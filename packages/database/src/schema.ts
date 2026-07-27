import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const memberRole = pgEnum("member_role", ["owner", "admin", "member", "viewer"]);
export const connectionStatus = pgEnum("connection_status", ["active", "expired", "revoked", "blocked", "archived"]);
export const syncRunStatus = pgEnum("sync_run_status", ["queued", "running", "succeeded", "failed", "partial"]);
export const assetType = pgEnum("asset_type", ["image", "video", "carousel", "unknown"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  imageUrl: text("image_url"),
  ...timestamps
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps
});

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").default("member").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })]);

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...timestamps
}, (table) => [index("clients_workspace_idx").on(table.workspaceId)]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  currency: text("currency"),
  archived: boolean("archived").default(false).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("projects_workspace_slug_uidx").on(table.workspaceId, table.slug),
  index("projects_client_idx").on(table.clientId)
]);

export const metaConnections = pgTable("meta_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  externalUserId: text("external_user_id"),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  status: connectionStatus("status").default("active").notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  ...timestamps
}, (table) => [index("meta_connections_workspace_idx").on(table.workspaceId)]);

export const adAccounts = pgTable("ad_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metaConnectionId: uuid("meta_connection_id").notNull().references(() => metaConnections.id, { onDelete: "cascade" }),
  externalAccountId: text("external_account_id").notNull(),
  name: text("name").notNull(),
  currency: text("currency"),
  timezone: text("timezone"),
  status: connectionStatus("status").default("active").notNull(),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("ad_accounts_workspace_external_uidx").on(table.workspaceId, table.externalAccountId),
  index("ad_accounts_connection_idx").on(table.metaConnectionId)
]);

export const projectAdAccounts = pgTable("project_ad_accounts", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  activeFrom: date("active_from"),
  activeTo: date("active_to"),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.projectId, table.adAccountId] })]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  externalCampaignId: text("external_campaign_id").notNull(),
  name: text("name").notNull(),
  objective: text("objective"),
  status: text("status"),
  effectiveStatus: text("effective_status"),
  raw: jsonb("raw").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("campaigns_account_external_uidx").on(table.adAccountId, table.externalCampaignId),
  index("campaigns_project_idx").on(table.projectId)
]);

export const adSets = pgTable("ad_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  externalAdSetId: text("external_adset_id").notNull(),
  name: text("name").notNull(),
  optimizationGoal: text("optimization_goal"),
  status: text("status"),
  raw: jsonb("raw").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("adsets_account_external_uidx").on(table.adAccountId, table.externalAdSetId)]);

export const ads = pgTable("ads", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  adSetId: uuid("adset_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
  externalAdId: text("external_ad_id").notNull(),
  externalCreativeId: text("external_creative_id"),
  name: text("name").notNull(),
  normalizedCreativeName: text("normalized_creative_name").notNull(),
  status: text("status"),
  raw: jsonb("raw").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("ads_account_external_uidx").on(table.adAccountId, table.externalAdId),
  index("ads_normalized_creative_name_idx").on(table.normalizedCreativeName)
]);

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  canonicalName: text("canonical_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  type: assetType("type").default("unknown").notNull(),
  imageHash: text("image_hash"),
  externalVideoId: text("external_video_id"),
  contentFingerprint: text("content_fingerprint"),
  thumbnailUrl: text("thumbnail_url"),
  archivedMediaUrl: text("archived_media_url"),
  width: integer("width"),
  height: integer("height"),
  durationSeconds: numeric("duration_seconds", { precision: 10, scale: 3 }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  conflictDetected: boolean("conflict_detected").default(false).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("media_assets_project_name_uidx").on(table.projectId, table.normalizedName),
  index("media_assets_project_idx").on(table.projectId)
]);

export const adMediaAssets = pgTable("ad_media_assets", {
  adId: uuid("ad_id").notNull().references(() => ads.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.adId, table.mediaAssetId] })]);

export const dailyInsights = pgTable("daily_insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  adAccountId: uuid("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  adSetId: uuid("adset_id").references(() => adSets.id, { onDelete: "cascade" }),
  adId: uuid("ad_id").references(() => ads.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  insightDate: date("insight_date").notNull(),
  breakdownHash: text("breakdown_hash").default("none").notNull(),
  attributionSetting: text("attribution_setting").default("default").notNull(),
  breakdowns: jsonb("breakdowns").$type<Record<string, string>>().default({}).notNull(),
  metrics: jsonb("metrics").$type<Record<string, string | number | null>>().default({}).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("daily_insights_fact_uidx").on(
    table.projectId,
    table.adAccountId,
    table.insightDate,
    table.campaignId,
    table.adSetId,
    table.adId,
    table.breakdownHash,
    table.attributionSetting
  ),
  index("daily_insights_project_date_idx").on(table.projectId, table.insightDate),
  index("daily_insights_asset_date_idx").on(table.mediaAssetId, table.insightDate)
]);

export const resultDefinitions = pgTable("result_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sourceType: text("source_type").notNull(),
  sourceEvent: text("source_event").notNull(),
  aggregation: text("aggregation").default("sum").notNull(),
  ...timestamps
}, (table) => [index("result_definitions_project_idx").on(table.projectId)]);

export const mappingRules = pgTable("mapping_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  operator: text("operator").notNull(),
  value: text("value").notNull(),
  direction: text("direction"),
  resultDefinitionId: uuid("result_definition_id").references(() => resultDefinitions.id, { onDelete: "set null" }),
  priority: integer("priority").default(100).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  ...timestamps
}, (table) => [index("mapping_rules_workspace_priority_idx").on(table.workspaceId, table.priority)]);

export const reportRecipes = pgTable("report_recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: integer("version").default(1).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, (table) => [index("report_recipes_project_idx").on(table.projectId)]);

export const googleConnections = pgTable("google_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  status: connectionStatus("status").default("active").notNull(),
  ...timestamps
}, (table) => [index("google_connections_workspace_idx").on(table.workspaceId)]);

export const googleReports = pgTable("google_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportRecipeId: uuid("report_recipe_id").notNull().references(() => reportRecipes.id, { onDelete: "cascade" }),
  googleConnectionId: uuid("google_connection_id").notNull().references(() => googleConnections.id, { onDelete: "cascade" }),
  spreadsheetId: text("spreadsheet_id").notNull().unique(),
  spreadsheetUrl: text("spreadsheet_url").notNull(),
  lastExportCursor: text("last_export_cursor"),
  lastSuccessfulExportAt: timestamp("last_successful_export_at", { withTimezone: true }),
  ...timestamps
}, (table) => [index("google_reports_project_idx").on(table.projectId)]);

export const sheetRowMappings = pgTable("sheet_row_mappings", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleReportId: uuid("google_report_id").notNull().references(() => googleReports.id, { onDelete: "cascade" }),
  tabName: text("tab_name").notNull(),
  stableRowKey: text("stable_row_key").notNull(),
  rowNumber: integer("row_number").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("sheet_rows_report_tab_key_uidx").on(table.googleReportId, table.tabName, table.stableRowKey)
]);

export const manualFieldValues = pgTable("manual_field_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  stableEntityKey: text("stable_entity_key").notNull(),
  fieldKey: text("field_key").notNull(),
  value: jsonb("value").$type<string | number | boolean | null>(),
  ...timestamps
}, (table) => [
  uniqueIndex("manual_values_entity_field_uidx").on(table.projectId, table.entityType, table.stableEntityKey, table.fieldKey)
]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  adAccountId: uuid("ad_account_id").references(() => adAccounts.id, { onDelete: "set null" }),
  jobType: text("job_type").notNull(),
  status: syncRunStatus("status").default("queued").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowsReceived: integer("rows_received").default(0).notNull(),
  rowsInserted: integer("rows_inserted").default(0).notNull(),
  rowsUpdated: integer("rows_updated").default(0).notNull(),
  cursor: text("cursor"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("sync_runs_workspace_created_idx").on(table.workspaceId, table.createdAt)]);

export const syncErrors = pgTable("sync_errors", {
  id: uuid("id").defaultRandom().primaryKey(),
  syncRunId: uuid("sync_run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
  code: text("code"),
  message: text("message").notNull(),
  retryable: boolean("retryable").default(false).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("sync_errors_run_idx").on(table.syncRunId)]);
