import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  createDatabase,
  dailyInsights,
  googleConnections,
  googleReports,
  projects,
  reportRecipes
} from "@zvedeno/database";
import type { ReportInterviewState } from "@zvedeno/shared";
import { currentWorkspaceUser } from "../../../lib/auth/workspace-user";
import { LEGACY_DMND_PROJECT_ID } from "../../../lib/project-ai";

type GoogleSetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function GoogleSetupPage({ searchParams }: GoogleSetupPageProps) {
  const params = await searchParams;
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const synced = typeof params.synced === "string" ? params.synced : undefined;
  const errors = typeof params.errors === "string" ? params.errors : undefined;
  const googleConnected = params.google === "connected";
  const error = typeof params.error === "string" ? params.error : undefined;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect(`/auth/sign-in?callbackUrl=/setup/google?projectId=${encodeURIComponent(projectId)}`);

  const { db, pool } = createDatabase();
  try {
    const [project] = projectId
      ? await db
          .select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.workspaceId, currentUser.workspaceId)))
          .limit(1)
      : [];

    if (!project) redirect("/projects?error=project_not_found");

    const [insightCount] = await db
      .select({ value: count() })
      .from(dailyInsights)
      .where(eq(dailyInsights.projectId, project.id));
    const [googleConnection] = await db
      .select({ id: googleConnections.id, email: googleConnections.email })
      .from(googleConnections)
      .where(and(eq(googleConnections.workspaceId, project.workspaceId), eq(googleConnections.status, "active")))
      .limit(1);
    const [recipe] = await db
      .select({ id: reportRecipes.id, config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
      .limit(1);
    const interview = ((recipe?.config ?? {}) as { reportInterview?: ReportInterviewState }).reportInterview;
    const legacy = project.id === LEGACY_DMND_PROJECT_ID;
    if (!legacy && interview?.status !== "ready") {
      redirect(`/projects/${project.id}/report-builder?error=finish_interview_first`);
    }

    const reports = await db
      .select({ id: googleReports.id, url: googleReports.spreadsheetUrl })
      .from(googleReports)
      .where(eq(googleReports.projectId, project.id));

    const blueprint = interview?.blueprint;
    const tabNames = blueprint?.tabs.map((tab) => tab.title) ?? ["Dashboard", "Sync Status", "Raw Data"];

    return (
      <main className="setupMain aiShell">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <Link className="backLink" href={legacy ? `/projects/${project.id}` : `/projects/${project.id}/report-builder`}>← Назад до конфігурації</Link>

        <div className="onboardingProgress" aria-label="Етапи налаштування">
          <span className="isDone">1. Кабінет</span>
          <span className="isDone">2. Meta</span>
          <span className="isDone">3. Проєкт</span>
          <span className="isDone">4. AI-інтервʼю</span>
          <span className="isActive">5. Звіт</span>
        </div>

        <header className="setupHeader compactHeader">
          <div className="eyebrow">GOOGLE REPORT</div>
          <h1>Структура погоджена. Тепер створюємо живий звіт.</h1>
          <p>
            Проєкт: <strong>{project.name}</strong>. У базі вже {insightCount?.value ?? 0} денних рядків.
            {blueprint ? ` Шаблон: ${blueprint.title}, деталізація: ${blueprint.granularity}.` : ""}
          </p>
          {synced && <div className="successNotice">Початкова синхронізація: {synced} рядків, помилок: {errors ?? "0"}.</div>}
          {googleConnected && <div className="successNotice">Google успішно підключено.</div>}
          {error && <div className="errorNotice">Помилка Google: {error}</div>}
        </header>

        {blueprint && (
          <section className="formSection aiGlass">
            <div className="formHeading"><span>Blueprint</span><h2>Що буде створено</h2></div>
            <div className="reportTabPreview">
              {tabNames.map((tab, index) => <span key={tab}><b>{index + 1}</b>{tab}</span>)}
            </div>
            <p className="panelDescription" style={{ marginTop: 16 }}>
              Метрики результату: <strong>{blueprint.resultMetrics.join(", ") || "AI визначить із доступних подій"}</strong>.
              {blueprint.revenueMetrics.length > 0 ? ` Дохід і ROAS: ${blueprint.revenueMetrics.join(", ")}.` : " Дохід і ROAS не включені в цей звіт."}
            </p>
          </section>
        )}

        <section className="setupList" style={{ marginTop: 18 }}>
          <article className="setupCard">
            <div className="setupIndex">1</div>
            <div className="setupCopy">
              <h2>Підключити Google</h2>
              <p>Дозволити сервісу створити та постійно оновлювати таблицю у твоєму Google Drive.</p>
              {googleConnection && <small>Підключено: {googleConnection.email ?? "Google account"}</small>}
            </div>
            {googleConnection ? (
              <span className="connectedBadge">Підключено</span>
            ) : (
              <Link className="primaryButton" href={`/api/integrations/google/connect?projectId=${project.id}`}>Підключити Google</Link>
            )}
          </article>

          <article className={`setupCard ${googleConnection ? "" : "isLocked"}`}>
            <div className="setupIndex">2</div>
            <div className="setupCopy">
              <h2>Створити індивідуальний звіт</h2>
              <p>{tabNames.join(" · ")}</p>
            </div>
            {googleConnection && recipe ? (
              <form action="/api/reports" method="post" className="inlineForm">
                <input type="hidden" name="projectId" value={project.id} />
                <input name="title" defaultValue={`${project.name} · ${blueprint?.title ?? "dashboard"}`} aria-label="Назва таблиці" />
                <button className="primaryButton" type="submit">Створити Google-звіт</button>
              </form>
            ) : (
              <span className="disabledButton">Після Google</span>
            )}
          </article>
        </section>

        {reports.length > 0 && (
          <section className="reportLinks">
            <h2>Створені звіти</h2>
            {reports.map((report) => (
              <a className="reportLink" href={report.url} target="_blank" rel="noreferrer" key={report.id}>Відкрити Google Sheet ↗</a>
            ))}
            <Link className="secondaryButton" href={`/projects/${project.id}`}>Відкрити проєкт у Zvedeno</Link>
          </section>
        )}
      </main>
    );
  } finally {
    await pool.end();
  }
}
