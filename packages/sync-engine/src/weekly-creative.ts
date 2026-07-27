import { and, eq, isNotNull } from "drizzle-orm";
import {
  adAccounts,
  creativeWeeklySnapshots,
  createDatabase,
  dailyInsights,
  mediaAssets,
  projects,
  reportRecipes
} from "@zvedeno/database";

export type WeeklyCreativeSyncOptions = {
  projectId?: string;
};

export type WeeklyCreativeSyncSummary = {
  projects: number;
  snapshots: number;
};

type ReportConfig = {
  resultMetric?: string;
};

type Aggregate = {
  workspaceId: string;
  projectId: string;
  mediaAssetId: string;
  weekStart: string;
  weekEnd: string;
  accounts: Set<string>;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  resultMetric?: string;
  sourceUpdatedAt?: Date;
};

function numberMetric(metrics: Record<string, string | number | null>, key: string): number {
  const parsed = Number(metrics[key] ?? 0);
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

function mondayOf(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function refreshCreativeWeeklySnapshots(
  options: WeeklyCreativeSyncOptions = {}
): Promise<WeeklyCreativeSyncSummary> {
  const { db, pool } = createDatabase();
  const summary: WeeklyCreativeSyncSummary = { projects: 0, snapshots: 0 };

  try {
    const projectRows = options.projectId
      ? await db
          .select({ id: projects.id, workspaceId: projects.workspaceId })
          .from(projects)
          .where(and(eq(projects.id, options.projectId), eq(projects.archived, false)))
      : await db
          .select({ id: projects.id, workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.archived, false));

    summary.projects = projectRows.length;

    for (const project of projectRows) {
      const [recipe] = await db
        .select({ config: reportRecipes.config })
        .from(reportRecipes)
        .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
        .limit(1);
      const config = (recipe?.config ?? {}) as ReportConfig;

      const rows = await db
        .select({
          date: dailyInsights.insightDate,
          metrics: dailyInsights.metrics,
          updatedAt: dailyInsights.updatedAt,
          mediaAssetId: dailyInsights.mediaAssetId,
          accountName: adAccounts.name
        })
        .from(dailyInsights)
        .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
        .innerJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
        .where(and(eq(dailyInsights.projectId, project.id), isNotNull(dailyInsights.mediaAssetId)));

      const aggregates = new Map<string, Aggregate>();
      for (const row of rows) {
        if (!row.mediaAssetId) continue;
        const weekStart = mondayOf(row.date);
        const key = `${row.mediaAssetId}:${weekStart}`;
        const metrics = row.metrics as Record<string, string | number | null>;
        const resultMetric = resolveResultMetric(metrics, config.resultMetric);
        const aggregate = aggregates.get(key) ?? {
          workspaceId: project.workspaceId,
          projectId: project.id,
          mediaAssetId: row.mediaAssetId,
          weekStart,
          weekEnd: addDays(weekStart, 6),
          accounts: new Set<string>(),
          spend: 0,
          impressions: 0,
          clicks: 0,
          results: 0
        };

        aggregate.accounts.add(row.accountName);
        aggregate.spend += numberMetric(metrics, "spend");
        aggregate.impressions += numberMetric(metrics, "impressions");
        aggregate.clicks += numberMetric(metrics, "clicks");
        if (resultMetric) {
          aggregate.results += numberMetric(metrics, resultMetric);
          aggregate.resultMetric = resultMetric;
        }
        if (!aggregate.sourceUpdatedAt || row.updatedAt > aggregate.sourceUpdatedAt) {
          aggregate.sourceUpdatedAt = row.updatedAt;
        }
        aggregates.set(key, aggregate);
      }

      for (const aggregate of aggregates.values()) {
        const cpa = aggregate.results > 0 ? aggregate.spend / aggregate.results : null;
        const ctr = aggregate.impressions > 0 ? (aggregate.clicks / aggregate.impressions) * 100 : null;
        const cpc = aggregate.clicks > 0 ? aggregate.spend / aggregate.clicks : null;
        await db
          .insert(creativeWeeklySnapshots)
          .values({
            workspaceId: aggregate.workspaceId,
            projectId: aggregate.projectId,
            mediaAssetId: aggregate.mediaAssetId,
            weekStart: aggregate.weekStart,
            weekEnd: aggregate.weekEnd,
            accountNames: Array.from(aggregate.accounts).sort(),
            metrics: {
              spend: aggregate.spend,
              impressions: aggregate.impressions,
              clicks: aggregate.clicks,
              results: aggregate.results,
              cpa,
              ctr,
              cpc,
              resultMetric: aggregate.resultMetric ?? null
            },
            sourceUpdatedAt: aggregate.sourceUpdatedAt ?? new Date()
          })
          .onConflictDoUpdate({
            target: [
              creativeWeeklySnapshots.projectId,
              creativeWeeklySnapshots.mediaAssetId,
              creativeWeeklySnapshots.weekStart
            ],
            set: {
              weekEnd: aggregate.weekEnd,
              accountNames: Array.from(aggregate.accounts).sort(),
              metrics: {
                spend: aggregate.spend,
                impressions: aggregate.impressions,
                clicks: aggregate.clicks,
                results: aggregate.results,
                cpa,
                ctr,
                cpc,
                resultMetric: aggregate.resultMetric ?? null
              },
              sourceUpdatedAt: aggregate.sourceUpdatedAt ?? new Date(),
              updatedAt: new Date()
            }
          });
        summary.snapshots += 1;
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
