import fs from "node:fs";

const path = "packages/sync-engine/src/meta-sync.ts";
let source = fs.readFileSync(path, "utf8");

const fieldsStart = source.indexOf("const FULL_INSIGHT_FIELDS = [");
const fieldsEnd = source.indexOf("function isoDate", fieldsStart);
if (fieldsStart < 0 || fieldsEnd < 0) throw new Error("Meta insight field block not found");

const identityFields = `
  "date_start",
  "date_stop",
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name"`;

const deliveryFields = `
  "spend",
  "social_spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "unique_clicks",
  "inline_link_clicks",
  "unique_inline_link_clicks",
  "outbound_clicks",
  "unique_outbound_clicks",
  "cpc",
  "cpm",
  "cpp",
  "cost_per_unique_click",
  "ctr"`;

const replacementFields = `const FULL_INSIGHT_FIELDS = [${identityFields},${deliveryFields},
  "actions",
  "action_values",
  "cost_per_action_type",
  "website_purchase_roas",
  "purchase_roas",
  "video_play_actions",
  "video_thruplay_watched_actions",
  "video_avg_time_watched_actions",
  "video_continuous_2_sec_watched_actions",
  "video_30_sec_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking"
].join(",");

const VALUE_INSIGHT_FIELDS = [${identityFields},${deliveryFields},
  "actions",
  "action_values",
  "cost_per_action_type",
  "website_purchase_roas",
  "purchase_roas"
].join(",");

const ACTION_VALUE_INSIGHT_FIELDS = [${identityFields},${deliveryFields},
  "actions",
  "action_values",
  "cost_per_action_type"
].join(",");

const CORE_INSIGHT_FIELDS = [${identityFields},${deliveryFields},
  "actions"
].join(",");

`;
source = source.slice(0, fieldsStart) + replacementFields + source.slice(fieldsEnd);

const metricStart = source.indexOf("function addActionValues(");
const metricEnd = source.indexOf("function inferAssetType", metricStart);
if (metricStart < 0 || metricEnd < 0) throw new Error("Meta metric mapper block not found");

const replacementMetrics = `const ARRAY_METRIC_PREFIXES: Record<string, string> = {
  actions: "action",
  action_values: "action_value",
  cost_per_action_type: "cost_per_action",
  website_purchase_roas: "website_purchase_roas",
  purchase_roas: "purchase_roas",
  outbound_clicks: "outbound_clicks",
  unique_outbound_clicks: "unique_outbound_clicks",
  video_play_actions: "video_play",
  video_thruplay_watched_actions: "video_thruplay",
  video_avg_time_watched_actions: "video_avg_time",
  video_continuous_2_sec_watched_actions: "video_continuous_2_sec",
  video_30_sec_watched_actions: "video_30_sec",
  video_p25_watched_actions: "video_25",
  video_p50_watched_actions: "video_50",
  video_p75_watched_actions: "video_75",
  video_p95_watched_actions: "video_95",
  video_p100_watched_actions: "video_100"
};

const NON_METRIC_FIELDS = new Set([
  "date_start",
  "date_stop",
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name"
]);

function addArrayMetric(
  target: Record<string, string | number | null>,
  key: string,
  values: unknown
): void {
  if (!Array.isArray(values)) return;
  const prefix = ARRAY_METRIC_PREFIXES[key] ?? key;
  for (const item of values) {
    if (!item || typeof item !== "object") continue;
    const actionType = String((item as { action_type?: unknown }).action_type ?? "total");
    const value = numberValue((item as { value?: unknown }).value);
    target[\`\${prefix}.\${actionType}\`] = value;
  }
}

function insightMetrics(insight: MetaInsight): Record<string, string | number | null> {
  const metrics: Record<string, string | number | null> = {};

  for (const [key, raw] of Object.entries(insight)) {
    if (NON_METRIC_FIELDS.has(key) || raw === undefined) continue;
    if (Array.isArray(raw)) {
      addArrayMetric(metrics, key, raw);
      continue;
    }
    if (raw === null) {
      metrics[key] = null;
      continue;
    }
    if (typeof raw === "number") {
      metrics[key] = Number.isFinite(raw) ? raw : null;
      continue;
    }
    if (typeof raw === "string") {
      const parsed = numberValue(raw);
      metrics[key] = parsed === null ? raw : parsed;
      continue;
    }
    if (typeof raw === "boolean") {
      metrics[key] = raw ? 1 : 0;
    }
  }

  return metrics;
}

`;
source = source.slice(0, metricStart) + replacementMetrics + source.slice(metricEnd);

const candidates = "[FULL_INSIGHT_FIELDS, CORE_INSIGHT_FIELDS]";
if (!source.includes(candidates)) throw new Error("Meta insight fallback candidates not found");
source = source.replace(
  candidates,
  "[FULL_INSIGHT_FIELDS, VALUE_INSIGHT_FIELDS, ACTION_VALUE_INSIGHT_FIELDS, CORE_INSIGHT_FIELDS]"
);

fs.writeFileSync(path, source);
console.log("Applied complete Meta metric inventory patch");
