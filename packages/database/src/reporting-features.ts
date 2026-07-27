import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { mediaAssets, projects, workspaces } from "./schema";

export const manualMetricScope = pgEnum("manual_metric_scope", ["project", "campaign", "creative"]);
export const manualMetricPeriod = pgEnum("manual_metric_period", ["day", "week", "month", "lifetime"]);
export const manualMetricValueType = pgEnum("manual_metric_value_type", ["number", "currency", "percentage"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const manualMetricDefinitions = pgTable("manual_metric_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  scope: manualMetricScope("scope").default("project").notNull(),
  period: manualMetricPeriod("period").default("week").notNull(),
  valueType: manualMetricValueType("value_type").default("number").notNull(),
  conversionBaseMetric: text("conversion_base_metric"),
  includeConversionRate: boolean("include_conversion_rate").default(true).notNull(),
  includeCostPerValue: boolean("include_cost_per_value").default(true).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  sortOrder: integer("sort_order").default(100).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("manual_metric_definitions_project_key_uidx").on(table.projectId, table.key),
  index("manual_metric_definitions_project_idx").on(table.projectId, table.enabled, table.sortOrder)
]);

export const manualMetricValues = pgTable("manual_metric_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  definitionId: uuid("definition_id").notNull().references(() => manualMetricDefinitions.id, { onDelete: "cascade" }),
  entityKey: text("entity_key").default("project").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  value: numeric("value", { precision: 20, scale: 4 }).notNull(),
  note: text("note"),
  source: text("source").default("manual").notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("manual_metric_values_period_uidx").on(
    table.definitionId,
    table.entityKey,
    table.periodStart,
    table.periodEnd
  ),
  index("manual_metric_values_project_period_idx").on(table.projectId, table.periodStart, table.periodEnd)
]);

export const creativeWeeklySnapshots = pgTable("creative_weekly_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  weekEnd: date("week_end").notNull(),
  accountNames: jsonb("account_names").$type<string[]>().default([]).notNull(),
  metrics: jsonb("metrics").$type<Record<string, string | number | null>>().default({}).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("creative_weekly_snapshots_asset_week_uidx").on(table.projectId, table.mediaAssetId, table.weekStart),
  index("creative_weekly_snapshots_project_week_idx").on(table.projectId, table.weekStart),
  index("creative_weekly_snapshots_asset_idx").on(table.mediaAssetId)
]);
