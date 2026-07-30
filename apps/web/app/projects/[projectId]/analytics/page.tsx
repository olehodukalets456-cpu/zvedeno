import Link from "next/link";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  adAccounts,
  ads,
  adSets,
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
  | "sub1"
  | "sub2"
  | "sub3"
  | "account"
  | "campaign"
  | "adset"
  | "ad"
  | "date"
  | "week";

type SortKey = "spend" | "results" | "cpa" | "clicks" | "impressions" | "ctr" | "cpc";

type Metrics = Record<string, string | number | null>;

type SourceRow = {
  date: string;
  metrics: Metrics;
  accountId: string;
  accountName: string;
  campaignName: string;
  adSetName: string;
  adName: string;
  creativeName: string;
  thumbnailUrl: string | null;
  archivedMediaUrl: string | null;
};

type AggregateRow = {
  key: string;
  dimensions: Record<DimensionKey, string>;
  previewUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  sourceRows: number;
};

const DIMENSION_OPTIONS: Array<{ value: DimensionKey; label: string }> = [
  { value: "sub1", label: "sub1 · Напрямок" },
  { value: "sub2", label: "sub2 · Креатив" },
  { value: "sub3", label: "sub3 · Воронка" },
  { value: "account", label: "Рекламний кабінет" },
  { value: "campaign", label: "Кампанія" },
  { value: "adset", label: "Набір реклами" },
  { value: "ad", label: "Оголошення" },
  { value: "date", label: "Дата" },
  { value: "week", label: "Тиждень" }
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

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
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

function directionFromCampaign(campaignName: string): string {
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
  return DIMENSION_OPTIONS.some((option) => option.value === value);
}

function dimensionLabel(value: DimensionKey): string {
  return DIMENSION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function sourceDimensions(row: SourceRow): Record<DimensionKey, string> {
  return {
    sub1: directionFromCampaign(row.campaignName),
    sub2: row.creativeName || row.adName || "Без назви",
    sub3: funnelFromCampaign(row.campaignName),
    account: row.accountName || row.accountId,
    campaign: row.campaignName || "Без кампанії",
    adset: row.adSetName || "Без ad set",
    ad: row.adName || "Без оголошення",
    date: row.date,
    week: weekLabel(row.date)
  };
}

function sortValue(row: AggregateRow, key: SortKey): number | null {
  if (key === "spend") return row.spend;
  if (key === "results") return row.results;
  if (key === "clicks") return row.clicks;
  if (key === "impressions") return row.impressions;
  if (key === "cpa") return row.results > 0 ? row.spend / row.results : null;
  if (key === "cpc") return row.clicks > 0 ? row.spend / row.clicks : null;
  return row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null;
}

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const defaults = defaultRange();

  let from = validDate(single(query.from)) ? single(query.from) : defaults.from;
  let to = validDate(single(query.to)) ? single(query.to) : defaults.to;
  if (from > to) [from, to] = [to, from];

  const groupCandidates = [single(query.group1) || "sub1", single(query.group2) || "sub2", single(query.group3)];
  const groups = groupCandidates.filter(isDimension).filter((value, index, values) => values.indexOf(value) === index);
  if (groups.length === 0) groups.push("sub2");

  const directionFilter = single(query.direction);
  const funnelFilter = single(query.funnel);
  const accountFilter = single(query.account);
  const campaignFilter = single(query.campaign);
  const search = single(query.search).trim().toLocaleLowerCase("uk-UA");
  const requestedSort = single(query.sort);
  const sort: SortKey = SORT_OPTIONS.some((option) => option.value === requestedSort)
    ? requestedSort as SortKey
    : "spend";
  const sortDirection = single(query.order) === "asc" ? "asc" : "desc";

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
        adSetName: adSets.name,
        adName: ads.name,
        creativeName: mediaAssets.canonicalName,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        archivedMediaUrl: mediaAssets.archivedMediaUrl
      })
      .from(dailyInsights)
      .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
      .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
      .leftJoin(adSets, eq(dailyInsights.adSetId, adSets.id))
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
      adSetName: row.adSetName ?? "",
      adName: row.adName ?? "",
      creativeName: row.creativeName ?? row.adName ?? "Без назви",
      thumbnailUrl: row.thumbnailUrl,
      archivedMediaUrl: row.archivedMediaUrl
    }));

    const dimensionCache = rows.map((row) => ({ row, dimensions: sourceDimensions(row) }));
    const directions = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.sub1))).sort();
    const funnels = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.sub3))).sort();
    const accounts = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.account))).sort();
    const campaignNames = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.campaign))).sort();

    const filtered = dimensionCache.filter(({ row, dimensions }) => {
      if (directionFilter && dimensions.sub1 !== directionFilter) return false;
      if (funnelFilter && dimensions.sub3 !== funnelFilter) return false;
      if (accountFilter && dimensions.account !== accountFilter) return false;
      if (campaignFilter && dimensions.campaign !== campaignFilter) return false;
      if (search) {
        const haystack = [
          dimensions.sub1,
          dimensions.sub2,
          dimensions.sub3,
          dimensions.account,
          dimensions.campaign,
          dimensions.adset,
          dimensions.ad,
          row.accountId
        ].join(" ").toLocaleLowerCase("uk-UA");
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const aggregateMap = new Map<string, AggregateRow>();
    for (const { row, dimensions } of filtered) {
      const key = groups.map((group) => dimensions[group]).join("\u001f");
      const current = aggregateMap.get(key) ?? {
        key,
        dimensions,
        previewUrl: row.archivedMediaUrl ?? row.thumbnailUrl,
        spend: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
        sourceRows: 0
      };
      current.previewUrl ??= row.archivedMediaUrl ?? row.thumbnailUrl;
      current.spend += numberMetric(row.metrics, "spend");
      current.impressions += numberMetric(row.metrics, "impressions");
      current.clicks += numberMetric(row.metrics, "clicks");
      current.results += numberMetric(row.metrics, resultMetric);
      current.sourceRows += 1;
      aggregateMap.set(key, current);
    }

    const aggregates = Array.from(aggregateMap.values()).sort((left, right) => {
      const leftValue = sortValue(left, sort);
      const rightValue = sortValue(right, sort);
      if (leftValue === null && rightValue === null) return left.key.localeCompare(right.key, "uk-UA");
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const diff = leftValue - rightValue;
      return sortDirection === "asc" ? diff : -diff;
    });

    const totals = aggregates.reduce((accumulator, row) => {
      accumulator.spend += row.spend;
      accumulator.impressions += row.impressions;
      accumulator.clicks += row.clicks;
      accumulator.results += row.results;
      return accumulator;
    }, { spend: 0, impressions: 0, clicks: 0, results: 0 });

    const currency = project.currency ?? "USD";
    const totalCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const totalCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const totalCpa = totals.results > 0 ? totals.spend / totals.results : null;

    return (
      <main className="analyticsMain">
        <header className="analyticsHeader">
          <div>
            <Link className="backLink" href={`/projects/${project.id}`}>← До проєкту</Link>
            <div className="eyebrow">Meta report builder</div>
            <h1>{project.name}: аналітика</h1>
            <p>
              Дані Meta у стилі трекера. <strong>sub1</strong> — напрямок, <strong>sub2</strong> — назва креативу,
              <strong> sub3</strong> — воронка. Основний результат: <code>{resultMetric}</code>.
            </p>
          </div>
          <div className="analyticsHeaderActions">
            <form action={`/api/projects/${project.id}/sync`} method="post">
              <button className="secondaryButton" type="submit">Оновити Meta зараз</button>
            </form>
          </div>
        </header>

        <form className="analyticsFilters" method="get">
          <label className="fieldLabel">Від<input type="date" name="from" defaultValue={from} /></label>
          <label className="fieldLabel">До<input type="date" name="to" defaultValue={to} /></label>
          <label className="fieldLabel">Групування 1
            <select name="group1" defaultValue={groups[0] ?? "sub1"}>
              {DIMENSION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Групування 2
            <select name="group2" defaultValue={groups[1] ?? "sub2"}>
              <option value="">Не використовувати</option>
              {DIMENSION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Групування 3
            <select name="group3" defaultValue={groups[2] ?? ""}>
              <option value="">Не використовувати</option>
              {DIMENSION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Напрямок
            <select name="direction" defaultValue={directionFilter}>
              <option value="">Усі</option>
              {directions.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Воронка
            <select name="funnel" defaultValue={funnelFilter}>
              <option value="">Усі</option>
              {funnels.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Кабінет
            <select name="account" defaultValue={accountFilter}>
              <option value="">Усі</option>
              {accounts.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label className="fieldLabel analyticsWideFilter">Кампанія
            <select name="campaign" defaultValue={campaignFilter}>
              <option value="">Усі</option>
              {campaignNames.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label className="fieldLabel analyticsWideFilter">Пошук
            <input name="search" defaultValue={single(query.search)} placeholder="Креатив, кампанія, ad set..." />
          </label>
          <label className="fieldLabel">Сортувати
            <select name="sort" defaultValue={sort}>
              {SORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Порядок
            <select name="order" defaultValue={sortDirection}>
              <option value="desc">Від більшого</option>
              <option value="asc">Від меншого</option>
            </select>
          </label>
          <div className="analyticsFilterActions">
            <button className="primaryButton" type="submit">Застосувати</button>
            <Link className="secondaryButton" href={`/projects/${project.id}/analytics`}>Скинути</Link>
          </div>
        </form>

        <section className="analyticsSummary">
          <article><span>Спенд</span><strong>{money(totals.spend, currency)}</strong></article>
          <article><span>Покази</span><strong>{rounded(totals.impressions, 0)}</strong></article>
          <article><span>Кліки</span><strong>{rounded(totals.clicks, 0)}</strong></article>
          <article><span>Результати</span><strong>{rounded(totals.results, 0)}</strong></article>
          <article><span>CTR</span><strong>{rounded(totalCtr)}%</strong></article>
          <article><span>CPC</span><strong>{money(totalCpc, currency)}</strong></article>
          <article><span>CPA</span><strong>{totalCpa === null ? "—" : money(totalCpa, currency)}</strong></article>
        </section>

        <section className="analyticsTablePanel">
          <div className="analyticsTableMeta">
            <div>
              <strong>{aggregates.length}</strong> згрупованих рядків із {filtered.length} денних фактів
            </div>
            <small>Період: {from} — {to} · часовий пояс проєкту: {project.timezone}</small>
          </div>

          <div className="analyticsTableWrap">
            <table className="analyticsTable">
              <thead>
                <tr>
                  {groups.map((group) => <th key={group}>{dimensionLabel(group)}</th>)}
                  <th>Спенд</th>
                  <th>Покази</th>
                  <th>Кліки</th>
                  <th>Результати</th>
                  <th>CTR</th>
                  <th>CPC</th>
                  <th>CPA</th>
                </tr>
              </thead>
              <tbody>
                {aggregates.slice(0, 1000).map((row) => {
                  const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
                  const cpc = row.clicks > 0 ? row.spend / row.clicks : null;
                  const cpa = row.results > 0 ? row.spend / row.results : null;
                  return (
                    <tr key={row.key}>
                      {groups.map((group) => (
                        <td key={group}>
                          {group === "sub2" ? (
                            <div className="analyticsCreativeCell">
                              {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" /> : <span className="analyticsCreativeFallback">—</span>}
                              <span>{row.dimensions[group]}</span>
                            </div>
                          ) : row.dimensions[group]}
                        </td>
                      ))}
                      <td>{money(row.spend, currency)}</td>
                      <td>{rounded(row.impressions, 0)}</td>
                      <td>{rounded(row.clicks, 0)}</td>
                      <td>{rounded(row.results, 0)}</td>
                      <td>{rounded(ctr)}%</td>
                      <td>{cpc === null ? "—" : money(cpc, currency)}</td>
                      <td>{cpa === null ? "—" : money(cpa, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {aggregates.length === 0 && <div className="analyticsEmpty">За цими фільтрами немає даних.</div>}
          {aggregates.length > 1000 && <div className="configNotice">Показано перші 1000 рядків. Звузь період або додай фільтр.</div>}
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
