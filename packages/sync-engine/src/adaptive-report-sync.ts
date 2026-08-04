import { desc, eq } from "drizzle-orm";
import {
  adAccounts,
  ads,
  adSets,
  campaigns,
  createDatabase,
  dailyInsights,
  mediaAssets,
  syncErrors,
  syncRuns
} from "@zvedeno/database";
import type { AdaptiveReportBlueprint, ReportGranularity } from "@zvedeno/shared";
import {
  ensureGoogleReportTabs,
  googleSheetsBatchUpdate,
  googleValuesBatchUpdate,
  type GoogleSpreadsheet
} from "./google-client";

type Database = ReturnType<typeof createDatabase>["db"];
type Cell = string | number | boolean | null;
type MetricBag = Record<string, string | number | boolean | null>;

type InsightRow = {
  factKey: string;
  date: string;
  metrics: MetricBag;
  accountId: string;
  accountName: string;
  campaignId: string | null;
  campaignName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  adId: string | null;
  adName: string | null;
  adStatus: string | null;
  creativeId: string | null;
  creativeName: string | null;
  creativeType: string | null;
  thumbnailUrl: string | null;
  archivedMediaUrl: string | null;
};

type Totals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  revenue: number;
};

type EntityAggregate = Totals & {
  key: string;
  name: string;
  secondary: string;
  launchDate: string;
  lastActivityDate: string;
  status: string;
  previewUrl: string;
};

type AdaptiveReportInput = {
  db: Database;
  accessToken: string;
  spreadsheetId: string;
  projectId: string;
  projectName: string;
  currency?: string | null;
  blueprint: AdaptiveReportBlueprint;
};

export type AdaptiveReportResult = {
  appended: number;
  updated: number;
  tabs: number;
  resultMetric: string | null;
  revenueMetric: string | null;
};

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number | null, digits = 2): number | string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits));
}

function percent(value: number | null): number | string {
  return rounded(value, 2);
}

function safeDivide(numerator: number, denominator: number, multiplier = 1): number | null {
  return denominator > 0 ? (numerator / denominator) * multiplier : null;
}

function escapeSheetTitle(value: string): string {
  return value.replace(/'/g, "''");
}

function safeSheetTitle(value: string): string {
  return value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Report";
}

function metricTotal(rows: InsightRow[], key: string): number {
  return rows.reduce((sum, row) => sum + numberValue(row.metrics[key]), 0);
}

function chooseMetric(rows: InsightRow[], candidates: string[]): string | null {
  const exact = candidates.find((key) => key && metricTotal(rows, key) > 0);
  if (exact) return exact;
  return candidates.find(Boolean) ?? null;
}

function fallbackResultMetric(rows: InsightRow[]): string | null {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.metrics)) {
      if (!key.startsWith("action.")) continue;
      totals.set(key, (totals.get(key) ?? 0) + numberValue(value));
    }
  }
  const preferred = [
    "action.omni_purchase",
    "action.purchase",
    "action.offsite_conversion.fb_pixel_purchase",
    "action.lead",
    "action.offsite_conversion.fb_pixel_lead",
    "action.messaging_conversation_started_7d",
    "action.complete_registration",
    "action.link_click"
  ];
  return preferred.find((key) => (totals.get(key) ?? 0) > 0)
    ?? Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? null;
}

function fallbackRevenueMetric(rows: InsightRow[]): string | null {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.metrics)) {
      if (!key.startsWith("action_value.")) continue;
      totals.set(key, (totals.get(key) ?? 0) + numberValue(value));
    }
  }
  const preferred = [
    "action_value.omni_purchase",
    "action_value.purchase",
    "action_value.offsite_conversion.fb_pixel_purchase"
  ];
  return preferred.find((key) => (totals.get(key) ?? 0) > 0)
    ?? Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? null;
}

function totalsForRows(rows: InsightRow[], resultMetric: string | null, revenueMetric: string | null): Totals {
  return rows.reduce<Totals>((totals, row) => {
    totals.spend += numberValue(row.metrics.spend);
    totals.impressions += numberValue(row.metrics.impressions);
    totals.reach += numberValue(row.metrics.reach);
    totals.clicks += numberValue(row.metrics.inline_link_clicks || row.metrics.clicks);
    if (resultMetric) totals.results += numberValue(row.metrics[resultMetric]);
    if (revenueMetric) totals.revenue += numberValue(row.metrics[revenueMetric]);
    return totals;
  }, { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, revenue: 0 });
}

function metricColumns(totals: Totals): Cell[] {
  return [
    rounded(totals.spend),
    Math.round(totals.impressions),
    Math.round(totals.reach),
    percent(safeDivide(totals.impressions, totals.reach)),
    Math.round(totals.clicks),
    Math.round(totals.results * 100) / 100,
    rounded(totals.revenue),
    rounded(safeDivide(totals.revenue, totals.spend)),
    rounded(safeDivide(totals.spend, totals.results)),
    rounded(safeDivide(totals.spend, totals.impressions, 1000)),
    rounded(safeDivide(totals.spend, totals.clicks)),
    percent(safeDivide(totals.clicks, totals.impressions, 100))
  ];
}

const METRIC_HEADERS = [
  "Витрати",
  "Покази",
  "Охоплення",
  "Частота",
  "Кліки",
  "Результат",
  "Дохід",
  "ROAS",
  "CPA",
  "CPM",
  "CPC",
  "CTR, %"
];

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
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }
  return map;
}

function entityAggregates(
  rows: InsightRow[],
  kind: "campaign" | "adset" | "creative",
  resultMetric: string | null,
  revenueMetric: string | null
): EntityAggregate[] {
  const grouped = groupBy(rows, (row) => {
    if (kind === "campaign") return row.campaignId ?? `campaign:${row.campaignName ?? "unknown"}`;
    if (kind === "adset") return row.adSetId ?? `adset:${row.adSetName ?? "unknown"}`;
    return row.creativeId ?? row.adId ?? `creative:${row.creativeName ?? row.adName ?? "unknown"}`;
  });

  return Array.from(grouped.entries()).map(([key, itemRows]) => {
    const first = itemRows[0]!;
    const dates = itemRows.map((row) => row.date).sort();
    const status = itemRows.some((row) => String(row.adStatus ?? "").toUpperCase() === "ACTIVE") ? "Активний" : "Зупинено";
    const name = kind === "campaign"
      ? first.campaignName ?? "Без назви кампанії"
      : kind === "adset"
        ? first.adSetName ?? "Без назви ad set"
        : first.creativeName ?? first.adName ?? "Без назви креативу";
    const secondary = kind === "campaign"
      ? first.accountName
      : kind === "adset"
        ? first.campaignName ?? first.accountName
        : first.campaignName ?? first.accountName;
    const previewUrl = kind === "creative" ? first.archivedMediaUrl ?? first.thumbnailUrl ?? "" : "";
    return {
      key,
      name,
      secondary,
      launchDate: dates[0] ?? "",
      lastActivityDate: dates.at(-1) ?? "",
      status,
      previewUrl,
      ...totalsForRows(itemRows, resultMetric, revenueMetric)
    };
  }).sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

function chartMetadataUrl(spreadsheetId: string): string {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set("fields", "spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title,gridProperties),charts(chartId))");
  return url.toString();
}

async function spreadsheetWithCharts(accessToken: string, spreadsheetId: string): Promise<GoogleSpreadsheet & {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } }; charts?: Array<{ chartId?: number }> }>;
}> {
  const response = await fetch(chartMetadataUrl(spreadsheetId), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const payload = await response.json() as GoogleSpreadsheet & {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } }; charts?: Array<{ chartId?: number }> }>;
  };
  if (!response.ok) throw new Error(`Google spreadsheet metadata failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function clearSheet(accessToken: string, spreadsheetId: string, title: string): Promise<void> {
  const range = `'${escapeSheetTitle(title)}'!A:AZ`;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error(`Google values clear failed for ${title}: ${response.status}`);
}

function sheetIds(spreadsheet: GoogleSpreadsheet): Map<string, number> {
  const map = new Map<string, number>();
  for (const sheet of spreadsheet.sheets ?? []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && id !== undefined) map.set(title, id);
  }
  return map;
}

function color(red: number, green: number, blue: number): Record<string, number> {
  return { red, green, blue };
}

function headerFormatRequest(sheetId: number, columns: number): unknown {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns },
      cell: {
        userEnteredFormat: {
          backgroundColor: color(0.05, 0.16, 0.27),
          textFormat: { foregroundColor: color(1, 1, 1), bold: true },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP"
        }
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
    }
  };
}

function genericTableRequests(sheetId: number, columns: number, rows: number): unknown[] {
  return [
    headerFormatRequest(sheetId, columns),
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1, rowCount: Math.max(5000, rows + 100), columnCount: Math.max(30, columns + 3) } },
        fields: "gridProperties(frozenRowCount,rowCount,columnCount)"
      }
    },
    {
      setBasicFilter: {
        filter: { range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(2, rows), startColumnIndex: 0, endColumnIndex: columns } }
      }
    },
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columns }
      }
    }
  ];
}

function dashboardRequests(input: {
  dashboardId: number;
  trendId?: number;
  trendRows: number;
  oldChartIds: number[];
  includeCharts: boolean;
}): unknown[] {
  const requests: unknown[] = input.oldChartIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } }));
  requests.push(
    {
      mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" }
    },
    {
      mergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" }
    },
    {
      repeatCell: {
        range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(0.03, 0.08, 0.11),
            textFormat: { foregroundColor: color(1, 1, 1), bold: true, fontSize: 16 },
            verticalAlignment: "MIDDLE"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"
      }
    },
    {
      repeatCell: {
        range: { sheetId: input.dashboardId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(0.07, 0.14, 0.19),
            textFormat: { foregroundColor: color(0.95, 0.98, 0.99), bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId: input.dashboardId, gridProperties: { frozenRowCount: 2, rowCount: 1000, columnCount: 20 } },
        fields: "gridProperties(frozenRowCount,rowCount,columnCount)"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: input.dashboardId, dimension: "ROWS", startIndex: 0, endIndex: 2 },
        properties: { pixelSize: 34 },
        fields: "pixelSize"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: input.dashboardId, dimension: "COLUMNS", startIndex: 0, endIndex: 12 },
        properties: { pixelSize: 110 },
        fields: "pixelSize"
      }
    }
  );

  if (input.includeCharts && input.trendId !== undefined && input.trendRows > 1) {
    const dataEnd = input.trendRows;
    requests.push(
      {
        addChart: {
          chart: {
            spec: {
              title: "Витрати та дохід",
              basicChart: {
                chartType: "LINE",
                legendPosition: "BOTTOM_LEGEND",
                headerCount: 1,
                axis: [
                  { position: "BOTTOM_AXIS", title: "Період" },
                  { position: "LEFT_AXIS", title: "Значення" }
                ],
                domains: [{ domain: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 1, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
                series: [
                  { series: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 0, endRowIndex: dataEnd, startColumnIndex: 1, endColumnIndex: 2 }] } }, targetAxis: "LEFT_AXIS" },
                  { series: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 0, endRowIndex: dataEnd, startColumnIndex: 7, endColumnIndex: 8 }] } }, targetAxis: "LEFT_AXIS" }
                ]
              }
            },
            position: { overlayPosition: { anchorCell: { sheetId: input.dashboardId, rowIndex: 7, columnIndex: 0 }, widthPixels: 760, heightPixels: 330 } }
          }
        }
      },
      {
        addChart: {
          chart: {
            spec: {
              title: "Результат і ROAS",
              basicChart: {
                chartType: "LINE",
                legendPosition: "BOTTOM_LEGEND",
                headerCount: 1,
                axis: [
                  { position: "BOTTOM_AXIS", title: "Період" },
                  { position: "LEFT_AXIS", title: "Результат" },
                  { position: "RIGHT_AXIS", title: "ROAS" }
                ],
                domains: [{ domain: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 1, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
                series: [
                  { series: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 0, endRowIndex: dataEnd, startColumnIndex: 6, endColumnIndex: 7 }] } }, targetAxis: "LEFT_AXIS" },
                  { series: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 0, endRowIndex: dataEnd, startColumnIndex: 8, endColumnIndex: 9 }] } }, targetAxis: "RIGHT_AXIS" }
                ]
              }
            },
            position: { overlayPosition: { anchorCell: { sheetId: input.dashboardId, rowIndex: 7, columnIndex: 8 }, widthPixels: 650, heightPixels: 330 } }
          }
        }
      }
    );
  }
  return requests;
}

function previewFormula(url: string): string {
  return url ? `=IFERROR(IMAGE("${url.replace(/"/g, '""')}",4,100,100),"")` : "";
}

function dashboardValues(projectName: string, blueprint: AdaptiveReportBlueprint, totals: Totals, currency: string): Cell[][] {
  return [
    [`${projectName} · ${blueprint.title}`],
    [`${blueprint.description} · оновлено ${new Date().toLocaleString("uk-UA")}`],
    [],
    ["Витрати", "", "Результат", "", "Дохід", "", "ROAS", "", "CPA", "", "CTR", ""],
    [`${rounded(totals.spend)} ${currency}`, "", rounded(totals.results), "", `${rounded(totals.revenue)} ${currency}`, "", rounded(safeDivide(totals.revenue, totals.spend)), "", `${rounded(safeDivide(totals.spend, totals.results))} ${currency}`, "", `${percent(safeDivide(totals.clicks, totals.impressions, 100))}%`, ""],
    [],
    ["Періодичність", blueprint.granularity, "Креативи", blueprint.includeCreatives ? "так" : "ні", "Кампанії", blueprint.includeCampaigns ? "так" : "ні", "Ad Sets", blueprint.includeAdSets ? "так" : "ні", "Воронка", blueprint.includeFunnel ? "так" : "ні", "Графіки", blueprint.includeCharts ? "так" : "ні"]
  ];
}

function trendValues(rows: InsightRow[], blueprint: AdaptiveReportBlueprint, resultMetric: string | null, revenueMetric: string | null): Cell[][] {
  const groups = groupBy(rows, (row) => bucketKey(row.date, blueprint.granularity));
  const values: Cell[][] = [["Період", ...METRIC_HEADERS]];
  for (const [period, periodRows] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    values.push([period, ...metricColumns(totalsForRows(periodRows, resultMetric, revenueMetric))]);
  }
  return values;
}

function entityTableValues(aggregates: EntityAggregate[], kind: "campaign" | "adset" | "creative"): Cell[][] {
  if (kind === "creative") {
    return [
      ["Превʼю", "Креатив", "Кампанія", "Запуск", "Остання активність", "Статус", ...METRIC_HEADERS],
      ...aggregates.map((item) => [previewFormula(item.previewUrl), item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...metricColumns(item)])
    ];
  }
  return [
    [kind === "campaign" ? "Кампанія" : "Ad Set", kind === "campaign" ? "Кабінет" : "Кампанія", "Запуск", "Остання активність", "Статус", ...METRIC_HEADERS],
    ...aggregates.map((item) => [item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...metricColumns(item)])
  ];
}

function funnelValues(rows: InsightRow[], blueprint: AdaptiveReportBlueprint, resultMetric: string | null): Cell[][] {
  const metricKeys = blueprint.funnelMetrics.map((key) => key === "business.result" ? resultMetric : key).filter((key): key is string => Boolean(key));
  const uniqueKeys = metricKeys.filter((key, index) => metricKeys.indexOf(key) === index);
  const spend = metricTotal(rows, "spend");
  let previous: number | null = null;
  const values: Cell[][] = [["Етап", "Metric key", "Результат", "CR від попереднього, %", "Ціна етапу"]];
  for (const key of uniqueKeys) {
    const value = metricTotal(rows, key);
    values.push([
      key.replace(/^action\./, "").replace(/[_\.]+/g, " "),
      key,
      rounded(value),
      previous === null ? "—" : percent(safeDivide(value, previous, 100)),
      rounded(safeDivide(spend, value))
    ]);
    previous = value;
  }
  return values;
}

function rawValues(rows: InsightRow[]): Cell[][] {
  return [
    ["__key", "Дата", "Кабінет", "Campaign", "Ad Set", "Ad", "Creative", "Metrics JSON"],
    ...rows.map((row) => [
      row.factKey,
      row.date,
      `${row.accountName} · ${row.accountId}`,
      row.campaignName ?? "",
      row.adSetName ?? "",
      row.adName ?? "",
      row.creativeName ?? "",
      JSON.stringify(row.metrics)
    ])
  ];
}

async function syncStatusValues(db: Database, projectId: string): Promise<Cell[][]> {
  const runs = await db
    .select({
      account: adAccounts.name,
      status: syncRuns.status,
      finishedAt: syncRuns.finishedAt,
      rows: syncRuns.rowsReceived,
      runId: syncRuns.id
    })
    .from(syncRuns)
    .leftJoin(adAccounts, eq(syncRuns.adAccountId, adAccounts.id))
    .where(eq(syncRuns.projectId, projectId))
    .orderBy(desc(syncRuns.createdAt))
    .limit(30);
  const values: Cell[][] = [["Source", "Status", "Last sync", "Rows", "Error"]];
  for (const run of runs) {
    const [error] = await db.select({ message: syncErrors.message }).from(syncErrors).where(eq(syncErrors.syncRunId, run.runId)).limit(1);
    values.push([run.account ?? "Project", run.status, run.finishedAt?.toISOString() ?? "—", run.rows, error?.message ?? ""]);
  }
  return values;
}

async function loadRows(db: Database, projectId: string): Promise<InsightRow[]> {
  const rows = await db
    .select({
      factKey: dailyInsights.factKey,
      date: dailyInsights.insightDate,
      metrics: dailyInsights.metrics,
      accountId: adAccounts.externalAccountId,
      accountName: adAccounts.name,
      campaignId: campaigns.externalCampaignId,
      campaignName: campaigns.name,
      adSetId: adSets.externalAdSetId,
      adSetName: adSets.name,
      adId: ads.externalAdId,
      adName: ads.name,
      adStatus: ads.status,
      creativeId: mediaAssets.id,
      creativeName: mediaAssets.canonicalName,
      creativeType: mediaAssets.type,
      thumbnailUrl: mediaAssets.thumbnailUrl,
      archivedMediaUrl: mediaAssets.archivedMediaUrl
    })
    .from(dailyInsights)
    .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
    .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
    .leftJoin(adSets, eq(dailyInsights.adSetId, adSets.id))
    .leftJoin(ads, eq(dailyInsights.adId, ads.id))
    .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
    .where(eq(dailyInsights.projectId, projectId));
  return rows.map((row) => ({ ...row, metrics: (row.metrics ?? {}) as MetricBag }));
}

export async function syncAdaptiveReport(input: AdaptiveReportInput): Promise<AdaptiveReportResult> {
  const rows = await loadRows(input.db, input.projectId);
  const resultMetric = chooseMetric(rows, input.blueprint.resultMetrics) ?? fallbackResultMetric(rows);
  const revenueMetric = chooseMetric(rows, input.blueprint.revenueMetrics) ?? fallbackRevenueMetric(rows);
  const totals = totalsForRows(rows, resultMetric, revenueMetric);
  const currency = input.currency ?? "USD";

  const tabNames = input.blueprint.tabs.map((tab) => safeSheetTitle(tab.title));
  if (!tabNames.includes("Dashboard")) tabNames.unshift("Dashboard");
  if (!tabNames.includes("Sync Status")) tabNames.push("Sync Status");
  const spreadsheet = await ensureGoogleReportTabs(input.accessToken, input.spreadsheetId, tabNames);
  const ids = sheetIds(spreadsheet);

  const valuesByTab = new Map<string, Cell[][]>();
  valuesByTab.set("Dashboard", dashboardValues(input.projectName, input.blueprint, totals, currency));

  const trendTab = input.blueprint.tabs.find((tab) => tab.kind === "trend");
  if (trendTab) valuesByTab.set(safeSheetTitle(trendTab.title), trendValues(rows, input.blueprint, resultMetric, revenueMetric));
  if (input.blueprint.includeCampaigns) {
    const tab = input.blueprint.tabs.find((item) => item.kind === "campaigns");
    if (tab) valuesByTab.set(safeSheetTitle(tab.title), entityTableValues(entityAggregates(rows, "campaign", resultMetric, revenueMetric), "campaign"));
  }
  if (input.blueprint.includeAdSets) {
    const tab = input.blueprint.tabs.find((item) => item.kind === "adsets");
    if (tab) valuesByTab.set(safeSheetTitle(tab.title), entityTableValues(entityAggregates(rows, "adset", resultMetric, revenueMetric), "adset"));
  }
  if (input.blueprint.includeCreatives) {
    const tab = input.blueprint.tabs.find((item) => item.kind === "creatives");
    if (tab) valuesByTab.set(safeSheetTitle(tab.title), entityTableValues(entityAggregates(rows, "creative", resultMetric, revenueMetric), "creative"));
  }
  if (input.blueprint.includeFunnel) {
    const tab = input.blueprint.tabs.find((item) => item.kind === "funnel");
    if (tab) valuesByTab.set(safeSheetTitle(tab.title), funnelValues(rows, input.blueprint, resultMetric));
  }
  if (input.blueprint.includeRawData) {
    const tab = input.blueprint.tabs.find((item) => item.kind === "raw");
    if (tab) valuesByTab.set(safeSheetTitle(tab.title), rawValues(rows));
  }
  valuesByTab.set("Sync Status", await syncStatusValues(input.db, input.projectId));

  for (const title of valuesByTab.keys()) await clearSheet(input.accessToken, input.spreadsheetId, title);
  await googleValuesBatchUpdate(
    input.accessToken,
    input.spreadsheetId,
    Array.from(valuesByTab.entries()).map(([title, values]) => ({ range: `'${escapeSheetTitle(title)}'!A1`, values }))
  );

  const metadata = await spreadsheetWithCharts(input.accessToken, input.spreadsheetId);
  const metadataIds = sheetIds(metadata);
  const requests: unknown[] = [];
  for (const [title, values] of valuesByTab) {
    const sheetId = metadataIds.get(title);
    if (sheetId === undefined) continue;
    if (title !== "Dashboard") {
      requests.push(...genericTableRequests(sheetId, Math.max(1, values[0]?.length ?? 1), values.length));
      if (title.toLowerCase().includes("creative")) {
        requests.push(
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: "ROWS", startRowIndex: 1, endRowIndex: values.length },
              properties: { pixelSize: 112 },
              fields: "pixelSize"
            }
          },
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
              properties: { pixelSize: 118 },
              fields: "pixelSize"
            }
          }
        );
      }
    }
  }

  const dashboardId = metadataIds.get("Dashboard");
  if (dashboardId !== undefined) {
    const trendTitle = trendTab ? safeSheetTitle(trendTab.title) : undefined;
    const trendId = trendTitle ? metadataIds.get(trendTitle) : undefined;
    const dashboardSheet = metadata.sheets?.find((sheet) => sheet.properties?.sheetId === dashboardId);
    const oldChartIds = (dashboardSheet?.charts ?? []).map((chart) => chart.chartId).filter((id): id is number => id !== undefined);
    requests.push(...dashboardRequests({
      dashboardId,
      trendId,
      trendRows: trendTitle ? valuesByTab.get(trendTitle)?.length ?? 0 : 0,
      oldChartIds,
      includeCharts: input.blueprint.includeCharts
    }));
  }

  await googleSheetsBatchUpdate(input.accessToken, input.spreadsheetId, requests);

  const rowCount = Array.from(valuesByTab.values()).reduce((sum, values) => sum + Math.max(0, values.length - 1), 0);
  return {
    appended: rowCount,
    updated: rowCount,
    tabs: valuesByTab.size,
    resultMetric,
    revenueMetric
  };
}
