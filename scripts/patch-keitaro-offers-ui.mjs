import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/app/projects/[projectId]/analytics/page.tsx";
let source = readFileSync(path, "utf8");

if (source.includes('const OFFER_OPTIONS = ["JOB", "DMND", "DWH"] as const;')) {
  console.log("Keitaro offers UI patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Keitaro offers UI patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

function replaceAllChecked(search, replacement, expectedCount, label) {
  const count = source.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Keitaro offers UI patch failed: ${label}; expected ${expectedCount}, found ${count}`);
  }
  source = source.split(search).join(replacement);
}

replaceOnce(
  `  { value: "week", label: "Тиждень" },\n`,
  "",
  "remove week grouping option"
);

replaceOnce(
  `const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [`,
  `const OFFER_OPTIONS = ["JOB", "DMND", "DWH"] as const;\n\nconst SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [`,
  "canonical offer options"
);

replaceOnce(
  `    label: "Канал",`,
  `    label: "DMND",`,
  "rename channel offer tab"
);

replaceOnce(
  `    groups: ["creative", "funnel", "week"],`,
  `    groups: ["creative", "funnel"],`,
  "remove week from JOB preset"
);

replaceAllChecked(
  `    groups: ["creative", "week"],`,
  `    groups: ["creative", "funnel"],`,
  2,
  "replace channel and DWH preset grouping"
);

replaceAllChecked(
  `["offer", "week", "creative"]`,
  `["offer", "creative", "funnel"]`,
  2,
  "replace all-offers and fallback grouping"
);

replaceOnce(
  `function offerFromCampaign(campaignName: string): string {
  const first = campaignName.trim().split(/[|\\s—–-]+/u).find(Boolean);
  return (first ?? "OTHER").toLocaleUpperCase("uk-UA");
}`,
  `function offerFromCampaign(campaignName: string): string {
  const first = campaignName.trim().split(/[|\\s—–-]+/u).find(Boolean);
  const normalized = (first ?? "OTHER").toLocaleUpperCase("uk-UA");
  return OFFER_OPTIONS.includes(normalized as (typeof OFFER_OPTIONS)[number])
    ? normalized
    : "OTHER";
}`,
  "strict offer routing by campaign naming"
);

replaceOnce(
  `function funnelFromCampaign(campaignName: string): string {
  const tokens = campaignName
    .toLocaleUpperCase("uk-UA")
    .split(/[|\\s—–_/-]+/u)
    .filter(Boolean);

  if (tokens.some((token) => token === "FORM" || token === "FORMS" || token === "ФОРМА")) {
    return "Лід-форма Meta";
  }
  if (tokens.some((token) => ["SITE", "LAND", "LANDING", "LEAD", "LEADS", "САЙТ"].includes(token))) {
    return "Лендінг / сайт";
  }
  return "Інше";
}`,
  `function funnelFromCampaign(campaignName: string): string {
  const tokens = campaignName
    .toLocaleUpperCase("uk-UA")
    .split(/[|\\s—–_/-]+/u)
    .filter(Boolean);

  if (tokens.some((token) => token === "FORM" || token === "FORMS" || token === "ФОРМА")) {
    return "Лід-форма Meta";
  }
  if (tokens.includes("BOT")) {
    return "Telegram-бот";
  }
  if (tokens.some((token) => ["TG", "TELEGRAM", "CHANNEL", "CHANEL"].includes(token))) {
    return "Telegram через прокладку";
  }
  if (tokens.some((token) => ["SITE", "LAND", "LANDING", "LEAD", "LEADS", "САЙТ"].includes(token))) {
    return "Сайт";
  }
  return "Інше";
}`,
  "campaign funnel routing"
);

replaceOnce(
  `function addMetrics(node: TreeNode, row: SourceRow, resultMetric: string): void {
  node.spend += numberMetric(row.metrics, "spend");
  node.impressions += numberMetric(row.metrics, "impressions");
  node.clicks += numberMetric(row.metrics, "clicks");
  node.results += numberMetric(row.metrics, resultMetric);
  node.sourceRows += 1;
}`,
  `function resultMetricForRow(row: SourceRow, fallbackMetric: string): string {
  return offerFromCampaign(row.campaignName) === "DWH"
    && funnelFromCampaign(row.campaignName) === "Telegram-бот"
      ? "action.purchase"
      : fallbackMetric;
}

function addMetrics(node: TreeNode, row: SourceRow, resultMetric: string): void {
  node.spend += numberMetric(row.metrics, "spend");
  node.impressions += numberMetric(row.metrics, "impressions");
  node.clicks += numberMetric(row.metrics, "clicks");
  node.results += numberMetric(row.metrics, resultMetricForRow(row, resultMetric));
  node.sourceRows += 1;
}`,
  "purchase metric for DWH BOT campaigns"
);

replaceOnce(
  `    const offers = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.offer))).sort();`,
  `    const offers = [...OFFER_OPTIONS];`,
  "always show all three project offers"
);

replaceOnce(
  '<details className={`trackerTreeDetails ${node.depth === 0 ? "trackerTreeRoot" : ""}`} open={node.depth === 0}>',
  '<details className={`trackerTreeDetails ${node.depth === 0 ? "trackerTreeRoot" : ""}`} open>',
  "auto-expand grouping rows"
);

replaceOnce(
  `<nav className="savedReports" aria-label="Збережені звіти">\n          <span className="savedReportsLabel">Збережені звіти</span>`,
  `<nav className="savedReports" aria-label="Офери">\n          <span className="savedReportsLabel">Офери</span>`,
  "rename saved reports navigation"
);

replaceOnce(
  `<div className="trackerControlRow">`,
  `<div className="trackerControlRow trackerControlRowPrimary">`,
  "primary control row class"
);

replaceOnce(
  `            <label className="trackerField">
              <span>Воронка</span>
              <select name="funnel" defaultValue={funnelFilter}>
                <option value="">Усі воронки</option>
                {funnels.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
`,
  "",
  "remove top funnel filter"
);

replaceOnce(
  `<span>Результат: <strong>{resultMetric}</strong></span>`,
  `<span>Результат: <strong>за ціллю кампанії</strong></span>`,
  "result metric status label"
);

writeFileSync(path, source);
console.log("Applied Keitaro-style offers, funnels and expanded grouping UI");
