import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
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
import {
  DateRangePicker,
  GroupingBuilder,
  type AnalyticsDatePreset
} from "./analytics-controls";

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
type DatePresetKey =
  | "today"
  | "yesterday"
  | "last7"
  | "last14"
  | "last30"
  | "last90"
  | "thisWeek"
  | "previousWeek"
  | "thisMonth"
  | "previousMonth"
  | "custom";
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

type SavedReport = {
  key: string;
  label: string;
  offer: string;
  funnel: string;
  account: string;
  groups: DimensionKey[];
  sort: SortKey;
  order: "asc" | "desc";
};

type ResolvedDateRange = {
  key: DatePresetKey;
  from: string;
  to: string;
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

const SAVED_REPORTS: SavedReport[] = [
  {
    key: "job",
    label: "JOB",
    offer: "JOB",
    funnel: "",
    account: "",
    groups: ["creative", "funnel", "week"],
    sort: "results",
    order: "desc"
  },
  {
    key: "channel",
    label: "Канал",
    offer: "DMND",
    funnel: "",
    account: "",
    groups: ["creative", "week"],
    sort: "results",
    order: "desc"
  },
  {
    key: "dwh",
    label: "DWH",
    offer: "DWH",
    funnel: "",
    account: "",
    groups: ["creative", "week"],
    sort: "results",
    order: "desc"
  },
  {
    key: "all",
    label: "Усі офери",
    offer: "",
    funnel: "",
    account: "",
    groups: ["offer", "week", "creative"],
    sort: "spend",
    order: "desc"
  }
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

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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

function todayInTimeZone(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return isoDate(new Date());
  }
}

function mondayOf(dateValue: string): string {
  const date = dateFromIso(dateValue);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(date);
}

function weekLabel(dateValue: string): string {
  const start = mondayOf(dateValue);
  return `${start} — ${isoDate(addDays(dateFromIso(start), 6))}`;
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

  return DATE_PRESET_LABELS.map((preset) => {
    if (preset.value === "custom") {
      return { ...preset, from: ranges.last7.from, to: ranges.last7.to };
    }
    return { ...preset, ...ranges[preset.value] };
  });
}

function isDatePreset(value: string): value is DatePresetKey {
  return DATE_PRESET_LABELS.some((preset) => preset.value === value);
}

function resolveDateRange(
  query: Record<string, string | string[] | undefined>,
  presets: AnalyticsDatePreset[]
): ResolvedDateRange {
  const requestedPreset = single(query.range);
  const customFrom = single(query.from);
  const customTo = single(query.to);
  const hasCustomDates = validDate(customFrom) && validDate(customTo);
  const key: DatePresetKey = isDatePreset(requestedPreset)
    ? requestedPreset
    : hasCustomDates
      ? "custom"
      : "last7";

  if (key === "custom" && hasCustomDates) {
    return customFrom <= customTo
      ? { key, from: customFrom, to: customTo }
      : { key, from: customTo, to: customFrom };
  }

  const selected = presets.find((preset) => preset.value === key)
    ?? presets.find((preset) => preset.value === "last7");

  if (!selected) throw new Error("Не вдалося визначити період звіту");
  return { key, from: selected.from, to: selected.to };
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

function reportHref(projectId: string, report: SavedReport, range: ResolvedDateRange): string {
  const params = new URLSearchParams({
    report: report.key,
    range: range.key,
    from: range.from,
    to: range.to,
    offer: report.offer,
    funnel: report.funnel,
    account: report.account,
    sort: report.sort,
    order: report.order
  });

  GROUP_OPTIONS.forEach((_, index) => {
    params.set(`group${index + 1}`, report.groups[index] ?? "");
  });

  return `/projects/${projectId}/analytics?${params.toString()}`;
}

function rowGridStyle(groups: DimensionKey[]): CSSProperties {
  const groupColumns = groups.length
    ? groups.map((group) => group === "creative" ? "minmax(230px, 1.35fr)" : "minmax(165px, 1fr)")
    : ["minmax(320px, 1fr)"];
  const metricColumns = Array.from({ length: 7 }, () => "minmax(92px, 112px)");
  const groupWidth = groups.length
    ? groups.reduce((sum, group) => sum + (group === "creative" ? 245 : 175), 0)
    : 320;

  return {
    gridTemplateColumns: [...groupColumns, ...metricColumns].join(" "),
    minWidth: `${Math.max(1120, groupWidth + 7 * 105)}px`
  };
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
    <span className="trackerTreeLabel">
      <span className={`trackerTreeCaret ${expandable ? "" : "isPlaceholder"}`}>▶</span>
      {node.dimension === "offer" && <i className={offerClass(node.label)} />}
      {node.dimension === "creative" && (
        node.previewUrl
          ? <img className="trackerTreePreview" src={node.previewUrl} alt="" loading="lazy" />
          : <span className="trackerTreePreview trackerCreativeFallback">—</span>
      )}
      <span className="trackerTreeLabelText">
        <strong>{node.label}</strong>
        {node.dimension && <small>{node.sourceRows} фактів</small>}
      </span>
    </span>
  );
}

function DimensionCells({
  node,
  groups,
  expandable
}: {
  node: TreeNode;
  groups: DimensionKey[];
  expandable: boolean;
}): ReactNode {
  const columnCount = Math.max(groups.length, 1);
  const activeColumn = node.depth === 0 ? 0 : Math.min(node.depth - 1, columnCount - 1);

  return Array.from({ length: columnCount }, (_, index) => (
    <span
      className={`trackerDimensionCell ${index === activeColumn ? "" : "trackerDimensionCellEmpty"}`}
      key={index}
    >
      {index === activeColumn && <NodeLabel node={node} expandable={expandable} />}
    </span>
  ));
}

function TreeNodeView({
  node,
  groups,
  currency,
  sort,
  order,
  gridStyle
}: {
  node: TreeNode;
  groups: DimensionKey[];
  currency: string;
  sort: SortKey;
  order: "asc" | "desc";
  gridStyle: CSSProperties;
}): ReactNode {
  const children = sortedChildren(node, sort, order);
  const expandable = children.length > 0;
  const rowClass = `trackerTreeRow ${node.depth === 0 ? "trackerTreeTotal" : ""}`;

  if (!expandable) {
    return (
      <div className={rowClass} style={gridStyle}>
        <DimensionCells node={node} groups={groups} expandable={false} />
        <MetricCells node={node} currency={currency} />
      </div>
    );
  }

  return (
    <details className={`trackerTreeDetails ${node.depth === 0 ? "trackerTreeRoot" : ""}`} open={node.depth === 0}>
      <summary className={rowClass} style={gridStyle}>
        <DimensionCells node={node} groups={groups} expandable />
        <MetricCells node={node} currency={currency} />
      </summary>
      <div className="trackerTreeChildren">
        {children.map((child) => (
          <TreeNodeView
            key={child.key}
            node={child}
            groups={groups}
            currency={currency}
            sort={sort}
            order={order}
            gridStyle={gridStyle}
          />
        ))}
      </div>
    </details>
  );
}

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
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

    const timeZone = project.timezone || "Europe/Kyiv";
    const datePresets = buildDatePresets(todayInTimeZone(timeZone));
    const range = resolveDateRange(query, datePresets);
    const activeReportKey = single(query.report);
    const activeReport = SAVED_REPORTS.find((report) => report.key === activeReportKey);

    const hasExplicitGroups = GROUP_OPTIONS.some((_, index) => hasQueryKey(query, `group${index + 1}`));
    const groupCandidates = hasExplicitGroups
      ? GROUP_OPTIONS.map((_, index) => single(query[`group${index + 1}`]))
      : activeReport?.groups ?? ["offer", "week", "creative"];
    const groups = groupCandidates
      .filter(isDimension)
      .filter((value, index, values) => values.indexOf(value) === index);

    const offerFilter = hasQueryKey(query, "offer")
      ? single(query.offer)
      : activeReport?.offer ?? "";
    const funnelFilter = hasQueryKey(query, "funnel")
      ? single(query.funnel)
      : activeReport?.funnel ?? "";
    const accountFilter = hasQueryKey(query, "account")
      ? single(query.account)
      : activeReport?.account ?? "";
    const search = single(query.search).trim().toLocaleLowerCase("uk-UA");
    const requestedSort = single(query.sort);
    const sort: SortKey = SORT_OPTIONS.some((option) => option.value === requestedSort)
      ? requestedSort as SortKey
      : activeReport?.sort ?? "spend";
    const sortDirection: "asc" | "desc" = single(query.order) === "asc"
      ? "asc"
      : single(query.order) === "desc"
        ? "desc"
        : activeReport?.order ?? "desc";

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
        gte(dailyInsights.insightDate, range.from),
        lte(dailyInsights.insightDate, range.to)
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
    const gridStyle = rowGridStyle(groups);
    const customPresetOptions = datePresets.map((preset) => (
      preset.value === "custom"
        ? { ...preset, from: range.from, to: range.to }
        : preset
    ));
    const resetReport = SAVED_REPORTS.find((report) => report.key === "all") ?? SAVED_REPORTS[0];

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
              className={`savedReportLink ${activeReport?.key === report.key ? "isActive" : ""}`}
              href={reportHref(project.id, report, range)}
              key={report.key}
            >
              {report.offer && <span className={offerClass(report.offer)} />}
              {report.label}
            </Link>
          ))}
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

          <GroupingBuilder options={GROUP_OPTIONS} initialGroups={groups} />

          <div className="trackerControlRow trackerControlRowBottom">
            <DateRangePicker
              presets={customPresetOptions}
              initialPreset={range.key}
              initialFrom={range.from}
              initialTo={range.to}
            />
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
            <button className="trackerButton trackerButtonGreen trackerApplyButton" type="submit">Застосувати</button>
            <Link
              className="trackerButton trackerButtonGhost trackerResetButton"
              href={reportHref(project.id, resetReport, range)}
            >
              Скинути
            </Link>
          </div>
        </form>

        <div className="trackerStatusBar">
          <span>Звіт: <strong>{activeReport?.label ?? "Кастомний"}</strong></span>
          <span>Креативів із даними: <strong>{creativeCount}</strong></span>
          <span>Денних фактів: <strong>{filtered.length}</strong></span>
          <span>Період: <strong>{range.from} — {range.to}</strong></span>
          <span>Результат: <strong>{resultMetric}</strong></span>
          <span>Групування: <strong>{groups.length ? groups.map(dimensionLabel).join(" → ") : "тільки total"}</strong></span>
        </div>

        <section className="trackerTreePanel">
          <div className="trackerTreeHeader trackerTreeRow" style={gridStyle}>
            {(groups.length ? groups : [null]).map((group, index) => (
              <span className="trackerDimensionHeader" key={group ?? index}>
                {group ? dimensionLabel(group) : "Звіт"}
              </span>
            ))}
            <span>Спенд</span>
            <span>Покази</span>
            <span>Кліки</span>
            <span>Результати</span>
            <span>CTR</span>
            <span>CPC</span>
            <span>CPA</span>
          </div>
          <div className="trackerTreeBody">
            <TreeNodeView
              node={tree}
              groups={groups}
              currency={currency}
              sort={sort}
              order={sortDirection}
              gridStyle={gridStyle}
            />
          </div>
          {filtered.length === 0 && <div className="trackerEmpty">За цими фільтрами немає даних.</div>}
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
