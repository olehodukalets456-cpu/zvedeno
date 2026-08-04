import { and, asc, eq } from "drizzle-orm";
import {
  adAccounts,
  ads,
  campaigns,
  createDatabase,
  dailyInsights,
  mediaAssets,
  projects,
  reportRecipes
} from "@zvedeno/database";
import {
  REPORT_TEMPLATE_CATALOG,
  reportTemplateById,
  type AdaptiveReportBlueprint,
  type ReportInterviewState,
  type ReportMetricCategory,
  type ReportMetricInventoryItem,
  type ReportQuestion,
  type ReportTemplateId,
  type ReportTemplateRecommendation
} from "@zvedeno/shared";

type MetricBag = Record<string, string | number | boolean | null>;
type Answers = Record<string, string | string[] | boolean>;

const TEMPLATE_IDS = new Set<ReportTemplateId>(REPORT_TEMPLATE_CATALOG.map((item) => item.id));
const GRANULARITIES = new Set(["daily", "weekly", "monthly"] as const);

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricCategory(key: string): ReportMetricCategory {
  if (["spend", "impressions", "reach", "frequency", "cpm"].includes(key)) return "delivery";
  if (["clicks", "inline_link_clicks", "outbound_clicks", "cpc", "ctr"].includes(key)) return "traffic";
  if (key.startsWith("action_value.") || key.includes("roas")) return "value";
  if (key.startsWith("action.") || key.startsWith("cost_per_action.")) return "conversion";
  if (key.startsWith("video_")) return "video";
  if (key.includes("ranking") || key.includes("quality")) return "quality";
  return "other";
}

function metricLabel(key: string): string {
  const known: Record<string, string> = {
    spend: "Витрати",
    impressions: "Покази",
    reach: "Охоплення",
    frequency: "Частота",
    clicks: "Усі кліки",
    inline_link_clicks: "Кліки на посилання",
    cpc: "CPC",
    cpm: "CPM",
    ctr: "CTR"
  };
  return known[key] ?? key
    .replace(/^action_value\./, "Цінність: ")
    .replace(/^action\./, "Подія: ")
    .replace(/^cost_per_action\./, "Ціна події: ")
    .replace(/[_\.]+/g, " ");
}

function inventoryFromRows(rows: Array<{ metrics: unknown }>): ReportMetricInventoryItem[] {
  const map = new Map<string, { total: number; nonZeroRows: number; coverageRows: number }>();
  for (const row of rows) {
    const metrics = (row.metrics ?? {}) as MetricBag;
    for (const [key, raw] of Object.entries(metrics)) {
      const current = map.get(key) ?? { total: 0, nonZeroRows: 0, coverageRows: 0 };
      current.coverageRows += 1;
      const value = numberValue(raw);
      if (value !== 0) current.nonZeroRows += 1;
      current.total += value;
      map.set(key, current);
    }
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({
      key,
      label: metricLabel(key),
      category: metricCategory(key),
      total: Number(value.total.toFixed(4)),
      nonZeroRows: value.nonZeroRows,
      coverageRows: value.coverageRows
    }))
    .sort((a, b) => {
      const priority = (item: ReportMetricInventoryItem) =>
        item.category === "value" ? 0 : item.category === "conversion" ? 1 : item.category === "traffic" ? 2 : 3;
      return priority(a) - priority(b) || b.nonZeroRows - a.nonZeroRows || a.key.localeCompare(b.key);
    });
}

function availableKeys(inventory: ReportMetricInventoryItem[]): Set<string> {
  return new Set(inventory.filter((item) => item.nonZeroRows > 0).map((item) => item.key));
}

function hasAny(keys: Set<string>, patterns: RegExp[]): boolean {
  return Array.from(keys).some((key) => patterns.some((pattern) => pattern.test(key)));
}

function deterministicRecommendations(inventory: ReportMetricInventoryItem[]): ReportTemplateRecommendation[] {
  const keys = availableKeys(inventory);
  const hasRevenue = hasAny(keys, [/^action_value\./, /roas/i]);
  const hasPurchase = hasAny(keys, [/^action\..*purchase/i]);
  const hasLead = hasAny(keys, [/^action\..*lead/i, /messaging_conversation/i]);
  const scores: Array<[ReportTemplateId, number, string]> = [
    ["commerce_roas", hasRevenue || hasPurchase ? 0.96 : 0.3, hasRevenue ? "У кабінеті є цінність конверсій — можна коректно рахувати дохід і ROAS." : "Підійде, якщо основна ціль — продажі."],
    ["lead_generation", hasLead ? 0.92 : 0.48, hasLead ? "У даних є ліди або переписки." : "Підійде для контролю CPL/CPA."],
    ["creative_intelligence", 0.72, "У проєкті доступні оголошення й креативи для порівняння."],
    ["custom_funnel", 0.62, "Підійде, якщо фінальний результат живе поза Meta або складається з кількох етапів."],
    ["minimal", 0.45, "Варіант без зайвих вкладок для кількох ключових KPI."]
  ];
  return scores
    .sort((a, b) => b[1] - a[1])
    .map(([templateId, score, reason]) => ({
      templateId,
      label: reportTemplateById(templateId).label,
      score,
      reason
    }));
}

function baseQuestions(recommendations: ReportTemplateRecommendation[], inventory: ReportMetricInventoryItem[]): ReportQuestion[] {
  const topMetrics = inventory
    .filter((item) => item.nonZeroRows > 0 && ["conversion", "value"].includes(item.category))
    .slice(0, 12);
  return [
    {
      id: "template",
      label: "Яку головну задачу має вирішувати звіт?",
      help: "AI вже проаналізував доступні події й відсортував варіанти за релевантністю.",
      type: "single",
      required: true,
      options: recommendations.map((item) => ({
        value: item.templateId,
        label: item.label,
        description: item.reason
      }))
    },
    {
      id: "granularity",
      label: "Яка деталізація динаміки потрібна?",
      help: "Це визначає основну часову вкладку й графіки.",
      type: "single",
      required: true,
      options: [
        { value: "daily", label: "Щодня", description: "Для оперативної оптимізації." },
        { value: "weekly", label: "Щотижня", description: "Для стабільного performance-аналізу." },
        { value: "monthly", label: "Щомісяця", description: "Для управлінського огляду та сезонності." }
      ]
    },
    {
      id: "focusMetrics",
      label: "Які фактичні події є головним результатом?",
      help: "Можна вибрати кілька. У звіт потраплятимуть тільки реально доступні події.",
      type: "multi",
      required: true,
      options: topMetrics.length > 0
        ? topMetrics.map((item) => ({ value: item.key, label: item.label, description: `Сума в кабінеті: ${Number(item.total.toFixed(2))}` }))
        : [{ value: "action.link_click", label: "Кліки на посилання", description: "У даних не знайдено стабільної фінальної конверсії." }]
    },
    {
      id: "includeCreatives",
      label: "Потрібна окрема аналітика креативів із превʼю?",
      help: "Якщо ні, звіт буде легшим і без великих зображень.",
      type: "boolean",
      required: true,
      options: []
    },
    {
      id: "includeCharts",
      label: "Потрібен dashboard із графіками?",
      help: "Графіки створюватимуться лише коли вони справді потрібні.",
      type: "boolean",
      required: true,
      options: []
    },
    {
      id: "externalResult",
      label: "Чи є фінальний результат поза Meta?",
      help: "Наприклад: реальна підписка, підтверджений лід, депозит або покупка в боті.",
      type: "boolean",
      required: true,
      options: []
    }
  ];
}

function cloneBlueprint(templateId: ReportTemplateId): AdaptiveReportBlueprint {
  return JSON.parse(JSON.stringify(reportTemplateById(templateId).blueprint)) as AdaptiveReportBlueprint;
}

function answerBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

function blueprintFromAnswers(
  answers: Answers,
  inventory: ReportMetricInventoryItem[],
  fallbackTemplate: ReportTemplateId
): AdaptiveReportBlueprint {
  const requested = String(answers.template ?? fallbackTemplate) as ReportTemplateId;
  const templateId = TEMPLATE_IDS.has(requested) ? requested : fallbackTemplate;
  const blueprint = cloneBlueprint(templateId);
  const granularity = String(answers.granularity ?? blueprint.granularity);
  if (GRANULARITIES.has(granularity as "daily" | "weekly" | "monthly")) {
    blueprint.granularity = granularity as "daily" | "weekly" | "monthly";
  }
  blueprint.includeCreatives = answerBoolean(answers.includeCreatives, blueprint.includeCreatives);
  blueprint.includeCharts = answerBoolean(answers.includeCharts, blueprint.includeCharts);
  blueprint.includeFunnel = answerBoolean(answers.externalResult, blueprint.includeFunnel);
  const selected = Array.isArray(answers.focusMetrics)
    ? answers.focusMetrics.map(String)
    : typeof answers.focusMetrics === "string"
      ? [answers.focusMetrics]
      : [];
  const available = availableKeys(inventory);
  const validSelected = selected.filter((key) => available.has(key));
  if (validSelected.length > 0) blueprint.resultMetrics = validSelected;
  blueprint.revenueMetrics = blueprint.revenueMetrics.filter((key) => available.has(key));
  if (blueprint.revenueMetrics.length > 0 && !blueprint.primaryMetrics.includes("derived.roas")) {
    blueprint.primaryMetrics.push("business.revenue", "derived.roas");
  }
  const trendTitle = blueprint.granularity === "daily" ? "Daily" : blueprint.granularity === "weekly" ? "Weekly" : "Monthly";
  blueprint.tabs = blueprint.tabs
    .filter((tab) => {
      if (tab.kind === "creatives") return blueprint.includeCreatives;
      if (tab.kind === "funnel") return blueprint.includeFunnel;
      if (tab.kind === "raw") return blueprint.includeRawData;
      return true;
    })
    .map((tab) => tab.kind === "trend" ? { ...tab, title: trendTitle } : tab);
  return blueprint;
}

function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const output of Array.isArray(payload.output) ? payload.output : []) {
    if (!output || typeof output !== "object") continue;
    const content = Array.isArray((output as { content?: unknown }).content)
      ? (output as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function normalizeRecommendations(value: unknown, fallback: ReportTemplateRecommendation[]): ReportTemplateRecommendation[] {
  if (!Array.isArray(value)) return fallback;
  const result = value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const templateId = String(item.templateId ?? "minimal") as ReportTemplateId;
      if (!TEMPLATE_IDS.has(templateId)) return null;
      return {
        templateId,
        label: reportTemplateById(templateId).label,
        score: Math.max(0, Math.min(1, numberValue(item.score))),
        reason: String(item.reason ?? "").slice(0, 500)
      };
    })
    .filter((item): item is ReportTemplateRecommendation => Boolean(item));
  return result.length > 0 ? result.sort((a, b) => b.score - a.score) : fallback;
}

function normalizeQuestions(value: unknown, fallback: ReportQuestion[]): ReportQuestion[] {
  if (!Array.isArray(value)) return fallback;
  const questions = value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const id = String(item.id ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
      const type = String(item.type ?? "single");
      if (!id || !["single", "multi", "boolean", "text"].includes(type)) return null;
      return {
        id,
        label: String(item.label ?? id).slice(0, 300),
        help: String(item.help ?? "").slice(0, 800),
        type: type as ReportQuestion["type"],
        required: item.required !== false,
        options: Array.isArray(item.options)
          ? item.options
              .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object"))
              .map((option) => ({
                value: String(option.value ?? "").slice(0, 160),
                label: String(option.label ?? option.value ?? "").slice(0, 200),
                description: String(option.description ?? "").slice(0, 500)
              }))
              .filter((option) => option.value)
          : []
      };
    })
    .filter((item): item is ReportQuestion => Boolean(item));
  return questions.length > 0 ? questions.slice(0, 12) : fallback;
}

async function saveState(projectId: string, state: ReportInterviewState): Promise<void> {
  const { db, pool } = createDatabase();
  try {
    const [recipe] = await db
      .select({ id: reportRecipes.id, config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, projectId), eq(reportRecipes.enabled, true)))
      .limit(1);
    if (!recipe) throw new Error("Report recipe not found");
    await db.update(reportRecipes).set({
      config: { ...(recipe.config as Record<string, unknown>), reportInterview: state },
      updatedAt: new Date()
    }).where(eq(reportRecipes.id, recipe.id));
  } finally {
    await pool.end();
  }
}

export async function loadReportInterview(projectId: string): Promise<ReportInterviewState | null> {
  const { db, pool } = createDatabase();
  try {
    const [recipe] = await db
      .select({ config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, projectId), eq(reportRecipes.enabled, true)))
      .limit(1);
    const state = (recipe?.config as { reportInterview?: unknown } | undefined)?.reportInterview;
    return state && typeof state === "object" ? state as ReportInterviewState : null;
  } finally {
    await pool.end();
  }
}

async function analyzeInventory(projectId: string): Promise<{
  projectName: string;
  inventory: ReportMetricInventoryItem[];
  context: Record<string, unknown>;
}> {
  const { db, pool } = createDatabase();
  try {
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new Error("Project not found");
    const rows = await db
      .select({
        date: dailyInsights.insightDate,
        metrics: dailyInsights.metrics,
        account: adAccounts.name,
        campaign: campaigns.name,
        objective: campaigns.objective,
        ad: ads.name,
        creative: mediaAssets.canonicalName
      })
      .from(dailyInsights)
      .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
      .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
      .leftJoin(ads, eq(dailyInsights.adId, ads.id))
      .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
      .where(eq(dailyInsights.projectId, projectId))
      .orderBy(asc(dailyInsights.insightDate));
    const inventory = inventoryFromRows(rows);
    const campaignsMap = new Map<string, { account: string; campaign: string; objective: string; spend: number; metricTotals: Record<string, number> }>();
    for (const row of rows) {
      const key = `${row.account}\u001f${row.campaign ?? "Без назви"}`;
      const item = campaignsMap.get(key) ?? {
        account: row.account,
        campaign: row.campaign ?? "Без назви",
        objective: row.objective ?? "",
        spend: 0,
        metricTotals: {}
      };
      const metrics = (row.metrics ?? {}) as MetricBag;
      item.spend += numberValue(metrics.spend);
      for (const [metric, value] of Object.entries(metrics)) {
        if (metric.startsWith("action.") || metric.startsWith("action_value.")) {
          item.metricTotals[metric] = (item.metricTotals[metric] ?? 0) + numberValue(value);
        }
      }
      campaignsMap.set(key, item);
    }
    return {
      projectName: project.name,
      inventory,
      context: {
        dateFrom: rows[0]?.date ?? null,
        dateTo: rows.at(-1)?.date ?? null,
        facts: rows.length,
        accounts: new Set(rows.map((row) => row.account)).size,
        campaigns: Array.from(campaignsMap.values()).slice(0, 100),
        creatives: new Set(rows.map((row) => row.creative).filter(Boolean)).size
      }
    };
  } finally {
    await pool.end();
  }
}

async function askArchitect(input: {
  projectName: string;
  inventory: ReportMetricInventoryItem[];
  context: Record<string, unknown>;
  brief: string;
  answers: Answers;
  round: number;
  fallbackRecommendations: ReportTemplateRecommendation[];
  fallbackQuestions: ReportQuestion[];
}): Promise<{ recommendations: ReportTemplateRecommendation[]; questions: ReportQuestion[]; summary: string; warnings: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      recommendations: input.fallbackRecommendations,
      questions: input.fallbackQuestions,
      summary: "Система просканувала доступні Meta-метрики та підготувала питання для конфігурації звіту.",
      warnings: ["OPENAI_API_KEY не налаштовано — використано детермінований аналітичний сценарій."]
    };
  }
  const model = process.env.OPENAI_REPORT_BUILDER_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? "gpt-5.6";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "high" },
      instructions: [
        "Ти senior performance marketing analytics architect.",
        "Проаналізуй фактичний inventory Meta Ads і сформуй лише питання, без яких неможливо побудувати коректний індивідуальний звіт.",
        "Не вигадуй метрики. Для ROAS має бути доступна action_value або інша цінність конверсії.",
        "Відповідай українською. Не дублюй уже отримані відповіді. Максимум 8 питань за раунд.",
        "Використовуй тільки templateId: commerce_roas, lead_generation, creative_intelligence, custom_funnel, minimal."
      ].join("\n"),
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }],
      text: {
        format: {
          type: "json_schema",
          name: "adaptive_report_interview",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "recommendations", "questions", "warnings"],
            properties: {
              summary: { type: "string" },
              recommendations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["templateId", "score", "reason"],
                  properties: {
                    templateId: { type: "string", enum: ["commerce_roas", "lead_generation", "creative_intelligence", "custom_funnel", "minimal"] },
                    score: { type: "number" },
                    reason: { type: "string" }
                  }
                }
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "help", "type", "required", "options"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    help: { type: "string" },
                    type: { type: "string", enum: ["single", "multi", "boolean", "text"] },
                    required: { type: "boolean" },
                    options: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["value", "label", "description"],
                        properties: {
                          value: { type: "string" },
                          label: { type: "string" },
                          description: { type: "string" }
                        }
                      }
                    }
                  }
                }
              },
              warnings: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) {
    return {
      recommendations: input.fallbackRecommendations,
      questions: input.fallbackQuestions,
      summary: "AI-аудит завершився fallback-сценарієм, але всі доступні метрики збережені.",
      warnings: [`OpenAI API повернув ${response.status}.`]
    };
  }
  const payload = await response.json() as Record<string, unknown>;
  const text = extractOutputText(payload);
  const parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  return {
    recommendations: normalizeRecommendations(parsed.recommendations, input.fallbackRecommendations),
    questions: normalizeQuestions(parsed.questions, input.fallbackQuestions),
    summary: String(parsed.summary ?? "AI проаналізував структуру даних і підготував уточнення.").slice(0, 2000),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 20) : []
  };
}

export async function startReportInterview(input: { projectId: string; brief?: string }): Promise<ReportInterviewState> {
  const analysis = await analyzeInventory(input.projectId);
  const recommendations = deterministicRecommendations(analysis.inventory);
  const questions = baseQuestions(recommendations, analysis.inventory);
  const ai = await askArchitect({
    ...analysis,
    brief: input.brief?.trim() ?? "",
    answers: {},
    round: 1,
    fallbackRecommendations: recommendations,
    fallbackQuestions: questions
  });
  const topTemplate = ai.recommendations[0]?.templateId ?? recommendations[0]?.templateId ?? "minimal";
  const state: ReportInterviewState = {
    version: "adaptive-v1",
    status: "questionnaire",
    model: process.env.OPENAI_REPORT_BUILDER_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? (process.env.OPENAI_API_KEY ? "gpt-5.6" : "deterministic-fallback"),
    round: 1,
    analyzedAt: new Date().toISOString(),
    summary: ai.summary,
    metricInventory: analysis.inventory,
    recommendations: ai.recommendations,
    questions: ai.questions,
    answers: {},
    blueprint: cloneBlueprint(topTemplate),
    warnings: ai.warnings
  };
  await saveState(input.projectId, state);
  return state;
}

export async function continueReportInterview(input: { projectId: string; answers: Answers; brief?: string }): Promise<ReportInterviewState> {
  const current = await loadReportInterview(input.projectId) ?? await startReportInterview({ projectId: input.projectId, brief: input.brief });
  const mergedAnswers = { ...current.answers, ...input.answers };
  const requiredMissing = current.questions.filter((question) => {
    const value = mergedAnswers[question.id];
    return question.required && (value === undefined || value === "" || (Array.isArray(value) && value.length === 0));
  });
  if (requiredMissing.length > 0) {
    const state = { ...current, answers: mergedAnswers, warnings: [`Заповни обовʼязкові питання: ${requiredMissing.map((item) => item.label).join(", ")}`] };
    await saveState(input.projectId, state);
    return state;
  }

  const analysis = await analyzeInventory(input.projectId);
  const recommendations = current.recommendations.length > 0 ? current.recommendations : deterministicRecommendations(analysis.inventory);
  const selectedTemplate = String(mergedAnswers.template ?? recommendations[0]?.templateId ?? "minimal") as ReportTemplateId;
  const blueprint = blueprintFromAnswers(mergedAnswers, analysis.inventory, TEMPLATE_IDS.has(selectedTemplate) ? selectedTemplate : "minimal");

  const needsExternalLabel = answerBoolean(mergedAnswers.externalResult, false) && !mergedAnswers.externalResultLabel;
  if (needsExternalLabel) {
    const followup: ReportQuestion = {
      id: "externalResultLabel",
      label: "Як називається фінальний результат поза Meta?",
      help: "Наприклад: реальні підписники, кваліфіковані ліди, депозити або покупки в боті.",
      type: "text",
      required: true,
      options: []
    };
    const state: ReportInterviewState = {
      ...current,
      status: "questionnaire",
      round: current.round + 1,
      analyzedAt: new Date().toISOString(),
      metricInventory: analysis.inventory,
      questions: [followup],
      answers: mergedAnswers,
      blueprint,
      warnings: []
    };
    await saveState(input.projectId, state);
    return state;
  }

  const state: ReportInterviewState = {
    ...current,
    status: "ready",
    round: current.round + 1,
    analyzedAt: new Date().toISOString(),
    metricInventory: analysis.inventory,
    questions: [],
    answers: mergedAnswers,
    blueprint,
    summary: `Конфігурація готова: ${reportTemplateById(blueprint.templateId).label}, ${blueprint.granularity}, ${blueprint.tabs.length} вкладок.`,
    warnings: blueprint.revenueMetrics.length === 0 && blueprint.templateId === "commerce_roas"
      ? ["У вибраному періоді не знайдено цінності покупок. ROAS буде порожнім, доки Meta не поверне action_value."]
      : []
  };
  await saveState(input.projectId, state);
  return state;
}
