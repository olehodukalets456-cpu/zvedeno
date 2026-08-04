import fs from "node:fs";

const syncPath = "packages/sync-engine/src/adaptive-report-sync.ts";
const layoutPath = "packages/sync-engine/src/client-report-layout.ts";
let source = fs.readFileSync(syncPath, "utf8");
let layout = fs.readFileSync(layoutPath, "utf8");

function mustReplace(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Client report patch marker missing: ${label}`);
  return text.replace(before, after);
}

const sharedImport = 'import type { AdaptiveReportBlueprint, ReportGranularity } from "@zvedeno/shared";';
const clientImport = `import {
  CLIENT_DASHBOARD_TITLE,
  CLIENT_SYNC_TITLE,
  buildClientMetricColumns,
  clientDashboardRequests,
  clientDashboardValues,
  clientEntityTableValues,
  clientSheetLayoutRequests,
  clientSheetTitle,
  clientTableRequests,
  clientTrendValues
} from "./client-report-layout";`;
if (!source.includes(clientImport)) {
  source = mustReplace(source, sharedImport, `${sharedImport}\n${clientImport}`, "client layout import");
}

const reportMetricsMarker = "  const reportMetrics = resolveReportMetrics(input.blueprint, revenueMetric, resultMetric);";
source = mustReplace(
  source,
  reportMetricsMarker,
  `${reportMetricsMarker}\n  const clientColumns = buildClientMetricColumns(input.blueprint, totals, resultMetric, revenueMetric);`,
  "client metric columns"
);

const tabNamesPattern = /  const tabNames = input\.blueprint\.tabs\.map\(\(tab\) => safeSheetTitle\(tab\.title\)\);\n  if \(!tabNames\.includes\("Dashboard"\)\) tabNames\.unshift\("Dashboard"\);\n  if \(!tabNames\.includes\("Sync Status"\)\) tabNames\.push\("Sync Status"\);/;
if (!tabNamesPattern.test(source)) throw new Error("Client report patch marker missing: tab names");
source = source.replace(
  tabNamesPattern,
  `  const tabNames = input.blueprint.tabs.map((tab) => clientSheetTitle(tab.kind, input.blueprint.granularity));
  if (!tabNames.includes(CLIENT_DASHBOARD_TITLE)) tabNames.unshift(CLIENT_DASHBOARD_TITLE);
  if (!tabNames.includes(CLIENT_SYNC_TITLE)) tabNames.push(CLIENT_SYNC_TITLE);`
);

source = mustReplace(
  source,
  '  valuesByTab.set("Dashboard", dashboardValues(input.projectName, input.blueprint, totals, currency, reportMetrics));',
  `  valuesByTab.set(CLIENT_DASHBOARD_TITLE, clientDashboardValues({
    projectName: input.projectName,
    blueprint: input.blueprint,
    rows,
    resultMetric,
    revenueMetric,
    currency,
    columns: clientColumns
  }));`,
  "dashboard values"
);

source = mustReplace(
  source,
  '  if (trendTab) valuesByTab.set(safeSheetTitle(trendTab.title), trendValues(rows, input.blueprint, resultMetric, revenueMetric, reportMetrics));',
  '  if (trendTab) valuesByTab.set(clientSheetTitle(trendTab.kind, input.blueprint.granularity), clientTrendValues(rows, input.blueprint, resultMetric, revenueMetric, clientColumns));',
  "trend values"
);

source = source.replaceAll(
  'valuesByTab.set(safeSheetTitle(tab.title), entityTableValues(entityAggregates(rows, "campaign", resultMetric, revenueMetric), "campaign", reportMetrics))',
  'valuesByTab.set(clientSheetTitle(tab.kind, input.blueprint.granularity), clientEntityTableValues(entityAggregates(rows, "campaign", resultMetric, revenueMetric), "campaign", clientColumns))'
);
source = source.replaceAll(
  'valuesByTab.set(safeSheetTitle(tab.title), entityTableValues(entityAggregates(rows, "adset", resultMetric, revenueMetric), "adset", reportMetrics))',
  'valuesByTab.set(clientSheetTitle(tab.kind, input.blueprint.granularity), clientEntityTableValues(entityAggregates(rows, "adset", resultMetric, revenueMetric), "adset", clientColumns))'
);
source = source.replaceAll(
  'valuesByTab.set(safeSheetTitle(tab.title), entityTableValues(entityAggregates(rows, "creative", resultMetric, revenueMetric), "creative", reportMetrics))',
  'valuesByTab.set(clientSheetTitle(tab.kind, input.blueprint.granularity), clientEntityTableValues(entityAggregates(rows, "creative", resultMetric, revenueMetric), "creative", clientColumns))'
);

source = source.replaceAll(
  "valuesByTab.set(safeSheetTitle(tab.title), funnelValues(rows, input.blueprint, resultMetric))",
  "valuesByTab.set(clientSheetTitle(tab.kind, input.blueprint.granularity), funnelValues(rows, input.blueprint, resultMetric))"
);
source = source.replaceAll(
  "valuesByTab.set(safeSheetTitle(tab.title), rawValues(rows))",
  "valuesByTab.set(clientSheetTitle(tab.kind, input.blueprint.granularity), rawValues(rows))"
);
source = mustReplace(
  source,
  '  valuesByTab.set("Sync Status", await syncStatusValues(input.db, input.projectId));',
  "  valuesByTab.set(CLIENT_SYNC_TITLE, await syncStatusValues(input.db, input.projectId));",
  "sync title"
);

source = source.replaceAll('title !== "Dashboard"', "title !== CLIENT_DASHBOARD_TITLE");
source = mustReplace(
  source,
  "      requests.push(...genericTableRequests(sheetId, Math.max(1, values[0]?.length ?? 1), values.length));",
  `      requests.push(...clientTableRequests({
        sheetId,
        headers: values[0] ?? [],
        rows: values.length,
        columns: clientColumns,
        currency,
        isCreative: title === clientSheetTitle("creatives", input.blueprint.granularity)
      }));`,
  "client table formatting"
);

source = source.replaceAll('metadataIds.get("Dashboard")', "metadataIds.get(CLIENT_DASHBOARD_TITLE)");
source = source.replaceAll(
  "const trendTitle = trendTab ? safeSheetTitle(trendTab.title) : undefined;",
  "const trendTitle = trendTab ? clientSheetTitle(trendTab.kind, input.blueprint.granularity) : undefined;"
);

const dashboardCallPattern = /    requests\.push\(\.\.\.dashboardRequests\(\{\n      dashboardId,\n      trendId,\n      trendRows: trendTitle \? valuesByTab\.get\(trendTitle\)\?\.length \?\? 0 : 0,\n      trendMetrics: reportMetrics,\n      oldChartIds,\n      includeCharts: input\.blueprint\.includeCharts\n    \}\)\);/;
if (!dashboardCallPattern.test(source)) throw new Error("Client report patch marker missing: dashboard request");
source = source.replace(
  dashboardCallPattern,
  `    requests.push(...clientDashboardRequests({
      dashboardId,
      trendId,
      trendHeaders: trendTitle ? valuesByTab.get(trendTitle)?.[0] ?? [] : [],
      trendRows: trendTitle ? valuesByTab.get(trendTitle)?.length ?? 0 : 0,
      oldChartIds,
      includeCharts: input.blueprint.includeCharts
    }));`
);

const batchUpdateMarker = "  await googleSheetsBatchUpdate(input.accessToken, input.spreadsheetId, requests);";
const layoutRequests = `  const rawTitle = clientSheetTitle("raw", input.blueprint.granularity);
  const orderedTitles = [
    CLIENT_DASHBOARD_TITLE,
    ...input.blueprint.tabs
      .filter((tab) => !["dashboard", "raw", "sync"].includes(tab.kind))
      .map((tab) => clientSheetTitle(tab.kind, input.blueprint.granularity)),
    rawTitle,
    CLIENT_SYNC_TITLE
  ].filter((title, index, items) => items.indexOf(title) === index);
  requests.push(...clientSheetLayoutRequests({
    sheets: metadata.sheets ?? [],
    orderedTitles,
    technicalTitles: [rawTitle, CLIENT_SYNC_TITLE]
  }));

${batchUpdateMarker}`;
source = mustReplace(source, batchUpdateMarker, layoutRequests, "sheet layout requests");

const previewMarker = "export function clientEntityTableValues(";
if (!layout.includes("function previewFormula(")) {
  layout = mustReplace(
    layout,
    previewMarker,
    `function previewFormula(url: string): string {
  return url ? \`=IFERROR(IMAGE("\${url.replace(/"/g, '\"\"')}", 4, 96, 96), "")\` : "";
}

${previewMarker}`,
    "creative preview formula"
  );
  layout = mustReplace(
    layout,
    "...aggregates.map((item) => [item.previewUrl, item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...columns.map((column) => metricValue(item, column.id))])",
    "...aggregates.map((item) => [previewFormula(item.previewUrl), item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...columns.map((column) => metricValue(item, column.id))])",
    "creative preview values"
  );
}

const dashboardPrefix = `export function clientDashboardRequests(input: {
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
      updateSheetProperties:`;
if (!layout.includes("startRowIndex: 0, endRowIndex: 11, startColumnIndex: 0, endColumnIndex: 12")) {
  layout = mustReplace(
    layout,
    dashboardPrefix,
    `export function clientDashboardRequests(input: {
  dashboardId: number;
  trendId?: number;
  trendHeaders: Cell[];
  trendRows: number;
  oldChartIds: number[];
  includeCharts: boolean;
}): unknown[] {
  const requests: unknown[] = input.oldChartIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } }));
  requests.push(
    { unmergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 11, startColumnIndex: 0, endColumnIndex: 12 } } },
    {
      updateSheetProperties:`,
    "dashboard unmerge"
  );
}

fs.writeFileSync(syncPath, source);
fs.writeFileSync(layoutPath, layout);
console.log("Applied client-first adaptive report experience");
