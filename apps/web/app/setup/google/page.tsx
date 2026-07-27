import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import {
  createDatabase,
  dailyInsights,
  googleConnections,
  googleReports,
  projects,
  reportRecipes
} from "@zvedeno/database";

type GoogleSetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GoogleSetupPage({ searchParams }: GoogleSetupPageProps) {
  const params = await searchParams;
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const synced = typeof params.synced === "string" ? params.synced : undefined;
  const errors = typeof params.errors === "string" ? params.errors : undefined;
  const googleConnected = params.google === "connected";
  const error = typeof params.error === "string" ? params.error : undefined;

  const { db, pool } = createDatabase();
  try {
    const [project] = projectId
      ? await db
          .select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
      : [];

    if (!project) {
      return (
        <main className="setupMain">
          <Link className="backLink" href="/setup/accounts">← До проєктів</Link>
          <section className="emptyState"><h2>Проєкт не знайдений</h2></section>
        </main>
      );
    }

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
      .select({ id: reportRecipes.id })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
      .limit(1);
    const reports = await db
      .select({ id: googleReports.id, url: googleReports.spreadsheetUrl })
      .from(googleReports)
      .where(eq(googleReports.projectId, project.id));

    return (
      <main className="setupMain">
        <Link className="backLink" href="/setup/accounts">← До кабінетів</Link>
        <header className="setupHeader compactHeader">
          <div className="eyebrow">Крок 3–4</div>
          <h1>Дані завантажені. Тепер створюємо живий Google-звіт.</h1>
          <p>
            Проєкт: <strong>{project.name}</strong>. У базі вже {insightCount?.value ?? 0} денних рядків.
          </p>
          {synced && <div className="successNotice">Початкова синхронізація: {synced} рядків, помилок: {errors ?? "0"}.</div>}
          {googleConnected && <div className="successNotice">Google успішно підключено.</div>}
          {error && <div className="errorNotice">Помилка Google: {error}</div>}
        </header>

        <section className="setupList">
          <article className="setupCard">
            <div className="setupIndex">3</div>
            <div className="setupCopy">
              <h2>Підключити Google</h2>
              <p>Дозволити сервісу створити та постійно оновлювати одну Google-таблицю.</p>
              {googleConnection && <small>Підключено: {googleConnection.email ?? "Google account"}</small>}
            </div>
            {googleConnection ? (
              <span className="connectedBadge">Підключено</span>
            ) : (
              <Link className="primaryButton" href={`/api/integrations/google/connect?projectId=${project.id}`}>Підключити Google</Link>
            )}
          </article>

          <article className={`setupCard ${googleConnection ? "" : "isLocked"}`}>
            <div className="setupIndex">4</div>
            <div className="setupCopy">
              <h2>Створити звіт</h2>
              <p>Dashboard, Campaigns, Daily, Creatives, Funnel, Raw Data та Sync Status.</p>
            </div>
            {googleConnection && recipe ? (
              <form action="/api/reports" method="post" className="inlineForm">
                <input type="hidden" name="projectId" value={project.id} />
                <input name="title" defaultValue={`${project.name} dashboard`} aria-label="Назва таблиці" />
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
