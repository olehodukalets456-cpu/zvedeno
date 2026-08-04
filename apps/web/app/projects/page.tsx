import Link from "next/link";
import { asc, count, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  adAccounts,
  createDatabase,
  dailyInsights,
  projectAdAccounts,
  projects,
  syncRuns
} from "@zvedeno/database";
import { canManageWorkspace, currentWorkspaceUser } from "../../lib/auth/workspace-user";
import { SignOutButton } from "../components/sign-out-button";

type ProjectsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const query = await searchParams;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect("/auth/sign-in?callbackUrl=/projects");

  const { db, pool } = createDatabase();
  try {
    const projectRows = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        currency: projects.currency,
        timezone: projects.timezone,
        archived: projects.archived,
        updatedAt: projects.updatedAt
      })
      .from(projects)
      .where(eq(projects.workspaceId, currentUser.workspaceId))
      .orderBy(asc(projects.archived), desc(projects.updatedAt), asc(projects.name));

    const accountCountRows = await db
      .select({ projectId: projectAdAccounts.projectId, total: count() })
      .from(projectAdAccounts)
      .innerJoin(projects, eq(projectAdAccounts.projectId, projects.id))
      .where(eq(projects.workspaceId, currentUser.workspaceId))
      .groupBy(projectAdAccounts.projectId);

    const insightCountRows = await db
      .select({ projectId: dailyInsights.projectId, total: count() })
      .from(dailyInsights)
      .innerJoin(projects, eq(dailyInsights.projectId, projects.id))
      .where(eq(projects.workspaceId, currentUser.workspaceId))
      .groupBy(dailyInsights.projectId);

    const recentRunRows = await db
      .select({ projectId: syncRuns.projectId, status: syncRuns.status, createdAt: syncRuns.createdAt })
      .from(syncRuns)
      .innerJoin(projects, eq(syncRuns.projectId, projects.id))
      .where(eq(projects.workspaceId, currentUser.workspaceId))
      .orderBy(desc(syncRuns.createdAt));

    const [inventory] = await db
      .select({ total: count() })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, currentUser.workspaceId));

    const accountCounts = new Map(accountCountRows.map((row) => [row.projectId, Number(row.total)]));
    const insightCounts = new Map(insightCountRows.map((row) => [row.projectId, Number(row.total)]));
    const latestRuns = new Map<string, { status: string; createdAt: Date }>();
    for (const run of recentRunRows) {
      if (!latestRuns.has(run.projectId)) latestRuns.set(run.projectId, { status: run.status, createdAt: run.createdAt });
    }

    const activeProjects = projectRows.filter((project) => !project.archived);
    const archivedProjects = projectRows.filter((project) => project.archived);
    const canManage = canManageWorkspace(currentUser);
    const error = single(query.error);

    return (
      <div className="aiShell workspaceDashboardShell">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <header className="workspaceDashboardTopbar">
          <Link className="aiBrand" href="/projects"><span className="aiBrandMark" />Zvedeno</Link>
          <nav className="workspaceDashboardNav" aria-label="Workspace">
            <Link className="isActive" href="/projects">Проєкти</Link>
            <Link href="/setup">Підключення</Link>
            <Link href="/users">Користувачі</Link>
          </nav>
          <div className="workspaceDashboardUser">
            <span><strong>{currentUser.name ?? currentUser.email}</strong><small>{currentUser.role}</small></span>
            <SignOutButton />
          </div>
        </header>

        <main className="workspaceDashboard">
          <header className="workspaceDashboardHero">
            <div>
              <div className="eyebrow">YOUR WORKSPACE</div>
              <h1>Проєкти, джерела й звіти в одному кабінеті.</h1>
              <p>
                Відкривай збережені проєкти, перемикайся між ними, керуй джерелами та створюй нові звіти без повторного підключення Meta.
              </p>
            </div>
            {canManage && (
              <Link className="primaryButton aiPrimary workspaceCreateProject" href={Number(inventory?.total ?? 0) > 0 ? "/setup/accounts" : "/setup"}>
                {Number(inventory?.total ?? 0) > 0 ? "+ Новий проєкт" : "Підключити Meta"}
              </Link>
            )}
          </header>

          {query.welcome === "1" && <div className="successNotice">Кабінет активовано. Тепер можна підключати Meta й створювати проєкти.</div>}
          {query.saved === "1" && <div className="successNotice">Налаштування проєкту збережено.</div>}
          {error === "forbidden" && <div className="errorNotice">Для цієї дії потрібна роль owner або admin.</div>}
          {error === "project_not_found" && <div className="errorNotice">Проєкт не знайдений у твоєму workspace або він архівований.</div>}
          {error && !["forbidden", "project_not_found"].includes(error) && <div className="errorNotice">Не вдалося завершити дію: {error}</div>}

          <section className="workspaceSummaryGrid">
            <article><strong>{activeProjects.length}</strong><span>активних проєктів</span></article>
            <article><strong>{Number(inventory?.total ?? 0)}</strong><span>доступних Meta-кабінетів</span></article>
            <article><strong>{activeProjects.reduce((sum, project) => sum + (insightCounts.get(project.id) ?? 0), 0)}</strong><span>денних фактів у workspace</span></article>
          </section>

          {activeProjects.length === 0 ? (
            <section className="workspaceEmptyProject aiGlass">
              <div className="eyebrow">START HERE</div>
              <h2>{Number(inventory?.total ?? 0) > 0 ? "Створи перший проєкт" : "Спочатку підключи Meta"}</h2>
              <p>
                {Number(inventory?.total ?? 0) > 0
                  ? "Обери рекламні кабінети, дай проєкту назву та опиши, що має бути у звіті."
                  : "Після авторизації Facebook система збере доступні рекламні кабінети, а потім запропонує створити проєкт."}
              </p>
              {canManage && (
                <Link className="primaryButton aiPrimary" href={Number(inventory?.total ?? 0) > 0 ? "/setup/accounts" : "/setup"}>
                  Продовжити
                </Link>
              )}
            </section>
          ) : (
            <section className="workspaceProjectGrid">
              {activeProjects.map((project) => {
                const lastRun = latestRuns.get(project.id);
                return (
                  <article className="workspaceProjectCard aiGlass" key={project.id}>
                    <div className="workspaceProjectCardTop">
                      <span className="workspaceProjectStatus">ACTIVE</span>
                      <small>{lastRun ? `${lastRun.status} · ${lastRun.createdAt.toLocaleString("uk-UA")}` : "ще не синхронізовано"}</small>
                    </div>
                    <div>
                      <h2>{project.name}</h2>
                      <p>{project.currency ?? "—"} · {project.timezone}</p>
                    </div>
                    <div className="workspaceProjectStats">
                      <span><strong>{accountCounts.get(project.id) ?? 0}</strong> кабінетів</span>
                      <span><strong>{insightCounts.get(project.id) ?? 0}</strong> фактів</span>
                    </div>
                    <div className="workspaceProjectActions">
                      <Link className="primaryButton aiPrimary" href={`/projects/${project.id}/analytics`}>Відкрити звіт</Link>
                      <Link className="secondaryButton aiSecondary" href={`/projects/${project.id}`}>Керування</Link>
                      {canManage && <Link className="secondaryButton aiSecondary" href={`/setup/accounts?projectId=${project.id}`}>Додати кабінет</Link>}
                    </div>
                    {canManage && (
                      <details className="workspaceProjectSettings">
                        <summary>Налаштування проєкту</summary>
                        <form action={`/api/projects/${project.id}/settings`} method="post">
                          <input type="hidden" name="action" value="rename" />
                          <label className="fieldLabel">Назва<input name="name" defaultValue={project.name} required /></label>
                          <button className="secondaryButton aiSecondary" type="submit">Зберегти назву</button>
                        </form>
                        <form action={`/api/projects/${project.id}/settings`} method="post">
                          <input type="hidden" name="action" value="archive" />
                          <button className="workspaceDangerButton" type="submit">Архівувати проєкт</button>
                        </form>
                      </details>
                    )}
                  </article>
                );
              })}
            </section>
          )}

          {canManage && archivedProjects.length > 0 && (
            <details className="workspaceArchivedProjects">
              <summary>Архівовані проєкти ({archivedProjects.length})</summary>
              <div className="workspaceArchivedList">
                {archivedProjects.map((project) => (
                  <div key={project.id}>
                    <span><strong>{project.name}</strong><small>{project.currency ?? "—"} · {project.timezone}</small></span>
                    <form action={`/api/projects/${project.id}/settings`} method="post">
                      <input type="hidden" name="action" value="restore" />
                      <button className="secondaryButton aiSecondary" type="submit">Відновити</button>
                    </form>
                  </div>
                ))}
              </div>
            </details>
          )}
        </main>
      </div>
    );
  } finally {
    await pool.end();
  }
}
