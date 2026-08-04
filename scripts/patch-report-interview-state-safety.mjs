import fs from "node:fs";

const projectPath = "apps/web/app/api/projects/route.ts";
let projectSource = fs.readFileSync(projectPath, "utf8");
const placeholder = `,
    reportInterview: {
      version: "adaptive-v1",
      status: "questionnaire",
      model: process.env.OPENAI_REPORT_BUILDER_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? "gpt-5.6",
      round: 0,
      analyzedAt: null,
      summary: "Очікується первинний аудит Meta-кабінетів.",
      metricInventory: [],
      recommendations: [],
      questions: [],
      answers: {},
      blueprint: null,
      warnings: []
    }`;
if (!projectSource.includes(placeholder)) throw new Error("Report interview placeholder not found");
projectSource = projectSource.replace(placeholder, "");
fs.writeFileSync(projectPath, projectSource);

const interviewPath = "apps/web/lib/report-interview.ts";
let interviewSource = fs.readFileSync(interviewPath, "utf8");
const oldReturn = `    const state = (recipe?.config as { reportInterview?: unknown } | undefined)?.reportInterview;
    return state && typeof state === "object" ? state as ReportInterviewState : null;`;
if (!interviewSource.includes(oldReturn)) throw new Error("Report interview loader marker not found");
interviewSource = interviewSource.replace(
  oldReturn,
  `    const state = (recipe?.config as { reportInterview?: unknown } | undefined)?.reportInterview;
    if (!state || typeof state !== "object") return null;
    const candidate = state as Partial<ReportInterviewState>;
    if (candidate.version !== "adaptive-v1" || !candidate.blueprint || typeof candidate.blueprint !== "object") return null;
    return candidate as ReportInterviewState;`
);
fs.writeFileSync(interviewPath, interviewSource);

console.log("Applied report interview state safety patch");
