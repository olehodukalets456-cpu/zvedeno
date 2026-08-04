import type { ReactNode } from "react";
import { asc, and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createDatabase, projects } from "@zvedeno/database";
import { currentWorkspaceUser } from "../../../lib/auth/workspace-user";
import { ProjectNav } from "./project-nav";

type ProjectLayoutProps = {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
};

export const dynamic = "force-dynamic";

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { projectId } = await params;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect(`/auth/sign-in?callbackUrl=/projects/${projectId}`);

  const { db, pool } = createDatabase();
  try {
    const projectOptions = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.workspaceId, currentUser.workspaceId), eq(projects.archived, false)))
      .orderBy(asc(projects.name));

    if (!projectOptions.some((project) => project.id === projectId)) {
      redirect("/projects?error=project_not_found");
    }

    return (
      <div className="workspaceProjectShell">
        <ProjectNav
          currentProjectId={projectId}
          projects={projectOptions}
          userLabel={currentUser.name ?? currentUser.email}
          role={currentUser.role}
        />
        {children}
      </div>
    );
  } finally {
    await pool.end();
  }
}
