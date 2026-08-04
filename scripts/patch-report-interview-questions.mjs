import fs from "node:fs";

const path = "apps/web/lib/report-interview.ts";
let source = fs.readFileSync(path, "utf8");

const marker = "async function saveState(projectId: string, state: ReportInterviewState): Promise<void> {";
if (!source.includes(marker)) throw new Error("Report interview save marker not found");
const helper = `function mergeInterviewQuestions(base: ReportQuestion[], extra: ReportQuestion[]): ReportQuestion[] {
  const map = new Map<string, ReportQuestion>();
  for (const question of [...base, ...extra]) {
    if (!map.has(question.id)) map.set(question.id, question);
  }
  return Array.from(map.values()).slice(0, 12);
}

`;
source = source.replace(marker, helper + marker);

const oldQuestions = "    questions: normalizeQuestions(parsed.questions, input.fallbackQuestions),";
if (!source.includes(oldQuestions)) throw new Error("AI question normalization marker not found");
source = source.replace(
  oldQuestions,
  "    questions: mergeInterviewQuestions(input.fallbackQuestions, normalizeQuestions(parsed.questions, [])),"
);

fs.writeFileSync(path, source);
console.log("Applied report interview core-question patch");
