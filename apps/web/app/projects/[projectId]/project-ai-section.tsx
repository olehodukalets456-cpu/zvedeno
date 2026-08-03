import { and, eq } from "drizzle-orm";
import { createDatabase, reportRecipes } from "@zvedeno/database";
import { LEGACY_DMND_PROJECT_ID, type ProjectAIReport } from "../../../lib/project-ai";

type ProjectAISectionProps = {
  projectId: string;
  query: Record<string, string | string[] | undefined>;
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asAIReport(value: unknown): ProjectAIReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<ProjectAIReport>;
  if (!Array.isArray(report.offers) || !Array.isArray(report.campaignMap)) return null;
  return report as ProjectAIReport;
}

export async function ProjectAISection({ projectId, query }: ProjectAISectionProps) {
  if (projectId === LEGACY_DMND_PROJECT_ID) return null;

  const { db, pool } = createDatabase();
  try {
    const [recipe] = await db
      .select({ config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, projectId), eq(reportRecipes.enabled, true)))
      .limit(1);
    const config = (recipe?.config ?? {}) as Record<string, unknown>;
    const report = asAIReport(config.aiReport);
    const brief = typeof config.projectBrief === "string" ? config.projectBrief : "";
    const confidence = report ? Math.round(report.confidence * 100) : 0;
    const status = single(query.ai) || report?.status || "pending";

    return (
      <section className="projectPanel fullPanel featurePanel aiGlass aiAnalysisCard">
        <div>
          <div className="formHeading">
            <span>Project AI</span>
            <h2>Логіка звіту для цього проєкту</h2>
          </div>
          {status === "needs_key" && (
            <div className="configNotice">
              OPENAI_API_KEY ще не додано у Vercel. Зараз працює детермінований fallback без передачі даних моделі.
            </div>
          )}
          {status === "failed" && (
            <div className="errorNotice">AI-виклик не завершився, тому звіт побудовано через безпечний fallback.</div>
          )}
          <p className="aiAnalysisSummary">
            {report?.summary ?? "Після синхронізації система проаналізує кампанії, події та креативи саме цього проєкту."}
          </p>
          <div className="aiOfferPills">
            {(report?.offers ?? []).map((offer) => (
              <span className="aiOfferPill" title={offer.description} key={offer.key}>
                {offer.label} · {offer.resultLabel}
              </span>
            ))}
            {!report?.offers.length && <span className="aiOfferPill">Очікує аналізу</span>}
          </div>
          {report?.warnings.length ? (
            <ul className="aiWarningList">
              {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          <form className="aiAnalysisForm" action={`/api/projects/${projectId}/ai-analyze`} method="post">
            <label className="fieldLabel">
              Уточнити завдання для AI
              <textarea
                name="projectBrief"
                defaultValue={brief}
                placeholder="Опиши напрями, воронки, справжні конверсії та бажану структуру звіту."
              />
            </label>
            <button className="primaryButton aiPrimary" type="submit">Перепроаналізувати проєкт</button>
          </form>
        </div>

        <aside className="aiConfidence">
          <strong>{confidence}%</strong>
          <span>confidence</span>
          <small>{report?.inventory.campaigns ?? 0} кампаній · {report?.inventory.creatives ?? 0} креативів</small>
          <small>{report?.model ?? "очікує запуску"}</small>
        </aside>
      </section>
    );
  } finally {
    await pool.end();
  }
}
