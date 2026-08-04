import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createDatabase, projects } from "@zvedeno/database";
import { canManageWorkspace, currentWorkspaceUser } from "../../../../../lib/auth/workspace-user";

type RouteContext = { params: Promise<{ projectId: string }> };

function redirectUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "https://etarget.site");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const currentUser = await currentWorkspaceUser();
  if (!canManageWorkspace(currentUser)) {
    return NextResponse.redirect(redirectUrl("/projects?error=forbidden"), 303);
  }

  const { projectId } = await context.params;
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const { db, pool } = createDatabase();

  try {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, currentUser.workspaceId)))
      .limit(1);
    if (!project) return NextResponse.redirect(redirectUrl("/projects?error=project_not_found"), 303);

    if (action === "rename") {
      const name = String(form.get("name") ?? "").trim();
      if (!name || name.length > 120) {
        return NextResponse.redirect(redirectUrl("/projects?error=invalid_project_name"), 303);
      }
      await db.update(projects).set({ name, updatedAt: new Date() }).where(eq(projects.id, project.id));
    } else if (action === "archive") {
      await db.update(projects).set({ archived: true, updatedAt: new Date() }).where(eq(projects.id, project.id));
    } else if (action === "restore") {
      await db.update(projects).set({ archived: false, updatedAt: new Date() }).where(eq(projects.id, project.id));
    } else {
      return NextResponse.redirect(redirectUrl("/projects?error=invalid_action"), 303);
    }

    return NextResponse.redirect(redirectUrl("/projects?saved=1"), 303);
  } catch (error) {
    console.error("Project settings update failed", error);
    return NextResponse.redirect(redirectUrl("/projects?error=settings_failed"), 303);
  } finally {
    await pool.end();
  }
}
