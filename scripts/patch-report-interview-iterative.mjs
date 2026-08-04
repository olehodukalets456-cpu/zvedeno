import fs from "node:fs";

const path = "apps/web/lib/report-interview.ts";
let source = fs.readFileSync(path, "utf8");

const instruction = `        "Відповідай українською. Не дублюй уже отримані відповіді. Максимум 8 питань за раунд.",`;
if (!source.includes(instruction)) throw new Error("Report architect clarification instruction not found");
source = source.replace(
  instruction,
  `${instruction}
        "Для додаткових налаштувань використовуй id includeCampaigns, includeAdSets, includeRawData або includeFunnel і type boolean. Не створюй питання, відповідь на яке не змінює структуру звіту.",`
);

const readyMarker = `  const state: ReportInterviewState = {
    ...current,
    status: "ready",`;
if (!source.includes(readyMarker)) throw new Error("Report interview ready-state marker not found");
const iterative = `  if (process.env.OPENAI_API_KEY && current.round < 4) {
    const aiFollowup = await askArchitect({
      ...analysis,
      brief: input.brief?.trim() ?? "",
      answers: mergedAnswers,
      round: current.round + 1,
      fallbackRecommendations: recommendations,
      fallbackQuestions: []
    });
    const unanswered = aiFollowup.questions.filter((question) => {
      const value = mergedAnswers[question.id];
      return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    });
    if (unanswered.length > 0) {
      const state: ReportInterviewState = {
        ...current,
        status: "questionnaire",
        round: current.round + 1,
        analyzedAt: new Date().toISOString(),
        summary: aiFollowup.summary,
        metricInventory: analysis.inventory,
        recommendations: aiFollowup.recommendations,
        questions: unanswered,
        answers: mergedAnswers,
        blueprint,
        warnings: aiFollowup.warnings
      };
      await saveState(input.projectId, state);
      return state;
    }
  }

${readyMarker}`;
source = source.replace(readyMarker, iterative);

fs.writeFileSync(path, source);
console.log("Applied iterative AI report clarification patch");
