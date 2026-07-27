import { eq } from "drizzle-orm";
import {
  createDatabase,
  googleConnections,
  googleReports,
  projects
} from "@zvedeno/database";
import { ensureGoogleReportTabs, refreshGoogleAccessToken } from "./google-client";
import { syncManualAndWeeklySheets } from "./manual-weekly-sheets";

export type ManualWeeklyReportSyncOptions = {
  projectId?: string;
  reportId?: string;
};

export type ManualWeeklyReportSyncSummary = {
  reports: number;
  appended: number;
  updated: number;
  importedManualValues: number;
  errors: number;
};

export async function syncManualWeeklyReports(
  options: ManualWeeklyReportSyncOptions = {}
): Promise<ManualWeeklyReportSyncSummary> {
  const { db, pool } = createDatabase();
  const summary: ManualWeeklyReportSyncSummary = {
    reports: 0,
    appended: 0,
    updated: 0,
    importedManualValues: 0,
    errors: 0
  };

  try {
    const query = db
      .select({
        reportId: googleReports.id,
        spreadsheetId: googleReports.spreadsheetId,
        projectId: googleReports.projectId,
        workspaceId: googleReports.workspaceId,
        encryptedRefreshToken: googleConnections.encryptedRefreshToken
      })
      .from(googleReports)
      .innerJoin(projects, eq(googleReports.projectId, projects.id))
      .innerJoin(googleConnections, eq(googleReports.googleConnectionId, googleConnections.id));

    const reports = options.reportId
      ? await query.where(eq(googleReports.id, options.reportId))
      : options.projectId
        ? await query.where(eq(googleReports.projectId, options.projectId))
        : await query;

    summary.reports = reports.length;

    for (const report of reports) {
      try {
        const accessToken = await refreshGoogleAccessToken(report.encryptedRefreshToken);
        await ensureGoogleReportTabs(accessToken, report.spreadsheetId);
        const result = await syncManualAndWeeklySheets({
          db,
          accessToken,
          reportId: report.reportId,
          spreadsheetId: report.spreadsheetId,
          workspaceId: report.workspaceId,
          projectId: report.projectId
        });
        summary.appended += result.appended;
        summary.updated += result.updated;
        summary.importedManualValues += result.importedManualValues;
      } catch (error) {
        summary.errors += 1;
        console.error("Weekly/manual report sync failed", report.reportId, error);
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
