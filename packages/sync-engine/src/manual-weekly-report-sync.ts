import { eq } from "drizzle-orm";
import {
  createDatabase,
  googleConnections,
  googleReports,
  projects
} from "@zvedeno/database";
import {
  ensureGoogleReportTabs,
  googleValuesBatchUpdate,
  refreshGoogleAccessToken
} from "./google-client";
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

const WEEKLY_HEADERS = [
  {
    range: "'Weekly Summary'!A1",
    values: [[
      "__key", "Week", "Spend", "Impressions", "Clicks", "Meta results", "Meta CPL",
      "Manual metric", "Manual value", "Final CPA", "Meta → manual CR, %", "Status", "Comment"
    ]]
  },
  {
    range: "'Creative Weekly'!A1",
    values: [[
      "__key", "Preview", "Week", "Creative", "Format", "Accounts", "Spend", "Impressions",
      "Clicks", "Meta results", "Meta CPL", "Manual metric", "Manual result", "Final CPA",
      "Meta → manual CR, %", "Status", "Comment"
    ]]
  },
  {
    range: "'Manual Input'!A1",
    values: [["__key", "Period start", "Period end", "Scope", "Entity", "Metric", "Value", "Note"]]
  }
];

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
        await googleValuesBatchUpdate(accessToken, report.spreadsheetId, WEEKLY_HEADERS);
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
