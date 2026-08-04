import fs from "node:fs";

const path = "packages/sync-engine/src/adaptive-report-sync.ts";
let source = fs.readFileSync(path, "utf8");

const signature = `function resolveReportMetrics(
  blueprint: AdaptiveReportBlueprint,
  revenueMetric: string | null
): ReportMetricDefinition[] {`;
if (!source.includes(signature)) throw new Error("Adaptive metric resolver signature not found");
const helper = `function selectedResultLabel(metric: string | null): string {
  const key = String(metric ?? "").toLowerCase();
  if (key.includes("purchase")) return "Покупки";
  if (key.includes("lead")) return "Ліди";
  if (key.includes("registration")) return "Реєстрації";
  if (key.includes("messaging") || key.includes("conversation")) return "Переписки";
  if (key.includes("landing_page_view")) return "Перегляди лендінгу";
  if (key.includes("link_click")) return "Кліки";
  return "Результат";
}

`;
source = source.replace(
  signature,
  `${helper}function resolveReportMetrics(
  blueprint: AdaptiveReportBlueprint,
  revenueMetric: string | null,
  resultMetric: string | null
): ReportMetricDefinition[] {`
);

const definitionMarker = `    const definition = REPORT_METRIC_DEFINITIONS[key];
    if (!definition) continue;
    seen.add(key);
    metrics.push(definition);`;
if (!source.includes(definitionMarker)) throw new Error("Adaptive metric definition marker not found");
source = source.replace(
  definitionMarker,
  `    const definition = REPORT_METRIC_DEFINITIONS[key];
    if (!definition) continue;
    seen.add(key);
    metrics.push(key === "business.result" ? { ...definition, label: selectedResultLabel(resultMetric) } : definition);`
);

const call = `  const reportMetrics = resolveReportMetrics(input.blueprint, revenueMetric);`;
if (!source.includes(call)) throw new Error("Adaptive metric resolver call not found");
source = source.replace(call, `  const reportMetrics = resolveReportMetrics(input.blueprint, revenueMetric, resultMetric);`);

fs.writeFileSync(path, source);
console.log("Applied adaptive result label patch");
