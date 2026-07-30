import Link from "next/link";
import type { ReactNode } from "react";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  adAccounts,
  ads,
  campaigns,
  createDatabase,
  dailyInsights,
  mediaAssets,
  projects,
  reportRecipes
} from "@zvedeno/database";

export const dynamic = "force-dynamic";

type AnalyticsPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DimensionKey =
  | "offer"
  | "week"
  | "creative"
  | "funnel"
  | "account"
  | "date";

type SortKey = "spend" | "results" | "cpa" | "clicks" | "impressions" | "ctr" | "cpc";
type Metrics = Record<string, string | number | null>;
type Dimensions = Record<DimensionKey, string>;

type SourceRow = {
  date: string;
  metrics: Metrics;
  accountId: string;
  accountName: string;
  campaignName: string;
  adName: string;
  creativeName: string;
  thumbnailUrl: string | null;
  archivedMediaUrl: string | null;
};

type DimensionRow = {
  row: SourceRow;
  dimensions: Dimensions;
};

type TreeNode = {
  key: string;
  label: string;
  dimension: DimensionKey | null;
  depth: number;
  previewUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  sourceRows: number;
  children: Map<string, TreeNode>;
};

const GROUP_OPTIONS: Array<{ value: DimensionKey; label: string }> = [
  { value: "offer", label: "Офер" },
  { value: "week", label: "Тиждень" },
  { value: "creative", label: "Креатив" },
  { value: "funnel", label: "Воронка" },
  { value: "account", label: "Кабінет" },
  { value: "date", label: "Дата" }
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "spend", label: "Спенд" },
  { value: "results", label: "Результати" },
  { value: "cpa", label: "CPA" },
  { value: "clicks", label: "Кліки" },
  { value: "impressions", label: "Покази" },
  { value: "ctr", label: "CTR" },
  { value: "cpc", label: "CPC" }
];

const SAVED_REPORTS = [
  { key: "job", label: "JOB", offer: "JOB" },
  { key: "channel", label: "Канал", offer: "DMND" },
  { key: "dwh", label: "DWH", offer: "DWH" }
] as const;

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasQueryKey(query: Record<string, string | string[] | undefined>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(query, key);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = addDays(to, -6);
  return { from: isoDate(from), to: isoDate(to) };
}

function offerFromCampaign(campaignName: string): string {
  const first = campaignName.trim().split(/[|\s—–-]+/u).find(Boolean);
  return (first ?? "OTHER").toLocaleUpperCase("uk-UA");
}

function funnelFromCampaign(campaignName: string): string {
  const tokens = campaignName
    .toLocaleUpperCase("uk-UA")
    .split(/[|\s—–_/-]+/u)
    .filter(Boolean);

  if (tokens.some((token) => token === "FORM" || token === "FORMS" || token === "ФОРМА")) {
    return "Лід-форма Meta";
  }
  if (tokens.some((token) => ["SITE", "LAND", "LANDING", "LEAD", "LEADS", "САЙТ"].includes(token))) {
    return "Лендінг / сайт";
  }
  return "Інше";
}

function mondayOf(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(date);
}

function weekLabel(dateValue: string): string {
  const start = mondayOf(dateValue);
  return `${start} — ${isoDate(addDays(new Date(`${start}T00:00:00Z`), 6))}`;
}

function numberMetric(metrics: Metrics, key: string): number {
  const raw = metrics[key];
  const parsed = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number, digits = 2): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("uk-UA", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${rounded(value)} ${currency}`;
  }
}

function isDimension(value: string): value is DimensionKey {
  return GROUP_OPTIONS.some((option) => option.value === value);
}

function dimensionLabel(value: DimensionKey): string {
  return GROUP_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function sourceDimensions(row: SourceRow): Dimensions {
  return {
    offer: offerFromCampaign(row.campaignName),
    week: weekLabel(row.date),
    creative: row.creativeName.trim() || row.adName.trim() || "Без назви",
    funnel: funnelFromCampaign(row.campaignName),
    account: row.accountName || row.accountId,
    date: row.date
  };
}

function displayMediaUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.hostname === "drive.google.com" || url.hostname.endsWith(".googleusercontent.com")) {
      const pathMatch = url.pathname.match(/\/d\/([^/]+)/);
      const id = url.searchParams.get("id") ?? pathMatch?.[1];
      if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w320`;
    }
  } catch {
    return value;
  }

  return value;
}

function sortValue(node: TreeNode, key: SortKey): number | null {
  if (key === "spend") return node.spend;
  if (key === "results") return node.results;
  if (key === "clicks") return node.clicks;
  if (key === "impressions") return node.impressions;
  if (key === "cpa") return node.results > 0 ? node.spend / node.results : null;
  if (key === "cpc") return node.clicks > 0 ? node.spend / node.clicks : null;
  return node.impressions > 0 ? (node.clicks / node.impressions) * 100 : null;
}

function addMetrics(node: TreeNode, row: SourceRow, resultMetric: string): void {
  node.spend += numberMetric(row.metrics, "spend");
  node.impressions += numberMetric(row.metrics, "impressions");
  node.clicks += numberMetric(row.metrics, "clicks");
  node.results += numberMetric(row.metrics, resultMetric);
  node.sourceRows += 1;
}

function buildTree(rows: DimensionRow[], groups: DimensionKey[], resultMetric: string): TreeNode {
  const root: TreeNode = {
    key: "total",
    label: "Всього",
    dimension: null,
    depth: 0,
    previewUrl: null,
    spend: 0,
    impressions: 0,
    clicks: 0,
    results: 0,
    sourceRows: 0,
    children: new Map()
  };

  for (const item of rows) {
    addMetrics(root, item.row, resultMetric);
    let parent = root;

    groups.forEach((dimension, index) => {
      const label = item.dimensions[dimension] || "—";
      const childMapKey = `${dimension}\u001f${label}`;
      let child = parent.children.get(childMapKey);

      if (!child) {
        child = {
          key: `${parent.key}\u001f${childMapKey}`,
          label,
          dimension,
          depth: index + 1,
          previewUrl: dimension === "creative"
            ? displayMediaUrl(item.row.archivedMediaUrl ?? item.row.thumbnailUrl)
            : null,
          spend: 0,
          impressions: 0,
          clicks: 0,
          results: 0,
          sourceRows: 0,
          children: new Map()
        };
        parent.children.set(childMapKey, child);
      }

      if (dimension === "creative" && !child.previewUrl) {
        child.previewUrl = displayMediaUrl(item.row.archivedMediaUrl ?? item.row.thumbnailUrl);
      }

      addMetrics(child, item.row, resultMetric);
      parent = child;
    });
  }

  return root;
}

function sortedChildren(node: TreeNode, sort: SortKey, order: "asc" | "desc"): TreeNode[] {
  return Array.from(node.children.values()).sort((left, right) => {
    const leftValue = sortValue(left, sort);
    const rightValue = sortValue(right, sort);

    if (leftValue === null && rightValue === null) return left.label.localeCompare(right.label, "uk-UA");
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;

    const difference = leftValue - rightValue;
    if (difference !== 0) return order === "asc" ? difference : -difference;
    return left.label.localeCompare(right.label, "uk-UA");
  });
}

function offerClass(value: string): string {
  return `trackerOffer trackerOffer${value.replace(/[^A-Za-z0-9]/g, "")}`;
}

function reportHref(projectId: string, from: string, to: string, offer: string): string {
  const params = new URLSearchParams({
    from,
    to,
    offer,
    group1: "week",
    group2: "creative",
    group3: "",
    group4: "",
    group5: "",
    sort: "spend",
    order: "desc"
  });
  return `/projects/${projectId}/analytics?${params.toString()}`;
}

function allOffersHref(projectId: string, from: string, to: string): string {
  const params = new URLSearchParams({
    from,
    to,
    group1: "offer",
    group2: "week",
    group3: "creative",
    group4: "",
    group5: "",
    sort: "spend",
    order: "desc"
  });
  return `/projects/${projectId}/analytics?${params.toString()}`;
}

function MetricCells({ node, currency }: { node: TreeNode; currency: string }): ReactNode {
  const ctr = node.impressions > 0 ? (node.clicks / node.impressions) * 100 : 0;
  const cpc = node.clicks > 0 ? node.spend / node.clicks : null;
  const cpa = node.results > 0 ? node.spend / node.results : null;

  return (
    <>
      <span className="trackerMetric">{money(node.spend, currency)}</span>
      <span className="trackerMetric">{rounded(node.impressions, 0)}</span>
      <span className="trackerMetric">{rounded(node.clicks, 0)}</span>
      <span className="trackerMetric">{rounded(node.results, 0)}</span>
      <span className="trackerMetric">{rounded(ctr)}%</span>
      <span className="trackerMetric">{cpc === null ? "—" : money(cpc, currency)}</span>
      <span className="trackerMetric">{cpa === null ? "—" : money(cpa, currency)}</span>
    </>
  );
}

function NodeLabel({ node, expandable }: { node: TreeNode; expandable: boolean }): ReactNode {
  return (
    <span className="trackerTreeLabel" style={{ paddingLeft: `${10 + node.depth * 18}px` }}>
      <span className={`trackerTreeCaret ${expandable ? "" : "isPlaceholder"}`}>▶</span>
      {node.dimension === "offer" && <i className={offerClass(node.label)} />}
      {node.dimension === "creative" && (
        node.previewUrl
          ? <img className="trackerTreePreview" src={node.previewUrl} alt="" loading="lazy" />
          : <span className="trackerTreePreview trackerCreativeFallback">—</span>
      )}
      <span className="trackerTreeLabelText">
        <strong>{node.label}</strong>
        {node.dimension && <small>{dimensionLabel(node.dimension)} · {node.sourceRows} фактів</small>}
      </span>
    </span>
  );
}

function TreeNodeView({
  node,
  currency,
  sort,
  order
}: {
  node: TreeNode;
  currency: string;
  sort: SortKey;
  order: "asc" | "desc";
}): ReactNode {
  const children = sortedChildren(node, sort, order);
  const expandable = children.length > 0;
  const rowClass = `trackerTreeRow ${node.depth === 0 ? "trackerTreeTotal" : ""}`;

  if (!expandable) {
    return (
      <div className={rowClass}>
        <NodeLabel node={node} expandable={false} />
        <MetricCells node={node} currency={currency} />
      </div>
    );
  }

  return (
    <details className={`trackerTreeDetails ${node.depth === 0 ? "trackerTreeRoot" : ""}`} open={node.depth === 0}>
      <summary className={rowClass}>
        <NodeLabel node={node} expandable />
        <MetricCells node={node} currency={currency} />
      </summary>
      <div className="trackerTreeChildren">
        {children.map((child) => (
          <TreeNodeView key={child.key} node={child} currency={currency} sort={sort} order={order} />
        ))}
      </div>
    </details>
  );
}

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const defaults = defaultRange();

  let from = validDate(single(query.from)) ? single(query.from) : defaults.from;
  let to = validDate(single(query.to)) ? single(query.to) : defaults.to;
  if (from > to) [from, to] = [to, from];

  const hasExplicitGroups = [1, 2, 3, 4, 5].some((index) => hasQueryKey(query, `group${index}`));
  const defaultGroups = ["offer", "week", "creative"];
  const groupCandidates = hasExplicitGroups
    ? [1, 2, 3, 4, 5].map((index) => single(query[`group${index}`]))
    : defaultGroups;
  const groups = groupCandidates
    .filter(isDimension)
    .filter((value, index, values) => values.indexOf(value) === index);

  const offerFilter = single(query.offer) || single(query.direction);
  const funnelFilter = single(query.funnel);
  const accountFilter = single(query.account);
  const search = single(query.search).trim().toLocaleLowerCase("uk-UA");
  const requestedSort = single(query.sort);
  const sort: SortKey = SORT_OPTIONS.some((option) => option.value === requestedSort)
    ? requestedSort as SortKey
    : "spend";
  const sortDirection: "asc" | "desc" = single(query.order) === "asc" ? "asc" : "desc";

  const { db, pool } = createDatabase();

  try {
    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        currency: projects.currency,
        timezone: projects.timezone
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return <main className="setupMain"><section className="emptyState"><h1>Проєкт не знайдений</h1></section></main>;
    }

    const [recipe] = await db
      .select({ config: reportRecipes.config })
      .from(reportRecipes)
      .where(eq(reportRecipes.projectId, project.id))
      .limit(1);

    const recipeConfig = (recipe?.config ?? {}) as Record<string, unknown>;
    const resultMetric = typeof recipeConfig.resultMetric === "string" && recipeConfig.resultMetric
      ? recipeConfig.resultMetric
      : "action.lead";

    const source = await db
      .select({
        date: dailyInsights.insightDate,
        metrics: dailyInsights.metrics,
        accountId: adAccounts.externalAccountId,
        accountName: adAccounts.name,
        campaignName: campaigns.name,
        adName: ads.name,
        creativeName: mediaAssets.canonicalName,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        archivedMediaUrl: mediaAssets.archivedMediaUrl
      })
      .from(dailyInsights)
      .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
      .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
      .leftJoin(ads, eq(dailyInsights.adId, ads.id))
      .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
      .where(and(
        eq(dailyInsights.projectId, project.id),
        gte(dailyInsights.insightDate, from),
        lte(dailyInsights.insightDate, to)
      ))
      .orderBy(asc(dailyInsights.insightDate));

    const rows: SourceRow[] = source.map((row) => ({
      date: row.date,
      metrics: row.metrics,
      accountId: row.accountId,
      accountName: row.accountName,
      campaignName: row.campaignName ?? "",
      adName: row.adName ?? "",
      creativeName: row.creativeName?.trim() || row.adName?.trim() || "Без назви",
      thumbnailUrl: row.thumbnailUrl,
      archivedMediaUrl: row.archivedMediaUrl
    }));

    const dimensionCache: DimensionRow[] = rows.map((row) => ({ row, dimensions: sourceDimensions(row) }));
    const offers = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.offer))).sort();
    const funnels = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.funnel))).sort();
    const accounts = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.account))).sort();

    const filtered = dimensionCache.filter(({ row, dimensions }) => {
      if (offerFilter && dimensions.offer !== offerFilter) return false;
      if (funnelFilter && dimensions.funnel !== funnelFilter) return false;
      if (accountFilter && dimensions.account !== accountFilter) return false;
      if (search) {
        const haystack = [dimensions.creative, row.adName].join(" ").toLocaleLowerCase("uk-UA");
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const tree = buildTree(filtered, groups, resultMetric);
    const currency = project.currency ?? "USD";
    const creativeCount = new Set(filtered.map(({ dimensions }) => dimensions.creative)).size;

    return (
      <main className="trackerPage">
        <header className="trackerHeader">
          <div className="trackerTitle">
            <span>ID: {project.id.slice(0, 8).toUpperCase()}</span>
            <strong>{project.name.toLocaleUpperCase("uk-UA")} · REPORT</strong>
          </div>
          <div className="trackerHeaderActions">
            <Link className="trackerButton trackerButtonGhost" href={`/projects/${project.id}`}>До проєкту</Link>
            <form action={`/api/projects/${project.id}/sync`} method="post">
              <button className="trackerButton trackerButtonGreen" type="submit">Оновити</button>
            </form>
          </div>
        </header>

        <nav className="savedReports" aria-label="Збережені звіти">
          <span className="savedReportsLabel">Збережені звіти</span>
          {SAVED_REPORTS.map((report) => (
            <Link
              className={`savedReportLink ${offerFilter === report.offer ? "isActive" : ""}`}
              href={reportHref(project.id, from, to, report.offer)}
              key={report.key}
            >
              <span className={offerClass(report.offer)} />
              {report.label}
            </Link>
          ))}
          <Link
            className={`savedReportLink ${offerFilter === "" ? "isActive" : ""}`}
            href={allOffersHref(project.id, from, to)}
          >
            Усі офери
          </Link>
        </nav>

        <form className="trackerControls" method="get">
          <div className="trackerControlRow">
            <label className="trackerField">
              <span>Офер</span>
              <select name="offer" defaultValue={offerFilter}>
                <option value="">Усі офери</option>
                {offers.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label className="trackerField">
              <span>Воронка</span>
              <select name="funnel" defaultValue={funnelFilter}>
                <option value="">Усі воронки</option>
                {funnels.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label className="trackerField trackerFieldWide">
              <span>Кабінет</span>
              <select name="account" defaultValue={accountFilter}>
                <option value="">Усі кабінети</option>
                {accounts.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label className="trackerField trackerSearch">
              <span>Пошук по крео</span>
              <input name="search" defaultValue={single(query.search)} placeholder="Назва креативу..." />
            </label>
          </div>

          <div className="trackerControlRow trackerGroupingRow">
            {[0, 1, 2, 3, 4].map((index) => (
              <label className="trackerField" key={index}>
                <span>Рівень {index + 1}</span>
                <select name={`group${index + 1}`} defaultValue={groups[index] ?? ""}>
                  <option value="">Без групування</option>
                  {GROUP_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="trackerControlRow trackerControlRowBottom">
            <label className="trackerField trackerDate">
              <span>Від</span>
              <input type="date" name="from" defaultValue={from} />
            </label>
            <label className="trackerField trackerDate">
              <span>До</span>
              <input type="date" name="to" defaultValue={to} />
            </label>
            <label className="trackerField">
              <span>Сортування</span>
              <select name="sort" defaultValue={sort}>
                {SORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="trackerField">
              <span>Порядок</span>
              <select name="order" defaultValue={sortDirection}>
                <option value="desc">За спаданням</option>
                <option value="asc">За зростанням</option>
              </select>
            </label>
            <button className="trackerButton trackerButtonGreen" type="submit">Застосувати</button>
            <Link className="trackerButton trackerButtonGhost" href={allOffersHref(project.id, from, to)}>Скинути</Link>
          </div>
        </form>

        <div className="trackerStatusBar">
          <span>Креативів із даними: <strong>{creativeCount}</strong></span>
          <span>Денних фактів: <strong>{filtered.length}</strong></span>
          <span>Період: <strong>{from} — {to}</strong></span>
          <span>Результат: <strong>{resultMetric}</strong></span>
          <span>Дерево: <strong>{groups.length ? groups.map(dimensionLabel).join(" → ") : "тільки total"}</strong></span>
        </div>

        <section className="trackerTreePanel">
          <div className="trackerTreeHeader trackerTreeRow">
            <span>Групування</span>
            <span>Спенд</span>
            <span>Покази</span>
            <span>Кліки</span>
            <span>Результати</span>
            <span>CTR</span>
            <span>CPC</span>
            <span>CPA</span>
          </div>
          <div className="trackerTreeBody">
            <TreeNodeView node={tree} currency={currency} sort={sort} order={sortDirection} />
          </div>
          {filtered.length === 0 && <div className="trackerEmpty">За цими фільтрами немає даних.</div>}
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
