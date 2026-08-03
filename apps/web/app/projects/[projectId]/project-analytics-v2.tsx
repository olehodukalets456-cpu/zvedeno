import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  adAccounts,
  ads,
  campaigns,
  createDatabase,
  dailyInsights,
  mediaAssets,
  projectAdAccounts,
  projects,
  reportRecipes
} from "@zvedeno/database";
import {
  DateRangePicker,
  GroupingBuilder,
  type AnalyticsDatePreset
} from "./analytics/analytics-controls";
import type { ProjectAIReport } from "../../lib/project-ai";

type ProjectAnalyticsV2Props = {
  projectId: string;
  query: Record<string, string | string[] | undefined>;
};

type DimensionKey = "offer" | "creative" | "funnel" | "account" | "date";
type SortKey = "spend" | "results" | "cpa" | "clicks" | "impressions" | "ctr" | "cpc";
type DatePresetKey = "today" | "yesterday" | "last7" | "last14" | "last30" | "last90" | "thisWeek" | "previousWeek" | "thisMonth" | "previousMonth" | "custom";
type Metrics = Record<string, string | number | null>;

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
  offer: string;
  funnel: string;
  resultMetric: string;
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

type ReportTab = {
  key: string;
  label: string;
  offer: string;
  groups: DimensionKey[];
  sort: SortKey;
  order: "asc" | "desc";
};

type Classification = {
  offer: string;
  funnel: string;
  resultMetric: string;
};

const GROUP_OPTIONS: Array<{ value: DimensionKey; label: string }> = [
  { value: "offer", label: "Офер" },
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

const DATE_PRESET_LABELS: Array<{ value: DatePresetKey; label: string }> = [
  { value: "today", label: "Сьогодні" },
  { value: "yesterday", label: "Вчора" },
  { value: "last7", label: "Останні 7 днів" },
  { value: "last14", label: "Останні 14 днів" },
  { value: "last30", label: "Останні 30 днів" },
  { value: "last90", label: "Останні 90 днів" },
  { value: "thisWeek", label: "Цей тиждень" },
  { value: "previousWeek", label: "Попередній тиждень" },
  { value: "thisMonth", label: "Цей місяць" },
  { value: "previousMonth", label: "Попередній місяць" },
  { value: "custom", label: "Власний період" }
];

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasQueryKey(query: Record<string, string | string[] | undefined>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(query, key);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromIso(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function mondayOf(dateValue: string): string {
  const date = dateFromIso(dateValue);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(date);
}

function todayInTimeZone(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return isoDate(new Date());
  }
}

function buildDatePresets(today: string): AnalyticsDatePreset[] {
  const todayDate = dateFromIso(today);
  const yesterday = isoDate(addDays(todayDate, -1));
  const thisWeekStart = mondayOf(today);
  const previousWeekEnd = isoDate(addDays(dateFromIso(thisWeekStart), -1));
  const previousWeekStart = isoDate(addDays(dateFromIso(thisWeekStart), -7));
  const thisMonthStart = `${today.slice(0, 7)}-01`;
  const previousMonthEnd = isoDate(addDays(dateFromIso(thisMonthStart), -1));
  const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;
  const ranges: Record<Exclude<DatePresetKey, "custom">, { from: string; to: string }> = {
    today: { from: today, to: today },
    yesterday: { from: yesterday, to: yesterday },
    last7: { from: isoDate(addDays(todayDate, -6)), to: today },
    last14: { from: isoDate(addDays(todayDate, -13)), to: today },
    last30: { from: isoDate(addDays(todayDate, -29)), to: today },
    last90: { from: isoDate(addDays(todayDate, -89)), to: today },
    thisWeek: { from: thisWeekStart, to: today },
    previousWeek: { from: previousWeekStart, to: previousWeekEnd },
    thisMonth: { from: thisMonthStart, to: today },
    previousMonth: { from: previousMonthStart, to: previousMonthEnd }
  };
  return DATE_PRESET_LABELS.map((preset) => preset.value === "custom"
    ? { ...preset, from: ranges.last7.from, to: ranges.last7.to }
    : { ...preset, ...ranges[preset.value] });
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function resolveRange(query: Record<string, string | string[] | undefined>, presets: AnalyticsDatePreset[]) {
  const requested = single(query.range) as DatePresetKey;
  const from = single(query.from);
  const to = single(query.to);
  if (requested === "custom" && validDate(from) && validDate(to)) {
    return { key: "custom" as const, from: from <= to ? from : to, to: from <= to ? to : from };
  }
  const selected = presets.find((preset) => preset.value === requested)
    ?? presets.find((preset) => preset.value === "last7");
  if (!selected) throw new Error("Date range unavailable");
  return { key: selected.value as DatePresetKey, from: selected.from, to: selected.to };
}

function isDimension(value: string): value is DimensionKey {
  return GROUP_OPTIONS.some((option) => option.value === value);
}

function dimensionLabel(value: DimensionKey): string {
  return GROUP_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function numberMetric(metrics: Metrics, key: string): number {
  const raw = metrics[key];
  const parsed = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number, digits = 2): string {
  return new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("uk-UA", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${rounded(value)} ${currency}`;
  }
}

function cleanOffer(value: string): string {
  return value.trim().toLocaleUpperCase("uk-UA").replace(/[^A-ZА-ЯІЇЄҐ0-9]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "GENERAL";
}

function fallbackOffer(campaignName: string): string {
  return cleanOffer(campaignName.split(/[|—–:\-]/u)[0] ?? campaignName.split(/\s+/u)[0] ?? "GENERAL");
}

function fallbackFunnel(campaignName: string): string {
  const tokens = campaignName.toLocaleUpperCase("uk-UA").split(/[|\s—–_/:\-]+/u).filter(Boolean);
  if (tokens.some((token) => ["FORM", "FORMS", "LEADFORM", "ФОРМА"].includes(token))) return "Лід-форма Meta";
  if (tokens.some((token) => ["BOT", "БОТ"].includes(token))) return "Telegram-бот";
  if (tokens.some((token) => ["TG", "TELEGRAM", "CHANNEL", "CHANEL", "КАНАЛ"].includes(token))) return "Telegram через прокладку";
  if (tokens.some((token) => ["SITE", "LAND", "LANDING", "WEBSITE", "САЙТ"].includes(token))) return "Сайт / лендінг";
  if (tokens.some((token) => ["MESSAGE", "MESSAGES", "DIRECT", "WHATSAPP", "MESSENGER"].includes(token))) return "Переписки";
  return "Інше";
}

function bestMetric(metrics: Metrics): string {
  const preferred = ["action.purchase", "action.omni_purchase", "action.lead", "action.messaging_conversation_started_7d", "action.complete_registration", "action.link_click"];
  return preferred.find((metric) => numberMetric(metrics, metric) > 0) ?? "action.lead";
}

function parseAIReport(config: Record<string, unknown>): ProjectAIReport | null {
  if (!config.aiReport || typeof config.aiReport !== "object") return null;
  const report = config.aiReport as Partial<ProjectAIReport>;
  return Array.isArray(report.offers) && Array.isArray(report.campaignMap) ? report as ProjectAIReport : null;
}

function classificationMap(report: ProjectAIReport | null): Map<string, Classification> {
  const map = new Map<string, Classification>();
  for (const item of report?.campaignMap ?? []) {
    map.set(item.campaignName.trim(), { offer: cleanOffer(item.offer), funnel: item.funnel || "Інше", resultMetric: item.resultMetric || "action.lead" });
  }
  return map;
}

function reportTabs(report: ProjectAIReport | null, config: Record<string, unknown>, actualOffers: string[]): ReportTab[] {
  const configured = report?.offers?.map((offer) => ({ key: cleanOffer(offer.key), label: offer.label || offer.key })) ?? [];
  const directions = Array.isArray(config.directions)
    ? config.directions
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({ key: cleanOffer(String(item.key ?? "GENERAL")), label: String(item.key ?? "General") }))
    : [];
  const candidates = configured.length ? configured : directions.length ? directions : actualOffers.map((key) => ({ key, label: key }));
  const unique = Array.from(new Map(candidates.map((item) => [item.key, item])).values());
  const defaultGroups = (report?.defaultGroups ?? ["creative", "funnel"]).filter(isDimension);
  const groups = defaultGroups.length ? defaultGroups : ["creative", "funnel"] as DimensionKey[];
  const tabs = unique.map((item) => ({ key: item.key.toLocaleLowerCase("en-US"), label: item.label, offer: item.key, groups, sort: "results" as const, order: "desc" as const }));
  tabs.push({ key: "all", label: "Усі напрями", offer: "", groups: unique.length > 1 ? ["offer", "creative", "funnel"] : groups, sort: "spend", order: "desc" });
  return tabs;
}

function tabHref(projectId: string, tab: ReportTab, range: { key: DatePresetKey; from: string; to: string }): string {
  const params = new URLSearchParams({ report: tab.key, range: range.key, from: range.from, to: range.to, offer: tab.offer, account: "", sort: tab.sort, order: tab.order });
  GROUP_OPTIONS.forEach((_, index) => params.set(`group${index + 1}`, tab.groups[index] ?? ""));
  return `/projects/${projectId}/analytics?${params.toString()}`;
}

function displayMediaUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "drive.google.com" || url.hostname.endsWith(".googleusercontent.com")) {
      const id = url.searchParams.get("id") ?? url.pathname.match(/\/d\/([^/]+)/)?.[1];
      if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w320`;
    }
  } catch {
    return value;
  }
  return value;
}

function addMetrics(node: TreeNode, row: SourceRow): void {
  node.spend += numberMetric(row.metrics, "spend");
  node.impressions += numberMetric(row.metrics, "impressions");
  node.clicks += numberMetric(row.metrics, "clicks");
  node.results += numberMetric(row.metrics, row.resultMetric);
  node.sourceRows += 1;
}

function dimensionValue(row: SourceRow, dimension: DimensionKey): string {
  if (dimension === "offer") return row.offer;
  if (dimension === "creative") return row.creativeName;
  if (dimension === "funnel") return row.funnel;
  if (dimension === "account") return `${row.accountName || row.accountId} · ${row.accountId}`;
  return row.date;
}

function buildTree(rows: SourceRow[], groups: DimensionKey[]): TreeNode {
  const root: TreeNode = { key: "total", label: "Всього", dimension: null, depth: 0, previewUrl: null, spend: 0, impressions: 0, clicks: 0, results: 0, sourceRows: 0, children: new Map() };
  for (const row of rows) {
    addMetrics(root, row);
    let parent = root;
    groups.forEach((dimension, index) => {
      const label = dimensionValue(row, dimension) || "—";
      const childKey = `${dimension}\u001f${label}`;
      let child = parent.children.get(childKey);
      if (!child) {
        child = { key: `${parent.key}\u001f${childKey}`, label, dimension, depth: index + 1, previewUrl: dimension === "creative" ? displayMediaUrl(row.archivedMediaUrl ?? row.thumbnailUrl) : null, spend: 0, impressions: 0, clicks: 0, results: 0, sourceRows: 0, children: new Map() };
        parent.children.set(childKey, child);
      }
      addMetrics(child, row);
      parent = child;
    });
  }
  return root;
}

function sortValue(node: TreeNode, key: SortKey): number | null {
  if (key === "spend") return node.spend;
  if (key === "results") return node.results;
  if (key === "clicks") return node.clicks;
  if (key === "impressions") return node.impressions;
  if (key === "cpa") return node.results > 0 ? node.spend / node.results : null;
  if (key === "cpc") return node.clicks > 0 ? node.spend / node.clicks : null;
  return node.impressions > 0 ? node.clicks / node.impressions * 100 : null;
}

function sortedChildren(node: TreeNode, sort: SortKey, order: "asc" | "desc"): TreeNode[] {
  return Array.from(node.children.values()).sort((left, right) => {
    const leftValue = sortValue(left, sort);
    const rightValue = sortValue(right, sort);
    if (leftValue === null && rightValue === null) return left.label.localeCompare(right.label, "uk-UA");
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const difference = leftValue - rightValue;
    return difference === 0 ? left.label.localeCompare(right.label, "uk-UA") : order === "asc" ? difference : -difference;
  });
}

function gridStyle(groups: DimensionKey[]): CSSProperties {
  const count = Math.max(groups.length, 1);
  const dimensions = groups.length ? groups.map((group) => group === "creative" ? "minmax(220px, 1.55fr)" : group === "account" ? "minmax(185px, 1.25fr)" : "minmax(135px, .9fr)") : ["minmax(280px, 1.8fr)"];
  const metrics = Array.from({ length: 7 }, () => count >= 3 ? "minmax(66px, .62fr)" : "minmax(76px, .7fr)");
  return { gridTemplateColumns: [...dimensions, ...metrics].join(" "), minWidth: `${count >= 4 ? 1160 : count === 3 ? 1040 : 980}px`, width: "100%" };
}

function MetricCells({ node, currency }: { node: TreeNode; currency: string }): ReactNode {
  const ctr = node.impressions > 0 ? node.clicks / node.impressions * 100 : 0;
  const cpc = node.clicks > 0 ? node.spend / node.clicks : null;
  const cpa = node.results > 0 ? node.spend / node.results : null;
  return <>
    <span className="trackerMetric">{money(node.spend, currency)}</span>
    <span className="trackerMetric">{rounded(node.impressions, 0)}</span>
    <span className="trackerMetric">{rounded(node.clicks, 0)}</span>
    <span className="trackerMetric">{rounded(node.results, 0)}</span>
    <span className="trackerMetric">{rounded(ctr)}%</span>
    <span className="trackerMetric">{cpc === null ? "—" : money(cpc, currency)}</span>
    <span className="trackerMetric">{cpa === null ? "—" : money(cpa, currency)}</span>
  </>;
}

function NodeLabel({ node, expandable }: { node: TreeNode; expandable: boolean }): ReactNode {
  return <span className="trackerTreeLabel">
    <span className={`trackerTreeCaret ${expandable ? "" : "isPlaceholder"}`}>▶</span>
    {node.dimension === "creative" && (node.previewUrl ? <img className="trackerTreePreview" src={node.previewUrl} alt="" loading="lazy" /> : <span className="trackerTreePreview trackerCreativeFallback">—</span>)}
    <span className="trackerTreeLabelText" title={node.label}><strong>{node.label}</strong>{node.dimension && <small>{node.sourceRows} фактів</small>}</span>
  </span>;
}

function DimensionCells({ node, groups, expandable }: { node: TreeNode; groups: DimensionKey[]; expandable: boolean }): ReactNode {
  const count = Math.max(groups.length, 1);
  if (node.depth === 0) return <span className="trackerDimensionCell trackerDimensionTotalCell" style={{ gridColumn: `1 / span ${count}` }}><NodeLabel node={node} expandable={expandable} /></span>;
  const active = Math.min(node.depth - 1, count - 1);
  return Array.from({ length: count }, (_, index) => <span className={`trackerDimensionCell ${index === active ? "" : "trackerDimensionCellEmpty"}`} key={index}>{index === active && <NodeLabel node={node} expandable={expandable} />}</span>);
}

function TreeView({ node, groups, currency, sort, order, style }: { node: TreeNode; groups: DimensionKey[]; currency: string; sort: SortKey; order: "asc" | "desc"; style: CSSProperties }): ReactNode {
  const children = sortedChildren(node, sort, order);
  const expandable = children.length > 0;
  const rowClass = `trackerTreeRow ${node.depth === 0 ? "trackerTreeTotal" : ""}`;
  if (!expandable) return <div className={rowClass} style={style}><DimensionCells node={node} groups={groups} expandable={false} /><MetricCells node={node} currency={currency} /></div>;
  return <details className={`trackerTreeDetails ${node.depth === 0 ? "trackerTreeRoot" : ""}`} open>
    <summary className={rowClass} style={style}><DimensionCells node={node} groups={groups} expandable /><MetricCells node={node} currency={currency} /></summary>
    <div className="trackerTreeChildren">{children.map((child) => <TreeView key={child.key} node={child} groups={groups} currency={currency} sort={sort} order={order} style={style} />)}</div>
  </details>;
}

export async function ProjectAnalyticsV2({ projectId, query }: ProjectAnalyticsV2Props) {
  const { db, pool } = createDatabase();
  try {
    const [project] = await db.select({ id: projects.id, name: projects.name, currency: projects.currency, timezone: projects.timezone }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return <main className="setupMain"><section className="emptyState"><h1>Проєкт не знайдений</h1></section></main>;

    const [recipe] = await db.select({ config: reportRecipes.config }).from(reportRecipes).where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true))).limit(1);
    const config = (recipe?.config ?? {}) as Record<string, unknown>;
    const aiReport = parseAIReport(config);
    const map = classificationMap(aiReport);
    const presets = buildDatePresets(todayInTimeZone(project.timezone || "Europe/Kyiv"));
    const range = resolveRange(query, presets);

    const linkedAccounts = await db.select({ externalId: adAccounts.externalAccountId, name: adAccounts.name, status: adAccounts.status }).from(projectAdAccounts).innerJoin(adAccounts, eq(projectAdAccounts.adAccountId, adAccounts.id)).where(and(eq(projectAdAccounts.projectId, project.id), isNull(projectAdAccounts.activeTo))).orderBy(asc(adAccounts.status), asc(adAccounts.name));
    const source = await db
      .select({ date: dailyInsights.insightDate, metrics: dailyInsights.metrics, accountId: adAccounts.externalAccountId, accountName: adAccounts.name, campaignName: campaigns.name, adName: ads.name, creativeName: mediaAssets.canonicalName, thumbnailUrl: mediaAssets.thumbnailUrl, archivedMediaUrl: mediaAssets.archivedMediaUrl })
      .from(dailyInsights)
      .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
      .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
      .leftJoin(ads, eq(dailyInsights.adId, ads.id))
      .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
      .where(and(eq(dailyInsights.projectId, project.id), gte(dailyInsights.insightDate, range.from), lte(dailyInsights.insightDate, range.to)))
      .orderBy(asc(dailyInsights.insightDate));

    const rows: SourceRow[] = source.map((row) => {
      const campaignName = row.campaignName ?? "";
      const classification = map.get(campaignName.trim());
      const metrics = (row.metrics ?? {}) as Metrics;
      return {
        date: row.date,
        metrics,
        accountId: row.accountId,
        accountName: row.accountName,
        campaignName,
        adName: row.adName ?? "",
        creativeName: row.creativeName?.trim() || row.adName?.trim() || "Без назви",
        thumbnailUrl: row.thumbnailUrl,
        archivedMediaUrl: row.archivedMediaUrl,
        offer: classification?.offer ?? fallbackOffer(campaignName),
        funnel: classification?.funnel ?? fallbackFunnel(campaignName),
        resultMetric: classification?.resultMetric ?? (typeof config.resultMetric === "string" ? config.resultMetric : bestMetric(metrics))
      };
    });

    const actualOffers = Array.from(new Set(rows.map((row) => row.offer))).filter(Boolean).sort();
    const tabs = reportTabs(aiReport, config, actualOffers);
    const activeTab = tabs.find((tab) => tab.key === single(query.report)) ?? tabs[0] ?? { key: "all", label: "Огляд", offer: "", groups: ["creative", "funnel"] as DimensionKey[], sort: "spend" as SortKey, order: "desc" as const };
    const explicitGroups = GROUP_OPTIONS.some((_, index) => hasQueryKey(query, `group${index + 1}`));
    const groups = (explicitGroups ? GROUP_OPTIONS.map((_, index) => single(query[`group${index + 1}`])) : activeTab.groups).filter(isDimension).filter((value, index, values) => values.indexOf(value) === index);
    const offerFilter = hasQueryKey(query, "offer") ? single(query.offer) : activeTab.offer;
    const accountFilter = single(query.account);
    const search = single(query.search).trim().toLocaleLowerCase("uk-UA");
    const requestedSort = single(query.sort);
    const sort = SORT_OPTIONS.some((option) => option.value === requestedSort) ? requestedSort as SortKey : activeTab.sort;
    const order: "asc" | "desc" = single(query.order) === "asc" ? "asc" : "desc";

    const filtered = rows.filter((row) => {
      if (offerFilter && row.offer !== offerFilter) return false;
      if (accountFilter && row.accountId !== accountFilter) return false;
      if (search && !`${row.creativeName} ${row.adName}`.toLocaleLowerCase("uk-UA").includes(search)) return false;
      return true;
    });

    const tree = buildTree(filtered, groups);
    const style = gridStyle(groups);
    const currency = project.currency ?? "USD";
    const customPresets = presets.map((preset) => preset.value === "custom" ? { ...preset, from: range.from, to: range.to } : preset);
    const resetTab = tabs.find((tab) => tab.key === "all") ?? activeTab;

    return <main className="trackerPage aiShell aiAnalyticsPage">
      <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
      <header className="trackerHeader">
        <div className="trackerTitle"><span>ID: {project.id.slice(0, 8).toUpperCase()}</span><strong>{project.name.toLocaleUpperCase("uk-UA")} · AI REPORT</strong></div>
        <div className="trackerHeaderActions"><Link className="trackerButton trackerButtonGhost" href={`/projects/${project.id}`}>До проєкту</Link><form action={`/api/projects/${project.id}/sync`} method="post"><button className="trackerButton trackerButtonGreen" type="submit">Оновити</button></form></div>
      </header>

      <nav className="savedReports" aria-label="Звіти проєкту"><span className="savedReportsLabel">Звіти</span>{tabs.map((tab) => <Link className={`savedReportLink ${activeTab.key === tab.key ? "isActive" : ""}`} href={tabHref(project.id, tab, range)} key={tab.key}>{tab.label}</Link>)}</nav>

      <form className="trackerControls" method="get">
        <div className="trackerControlRow trackerControlRowPrimary">
          <label className="trackerField"><span>Офер</span><select name="offer" defaultValue={offerFilter}><option value="">Усі напрями</option>{Array.from(new Map(tabs.filter((tab) => tab.offer).map((tab) => [tab.offer, tab.label])).entries()).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="trackerField trackerFieldWide"><span>Кабінет</span><select name="account" defaultValue={accountFilter}><option value="">Усі кабінети</option>{linkedAccounts.map((account) => <option value={account.externalId} key={account.externalId}>{account.name} · {account.externalId}{account.status === "active" ? "" : " · недоступний"}</option>)}</select></label>
          <label className="trackerField trackerSearch"><span>Пошук по крео</span><input name="search" defaultValue={single(query.search)} placeholder="Назва креативу..." /></label>
        </div>
        <GroupingBuilder options={GROUP_OPTIONS} initialGroups={groups} />
        <div className="trackerControlRow trackerControlRowBottom">
          <DateRangePicker presets={customPresets} initialPreset={range.key} initialFrom={range.from} initialTo={range.to} />
          <label className="trackerField"><span>Сортування</span><select name="sort" defaultValue={sort}>{SORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="trackerField"><span>Порядок</span><select name="order" defaultValue={order}><option value="desc">За спаданням</option><option value="asc">За зростанням</option></select></label>
          <button className="trackerButton trackerButtonGreen trackerApplyButton" type="submit">Застосувати</button>
          <Link className="trackerButton trackerButtonGhost trackerResetButton" href={tabHref(project.id, resetTab, range)}>Скинути</Link>
        </div>
      </form>

      <div className="trackerStatusBar"><span>Звіт: <strong>{activeTab.label}</strong></span><span>Креативів: <strong>{new Set(filtered.map((row) => row.creativeName)).size}</strong></span><span>Денних фактів: <strong>{filtered.length}</strong></span><span>Період: <strong>{range.from} — {range.to}</strong></span><span>AI: <strong>{aiReport?.status ?? "fallback"}</strong></span><span>Групування: <strong>{groups.length ? groups.map(dimensionLabel).join(" → ") : "тільки total"}</strong></span></div>

      <section className="trackerTreePanel" key={groups.join("|") || "total"}>
        <div className="trackerTreeHeader trackerTreeRow" style={style}>{(groups.length ? groups : [null]).map((group, index) => <span className="trackerDimensionHeader" key={group ?? index}>{group ? dimensionLabel(group) : "Звіт"}</span>)}<span>Спенд</span><span>Покази</span><span>Кліки</span><span>Результати</span><span>CTR</span><span>CPC</span><span>CPA</span></div>
        <div className="trackerTreeBody"><TreeView node={tree} groups={groups} currency={currency} sort={sort} order={order} style={style} /></div>
        {filtered.length === 0 && <div className="trackerEmpty">У цьому проєкті немає даних за вибраними умовами.</div>}
      </section>
    </main>;
  } finally {
    await pool.end();
  }
}
