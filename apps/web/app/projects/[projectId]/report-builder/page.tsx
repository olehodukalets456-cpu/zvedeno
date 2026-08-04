import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createDatabase, projects } from "@zvedeno/database";
import { reportTemplateById, type ReportQuestion } from "@zvedeno/shared";
import { currentWorkspaceUser } from "../../../../lib/auth/workspace-user";
import { loadReportInterview, startReportInterview } from "../../../../lib/report-interview";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function answerValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function QuestionField({ question, answer }: { question: ReportQuestion; answer: unknown }) {
  const selected = new Set(answerValues(answer));
  if (question.type === "boolean") {
    return (
      <div className="reportAnswerBoolean">
        <label><input type="radio" name={question.id} value="true" defaultChecked={answer === true || answer === "true"} required={question.required} /> Так</label>
        <label><input type="radio" name={question.id} value="false" defaultChecked={answer === false || answer === "false"} required={question.required} /> Ні</label>
      </div>
    );
  }
  if (question.type === "text") {
    return <textarea name={question.id} rows={3} defaultValue={typeof answer === "string" ? answer : ""} required={question.required} />;
  }
  const inputType = question.type === "multi" ? "checkbox" : "radio";
  return (
    <div className="reportAnswerOptions">
      {question.options.map((option) => (
        <label className="reportAnswerOption" key={`${question.id}:${option.value}`}>
          <input
            type={inputType}
            name={question.id}
            value={option.value}
            defaultChecked={selected.has(option.value)}
            required={question.type === "single" && question.required}
          />
          <span><strong>{option.label}</strong><small>{option.description}</small></span>
        </label>
      ))}
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function ReportBuilderPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect(`/auth/sign-in?callbackUrl=/projects/${projectId}/report-builder`);

  const { db, pool } = createDatabase();
  try {
    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, currentUser.workspaceId)))
      .limit(1);
    if (!project) redirect("/projects?error=project_not_found");

    const state = await loadReportInterview(project.id) ?? await startReportInterview({ projectId: project.id });
    const topMetrics = state.metricInventory.filter((metric) => metric.nonZeroRows > 0).slice(0, 18);
    const selectedTemplate = reportTemplateById(state.blueprint.templateId);

    return (
      <main className="reportBuilderMain">
        <div className="onboardingProgress" aria-label="Етапи налаштування">
          <span className="isDone">1. Кабінет</span>
          <span className="isDone">2. Meta</span>
          <span className="isDone">3. Проєкт</span>
          <span className="isActive">4. AI-інтервʼю</span>
          <span className={state.status === "ready" ? "isActive" : ""}>5. Звіт</span>
        </div>

        <header className="reportBuilderHero">
          <div>
            <div className="eyebrow">AI REPORT ARCHITECT · ROUND {state.round}</div>
            <h1>{state.status === "ready" ? "Структура звіту готова." : "AI проаналізував кабінети. Тепер уточнює, що потрібно саме тобі."}</h1>
            <p>{state.summary}</p>
          </div>
          <div className="reportBuilderModel"><span>MODEL</span><strong>{state.model}</strong><small>{state.metricInventory.length} доступних метрик</small></div>
        </header>

        {query.error && <div className="errorNotice">Не вдалося завершити AI-інтервʼю. Спробуй ще раз.</div>}
        {state.warnings.map((warning) => <div className="configNotice" key={warning}>{warning}</div>)}

        <section className="reportMetricAudit aiGlass">
          <div className="formHeading"><span>Фактичний inventory</span><h2>Що система реально знайшла в Meta</h2></div>
          <p>AI бачить не лише spend і lead. Він отримує повний набір доступних подій, цінностей, video-метрик і delivery-показників.</p>
          <div className="reportMetricChips">
            {topMetrics.map((metric) => (
              <span key={metric.key}><strong>{metric.label}</strong><small>{Number(metric.total.toFixed(2))} · {metric.nonZeroRows} рядків</small></span>
            ))}
          </div>
          {state.metricInventory.length > topMetrics.length && (
            <details><summary>Показати всі метрики ({state.metricInventory.length})</summary>
              <div className="reportMetricList">
                {state.metricInventory.map((metric) => <div key={metric.key}><code>{metric.key}</code><span>{metric.label}</span><b>{Number(metric.total.toFixed(4))}</b></div>)}
              </div>
            </details>
          )}
        </section>

        {state.status === "ready" ? (
          <>
            <section className="reportBlueprint aiGlass">
              <div className="formHeading"><span>Готовий blueprint</span><h2>{selectedTemplate.label}</h2></div>
              <p>{state.blueprint.description}</p>
              <div className="reportBlueprintStats">
                <div><strong>{state.blueprint.granularity === "daily" ? "Щодня" : state.blueprint.granularity === "weekly" ? "Щотижня" : "Щомісяця"}</strong><span>динаміка</span></div>
                <div><strong>{state.blueprint.includeCharts ? "Так" : "Ні"}</strong><span>графіки</span></div>
                <div><strong>{state.blueprint.includeCreatives ? "Так" : "Ні"}</strong><span>креативи</span></div>
                <div><strong>{state.blueprint.tabs.length}</strong><span>вкладок</span></div>
              </div>
              <div className="reportTabPreview">
                {state.blueprint.tabs.map((tab, index) => <span key={`${tab.kind}:${tab.title}`}><b>{index + 1}</b>{tab.title}</span>)}
              </div>
              <div className="reportBlueprintMetrics">
                <div><span>Основні метрики</span><code>{state.blueprint.primaryMetrics.join(" · ")}</code></div>
                <div><span>Фінальний результат</span><code>{state.blueprint.resultMetrics.join(" · ") || "не визначено"}</code></div>
                <div><span>Дохід / ROAS</span><code>{state.blueprint.revenueMetrics.join(" · ") || "не доступно в Meta"}</code></div>
              </div>
              <div className="reportBuilderActions">
                <Link className="primaryButton aiPrimary" href={`/setup/google?projectId=${project.id}`}>Підключити Google і створити звіт</Link>
                <form action={`/api/projects/${project.id}/report-builder`} method="post">
                  <input type="hidden" name="action" value="restart" />
                  <button className="secondaryButton aiSecondary" type="submit">Перебудувати конфігурацію</button>
                </form>
              </div>
            </section>
          </>
        ) : (
          <form className="reportQuestionnaire" action={`/api/projects/${project.id}/report-builder`} method="post">
            <input type="hidden" name="action" value="answer" />
            {state.questions.map((question, index) => (
              <section className="reportQuestion aiGlass" key={question.id}>
                <div className="reportQuestionNumber">{String(index + 1).padStart(2, "0")}</div>
                <div className="reportQuestionContent">
                  <h2>{question.label}</h2>
                  <p>{question.help}</p>
                  <QuestionField question={question} answer={state.answers[question.id]} />
                </div>
              </section>
            ))}
            <button className="primaryButton aiPrimary reportQuestionSubmit" type="submit">
              {state.round === 1 ? "Передати відповіді AI" : "Завершити уточнення"}
            </button>
          </form>
        )}
      </main>
    );
  } finally {
    await pool.end();
  }
}
