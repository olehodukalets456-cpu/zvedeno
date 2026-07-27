import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  createDatabase,
  googleConnections,
  googleReports,
  projects,
  reportRecipes
} from "@zvedeno/database";
import {
  createGoogleSpreadsheet,
  GOOGLE_REPORT_TABS,
  initializeGoogleReport,
  refreshGoogleAccessToken,
  syncGoogleReports
} from "@zvedeno/sync-engine";

function appUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000");
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const requestedTitle = String(form.get("title") ?? "").trim();
  if (!projectId) return NextResponse.redirect(appUrl("/setup/accounts?error=missing_project"), 303);

  const { db, pool } = createDatabase();
  try {
    const [project] = await db
      .select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return NextResponse.redirect(appUrl("/setup/accounts?error=project_not_found"), 303);

    const [recipe] = await db
      .select({ id: reportRecipes.id })
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

    const accessToken = await refreshGoogleAccessToken(googleConnection.encryptedRefreshToken);
    const spreadsheet = await createGoogleSpreadsheet(
      accessToken,
      requestedTitle || `${project.name} dashboard`,
      GOOGLE_REPORT_TABS
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
    const url = appUrl(`/projects/${project.id}`);
    url.searchParams.set("report", "created");
    url.searchParams.set("appended", String(summary.appended));
    url.searchParams.set("errors", String(summary.errors));
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
