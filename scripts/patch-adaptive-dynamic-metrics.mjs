import fs from "node:fs";

const path = "packages/sync-engine/src/adaptive-report-sync.ts";
let source = fs.readFileSync(path, "utf8");

function replaceBetween(startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Could not patch between ${startMarker} and ${endMarker}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceBetween(
  "function metricColumns(",
  "function weekStart",
  `type ReportMetricDefinition = {
  key: string;
  label: string;
  value: (totals: Totals) => Cell;
  dashboardValue: (totals: Totals, currency: string) => Cell;
};

const REPORT_METRIC_DEFINITIONS: Record<string, ReportMetricDefinition> = {
  spend: {
    key: "spend",
    label: "Витрати",
    value: (totals) => rounded(totals.spend),
    dashboardValue: (totals, currency) => \`\${rounded(totals.spend)} \${currency}\`
  },
  impressions: {
    key: "impressions",
    label: "Покази",
    value: (totals) => Math.round(totals.impressions),
    dashboardValue: (totals) => Math.round(totals.impressions)
  },
  reach: {
    key: "reach",
    label: "Охоплення",
    value: (totals) => Math.round(totals.reach),
    dashboardValue: (totals) => Math.round(totals.reach)
  },
  "derived.frequency": {
    key: "derived.frequency",
    label: "Частота",
    value: (totals) => percent(safeDivide(totals.impressions, totals.reach)),
    dashboardValue: (totals) => percent(safeDivide(totals.impressions, totals.reach))
  },
  inline_link_clicks: {
    key: "inline_link_clicks",
    label: "Кліки",
    value: (totals) => Math.round(totals.clicks),
    dashboardValue: (totals) => Math.round(totals.clicks)
  },
  "business.result": {
    key: "business.result",
    label: "Результат",
    value: (totals) => Math.round(totals.results * 100) / 100,
    dashboardValue: (totals) => Math.round(totals.results * 100) / 100
  },
  "business.revenue": {
    key: "business.revenue",
    label: "Дохід",
    value: (totals) => rounded(totals.revenue),
    dashboardValue: (totals, currency) => \`\${rounded(totals.revenue)} \${currency}\`
  },
  "derived.roas": {
    key: "derived.roas",
    label: "ROAS",
    value: (totals) => rounded(safeDivide(totals.revenue, totals.spend)),
    dashboardValue: (totals) => rounded(safeDivide(totals.revenue, totals.spend))
  },
  "derived.cpa": {
    key: "derived.cpa",
    label: "CPA",
    value: (totals) => rounded(safeDivide(totals.spend, totals.results)),
    dashboardValue: (totals, currency) => {
      const value = rounded(safeDivide(totals.spend, totals.results));
      return value === "—" ? value : \`\${value} \${currency}\`;
    }
  },
  "derived.cpm": {
    key: "derived.cpm",
    label: "CPM",
    value: (totals) => rounded(safeDivide(totals.spend, totals.impressions, 1000)),
    dashboardValue: (totals, currency) => {
      const value = rounded(safeDivide(totals.spend, totals.impressions, 1000));
      return value === "—" ? value : \`\${value} \${currency}\`;
    }
  },
  "derived.cpc": {
    key: "derived.cpc",
    label: "CPC",
    value: (totals) => rounded(safeDivide(totals.spend, totals.clicks)),
    dashboardValue: (totals, currency) => {
      const value = rounded(safeDivide(totals.spend, totals.clicks));
      return value === "—" ? value : \`\${value} \${currency}\`;
    }
  },
  "derived.ctr": {
    key: "derived.ctr",
    label: "CTR, %",
    value: (totals) => percent(safeDivide(totals.clicks, totals.impressions, 100)),
    dashboardValue: (totals) => {
      const value = percent(safeDivide(totals.clicks, totals.impressions, 100));
      return value === "—" ? value : \`\${value}%\`;
    }
  }
};

const REPORT_METRIC_ALIASES: Record<string, string> = {
  clicks: "inline_link_clicks",
  frequency: "derived.frequency",
  results: "business.result",
  revenue: "business.revenue",
  roas: "derived.roas",
  cpa: "derived.cpa",
  cpm: "derived.cpm",
  cpc: "derived.cpc",
  ctr: "derived.ctr"
};

function resolveReportMetrics(
  blueprint: AdaptiveReportBlueprint,
  revenueMetric: string | null
): ReportMetricDefinition[] {
  const source = blueprint.primaryMetrics.length > 0
    ? blueprint.primaryMetrics
    : ["spend", "business.result", "derived.cpa"];
  const seen = new Set<string>();
  const metrics: ReportMetricDefinition[] = [];
  for (const requested of source) {
    const key = REPORT_METRIC_ALIASES[requested] ?? requested;
    if ((!revenueMetric && (key === "business.revenue" || key === "derived.roas")) || seen.has(key)) continue;
    const definition = REPORT_METRIC_DEFINITIONS[key];
    if (!definition) continue;
    seen.add(key);
    metrics.push(definition);
  }
  if (metrics.length === 0) {
    return [REPORT_METRIC_DEFINITIONS.spend!, REPORT_METRIC_DEFINITIONS["business.result"]!, REPORT_METRIC_DEFINITIONS["derived.cpa"]!];
  }
  return metrics;
}

function metricColumns(totals: Totals, metrics: ReportMetricDefinition[]): Cell[] {
  return metrics.map((metric) => metric.value(totals));
}

function metricHeaders(metrics: ReportMetricDefinition[]): string[] {
  return metrics.map((metric) => metric.label);
}

function weekStart`
);

replaceBetween(
  "function dashboardRequests(",
  "function previewFormula",
  `function chartSeries(
  sheetId: number,
  dataEnd: number,
  columnIndex: number,
  targetAxis: "LEFT_AXIS" | "RIGHT_AXIS" = "LEFT_AXIS"
): Record<string, unknown> {
  return {
    series: {
      sourceRange: {
        sources: [{ sheetId, startRowIndex: 0, endRowIndex: dataEnd, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 }]
      }
    },
    targetAxis
  };
}

function dashboardRequests(input: {
  dashboardId: number;
  trendId?: number;
  trendRows: number;
  trendMetrics: ReportMetricDefinition[];
  oldChartIds: number[];
  includeCharts: boolean;
}): unknown[] {
  const requests: unknown[] = input.oldChartIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } }));
  requests.push(
    {
      unmergeCells: { range: { sheetId: input.dashboardId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 } }
    },
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

  if (!input.includeCharts || input.trendId === undefined || input.trendRows <= 1) return requests;

  const metricColumn = (key: string): number | null => {
    const index = input.trendMetrics.findIndex((metric) => metric.key === key);
    return index >= 0 ? index + 1 : null;
  };
  const dataEnd = input.trendRows;
  const spendColumn = metricColumn("spend");
  const revenueColumn = metricColumn("business.revenue");
  const resultColumn = metricColumn("business.result");
  const roasColumn = metricColumn("derived.roas");

  const financialSeries: Record<string, unknown>[] = [];
  if (spendColumn !== null) financialSeries.push(chartSeries(input.trendId, dataEnd, spendColumn));
  if (revenueColumn !== null) financialSeries.push(chartSeries(input.trendId, dataEnd, revenueColumn));
  if (financialSeries.length > 0) {
    requests.push({
      addChart: {
        chart: {
          spec: {
            title: revenueColumn !== null ? "Витрати та дохід" : "Динаміка витрат",
            basicChart: {
              chartType: "LINE",
              legendPosition: "BOTTOM_LEGEND",
              headerCount: 1,
              axis: [
                { position: "BOTTOM_AXIS", title: "Період" },
                { position: "LEFT_AXIS", title: "Значення" }
              ],
              domains: [{ domain: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 1, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
              series: financialSeries
            }
          },
          position: { overlayPosition: { anchorCell: { sheetId: input.dashboardId, rowIndex: 7, columnIndex: 0 }, widthPixels: 760, heightPixels: 330 } }
        }
      }
    });
  }

  const performanceSeries: Record<string, unknown>[] = [];
  if (resultColumn !== null) performanceSeries.push(chartSeries(input.trendId, dataEnd, resultColumn));
  if (roasColumn !== null) performanceSeries.push(chartSeries(input.trendId, dataEnd, roasColumn, "RIGHT_AXIS"));
  if (performanceSeries.length > 0) {
    const axes: Record<string, unknown>[] = [
      { position: "BOTTOM_AXIS", title: "Період" },
      { position: "LEFT_AXIS", title: "Результат" }
    ];
    if (roasColumn !== null) axes.push({ position: "RIGHT_AXIS", title: "ROAS" });
    requests.push({
      addChart: {
        chart: {
          spec: {
            title: roasColumn !== null ? "Результат і ROAS" : "Динаміка результату",
            basicChart: {
              chartType: "LINE",
              legendPosition: "BOTTOM_LEGEND",
              headerCount: 1,
              axis: axes,
              domains: [{ domain: { sourceRange: { sources: [{ sheetId: input.trendId, startRowIndex: 1, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
              series: performanceSeries
            }
          },
          position: { overlayPosition: { anchorCell: { sheetId: input.dashboardId, rowIndex: 7, columnIndex: 8 }, widthPixels: 650, heightPixels: 330 } }
        }
      }
    });
  }
  return requests;
}

function previewFormula`
);

replaceBetween(
  "function dashboardValues(",
  "function funnelValues",
  `function dashboardValues(
  projectName: string,
  blueprint: AdaptiveReportBlueprint,
  totals: Totals,
  currency: string,
  metrics: ReportMetricDefinition[]
): Cell[][] {
  const kpis = metrics.slice(0, 6);
  const labels: Cell[] = [];
  const values: Cell[] = [];
  for (const metric of kpis) {
    labels.push(metric.label, "");
    values.push(metric.dashboardValue(totals, currency), "");
  }
  while (labels.length < 12) labels.push("");
  while (values.length < 12) values.push("");
  return [
    [\`\${projectName} · \${blueprint.title}\`],
    [\`\${blueprint.description} · оновлено \${new Date().toLocaleString("uk-UA")}\`],
    [],
    labels,
    values,
    [],
    ["Періодичність", blueprint.granularity, "Креативи", blueprint.includeCreatives ? "так" : "ні", "Кампанії", blueprint.includeCampaigns ? "так" : "ні", "Ad Sets", blueprint.includeAdSets ? "так" : "ні", "Воронка", blueprint.includeFunnel ? "так" : "ні", "Графіки", blueprint.includeCharts ? "так" : "ні"]
  ];
}

function trendValues(
  rows: InsightRow[],
  blueprint: AdaptiveReportBlueprint,
  resultMetric: string | null,
  revenueMetric: string | null,
  metrics: ReportMetricDefinition[]
): Cell[][] {
  const groups = groupBy(rows, (row) => bucketKey(row.date, blueprint.granularity));
  const values: Cell[][] = [["Період", ...metricHeaders(metrics)]];
  for (const [period, periodRows] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    values.push([period, ...metricColumns(totalsForRows(periodRows, resultMetric, revenueMetric), metrics)]);
  }
  return values;
}

function entityTableValues(
  aggregates: EntityAggregate[],
  kind: "campaign" | "adset" | "creative",
  metrics: ReportMetricDefinition[]
): Cell[][] {
  const headers = metricHeaders(metrics);
  if (kind === "creative") {
    return [
      ["Превʼю", "Креатив", "Кампанія", "Запуск", "Остання активність", "Статус", ...headers],
      ...aggregates.map((item) => [previewFormula(item.previewUrl), item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...metricColumns(item, metrics)])
    ];
  }
  return [
    [kind === "campaign" ? "Кампанія" : "Ad Set", kind === "campaign" ? "Кабінет" : "Кампанія", "Запуск", "Остання активність", "Статус", ...headers],
    ...aggregates.map((item) => [item.name, item.secondary, item.launchDate, item.lastActivityDate, item.status, ...metricColumns(item, metrics)])
  ];
}

function funnelValues`
);

const totalsMarker = `  const totals = totalsForRows(rows, resultMetric, revenueMetric);
  const currency = input.currency ?? "USD";`;
if (!source.includes(totalsMarker)) throw new Error("Adaptive totals marker not found");
source = source.replace(
  totalsMarker,
  `${totalsMarker}
  const reportMetrics = resolveReportMetrics(input.blueprint, revenueMetric);`
);

source = source.replace(
  `valuesByTab.set("Dashboard", dashboardValues(input.projectName, input.blueprint, totals, currency));`,
  `valuesByTab.set("Dashboard", dashboardValues(input.projectName, input.blueprint, totals, currency, reportMetrics));`
);
source = source.replace(
  `if (trendTab) valuesByTab.set(safeSheetTitle(trendTab.title), trendValues(rows, input.blueprint, resultMetric, revenueMetric));`,
  `if (trendTab) valuesByTab.set(safeSheetTitle(trendTab.title), trendValues(rows, input.blueprint, resultMetric, revenueMetric, reportMetrics));`
);
source = source.replaceAll(
  `entityTableValues(entityAggregates(rows, "campaign", resultMetric, revenueMetric), "campaign")`,
  `entityTableValues(entityAggregates(rows, "campaign", resultMetric, revenueMetric), "campaign", reportMetrics)`
);
source = source.replaceAll(
  `entityTableValues(entityAggregates(rows, "adset", resultMetric, revenueMetric), "adset")`,
  `entityTableValues(entityAggregates(rows, "adset", resultMetric, revenueMetric), "adset", reportMetrics)`
);
source = source.replaceAll(
  `entityTableValues(entityAggregates(rows, "creative", resultMetric, revenueMetric), "creative")`,
  `entityTableValues(entityAggregates(rows, "creative", resultMetric, revenueMetric), "creative", reportMetrics)`
);

const requestMarker = `      trendRows: trendTitle ? valuesByTab.get(trendTitle)?.length ?? 0 : 0,
      oldChartIds,`;
if (!source.includes(requestMarker)) throw new Error("Adaptive chart request marker not found");
source = source.replace(
  requestMarker,
  `      trendRows: trendTitle ? valuesByTab.get(trendTitle)?.length ?? 0 : 0,
      trendMetrics: reportMetrics,
      oldChartIds,`
);

fs.writeFileSync(path, source);
console.log("Applied blueprint-driven adaptive metrics patch");
