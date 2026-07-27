import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import {
  adAccounts,
  createDatabase,
  dailyInsights,
  googleReports,
  projectAdAccounts,
  projects,
  syncRuns
} from "@zvedeno/database";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const { db, pool } = createDatabase();

  try {
    const [project] = await db
      .select({ id: projects.id, name: projects.name, currency: projects.currency, timezone: projects.timezone })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      return <main className="setupMain"><section className="emptyState"><h1>Проєкт не знайдений</h1></section></main>;
    }

    const accounts = await db
      .select({
        id: adAccounts.id,
        name: adAccounts.name,
        externalId: adAccounts.externalAccountId,
        status: adAccounts.status,
        lastSync: adAccounts.lastSuccessfulSyncAt,
        isPrimary: projectAdAccounts.isPrimary
      })
      .from(projectAdAccounts)
      .innerJoin(adAccounts, eq(projectAdAccounts.adAccountId, adAccounts.id))
      .where(eq(projectAdAccounts.projectId, project.id));

    const insights = await db
      .select({ id: dailyInsights.id })
      .from(dailyInsights)
      .where(eq(dailyInsights.projectId, project.id));
    const reports = await db
      .select({ id: googleReports.id, url: googleReports.spreadsheetUrl, lastExport: googleReports.lastSuccessfulExportAt })
      .from(googleReports)
      .where(eq(googleReports.projectId, project.id));
    const recentRuns = await db
      .select({ id: syncRuns.id, status: syncRuns.status, rows: syncRuns.rowsReceived, createdAt: syncRuns.createdAt })
      .from(syncRuns)
      .where(eq(syncRuns.projectId, project.id))
      .orderBy(desc(syncRuns.createdAt))
      .limit(6);

    return (
      <main className="setupMain projectPage">
        <Link className="backLink" href="/setup/accounts">← До проєктів</Link>
        <header className="projectHeader">
          <div>
            <div className="eyebrow">Living report project</div>
            <h1>{project.name}</h1>
            <p>{project.currency ?? "—"} · {project.timezone} · {insights.length} денних фактів</p>
          </div>
          <form action={`/api/projects/${project.id}/sync`} method="post">
            <button className="primaryButton" type="submit">Оновити зараз</button>
          </form>
        </header>

        {query.report === "created" && (
          <div className="successNotice">Google-звіт створено. Додано рядків: {String(query.appended ?? "0")}, помилок: {String(query.errors ?? "0")}.</div>
        )}
        {query.sync === "done" && (
          <div className="successNotice">Синхронізацію завершено. Meta: {String(query.meta ?? "0")}, Google: {String(query.sheets ?? "0")}.</div>
        )}
        {query.error && <div className="errorNotice">Не вдалося завершити дію: {String(query.error)}</div>}

        <section className="projectGrid">
          <article className="projectPanel">
            <div className="formHeading"><span>Кабінети</span><h2>Джерела проєкту</h2></div>
            <div className="panelList">
              {accounts.map((account) => (
                <div className="panelRow" key={account.id}>
                  <div><strong>{account.name}</strong><small>{account.externalId}</small></div>
                  <div className="rowMeta"><span>{account.isPrimary ? "Primary" : "Source"}</span><span>{account.status}</span></div>
                </div>
              ))}
            </div>
            <Link className="secondaryButton" href="/setup/accounts">Додати новий кабінет через новий проєкт</Link>
          </article>

          <article className="projectPanel">
            <div className="formHeading"><span>Google Sheets</span><h2>Постійні звіти</h2></div>
            <div className="panelList">
              {reports.length === 0 ? <p>Звіт ще не створено.</p> : reports.map((report) => (
                <a className="panelRow reportRow" href={report.url} target="_blank" rel="noreferrer" key={report.id}>
                  <div><strong>Відкрити Google Sheet ↗</strong><small>Оновлено: {report.lastExport?.toLocaleString("uk-UA") ?? "ще ні"}</small></div>
                </a>
              ))}
            </div>
            {reports.length === 0 && <Link className="primaryButton" href={`/setup/google?projectId=${project.id}`}>Створити звіт</Link>}
          </article>
        </section>

        <section className="projectPanel fullPanel">
          <div className="formHeading"><span>Sync log</span><h2>Останні запуски</h2></div>
          <div className="panelList">
            {recentRuns.map((run) => (
              <div className="panelRow" key={run.id}>
                <strong>{run.status}</strong>
                <span>{run.rows} рядків · {run.createdAt.toLocaleString("uk-UA")}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
