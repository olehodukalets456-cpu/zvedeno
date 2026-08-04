"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOutButton } from "../../components/sign-out-button";

type ProjectOption = { id: string; name: string };

type ProjectNavProps = {
  currentProjectId: string;
  projects: ProjectOption[];
  userLabel: string;
  role: string;
};

export function ProjectNav({ currentProjectId, projects, userLabel, role }: ProjectNavProps) {
  const router = useRouter();

  return (
    <div className="workspaceProjectBar">
      <Link className="workspaceProjectBrand" href="/projects"><span className="aiBrandMark" />Zvedeno</Link>
      <label className="workspaceProjectSwitcher">
        <span>Проєкт</span>
        <select
          aria-label="Перемкнути проєкт"
          value={currentProjectId}
          onChange={(event) => router.push(`/projects/${event.target.value}`)}
        >
          {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
        </select>
      </label>
      <nav className="workspaceProjectLinks" aria-label="Workspace">
        <Link href={`/projects/${currentProjectId}/analytics`}>Аналітика</Link>
        <Link href={`/projects/${currentProjectId}/report-builder`}>Конструктор звіту</Link>
        <Link href="/projects">Усі проєкти</Link>
        <Link href="/setup">Підключення</Link>
        <Link href="/users">Користувачі</Link>
      </nav>
      <div className="workspaceProjectUser">
        <span><strong>{userLabel}</strong><small>{role}</small></span>
        <SignOutButton />
      </div>
    </div>
  );
}
