import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createDatabase, projects } from "@zvedeno/database";
import { syncGoogleReports } from "@zvedeno/sync-engine";
import { continueReportInterview, loadReportInterview, startReportInterview } from "../../../../../lib/report-interview";
import { currentWorkspaceUser } from "../../../../../lib/auth/workspace-user";

type RouteContext = { params: Promise<{ projectId: string }> };

type AnswerValue = string | string[] | boolean;

function redirectUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "https://etarget.site");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) return NextResponse.redirect(redirectUrl("/auth/sign-in"), 303);
  const { projectId } = await context.params;
  const { db, pool } = createDatabase();
  try {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, currentUser.workspaceId)))
      .limit(1);
    if (!project) return NextResponse.redirect(redirectUrl("/projects?error=project_not_found"), 303);

    const form = await request.formData();
    const action = String(form.get("action") ?? "answer");
    if (action === "restart") {
      await startReportInterview({ projectId, brief: String(form.get("brief") ?? "") });
      return NextResponse.redirect(redirectUrl(`/projects/${projectId}/report-builder?restarted=1`), 303);
    }

    const current = await loadReportInterview(projectId) ?? await startReportInterview({ projectId });
    const answers: Record<string, AnswerValue> = {};
    for (const question of current.questions) {
      if (question.type === "multi") {
        answers[question.id] = form.getAll(question.id).map(String).filter(Boolean);
      } else if (question.type === "boolean") {
        answers[question.id] = String(form.get(question.id) ?? "false") === "true";
      } else {
        answers[question.id] = String(form.get(question.id) ?? "").trim();
      }
    }

    const state = await continueReportInterview({ projectId, answers });
    const url = redirectUrl(`/projects/${projectId}/report-builder`);
    url.searchParams.set(state.status === "ready" ? "ready" : "round", String(state.status === "ready" ? 1 : state.round));
    if (state.status === "ready") {
      const sheets = await syncGoogleReports({ projectId });
      url.searchParams.set("sheets", String(sheets.appended + sheets.updated));
      url.searchParams.set("sheetErrors", String(sheets.errors));
    }
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Report interview failed", error);
    return NextResponse.redirect(redirectUrl(`/projects/${projectId}/report-builder?error=interview_failed`), 303);
  } finally {
    await pool.end();
  }
}
