import { eq } from "drizzle-orm";
import {
  createDatabase,
  googleConnections,
  googleReports,
  projects,
  reportRecipes
} from "@zvedeno/database";
import type { ReportInterviewState } from "@zvedeno/shared";
import { syncAdaptiveReport } from "./adaptive-report-sync";
import { refreshGoogleAccessToken } from "./google-client";
import {
  syncDirectionReport,
  type DirectionReportConfig
} from "./direction-report-by-name";

const LEGACY_DMND_PROJECT_ID = "cc6f71d1-1043-4a2e-96d7-8f50484c010e";

type AdaptiveConfig = DirectionReportConfig & {
  reportInterview?: ReportInterviewState;
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
        projectCurrency: projects.currency,
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
        const config = (report.config ?? {}) as AdaptiveConfig;
        const interview = config.reportInterview;
        const adaptive = report.projectId !== LEGACY_DMND_PROJECT_ID
          && interview?.version === "adaptive-v1"
          && interview.status === "ready";

        const result = adaptive
          ? await syncAdaptiveReport({
              db,
              accessToken,
              spreadsheetId: report.spreadsheetId,
              projectId: report.projectId,
              projectName: report.projectName,
              currency: report.projectCurrency,
              blueprint: interview.blueprint
            })
          : await syncDirectionReport({
              db,
              accessToken,
              reportId: report.reportId,
              spreadsheetId: report.spreadsheetId,
              projectId: report.projectId,
              projectName: report.projectName,
              config
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
        console.error("Google report sync failed", report.reportId, error);
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
