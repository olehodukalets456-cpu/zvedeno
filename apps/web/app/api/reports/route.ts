import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  createDatabase,
  googleConnections,
  googleReports,
  projects,
  reportRecipes
} from "@zvedeno/database";
import type { ReportInterviewState } from "@zvedeno/shared";
import {
  createGoogleSpreadsheet,
  GOOGLE_REPORT_TABS,
  initializeGoogleReport,
  refreshGoogleAccessToken,
  syncGoogleReports,
  syncManualWeeklyReports
} from "@zvedeno/sync-engine";
import { currentWorkspaceUser } from "../../../lib/auth/workspace-user";
import { LEGACY_DMND_PROJECT_ID } from "../../../lib/project-ai";

function appUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000");
}

function uniqueTabs(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export async function POST(request: NextRequest) {
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) return NextResponse.redirect(appUrl("/auth/sign-in"), 303);

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const requestedTitle = String(form.get("title") ?? "").trim();
  if (!projectId) return NextResponse.redirect(appUrl("/setup/accounts?error=missing_project"), 303);

  const { db, pool } = createDatabase();
  try {
    const [project] = await db
      .select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, currentUser.workspaceId)))
      .limit(1);
    if (!project) return NextResponse.redirect(appUrl("/projects?error=project_not_found"), 303);

    const [recipe] = await db
      .select({ id: reportRecipes.id, config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
      .limit(1);
    const [googleConnection] = await db
      .select({ id: googleConnections.id, encryptedRefreshToken: googleConnections.encryptedRefreshToken })
      .from(googleConnections)
      .where(and(eq(googleConnections.workspaceId, project.workspaceId), eq(googleConnections.status, "active")))
      .orderBy(desc(googleConnections.updatedAt))
      .limit(1);

    if (!recipe || !googleConnection) {
      const url = appUrl("/setup/google");
      url.searchParams.set("projectId", project.id);
      url.searchParams.set("error", "google_or_recipe_missing");
      return NextResponse.redirect(url, 303);
    }

    const interview = ((recipe.config ?? {}) as { reportInterview?: ReportInterviewState }).reportInterview;
    const adaptive = project.id !== LEGACY_DMND_PROJECT_ID
      && interview?.version === "adaptive-v1"
      && interview.status === "ready";
    if (project.id !== LEGACY_DMND_PROJECT_ID && !adaptive) {
      return NextResponse.redirect(appUrl(`/projects/${project.id}/report-builder?error=finish_interview_first`), 303);
    }

    const initialTabs = adaptive
      ? uniqueTabs([
          "Dashboard",
          ...interview.blueprint.tabs.map((tab) => tab.title),
          "Sync Status"
        ])
      : [...GOOGLE_REPORT_TABS];

    const accessToken = await refreshGoogleAccessToken(googleConnection.encryptedRefreshToken);
    const spreadsheet = await createGoogleSpreadsheet(
      accessToken,
      requestedTitle || `${project.name} dashboard`,
      initialTabs
    );
    await initializeGoogleReport(accessToken, spreadsheet);

    const [report] = await db
      .insert(googleReports)
      .values({
        workspaceId: project.workspaceId,
        projectId: project.id,
        reportRecipeId: recipe.id,
        googleConnectionId: googleConnection.id,
        spreadsheetId: spreadsheet.spreadsheetId,
        spreadsheetUrl: spreadsheet.spreadsheetUrl
      })
      .returning({ id: googleReports.id });
    if (!report) throw new Error("Failed to save Google report");

    const summary = await syncGoogleReports({ reportId: report.id });
    const manualWeekly = adaptive
      ? { appended: 0, updated: 0, errors: 0 }
      : await syncManualWeeklyReports({ reportId: report.id });
    const url = appUrl(`/projects/${project.id}`);
    url.searchParams.set("report", "created");
    url.searchParams.set("appended", String(summary.appended + manualWeekly.appended));
    url.searchParams.set("errors", String(summary.errors + manualWeekly.errors));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Report creation failed", error);
    const url = appUrl("/setup/google");
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("error", "report_creation_failed");
    return NextResponse.redirect(url, 303);
  } finally {
    await pool.end();
  }
}
