import { and, eq } from "drizzle-orm";
import {
  adAccounts,
  createDatabase,
  projectAdAccounts,
  projects,
  reportRecipes
} from "@zvedeno/database";
import { syncMetaData } from "./meta-sync";
import { syncGoogleReports } from "./sheets-sync";

type RecipeConfig = { refreshMinutes?: number };

export type ScheduledSyncSummary = {
  dueProjects: number;
  metaInsights: number;
  sheetRows: number;
  errors: number;
};

export async function runScheduledSyncCycle(now = new Date()): Promise<ScheduledSyncSummary> {
  const { db, pool } = createDatabase();
  let rows: Array<{ projectId: string; config: Record<string, unknown>; lastSync: Date | null }> = [];
  try {
    rows = await db
      .select({
        projectId: projects.id,
        config: reportRecipes.config,
        lastSync: adAccounts.lastSuccessfulSyncAt
      })
      .from(reportRecipes)
      .innerJoin(projects, eq(reportRecipes.projectId, projects.id))
      .leftJoin(projectAdAccounts, eq(projectAdAccounts.projectId, projects.id))
      .leftJoin(adAccounts, eq(projectAdAccounts.adAccountId, adAccounts.id))
      .where(and(eq(reportRecipes.enabled, true), eq(projects.archived, false)));
  } finally {
    await pool.end();
  }

  const grouped = new Map<string, { refreshMinutes: number; lastSyncs: Array<Date | null> }>();
  for (const row of rows) {
    const config = row.config as RecipeConfig;
    const current = grouped.get(row.projectId) ?? {
      refreshMinutes: Math.max(15, Number(config.refreshMinutes ?? 60)),
      lastSyncs: []
    };
    current.lastSyncs.push(row.lastSync);
    grouped.set(row.projectId, current);
  }

  const dueProjectIds = Array.from(grouped.entries())
    .filter(([, value]) => {
      if (value.lastSyncs.length === 0 || value.lastSyncs.some((date) => date === null)) return true;
      const latestRequired = now.getTime() - value.refreshMinutes * 60 * 1000;
      return value.lastSyncs.some((date) => (date?.getTime() ?? 0) <= latestRequired);
    })
    .map(([projectId]) => projectId);

  const summary: ScheduledSyncSummary = {
    dueProjects: dueProjectIds.length,
    metaInsights: 0,
    sheetRows: 0,
    errors: 0
  };

  for (const projectId of dueProjectIds) {
    const meta = await syncMetaData({ projectId });
    const sheets = await syncGoogleReports({ projectId });
    summary.metaInsights += meta.insights;
    summary.sheetRows += sheets.appended + sheets.updated;
    summary.errors += meta.errors + sheets.errors;
  }

  return summary;
}
