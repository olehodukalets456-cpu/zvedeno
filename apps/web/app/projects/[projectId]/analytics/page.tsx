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
  | "offer"
  | "account"
  | "campaign"
  | "adset"
  | "funnel"
  | "date"
  | "week";

type SortKey = "spend" | "results" | "cpa" | "clicks" | "impressions" | "ctr" | "cpc";
type Metrics = Record<string, string | number | null>;
type Dimensions = Record<DimensionKey, string> & { creative: string };

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
  dimensions: Dimensions;
  previewUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  sourceRows: number;
};

const GROUP_OPTIONS: Array<{ value: DimensionKey; label: string }> = [
  { value: "offer", label: "Офер" },
  { value: "funnel", label: "Воронка" },
  { value: "account", label: "Кабінет" },
  { value: "campaign", label: "Кампанія" },
  { value: "adset", label: "Адсет" },
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
    creative: row.creativeName || row.adName || "Без назви",
    funnel: funnelFromCampaign(row.campaignName),
    account: row.accountName || row.accountId,
    campaign: row.campaignName || "Без кампанії",
    adset: row.adSetName || "Без ad set",
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

function reportHref(projectId: string, from: string, to: string, offer: string): string {
  const params = new URLSearchParams({
    from,
    to,
    offer,
    group1: "",
    group2: "",
    group3: "",
    sort: "spend",
    order: "desc"
  });
  return `/projects/${projectId}/analytics?${params.toString()}`;
}

function offerClass(value: string): string {
  return `trackerOffer trackerOffer${value.replace(/[^A-Za-z0-9]/g, "")}`;
}

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const defaults = defaultRange();

  let from = validDate(single(query.from)) ? single(query.from) : defaults.from;
  let to = validDate(single(query.to)) ? single(query.to) : defaults.to;
  if (from > to) [from, to] = [to, from];

  const firstGroup = hasQueryKey(query, "group1") ? single(query.group1) : "offer";
  const groupCandidates = [firstGroup, single(query.group2), single(query.group3)];
  const groups = groupCandidates
    .filter(isDimension)
    .filter((value, index, values) => values.indexOf(value) === index);

  const offerFilter = single(query.offer) || single(query.direction);
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
    const offers = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.offer))).sort();
    const funnels = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.funnel))).sort();
    const accounts = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.account))).sort();
    const campaignNames = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.campaign))).sort();

    const filtered = dimensionCache.filter(({ row, dimensions }) => {
      if (offerFilter && dimensions.offer !== offerFilter) return false;
      if (funnelFilter && dimensions.funnel !== funnelFilter) return false;
      if (accountFilter && dimensions.account !== accountFilter) return false;
      if (campaignFilter && dimensions.campaign !== campaignFilter) return false;
      if (search) {
        const haystack = [
          dimensions.offer,
          dimensions.creative,
          dimensions.funnel,
          dimensions.account,
          dimensions.campaign,
          dimensions.adset,
          row.adName,
          row.accountId
        ].join(" ").toLocaleLowerCase("uk-UA");
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const aggregateMap = new Map<string, AggregateRow>();
    for (const { row, dimensions } of filtered) {
      const key = [...groups.map((group) => dimensions[group]), dimensions.creative].join("\u001f");
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
    const totalCpc = totals.clicks > 0 ? totals.spend / totals.clicks : null;
    const totalCpa = totals.results > 0 ? totals.spend / totals.results : null;

    return (
      <main className="trackerPage">
        <header className="trackerHeader">
          <div className="trackerTitle">
            <span>ID: {project.id.slice(0, 8).toUpperCase()}</span>
            <strong>{project.name.toLocaleUpperCase("uk-UA")} · CREATIVE REPORT</strong>
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
            href={`/projects/${project.id}/analytics?from=${from}&to=${to}`}
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
            <label className="trackerField trackerFieldWide">
              <span>Кампанія</span>
              <select name="campaign" defaultValue={campaignFilter}>
                <option value="">Усі кампанії</option>
                {campaignNames.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
          </div>

          <div className="trackerControlRow">
            {[0, 1, 2].map((index) => (
              <label className="trackerField" key={index}>
                <span>Групування {index + 1}</span>
                <select name={`group${index + 1}`} defaultValue={groups[index] ?? ""}>
                  <option value="">Без групування</option>
                  {GROUP_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="trackerField trackerSearch">
              <span>Пошук по крео</span>
              <input name="search" defaultValue={single(query.search)} placeholder="Назва креативу..." />
            </label>
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
            <Link className="trackerButton trackerButtonGhost" href={`/projects/${project.id}/analytics`}>Скинути</Link>
          </div>
        </form>

        <div className="trackerStatusBar">
          <span>Креативів: <strong>{aggregates.length}</strong></span>
          <span>Денних фактів: <strong>{filtered.length}</strong></span>
          <span>Період: <strong>{from} — {to}</strong></span>
          <span>Результат: <strong>{resultMetric}</strong></span>
        </div>

        <section className="trackerTablePanel">
          <div className="trackerTableWrap">
            <table className="trackerTable">
              <thead>
                <tr>
                  {groups.map((group) => <th key={group}>{dimensionLabel(group)}</th>)}
                  <th>Креатив</th>
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
                        <td className={group === "offer" ? "trackerOfferCell" : ""} key={group}>
                          {group === "offer" ? (
                            <span className="trackerOfferValue"><i className={offerClass(row.dimensions.offer)} />{row.dimensions.offer}</span>
                          ) : row.dimensions[group]}
                        </td>
                      ))}
                      <td>
                        <div className="trackerCreativeCell">
                          {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" /> : <span className="trackerCreativeFallback">—</span>}
                          <div>
                            <strong>{row.dimensions.creative}</strong>
                            <small>{row.sourceRows} денних рядків</small>
                          </div>
                        </div>
                      </td>
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
              <tfoot>
                <tr>
                  <td colSpan={groups.length + 1}>Всього</td>
                  <td>{money(totals.spend, currency)}</td>
                  <td>{rounded(totals.impressions, 0)}</td>
                  <td>{rounded(totals.clicks, 0)}</td>
                  <td>{rounded(totals.results, 0)}</td>
                  <td>{rounded(totalCtr)}%</td>
                  <td>{totalCpc === null ? "—" : money(totalCpc, currency)}</td>
                  <td>{totalCpa === null ? "—" : money(totalCpa, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {aggregates.length === 0 && <div className="trackerEmpty">За цими фільтрами немає даних.</div>}
          {aggregates.length > 1000 && <div className="trackerWarning">Показано перші 1000 рядків. Звузь період або додай фільтр.</div>}
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
