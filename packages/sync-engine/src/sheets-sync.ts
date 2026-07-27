import { and, desc, eq } from "drizzle-orm";
import {
  adAccounts,
  ads,
  adSets,
  campaigns,
  createDatabase,
  dailyInsights,
  googleConnections,
  googleReports,
  mediaAssets,
  projects,
  reportRecipes,
  sheetRowMappings,
  syncErrors,
  syncRuns
} from "@zvedeno/database";
import {
  googleValuesAppend,
  googleValuesBatchUpdate,
  parseUpdatedRangeStartRow,
  refreshGoogleAccessToken
} from "./google-client";
import { googleValuesGet } from "./google-values";

type ReportConfig = {
  resultMetric?: string;
  resultLabel?: string;
  startDate?: string;
  includeDaily?: boolean;
  includeCreatives?: boolean;
  funnelStages?: Array<{ label: string; metric: string }>;
};

type SheetCell = string | number | boolean | null;

type ManagedRow = {
  key: string;
  values: SheetCell[];
};

type Aggregate = {
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
};

export type SheetsSyncOptions = {
  projectId?: string;
  reportId?: string;
};

export type SheetsSyncSummary = {
  reports: number;
  appended: number;
  updated: number;
  errors: number;
};

function numberMetric(metrics: Record<string, string | number | null>, key: string): number {
  const value = metrics[key];
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveResultMetric(metrics: Record<string, string | number | null>, configured?: string): string | undefined {
  if (configured && configured in metrics) return configured;
  const preferred = [
    "action.lead",
    "action.offsite_conversion.fb_pixel_lead",
    "action.messaging_conversation_started_7d",
    "action.omni_purchase",
    "action.purchase",
    "action.link_click"
  ];
  return preferred.find((key) => key in metrics) ?? Object.keys(metrics).find((key) => key.startsWith("action."));
}

function addAggregate(target: Aggregate, metrics: Record<string, string | number | null>, resultMetric?: string): void {
  target.spend += numberMetric(metrics, "spend");
  target.impressions += numberMetric(metrics, "impressions");
  target.clicks += numberMetric(metrics, "clicks");
  const resultKey = resolveResultMetric(metrics, resultMetric);
  if (resultKey) target.results += numberMetric(metrics, resultKey);
}

function derived(aggregate: Aggregate) {
  return {
    cpa: aggregate.results > 0 ? aggregate.spend / aggregate.results : null,
    ctr: aggregate.impressions > 0 ? (aggregate.clicks / aggregate.impressions) * 100 : null,
    cpc: aggregate.clicks > 0 ? aggregate.spend / aggregate.clicks : null
  };
}

function rounded(value: number | null, digits = 2): number | string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits));
}

function escapeFormula(value: string): string {
  return value.replace(/"/g, '""');
}

function columnName(column: number): string {
  let result = "";
  let value = column;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

async function syncManagedRows(input: {
  db: ReturnType<typeof createDatabase>["db"];
  accessToken: string;
  reportId: string;
  spreadsheetId: string;
  tab: string;
  rows: ManagedRow[];
  managedColumns: number;
}): Promise<{ appended: number; updated: number }> {
  const { db, accessToken, reportId, spreadsheetId, tab, rows, managedColumns } = input;
  if (rows.length === 0) return { appended: 0, updated: 0 };

  const keyColumn = await googleValuesGet(accessToken, spreadsheetId, `'${tab}'!A2:A`);
  const liveRows = new Map<string, number>();
  keyColumn.forEach((row, index) => {
    const key = String(row[0] ?? "").trim();
    if (key) liveRows.set(key, index + 2);
  });

  const appendRows: ManagedRow[] = [];
  const updateData: Array<{ range: string; values: SheetCell[][] }> = [];

  for (const row of rows) {
    const rowNumber = liveRows.get(row.key);
    if (rowNumber) {
      updateData.push({
        range: `'${tab}'!A${rowNumber}:${columnName(managedColumns)}${rowNumber}`,
        values: [row.values.slice(0, managedColumns)]
      });
      await db
        .insert(sheetRowMappings)
        .values({ googleReportId: reportId, tabName: tab, stableRowKey: row.key, rowNumber, sourceUpdatedAt: new Date() })
        .onConflictDoUpdate({
          target: [sheetRowMappings.googleReportId, sheetRowMappings.tabName, sheetRowMappings.stableRowKey],
          set: { rowNumber, sourceUpdatedAt: new Date(), updatedAt: new Date() }
        });
    } else {
      appendRows.push(row);
    }
  }

  for (let index = 0; index < updateData.length; index += 250) {
    await googleValuesBatchUpdate(accessToken, spreadsheetId, updateData.slice(index, index + 250));
  }

  if (appendRows.length > 0) {
    const result = await googleValuesAppend(
      accessToken,
      spreadsheetId,
      `'${tab}'!A2`,
      appendRows.map((row) => row.values)
    );
    const startRow = parseUpdatedRangeStartRow(result.updatedRange);
    if (startRow) {
      for (let index = 0; index < appendRows.length; index += 1) {
        const row = appendRows[index];
        if (!row) continue;
        await db
          .insert(sheetRowMappings)
          .values({
            googleReportId: reportId,
            tabName: tab,
            stableRowKey: row.key,
            rowNumber: startRow + index,
            sourceUpdatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: [sheetRowMappings.googleReportId, sheetRowMappings.tabName, sheetRowMappings.stableRowKey],
            set: { rowNumber: startRow + index, sourceUpdatedAt: new Date(), updatedAt: new Date() }
          });
      }
    }
  }

  return { appended: appendRows.length, updated: updateData.length };
}

export async function syncGoogleReports(options: SheetsSyncOptions = {}): Promise<SheetsSyncSummary> {
  const { db, pool } = createDatabase();
  const summary: SheetsSyncSummary = { reports: 0, appended: 0, updated: 0, errors: 0 };

  try {
    const reportQuery = db
      .select({
        reportId: googleReports.id,
        spreadsheetId: googleReports.spreadsheetId,
        projectId: googleReports.projectId,
        projectName: projects.name,
        encryptedRefreshToken: googleConnections.encryptedRefreshToken,
        config: reportRecipes.config
      })
      .from(googleReports)
      .innerJoin(projects, eq(googleReports.projectId, projects.id))
      .innerJoin(googleConnections, eq(googleReports.googleConnectionId, googleConnections.id))
      .innerJoin(reportRecipes, eq(googleReports.reportRecipeId, reportRecipes.id));

    const reports = options.reportId
      ? await reportQuery.where(eq(googleReports.id, options.reportId))
      : options.projectId
        ? await reportQuery.where(eq(googleReports.projectId, options.projectId))
        : await reportQuery;

    summary.reports = reports.length;

    for (const report of reports) {
      try {
        const config = (report.config ?? {}) as ReportConfig;
        const accessToken = await refreshGoogleAccessToken(report.encryptedRefreshToken);
        const insightRows = await db
          .select({
            factKey: dailyInsights.factKey,
            date: dailyInsights.insightDate,
            metrics: dailyInsights.metrics,
            accountId: adAccounts.id,
            accountExternalId: adAccounts.externalAccountId,
            accountName: adAccounts.name,
            campaignId: campaigns.id,
            campaignExternalId: campaigns.externalCampaignId,
            campaignName: campaigns.name,
            campaignStatus: campaigns.effectiveStatus,
            adSetId: adSets.id,
            adSetName: adSets.name,
            adId: ads.id,
            adExternalId: ads.externalAdId,
            adName: ads.name,
            assetId: mediaAssets.id,
            assetName: mediaAssets.canonicalName,
            assetType: mediaAssets.type,
            thumbnailUrl: mediaAssets.thumbnailUrl,
            firstSeenAt: mediaAssets.firstSeenAt,
            lastSeenAt: mediaAssets.lastSeenAt,
            updatedAt: dailyInsights.updatedAt
          })
          .from(dailyInsights)
          .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
          .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
          .leftJoin(adSets, eq(dailyInsights.adSetId, adSets.id))
          .leftJoin(ads, eq(dailyInsights.adId, ads.id))
          .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
          .where(eq(dailyInsights.projectId, report.projectId));

        const campaignAggregates = new Map<string, { name: string; account: string; status: string; aggregate: Aggregate }>();
        const creativeAggregates = new Map<string, {
          name: string;
          type: string;
          thumbnail: string | undefined;
          accounts: Set<string>;
          firstSeen: Date | null | undefined;
          lastSeen: Date | null | undefined;
          aggregate: Aggregate;
        }>();
        const total: Aggregate = { spend: 0, impressions: 0, clicks: 0, results: 0 };
        const dailyManagedRows: ManagedRow[] = [];
        const rawRows: ManagedRow[] = [];

        for (const row of insightRows) {
          const metrics = row.metrics as Record<string, string | number | null>;
          addAggregate(total, metrics, config.resultMetric);

          const campaignKey = row.campaignId ?? `campaign:${row.campaignExternalId ?? "unknown"}`;
          const campaign = campaignAggregates.get(campaignKey) ?? {
            name: row.campaignName ?? "Unknown campaign",
            account: row.accountName,
            status: row.campaignStatus ?? "unknown",
            aggregate: { spend: 0, impressions: 0, clicks: 0, results: 0 }
          };
          addAggregate(campaign.aggregate, metrics, config.resultMetric);
          campaignAggregates.set(campaignKey, campaign);

          if (row.assetId) {
            const creative = creativeAggregates.get(row.assetId) ?? {
              name: row.assetName ?? row.adName ?? "Unknown creative",
              type: row.assetType ?? "unknown",
              thumbnail: row.thumbnailUrl ?? undefined,
              accounts: new Set<string>(),
              firstSeen: row.firstSeenAt,
              lastSeen: row.lastSeenAt,
              aggregate: { spend: 0, impressions: 0, clicks: 0, results: 0 }
            };
            creative.accounts.add(row.accountName);
            addAggregate(creative.aggregate, metrics, config.resultMetric);
            creativeAggregates.set(row.assetId, creative);
          }

          const rowAggregate: Aggregate = {
            spend: numberMetric(metrics, "spend"),
            impressions: numberMetric(metrics, "impressions"),
            clicks: numberMetric(metrics, "clicks"),
            results: numberMetric(metrics, resolveResultMetric(metrics, config.resultMetric) ?? "")
          };
          const rowDerived = derived(rowAggregate);
          dailyManagedRows.push({
            key: row.factKey,
            values: [
              row.factKey,
              row.date,
              row.accountName,
              row.campaignName ?? "—",
              row.adSetName ?? "—",
              row.adName ?? "—",
              row.assetName ?? row.adName ?? "—",
              rounded(rowAggregate.spend),
              rowAggregate.impressions,
              rowAggregate.clicks,
              rowAggregate.results,
              rounded(rowDerived.cpa),
              rounded(rowDerived.ctr),
              rounded(rowDerived.cpc)
            ]
          });
          rawRows.push({
            key: row.factKey,
            values: [
              row.factKey,
              row.date,
              row.accountExternalId,
              row.campaignExternalId ?? "",
              row.adSetId ?? "",
              row.adExternalId ?? "",
              row.assetId ?? "",
              JSON.stringify(metrics)
            ]
          });
        }

        const campaignManagedRows: ManagedRow[] = Array.from(campaignAggregates.entries()).map(([key, value]) => {
          const values = derived(value.aggregate);
          return {
            key: `campaign:${key}`,
            values: [
              `campaign:${key}`,
              value.name,
              value.account,
              rounded(value.aggregate.spend),
              value.aggregate.impressions,
              value.aggregate.clicks,
              value.aggregate.results,
              rounded(values.cpa),
              rounded(values.ctr),
              rounded(values.cpc)
            ]
          };
        });

        const creativeManagedRows: ManagedRow[] = Array.from(creativeAggregates.entries()).map(([key, value]) => {
          const values = derived(value.aggregate);
          const preview = value.thumbnail
            ? `=IFERROR(IMAGE("${escapeFormula(value.thumbnail)}",4,120,120),"")`
            : "";
          return {
            key: `creative:${key}`,
            values: [
              `creative:${key}`,
              preview,
              value.name,
              value.type,
              Array.from(value.accounts).join(", "),
              rounded(value.aggregate.spend),
              value.aggregate.impressions,
              value.aggregate.clicks,
              value.aggregate.results,
              rounded(values.cpa),
              rounded(values.ctr),
              rounded(values.cpc),
              value.firstSeen?.toISOString?.() ?? "—",
              value.lastSeen?.toISOString?.() ?? "—"
            ]
          };
        });

        const campaignResult = await syncManagedRows({
          db,
          accessToken,
          reportId: report.reportId,
          spreadsheetId: report.spreadsheetId,
          tab: "Campaigns",
          rows: campaignManagedRows,
          managedColumns: 10
        });
        const dailyResult = config.includeDaily === false
          ? { appended: 0, updated: 0 }
          : await syncManagedRows({
              db,
              accessToken,
              reportId: report.reportId,
              spreadsheetId: report.spreadsheetId,
              tab: "Daily",
              rows: dailyManagedRows,
              managedColumns: 14
            });
        const creativeResult = config.includeCreatives === false
          ? { appended: 0, updated: 0 }
          : await syncManagedRows({
              db,
              accessToken,
              reportId: report.reportId,
              spreadsheetId: report.spreadsheetId,
              tab: "Creatives",
              rows: creativeManagedRows,
              managedColumns: 14
            });
        const rawResult = await syncManagedRows({
          db,
          accessToken,
          reportId: report.reportId,
          spreadsheetId: report.spreadsheetId,
          tab: "Raw Data",
          rows: rawRows,
          managedColumns: 8
        });

        summary.appended += campaignResult.appended + dailyResult.appended + creativeResult.appended + rawResult.appended;
        summary.updated += campaignResult.updated + dailyResult.updated + creativeResult.updated + rawResult.updated;

        const totalDerived = derived(total);
        await googleValuesBatchUpdate(accessToken, report.spreadsheetId, [
          {
            range: "'Dashboard'!A2:C10",
            values: [
              ["Project", report.projectName, new Date().toISOString()],
              ["Spend", rounded(total.spend), new Date().toISOString()],
              ["Impressions", total.impressions, new Date().toISOString()],
              ["Clicks", total.clicks, new Date().toISOString()],
              [config.resultLabel ?? "Results", total.results, new Date().toISOString()],
              ["Cost per result", rounded(totalDerived.cpa), new Date().toISOString()],
              ["CTR, %", rounded(totalDerived.ctr), new Date().toISOString()],
              ["CPC", rounded(totalDerived.cpc), new Date().toISOString()],
              ["Last sync", new Date().toISOString(), new Date().toISOString()]
            ]
          }
        ]);

        const funnelStages = config.funnelStages ?? [
          { label: "Impressions", metric: "impressions" },
          { label: "Clicks", metric: "clicks" },
          { label: config.resultLabel ?? "Results", metric: config.resultMetric ?? "result" }
        ];
        const funnelValues = funnelStages.map((stage, index) => {
          const value = stage.metric === "impressions"
            ? total.impressions
            : stage.metric === "clicks"
              ? total.clicks
              : stage.metric === "result" || stage.metric === config.resultMetric
                ? total.results
                : insightRows.reduce((sum, row) => sum + numberMetric(row.metrics as Record<string, string | number | null>, stage.metric), 0);
          const previousStage = index > 0 ? funnelStages[index - 1] : undefined;
          const previousValue = !previousStage
            ? null
            : previousStage.metric === "impressions"
              ? total.impressions
              : previousStage.metric === "clicks"
                ? total.clicks
                : total.results;
          return [
            stage.label,
            value,
            previousValue && previousValue > 0 ? rounded((value / previousValue) * 100) : "—",
            value > 0 ? rounded(total.spend / value) : "—"
          ];
        });
        await googleValuesBatchUpdate(accessToken, report.spreadsheetId, [
          { range: "'Funnel'!A2:D100", values: funnelValues }
        ]);

        const latestRuns = await db
          .select({
            account: adAccounts.name,
            status: syncRuns.status,
            finishedAt: syncRuns.finishedAt,
            rows: syncRuns.rowsReceived,
            runId: syncRuns.id
          })
          .from(syncRuns)
          .leftJoin(adAccounts, eq(syncRuns.adAccountId, adAccounts.id))
          .where(eq(syncRuns.projectId, report.projectId))
          .orderBy(desc(syncRuns.createdAt))
          .limit(20);
        const statusValues: SheetCell[][] = [];
        for (const run of latestRuns) {
          const [error] = await db
            .select({ message: syncErrors.message })
            .from(syncErrors)
            .where(eq(syncErrors.syncRunId, run.runId))
            .limit(1);
          statusValues.push([
            run.account ?? "Project",
            run.status,
            run.finishedAt?.toISOString() ?? "—",
            run.rows,
            error?.message ?? ""
          ]);
        }
        if (statusValues.length > 0) {
          await googleValuesBatchUpdate(accessToken, report.spreadsheetId, [
            { range: "'Sync Status'!A2:E100", values: statusValues }
          ]);
        }

        await db
          .update(googleReports)
          .set({ lastSuccessfulExportAt: new Date(), lastExportCursor: new Date().toISOString(), updatedAt: new Date() })
          .where(eq(googleReports.id, report.reportId));
      } catch (error) {
        summary.errors += 1;
        console.error("Google report sync failed", report.reportId, error);
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
