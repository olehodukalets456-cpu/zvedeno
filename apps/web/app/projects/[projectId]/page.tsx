import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import {
  adAccounts,
  createDatabase,
  creativeWeeklySnapshots,
  dailyInsights,
  googleReports,
  manualMetricDefinitions,
  manualMetricValues,
  mediaAssets,
  projectAdAccounts,
  projects,
  syncRuns
} from "@zvedeno/database";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function currentWeek(): { start: string; end: string } {
  const date = new Date();
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { start, end: date.toISOString().slice(0, 10) };
}

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
    const definitions = await db
      .select({
        id: manualMetricDefinitions.id,
        label: manualMetricDefinitions.label,
        scope: manualMetricDefinitions.scope,
        period: manualMetricDefinitions.period,
        conversionBaseMetric: manualMetricDefinitions.conversionBaseMetric,
        includeConversionRate: manualMetricDefinitions.includeConversionRate,
        includeCostPerValue: manualMetricDefinitions.includeCostPerValue
      })
      .from(manualMetricDefinitions)
      .where(eq(manualMetricDefinitions.projectId, project.id))
      .orderBy(asc(manualMetricDefinitions.sortOrder), asc(manualMetricDefinitions.label));
    const recentManualValues = await db
      .select({
        id: manualMetricValues.id,
        definitionId: manualMetricValues.definitionId,
        entityKey: manualMetricValues.entityKey,
        periodStart: manualMetricValues.periodStart,
        periodEnd: manualMetricValues.periodEnd,
        value: manualMetricValues.value,
        note: manualMetricValues.note,
        source: manualMetricValues.source
      })
      .from(manualMetricValues)
      .where(eq(manualMetricValues.projectId, project.id))
      .orderBy(desc(manualMetricValues.periodStart), desc(manualMetricValues.updatedAt))
      .limit(12);
    const assets = await db
      .select({ id: mediaAssets.id, name: mediaAssets.canonicalName })
      .from(mediaAssets)
      .where(eq(mediaAssets.projectId, project.id))
      .orderBy(asc(mediaAssets.canonicalName));
    const weeklySnapshots = await db
      .select({ id: creativeWeeklySnapshots.id, weekStart: creativeWeeklySnapshots.weekStart })
      .from(creativeWeeklySnapshots)
      .where(eq(creativeWeeklySnapshots.projectId, project.id));

    const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
    const week = currentWeek();

    return (
      <main className="setupMain projectPage">
        <Link className="backLink" href="/setup/accounts">← До проєктів</Link>
        <header className="projectHeader">
          <div>
            <div className="eyebrow">Living report project</div>
            <h1>{project.name}</h1>
            <p>{project.currency ?? "—"} · {project.timezone} · {insights.length} денних фактів</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="primaryButton" href={`/projects/${project.id}/analytics`}>Відкрити аналітику</Link>
            <form action={`/api/projects/${project.id}/sync`} method="post">
              <button className="secondaryButton" type="submit">Оновити зараз</button>
            </form>
          </div>
        </header>

        {query.report === "created" && (
          <div className="successNotice">Google-звіт створено. Додано рядків: {String(query.appended ?? "0")}, помилок: {String(query.errors ?? "0")}.</div>
        )}
        {query.sync === "done" && (
          <div className="successNotice">Синхронізацію завершено. Meta: {String(query.meta ?? "0")}, weekly snapshots: {String(query.weekly ?? "0")}, Google: {String(query.sheets ?? "0")}.</div>
        )}
        {query.manualMetric === "created" && <div className="successNotice">Ручний показник створено й додано в Google Sheet.</div>}
        {query.manualValue === "saved" && <div className="successNotice">Ручний результат збережено. Формули у звіті оновлено.</div>}
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
            <Link className="secondaryButton" href="/setup/accounts">Додати новий кабінет до проєкту</Link>
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

        <section className="projectPanel fullPanel featurePanel">
          <div className="formHeading">
            <span>Creative Weekly Review</span>
            <h2>Щотижнева історія оптимізації креативів</h2>
          </div>
          <p className="panelDescription">
            У Google Sheet вкладка <strong>Creative Weekly</strong> тримає окремий рядок для кожного креативу й тижня:
            превʼю, витрати, кліки, Meta-результат, CPL і ручний фінальний результат. Поточний тиждень оновлюється,
            завершені тижні не стираються.
          </p>
          <div className="featureStats">
            <div><strong>{weeklySnapshots.length}</strong><span>збережених weekly snapshots</span></div>
            <div><strong>{assets.length}</strong><span>унікальних креативів за назвою</span></div>
          </div>
        </section>

        <section className="projectPanel fullPanel featurePanel">
          <div className="formHeading">
            <span>Manual results</span>
            <h2>Додай реальний бізнес-результат</h2>
          </div>
          <p className="panelDescription">
            Meta Lead може бути лише кліком по кнопці. Тут створюється окремий показник на кшталт
            «Реальні підписники», а сервіс рахує Lead → Subscriber CR та фактичну ціну підписника.
          </p>

          <form className="inlineFeatureForm" action={`/api/projects/${project.id}/manual-metrics`} method="post">
            <label className="fieldLabel">
              Назва показника
              <input name="label" required placeholder="Наприклад, Реальні підписники" />
            </label>
            <label className="fieldLabel">
              Рівень
              <select name="scope" defaultValue="project">
                <option value="project">Весь проєкт за тиждень</option>
                <option value="creative">Кожен креатив за тиждень</option>
              </select>
            </label>
            <input type="hidden" name="period" value="week" />
            <input type="hidden" name="valueType" value="number" />
            <label className="fieldLabel">
              Від чого рахувати конверсію
              <select name="conversionBaseMetric" defaultValue="result">
                <option value="result">Від основного Meta result</option>
                <option value="clicks">Від усіх кліків</option>
                <option value="impressions">Від показів</option>
              </select>
            </label>
            <label className="checkField"><input type="checkbox" name="includeConversionRate" defaultChecked /> Рахувати конверсію</label>
            <label className="checkField"><input type="checkbox" name="includeCostPerValue" defaultChecked /> Рахувати фінальний CPA</label>
            <button className="primaryButton" type="submit">Додати ручний показник</button>
          </form>

          {definitions.length > 0 && (
            <div className="manualMetricGrid">
              {definitions.map((definition) => (
                <article className="manualMetricCard" key={definition.id}>
                  <div>
                    <strong>{definition.label}</strong>
                    <small>{definition.scope === "project" ? "Проєкт" : "Креатив"} · {definition.period}</small>
                  </div>
                  <form action={`/api/projects/${project.id}/manual-values`} method="post">
                    <input type="hidden" name="definitionId" value={definition.id} />
                    {definition.scope === "creative" ? (
                      <label className="fieldLabel">
                        Креатив
                        <select name="entityKey" required defaultValue="">
                          <option value="" disabled>Обери креатив</option>
                          {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
                        </select>
                      </label>
                    ) : <input type="hidden" name="entityKey" value="project" />}
                    <div className="datePair">
                      <label className="fieldLabel">Початок<input type="date" name="periodStart" defaultValue={week.start} required /></label>
                      <label className="fieldLabel">Кінець<input type="date" name="periodEnd" defaultValue={week.end} required /></label>
                    </div>
                    <label className="fieldLabel">Значення<input type="number" name="value" min="0" step="0.01" required /></label>
                    <label className="fieldLabel">Коментар<input name="note" placeholder="Необовʼязково" /></label>
                    <button className="secondaryButton" type="submit">Зберегти результат</button>
                  </form>
                </article>
              ))}
            </div>
          )}

          {recentManualValues.length > 0 && (
            <div className="panelList manualHistory">
              {recentManualValues.map((value) => {
                const definition = definitionMap.get(value.definitionId);
                const entity = value.entityKey === "project"
                  ? "Проєкт"
                  : assets.find((asset) => asset.id === value.entityKey)?.name ?? value.entityKey;
                return (
                  <div className="panelRow" key={value.id}>
                    <div>
                      <strong>{definition?.label ?? "Manual result"}: {Number(value.value)}</strong>
                      <small>{entity} · {value.periodStart} — {value.periodEnd} · {value.source}</small>
                    </div>
                    <span>{value.note ?? ""}</span>
                  </div>
                );
              })}
            </div>
          )}
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
