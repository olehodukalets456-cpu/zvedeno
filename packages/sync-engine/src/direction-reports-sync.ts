import { eq } from "drizzle-orm";
import {
  createDatabase,
  googleConnections,
  googleReports,
  projects,
  reportRecipes
} from "@zvedeno/database";
import { refreshGoogleAccessToken } from "./google-client";
import {
  syncDirectionReport,
  type DirectionReportConfig
} from "./direction-report-by-name";

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
        const accessToken = await refreshGoogleAccessToken(report.encryptedRefreshToken);
        const result = await syncDirectionReport({
          db,
          accessToken,
          reportId: report.reportId,
          spreadsheetId: report.spreadsheetId,
          projectId: report.projectId,
          projectName: report.projectName,
          config: (report.config ?? {}) as DirectionReportConfig
        });
        summary.appended += result.appended;
        summary.updated += result.updated;

        await db
          .update(googleReports)
          .set({
            lastSuccessfulExportAt: new Date(),
            lastExportCursor: new Date().toISOString(),
            updatedAt: new Date()
          })
          .where(eq(googleReports.id, report.reportId));
      } catch (error) {
        summary.errors += 1;
        console.error("Direction Google report sync failed", report.reportId, error);
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
