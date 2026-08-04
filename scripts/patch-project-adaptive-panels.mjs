import fs from "node:fs";

const path = "apps/web/app/projects/[projectId]/page.tsx";
let source = fs.readFileSync(path, "utf8");

source = source.replace(
  "  projects,\n  syncRuns",
  "  projects,\n  reportRecipes,\n  syncRuns"
);

const importMarker = "} from \"@zvedeno/database\";\n";
if (!source.includes(importMarker)) throw new Error("Project page import marker not found");
source = source.replace(
  importMarker,
  `${importMarker}import type { ReportInterviewState } from "@zvedeno/shared";\nimport { LEGACY_DMND_PROJECT_ID } from "../../../lib/project-ai";\n`
);

const dataMarker = `    const weeklySnapshots = await db
      .select({ id: creativeWeeklySnapshots.id, weekStart: creativeWeeklySnapshots.weekStart })
      .from(creativeWeeklySnapshots)
      .where(eq(creativeWeeklySnapshots.projectId, project.id));

    const definitionMap`;
if (!source.includes(dataMarker)) throw new Error("Project page weekly data marker not found");
source = source.replace(
  dataMarker,
  `    const weeklySnapshots = await db
      .select({ id: creativeWeeklySnapshots.id, weekStart: creativeWeeklySnapshots.weekStart })
      .from(creativeWeeklySnapshots)
      .where(eq(creativeWeeklySnapshots.projectId, project.id));
    const [recipe] = await db
      .select({ config: reportRecipes.config })
      .from(reportRecipes)
      .where(eq(reportRecipes.projectId, project.id))
      .limit(1);
    const interview = ((recipe?.config ?? {}) as { reportInterview?: ReportInterviewState }).reportInterview;
    const adaptiveBlueprint = interview?.version === "adaptive-v1" ? interview.blueprint : null;

    const definitionMap`
);

const headerMarker = `            <Link className="primaryButton" href={\`/projects/\${project.id}/analytics\`}>Відкрити аналітику</Link>
            <form action={\`/api/projects/\${project.id}/sync\`} method="post">`;
if (!source.includes(headerMarker)) throw new Error("Project page header action marker not found");
source = source.replace(
  headerMarker,
  `            <Link className="primaryButton" href={\`/projects/\${project.id}/analytics\`}>Відкрити аналітику</Link>
            {project.id !== LEGACY_DMND_PROJECT_ID && (
              <Link className="secondaryButton" href={\`/projects/\${project.id}/report-builder\`}>Конструктор звіту</Link>
            )}
            <form action={\`/api/projects/\${project.id}/sync\`} method="post">`
);

const creativeStart = `        <section className="projectPanel fullPanel featurePanel">
          <div className="formHeading">
            <span>Creative Weekly Review</span>`;
if (!source.includes(creativeStart)) throw new Error("Creative weekly panel marker not found");
const adaptivePanel = `        {project.id !== LEGACY_DMND_PROJECT_ID && (
          <section className="projectPanel fullPanel featurePanel">
            <div className="formHeading">
              <span>Adaptive report</span>
              <h2>{interview?.status === "ready" ? adaptiveBlueprint?.title ?? "Індивідуальний звіт" : "AI-конфігурація ще не завершена"}</h2>
            </div>
            <p className="panelDescription">
              {interview?.summary ?? "Запусти AI-інтервʼю: система проаналізує всі доступні Meta-метрики, запропонує шаблони й поставить уточнювальні питання."}
            </p>
            {adaptiveBlueprint && (
              <div className="featureStats">
                <div><strong>{adaptiveBlueprint.tabs.length}</strong><span>вкладок у Google-звіті</span></div>
                <div><strong>{adaptiveBlueprint.granularity}</strong><span>деталізація динаміки</span></div>
                <div><strong>{adaptiveBlueprint.includeCreatives ? "Так" : "Ні"}</strong><span>аналітика креативів</span></div>
                <div><strong>{adaptiveBlueprint.revenueMetrics.length > 0 ? "Так" : "Ні"}</strong><span>дохід і ROAS</span></div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link className="primaryButton" href={\`/projects/\${project.id}/report-builder\`}>{interview?.status === "ready" ? "Змінити структуру" : "Пройти AI-інтервʼю"}</Link>
              {interview?.status === "ready" && reports.length === 0 && (
                <Link className="secondaryButton" href={\`/setup/google?projectId=\${project.id}\`}>Створити Google-звіт</Link>
              )}
            </div>
          </section>
        )}

        {(project.id === LEGACY_DMND_PROJECT_ID || adaptiveBlueprint?.includeCreatives) && (
${creativeStart}`;
source = source.replace(creativeStart, adaptivePanel);

const betweenPanels = `        </section>

        <section className="projectPanel fullPanel featurePanel">
          <div className="formHeading">
            <span>Manual results</span>`;
if (!source.includes(betweenPanels)) throw new Error("Project page panel boundary not found");
source = source.replace(
  betweenPanels,
  `        </section>
        )}

        {(project.id === LEGACY_DMND_PROJECT_ID || adaptiveBlueprint?.includeFunnel) && (
        <section className="projectPanel fullPanel featurePanel">
          <div className="formHeading">
            <span>Manual results</span>`
);

const manualEnd = `        </section>

        <section className="projectPanel fullPanel">
          <div className="formHeading"><span>Sync log</span><h2>Останні запуски</h2></div>`;
if (!source.includes(manualEnd)) throw new Error("Manual result panel end marker not found");
source = source.replace(
  manualEnd,
  `        </section>
        )}

        <section className="projectPanel fullPanel">
          <div className="formHeading"><span>Sync log</span><h2>Останні запуски</h2></div>`
);

fs.writeFileSync(path, source);
console.log("Applied adaptive project panel patch");
