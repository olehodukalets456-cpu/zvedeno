import type { AdaptiveReportBlueprint, ReportGranularity, ReportTabKind } from "@zvedeno/shared";

type Cell = string | number | boolean | null;
type MetricBag = Record<string, string | number | boolean | null>;

export type ClientInsightRow = {
  date: string;
  metrics: MetricBag;
  campaignName?: string | null;
};

export type ClientTotals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  revenue: number;
};

export type ClientAggregate = ClientTotals & {
  name: string;
  secondary: string;
  launchDate: string;
  lastActivityDate: string;
  status: string;
  previewUrl: string;
};

export type ClientMetricId =
  | "spend"
  | "impressions"
  | "reach"
  | "frequency"
  | "clicks"
  | "results"
  | "revenue"
  | "roas"
  | "cpa"
  | "cpm"
  | "cpc"
  | "ctr";

export type ClientMetricColumn = {
  id: ClientMetricId;
  header: string;
  width: number;
  format: "currency" | "integer" | "decimal" | "percent";
};

type SheetMetadata = {
  properties?: { sheetId?: number; title?: string };
};

export const CLIENT_DASHBOARD_TITLE = "Огляд";
export const CLIENT_SYNC_TITLE = "Технічні дані";

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number | null, digits = 2): number | string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits));
}

function safeDivide(numerator: number, denominator: number, multiplier = 1): number | null {
  return denominator > 0 ? (numerator / denominator) * multiplier : null;
}

function color(red: number, green: number, blue: number): Record<string, number> {
  return { red, green, blue };
}

function weekStart(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return value.toISOString().slice(0, 10);
}

function bucketKey(date: string, granularity: ReportGranularity): string {
  if (granularity === "daily") return date;
  if (granularity === "weekly") return weekStart(date);
  return date.slice(0, 7);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const current = result.get(key) ?? [];
    current.push(item);
    result.set(key, current);
  }
  return result;
}

function totalsForRows(rows: ClientInsightRow[], resultMetric: string | null, revenueMetric: string | null): ClientTotals {
  return rows.reduce<ClientTotals>((totals, row) => {
    totals.spend += numberValue(row.metrics.spend);
    totals.impressions += numberValue(row.metrics.impressions);
    totals.reach += numberValue(row.metrics.reach);
    totals.clicks += numberValue(row.metrics.inline_link_clicks || row.metrics.clicks);
    if (resultMetric) totals.results += numberValue(row.metrics[resultMetric]);
    if (revenueMetric) totals.revenue += numberValue(row.metrics[revenueMetric]);
    return totals;
  }, { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, revenue: 0 });
}

function resultLabel(metric: string | null): string {
  if (!metric) return "Результати";
  const normalized = metric.toLowerCase();
  if (normalized.includes("purchase")) return "Покупки";
  if (normalized.includes("lead")) return "Ліди";
  if (normalized.includes("registration")) return "Реєстрації";
  if (normalized.includes("messaging") || normalized.includes("conversation")) return "Діалоги";
  if (normalized.includes("subscribe")) return "Підписки";
  if (normalized.includes("link_click")) return "Кліки на посилання";
  return metric
    .replace(/^action\./, "")
    .replace(/[_\.]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function metricValue(totals: ClientTotals, id: ClientMetricId): number | string {
  if (id === "spend") return rounded(totals.spend);
  if (id === "impressions") return Math.round(totals.impressions);
  if (id === "reach") return Math.round(totals.reach);
  if (id === "frequency") return rounded(safeDivide(totals.impressions, totals.reach));
  if (id === "clicks") return Math.round(totals.clicks);
  if (id === "results") return rounded(totals.results);
  if (id === "revenue") return rounded(totals.revenue);
  if (id === "roas") return rounded(safeDivide(totals.revenue, totals.spend));
  if (id === "cpa") return rounded(safeDivide(totals.spend, totals.results));
  if (id === "cpm") return rounded(safeDivide(totals.spend, totals.impressions, 1000));
  if (id === "cpc") return rounded(safeDivide(totals.spend, totals.clicks));
  return rounded(safeDivide(totals.clicks, totals.impressions, 100));
}

function requestedMetricIds(blueprint: AdaptiveReportBlueprint): Set<ClientMetricId> {
  const map: Record<string, ClientMetricId> = {
    spend: "spend",
    impressions: "impressions",
    reach: "reach",
    frequency: "frequency",
    "derived.frequency": "frequency",
    clicks: "clicks",
    inline_link_clicks: "clicks",
    "business.result": "results",
    "business.revenue": "revenue",
    "derived.roas": "roas",
    "derived.cpa": "cpa",
    "derived.cpm": "cpm",
    "derived.cpc": "cpc",
    "derived.ctr": "ctr"
  };
  return new Set(blueprint.primaryMetrics.map((metric) => map[metric]).filter((id): id is ClientMetricId => Boolean(id)));
}

export function buildClientMetricColumns(
  blueprint: AdaptiveReportBlueprint,
  totals: ClientTotals,
  resultMetric: string | null,
  revenueMetric: string | null
): ClientMetricColumn[] {
  const requested = requestedMetricIds(blueprint);
  requested.add("spend");
  if (resultMetric) requested.add("results");
  if (resultMetric && totals.results > 0) requested.add("cpa");
  if (revenueMetric && totals.revenue > 0) {
    requested.add("revenue");
    requested.add("roas");
  }

  const preferredByTemplate: Record<string, ClientMetricId[]> = {
    commerce_roas: ["spend", "revenue", "roas", "results", "cpa", "ctr", "clicks"],
    lead_generation: ["spend", "results", "cpa", "clicks", "ctr", "cpm"],
    creative_intelligence: ["spend", "results", "roas", "revenue", "cpa", "ctr", "cpc"],
    custom_funnel: ["spend", "results", "cpa", "clicks", "ctr", "revenue", "roas"],
    minimal: ["spend", "results", "revenue", "roas", "cpa"]
  };
  const fallback: ClientMetricId[] = ["spend", "results", "revenue", "roas", "cpa", "clicks", "ctr"];
  const preferred = preferredByTemplate[blueprint.templateId] ?? fallback;

  const available = (id: ClientMetricId): boolean => {
    if (!requested.has(id)) return false;
    if (id === "impressions" || id === "cpm") return totals.impressions > 0;
    if (id === "reach" || id === "frequency") return totals.reach > 0;
    if (id === "clicks" || id === "cpc" || id === "ctr") return totals.clicks > 0 && totals.impressions > 0;
    if (id === "results" || id === "cpa") return Boolean(resultMetric) && totals.results > 0;
    if (id === "revenue" || id === "roas") return Boolean(revenueMetric) && totals.revenue > 0;
    return true;
  };

  const ids = preferred.filter(available).slice(0, 7);
  const definitions: Record<ClientMetricId, Omit<ClientMetricColumn, "id">> = {
    spend: { header: "Витрати", width: 110, format: "currency" },
    impressions: { header: "Покази", width: 100, format: "integer" },
    reach: { header: "Охоплення", width: 105, format: "integer" },
    frequency: { header: "Частота", width: 90, format: "decimal" },
    clicks: { header: "Кліки", width: 90, format: "integer" },
    results: { header: resultLabel(resultMetric), width: 105, format: "decimal" },
    revenue: { header: "Дохід", width: 110, format: "currency" },
    roas: { header: "ROAS", width: 85, format: "decimal" },
    cpa: { header: resultMetric?.toLowerCase().includes("lead") ? "CPL" : "CPA", width: 95, format: "currency" },
    cpm: { header: "CPM", width: 90, format: "currency" },
    cpc: { header: "CPC", width: 90, format: "currency" },
    ctr: { header: "CTR, %", width: 90, format: "percent" }
  };
  return ids.map((id) => ({ id, ...definitions[id] }));
}

export function clientSheetTitle(kind: ReportTabKind, granularity: ReportGranularity): string {
  if (kind === "dashboard") return CLIENT_DASHBOARD_TITLE;
  if (kind === "trend") return granularity === "daily" ? "Щоденна динаміка" : granularity === "weekly" ? "Щотижнева динаміка" : "Щомісячна динаміка";
  if (kind === "campaigns") return "Кампанії";
  if (kind === "adsets") return "Групи оголошень";
  if (kind === "creatives") return "Креативи";
  if (kind === "funnel") return "Воронка";
  if (kind === "raw") return "Дані Meta";
  return CLIENT_SYNC_TITLE;
}

function comparablePeriod(rows: ClientInsightRow[], granularity: ReportGranularity): {
  currentRows: ClientInsightRow[];
  previousRows: ClientInsightRow[];
  currentKey: string;
  partial: boolean;
} {
  const groups = Array.from(groupBy(rows, (row) => bucketKey(row.date, granularity)).entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const [currentKey, currentRows] = groups.at(-1) ?? ["", []];
  const previousAll = groups.at(-2)?.[1] ?? [];
  if (granularity === "daily") return { currentRows, previousRows: previousAll, currentKey, partial: false };

  const currentDates = Array.from(new Set(currentRows.map((row) => row.date))).sort();
  const previousDates = Array.from(new Set(previousAll.map((row) => row.date))).sort();
  const expected = granularity === "weekly"
    ? 7
    : new Date(Date.UTC(Number(currentKey.slice(0, 4)), Number(currentKey.slice(5, 7)), 0)).getUTCDate();
  const partial = currentDates.length < expected;
  const comparableDates = new Set(previousDates.slice(0, Math.max(1, currentDates.length)));
  return {
    currentRows,
    previousRows: partial ? previousAll.filter((row) => comparableDates.has(row.date)) : previousAll,
    currentKey,
    partial
  };
}

function periodLabel(key: string, granularity: ReportGranularity): string {
  if (!key) return "Немає даних";
  if (granularity === "daily") return new Date(`${key}T00:00:00Z`).toLocaleDateString("uk-UA");
  if (granularity === "weekly") {
    const start = new Date(`${key}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${start.toLocaleDateString("uk-UA")} — ${end.toLocaleDateString("uk-UA")}`;
  }
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
}

function delta(current: number, previous: number): number | null {
  return previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
}

function deltaText(current: number, previous: number): string {
  const value = delta(current, previous);
  if (value === null) return "без бази для порівняння";
  if (Math.abs(value) < 0.05) return "без змін";
  return `${value > 0 ? "↑" : "↓"} ${Math.abs(value).toFixed(1)}% до попереднього періоду`;
}

function formattedMetric(id: ClientMetricId, totals: ClientTotals, currency: string): string {
  const value = metricValue(totals, id);
  if (value === "—") return "—";
  const number = Number(value);
  if (id === "spend" || id === "revenue" || id === "cpa" || id === "cpm" || id === "cpc") {
    return `${number.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ${currency}`;
  }
  if (id === "ctr") return `${number.toLocaleString("uk-UA", { maximumFractionDigits: 2 })}%`;
  if (id === "roas" || id === "frequency") return number.toLocaleString("uk-UA", { maximumFractionDigits: 2 });
  return number.toLocaleString("uk-UA", { maximumFractionDigits: 2 });
}

function insightLines(current: ClientTotals, previous: ClientTotals, resultMetric: string | null, revenueMetric: string | null, currency: string): string[] {
  const lines: string[] = [];
  lines.push(`Витрати: ${formattedMetric("spend", current, currency)} · ${deltaText(current.spend, previous.spend)}.`);
  if (resultMetric && current.results > 0) {
    const cpa = safeDivide(current.spend, current.results) ?? 0;
    const previousCpa = safeDivide(previous.spend, previous.results) ?? 0;
    lines.push(`${resultLabel(resultMetric)}: ${formattedMetric("results", current, currency)} · ${deltaText(current.results, previous.results)}; ${resultMetric.toLowerCase().includes("lead") ? "CPL" : "CPA"} ${formattedMetric("cpa", current, currency)} (${deltaText(cpa, previousCpa)}).`);
  }
  if (revenueMetric && current.revenue > 0) {
    const roas = safeDivide(current.revenue, current.spend) ?? 0;
    const previousRoas = safeDivide(previous.revenue, previous.spend) ?? 0;
    lines.push(`Дохід: ${formattedMetric("revenue", current, currency)}; ROAS ${formattedMetric("roas", current, currency)} (${deltaText(roas, previousRoas)}).`);
  } else if (current.clicks > 0) {
    const ctr = safeDivide(current.clicks, current.impressions, 100) ?? 0;
    const previousCtr = safeDivide(previous.clicks, previous.impressions, 100) ?? 0;
    lines.push(`Кліки: ${formattedMetric("clicks", current, currency)}; CTR ${formattedMetric("ctr", current, currency)} (${deltaText(ctr, previousCtr)}).`);
  }
  return lines.slice(0, 3);
}

export function clientDashboardValues(input: {
  projectName: string;
  blueprint: AdaptiveReportBlueprint;
  rows: ClientInsightRow[];
  resultMetric: string | null;
  revenueMetric: string | null;
  currency: string;
  columns: ClientMetricColumn[];
}): Cell[][] {
  const period = comparablePeriod(input.rows, input.blueprint.granularity);
  const current = totalsForRows(period.currentRows, input.resultMetric, input.revenueMetric);
  const previous = totalsForRows(period.previousRows, input.resultMetric, input.revenueMetric);
  const preferredCards: ClientMetricId[] = input.revenueMetric && current.revenue > 0
    ? ["spend", "revenue", "roas", "results", "cpa", "ctr"]
    : ["spend", "results", "cpa", "clicks", "ctr", "reach"];
  const allowed = new Set(input.columns.map((column) => column.id));
  const cards = preferredCards.filter((id) => allowed.has(id)).slice(0, 6);
  while (cards.length < 6) cards.push((input.columns.find((column) => !cards.includes(column.id))?.id ?? "spend"));

  const labels: Record<ClientMetricId, string> = {
    spend: "Витрати",
    impressions: "Покази",
    reach: "Охоплення",
    frequency: "Частота",
    clicks: "Кліки",
    results: resultLabel(input.resultMetric),
    revenue: "Дохід",
    roas: "ROAS",
    cpa: input.resultMetric?.toLowerCase().includes("lead") ? "CPL" : "CPA",
    cpm: "CPM",
    cpc: "CPC",
    ctr: "CTR"
  };
  const currentValues: Record<ClientMetricId, number> = {
    spend: current.spend,
    impressions: current.impressions,
    reach: current.reach,
    frequency: safeDivide(current.impressions, current.reach) ?? 0,
    clicks: current.clicks,
    results: current.results,
    revenue: current.revenue,
    roas: safeDivide(current.revenue, current.spend) ?? 0,
    cpa: safeDivide(current.spend, current.results) ?? 0,
    cpm: safeDivide(current.spend, current.impressions, 1000) ?? 0,
    cpc: safeDivide(current.spend, current.clicks) ?? 0,
    ctr: safeDivide(current.clicks, current.impressions, 100) ?? 0
  };
  const previousValues: Record<ClientMetricId, number> = {
    spend: previous.spend,
    impressions: previous.impressions,
    reach: previous.reach,
    frequency: safeDivide(previous.impressions, previous.reach) ?? 0,
    clicks: previous.clicks,
    results: previous.results,
    revenue: previous.revenue,
    roas: safeDivide(previous.revenue, previous.spend) ?? 0,
    cpa: safeDivide(previous.spend, previous.results) ?? 0,
    cpm: safeDivide(previous.spend, previous.impressions, 1000) ?? 0,
    cpc: safeDivide(previous.spend, previous.clicks) ?? 0,
    ctr: safeDivide(previous.clicks, previous.impressions, 100) ?? 0
  };

  const labelRow = Array<Cell>(12).fill("");
  const valueRow = Array<Cell>(12).fill("");
  const deltaRow = Array<Cell>(12).fill("");
  cards.forEach((id, index) => {
    const column = index * 2;
    labelRow[column] = labels[id];
    valueRow[column] = formattedMetric(id, current, input.currency);
    deltaRow[column] = deltaText(currentValues[id], previousValues[id]);
  });
  const insights = insightLines(current, previous, input.resultMetric, input.revenueMetric, input.currency);
  return [
    [`${input.projectName} · Performance report`],
    [`${periodLabel(period.currentKey, input.blueprint.granularity)} · ${period.partial ? "неповний період, порівняння за однаковою кількістю днів" : "порівняння з попереднім періодом"} · оновлено ${new Date().toLocaleString("uk-UA")}`],
    [],
    labelRow,
    valueRow,
    deltaRow,
    [],
    ["Коротко про зміни"],
    [insights[0] ?? "Даних поки недостатньо для висновку."],
    [insights[1] ?? ""],
    [insights[2] ?? ""]
  ];
}

export function clientTrendValues(
  rows: ClientInsightRow[],
  blueprint: AdaptiveReportBlueprint,
  resultMetric: string | null,
  revenueMetric: string | null,
  columns: ClientMetricColumn[]
): Cell[][] {
  const groups = groupBy(rows, (row) => bucketKey(row.date, blueprint.granularity));
  const values: Cell[][] = [["Період", ...columns.map((column) => column.header)]];
  for (const [period, periodRows] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const totals = totalsForRows(periodRows, resultMetric, revenueMetric);
    values.push([periodLabel(period, blueprint.granularity), ...columns.map((column) => metricValue(totals, column.id))]);
  }
  return values;
}

export function clientEntityTableValues(
  aggregates: ClientAggregate[],
  kind: "campaign" | "adset" | "creative",
  columns: ClientMetricColumn[]
): Cell[][] {
  if (kind === "creative") {
    return [
      ["Превʼю", "Креатив", "Кампанія", "Запуск", "Остання активність", "Статус", ...columns.map((column) => column.header)],
      ...aggregates.map((item) => [item.previewUrl, item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...columns.map((column) => metricValue(item, column.id))])
    ];
  }
  return [
    [kind === "campaign" ? "Кампанія" : "Група оголошень", kind === "campaign" ? "Кабінет" : "Кампанія", "Запуск", "Остання активність", "Статус", ...columns.map((column) => column.header)],
    ...aggregates.map((item) => [item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...columns.map((column) => metricValue(item, column.id))])
  ];
}

function currencyPattern(currency: string): string {
  return `#,##0.00 "${currency.replace(/"/g, "")}"`;
}

export function clientTableRequests(input: {
  sheetId: number;
  headers: Cell[];
  rows: number;
  columns: ClientMetricColumn[];
  currency: string;
  isCreative: boolean;
}): unknown[] {
  const columnCount = Math.max(1, input.headers.length);
  const requests: unknown[] = [
    { clearBasicFilter: { sheetId: input.sheetId } },
    {
      updateSheetProperties: {
        properties: { sheetId: input.sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true, rowCount: Math.max(1000, input.rows + 50), columnCount: Math.max(20, columnCount + 2) } },
        fields: "gridProperties(frozenRowCount,hideGridlines,rowCount,columnCount)"
      }
    },
    {
      repeatCell: {
        range: { sheetId: input.sheetId, startRowIndex: 0, endRowIndex: Math.max(2, input.rows), startColumnIndex: 0, endColumnIndex: columnCount },
        cell: { userEnteredFormat: { backgroundColor: color(1, 1, 1), textFormat: { foregroundColor: color(0.08, 0.08, 0.11), fontSize: 10 }, verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"
      }
    },
    {
      repeatCell: {
        range: { sheetId: input.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: { userEnteredFormat: { backgroundColor: color(0.07, 0.08, 0.12), textFormat: { foregroundColor: color(1, 1, 1), bold: true, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: input.sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 42 },
        fields: "pixelSize"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: input.sheetId, dimension: "ROWS", startIndex: 1, endIndex: Math.max(2, input.rows) },
        properties: { pixelSize: input.isCreative ? 108 : 30 },
        fields: "pixelSize"
      }
    }
  ];

  input.headers.forEach((header, index) => {
    const text = String(header ?? "");
    let width = input.isCreative && index === 0 ? 112 : index < (input.isCreative ? 6 : 5) ? (index === 0 || index === 1 ? 220 : 120) : 100;
    const metric = input.columns.find((column) => column.header === text);
    if (metric) width = metric.width;
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: input.sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
        properties: { pixelSize: width },
        fields: "pixelSize"
      }
    });
    if (metric && input.rows > 1) {
      const pattern = metric.format === "currency" ? currencyPattern(input.currency) : metric.format === "integer" ? "#,##0" : "0.00";
      requests.push({
        repeatCell: {
          range: { sheetId: input.sheetId, startRowIndex: 1, endRowIndex: input.rows, startColumnIndex: index, endColumnIndex: index + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern }, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)"
        }
      });
    }
  });
  return requests;
}

function trendColumnIndex(headers: Cell[], name: string): number | null {
  const index = headers.findIndex((header) => String(header) === name);
  return index >= 0 ? index : null;
}

export function clientDashboardRequests(input: {
  dashboardId: number;
  trendId?: number;
  trendHeaders: Cell[];
  trendRows: number;
  oldChartIds: number[];
  includeCharts: boolean;
}): unknown[] {
  const requests: unknown[] = input.oldChartIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } }));
  requests.push(
    {
      updateSheetProperties: {
        properties: { sheetId: input.dashboardId, gridProperties: { frozenRowCount: 2, hideGridlines: true, rowCount: 1000, columnCount: 16 } },
        fields: "gridProperties(frozenRowCount,hideGridlines,rowCount,columnCount)"
      }
    },
    { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
    {
      repeatCell: {
        range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 12, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { backgroundColor: color(0.985, 0.98, 1), textFormat: { foregroundColor: color(0.08, 0.07, 0.12) }, verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"
      }
    },
    {
      repeatCell: {
        range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { backgroundColor: color(0.985, 0.98, 1), textFormat: { foregroundColor: color(0.05, 0.04, 0.08), bold: true, fontSize: 24 } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)"
      }
    },
    {
      repeatCell: {
        range: { sheetId: input.dashboardId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(0.38, 0.36, 0.45), fontSize: 10 } } },
        fields: "userEnteredFormat(textFormat)"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: input.dashboardId, dimension: "COLUMNS", startIndex: 0, endIndex: 12 },
        properties: { pixelSize: 105 },
        fields: "pixelSize"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: input.dashboardId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 48 },
        fields: "pixelSize"
      }
    }
  );

  for (let card = 0; card < 6; card += 1) {
    const startColumnIndex = card * 2;
    requests.push(
      { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 3, endRowIndex: 4, startColumnIndex, endColumnIndex: startColumnIndex + 2 }, mergeType: "MERGE_ALL" } },
      { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 4, endRowIndex: 5, startColumnIndex, endColumnIndex: startColumnIndex + 2 }, mergeType: "MERGE_ALL" } },
      { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 5, endRowIndex: 6, startColumnIndex, endColumnIndex: startColumnIndex + 2 }, mergeType: "MERGE_ALL" } },
      {
        repeatCell: {
          range: { sheetId: input.dashboardId, startRowIndex: 3, endRowIndex: 6, startColumnIndex, endColumnIndex: startColumnIndex + 2 },
          cell: {
            userEnteredFormat: {
              backgroundColor: card % 2 === 0 ? color(0.94, 0.91, 1) : color(0.9, 0.94, 1),
              borders: {
                top: { style: "SOLID", color: color(0.84, 0.8, 0.94) },
                bottom: { style: "SOLID", color: color(0.84, 0.8, 0.94) },
                left: { style: "SOLID", color: color(0.84, 0.8, 0.94) },
                right: { style: "SOLID", color: color(0.84, 0.8, 0.94) }
              },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE"
            }
          },
          fields: "userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)"
        }
      },
      {
        repeatCell: {
          range: { sheetId: input.dashboardId, startRowIndex: 4, endRowIndex: 5, startColumnIndex, endColumnIndex: startColumnIndex + 2 },
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 18, foregroundColor: color(0.08, 0.05, 0.17) } } },
          fields: "userEnteredFormat(textFormat)"
        }
      },
      {
        repeatCell: {
          range: { sheetId: input.dashboardId, startRowIndex: 5, endRowIndex: 6, startColumnIndex, endColumnIndex: startColumnIndex + 2 },
          cell: { userEnteredFormat: { textFormat: { fontSize: 9, foregroundColor: color(0.38, 0.31, 0.55) } } },
          fields: "userEnteredFormat(textFormat)"
        }
      }
    );
  }

  requests.push(
    { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
    {
      repeatCell: {
        range: { sheetId: input.dashboardId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14, foregroundColor: color(0.08, 0.05, 0.17) } } },
        fields: "userEnteredFormat(textFormat)"
      }
    }
  );
  for (let row = 8; row < 11; row += 1) {
    requests.push(
      { mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
      {
        repeatCell: {
          range: { sheetId: input.dashboardId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 12 },
          cell: { userEnteredFormat: { backgroundColor: color(1, 1, 1), textFormat: { foregroundColor: color(0.2, 0.18, 0.27), fontSize: 10 }, wrapStrategy: "WRAP" } },
          fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy)"
        }
      }
    );
  }

  if (!input.includeCharts || input.trendId === undefined || input.trendRows <= 2) return requests;
  const period = 0;
  const spend = trendColumnIndex(input.trendHeaders, "Витрати");
  const results = input.trendHeaders.findIndex((header) => !["Період", "Витрати", "Дохід", "ROAS", "CPA", "CPL", "CTR, %", "Кліки", "Покази", "Охоплення", "Частота", "CPM", "CPC"].includes(String(header)));
  const revenue = trendColumnIndex(input.trendHeaders, "Дохід");
  const roas = trendColumnIndex(input.trendHeaders, "ROAS");
  const cpa = trendColumnIndex(input.trendHeaders, "CPA") ?? trendColumnIndex(input.trendHeaders, "CPL");
  const ctr = trendColumnIndex(input.trendHeaders, "CTR, %");
  const dataEnd = input.trendRows;

  const chart = (title: string, first: number | null, second: number | null, rowIndex: number, columnIndex: number): unknown | null => {
    const series = [first, second]
      .filter((index): index is number => index !== null && index >= 1)
      .map((index, seriesIndex) => ({
        series: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 0, endRowIndex: dataEnd, startColumnIndex: index, endColumnIndex: index + 1 }] } },
        targetAxis: seriesIndex === 0 ? "LEFT_AXIS" : "RIGHT_AXIS"
      }));
    if (series.length === 0) return null;
    return {
      addChart: {
        chart: {
          spec: {
            title,
            backgroundColor: color(1, 1, 1),
            basicChart: {
              chartType: "LINE",
              legendPosition: "BOTTOM_LEGEND",
              headerCount: 1,
              axis: [
                { position: "BOTTOM_AXIS", title: "Період" },
                { position: "LEFT_AXIS", title: "Основний показник" },
                { position: "RIGHT_AXIS", title: "Другий показник" }
              ],
              domains: [{ domain: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 1, endRowIndex: dataEnd, startColumnIndex: period, endColumnIndex: period + 1 }] } } }],
              series
            }
          },
          position: { overlayPosition: { anchorCell: { sheetId: input.dashboardId, rowIndex, columnIndex }, widthPixels: 620, heightPixels: 320 } }
        }
      }
    };
  };
  const firstChart = chart(revenue !== null ? "Витрати та дохід" : "Витрати та результат", spend, revenue ?? (results >= 1 ? results : null), 12, 0);
  const secondChart = chart(roas !== null ? "ROAS та вартість результату" : "Вартість результату та CTR", roas ?? cpa, roas !== null ? cpa : ctr, 12, 6);
  if (firstChart) requests.push(firstChart);
  if (secondChart) requests.push(secondChart);
  return requests;
}

export function clientSheetLayoutRequests(input: {
  sheets: SheetMetadata[];
  orderedTitles: string[];
  technicalTitles: string[];
}): unknown[] {
  const order = new Map(input.orderedTitles.map((title, index) => [title, index]));
  const technical = new Set(input.technicalTitles);
  const requests: unknown[] = [];
  for (const sheet of input.sheets) {
    const sheetId = sheet.properties?.sheetId;
    const title = sheet.properties?.title;
    if (sheetId === undefined || !title) continue;
    const index = order.get(title);
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          hidden: technical.has(title) || index === undefined,
          ...(index !== undefined ? { index } : {})
        },
        fields: index !== undefined ? "hidden,index" : "hidden"
      }
    });
  }
  return requests;
}
