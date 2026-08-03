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

export const LEGACY_DMND_PROJECT_ID = "cc6f71d1-1043-4a2e-96d7-8f50484c010e";

export type AIReportOffer = {
  key: string;
  label: string;
  description: string;
  resultMetric: string;
  resultLabel: string;
};

export type AICampaignMapping = {
  campaignName: string;
  offer: string;
  funnel: string;
  resultMetric: string;
  rationale: string;
};

export type ProjectAIReport = {
  status: "ready" | "fallback" | "needs_key" | "failed";
  model: string;
  analyzedAt: string;
  summary: string;
  confidence: number;
  offers: AIReportOffer[];
  campaignMap: AICampaignMapping[];
  defaultGroups: string[];
  warnings: string[];
  inventory: {
    accounts: number;
    campaigns: number;
    ads: number;
    creatives: number;
    dailyFacts: number;
  };
};

type RawMetrics = Record<string, string | number | null>;

type CampaignAggregate = {
  campaignName: string;
  accountName: string;
  objective: string;
  spend: number;
  impressions: number;
  clicks: number;
  actions: Record<string, number>;
  adNames: Set<string>;
  creativeNames: Set<string>;
  imageUrls: Set<string>;
};

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function cleanKey(value: string): string {
  return value
    .trim()
    .toLocaleUpperCase("uk-UA")
    .replace(/[^A-ZА-ЯІЇЄҐ0-9]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "GENERAL";
}

function firstCampaignToken(name: string): string {
  return cleanKey(name.split(/[|—–:\-]/u)[0] ?? name.split(/\s+/u)[0] ?? "GENERAL");
}

function inferFunnel(name: string): string {
  const tokens = name.toLocaleUpperCase("uk-UA").split(/[|\s—–_/:\-]+/u).filter(Boolean);
  if (tokens.some((token) => ["FORM", "FORMS", "LEADFORM", "ФОРМА"].includes(token))) return "Лід-форма Meta";
  if (tokens.some((token) => ["BOT", "БОТ"].includes(token))) return "Telegram-бот";
  if (tokens.some((token) => ["TG", "TELEGRAM", "CHANNEL", "CHANEL", "КАНАЛ"].includes(token))) return "Telegram через прокладку";
  if (tokens.some((token) => ["SITE", "LAND", "LANDING", "WEBSITE", "САЙТ"].includes(token))) return "Сайт / лендінг";
  if (tokens.some((token) => ["MESSAGES", "MESSAGE", "DIRECT", "WHATSAPP", "MESSENGER"].includes(token))) return "Переписки";
  return "Інше";
}

function chooseResultMetric(aggregate: CampaignAggregate): string {
  const preferred = [
    "action.purchase",
    "action.omni_purchase",
    "action.lead",
    "action.messaging_conversation_started_7d",
    "action.complete_registration",
    "action.link_click"
  ];
  return preferred.find((key) => (aggregate.actions[key] ?? 0) > 0) ?? "action.lead";
}

function labelForMetric(metric: string): string {
  if (metric.includes("purchase")) return "Покупки";
  if (metric.includes("messaging")) return "Переписки";
  if (metric.includes("registration")) return "Реєстрації";
  if (metric.includes("link_click")) return "Кліки";
  return "Ліди";
}

function fallbackReport(
  aggregates: CampaignAggregate[],
  inventory: ProjectAIReport["inventory"],
  status: ProjectAIReport["status"],
  warning?: string
): ProjectAIReport {
  const offerMap = new Map<string, AIReportOffer>();
  const campaignMap: AICampaignMapping[] = [];

  for (const campaign of aggregates) {
    const offer = firstCampaignToken(campaign.campaignName);
    const resultMetric = chooseResultMetric(campaign);
    if (!offerMap.has(offer)) {
      offerMap.set(offer, {
        key: offer,
        label: offer,
        description: `Автоматично визначено з контексту кампаній ${offer}.`,
        resultMetric,
        resultLabel: labelForMetric(resultMetric)
      });
    }
    campaignMap.push({
      campaignName: campaign.campaignName,
      offer,
      funnel: inferFunnel(campaign.campaignName),
      resultMetric,
      rationale: "Детермінований fallback за назвою, ціллю та доступними подіями Meta."
    });
  }

  return {
    status,
    model: "deterministic-fallback",
    analyzedAt: new Date().toISOString(),
    summary: aggregates.length
      ? "Система просканувала проєкт і сформувала окремий звіт із фактичних кампаній цього проєкту."
      : "У вибраних кабінетах поки немає кампаній для формування структури звіту.",
    confidence: aggregates.length ? 0.62 : 0.25,
    offers: Array.from(offerMap.values()),
    campaignMap,
    defaultGroups: ["creative", "funnel"],
    warnings: warning ? [warning] : [],
    inventory
  };
}

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function normalizeAIReport(
  value: unknown,
  fallback: ProjectAIReport,
  model: string
): ProjectAIReport {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const offers = Array.isArray(raw.offers)
    ? raw.offers
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          key: cleanKey(String(item.key ?? item.label ?? "GENERAL")),
          label: String(item.label ?? item.key ?? "General").slice(0, 80),
          description: String(item.description ?? "").slice(0, 500),
          resultMetric: String(item.resultMetric ?? "action.lead").slice(0, 100),
          resultLabel: String(item.resultLabel ?? "Результати").slice(0, 80)
        }))
    : [];
  const validOffers = offers.length ? offers : fallback.offers;
  const offerKeys = new Set(validOffers.map((offer) => offer.key));
  const campaignMap = Array.isArray(raw.campaignMap)
    ? raw.campaignMap
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => {
          const requestedOffer = cleanKey(String(item.offer ?? "GENERAL"));
          return {
            campaignName: String(item.campaignName ?? "").slice(0, 500),
            offer: offerKeys.has(requestedOffer) ? requestedOffer : validOffers[0]?.key ?? "GENERAL",
            funnel: String(item.funnel ?? "Інше").slice(0, 120),
            resultMetric: String(item.resultMetric ?? "action.lead").slice(0, 100),
            rationale: String(item.rationale ?? "").slice(0, 500)
          };
        })
        .filter((item) => item.campaignName)
    : fallback.campaignMap;

  return {
    ...fallback,
    status: "ready",
    model,
    analyzedAt: new Date().toISOString(),
    summary: String(raw.summary ?? fallback.summary).slice(0, 2000),
    confidence: Math.max(0, Math.min(1, numberValue(raw.confidence ?? fallback.confidence))),
    offers: validOffers,
    campaignMap,
    defaultGroups: Array.isArray(raw.defaultGroups)
      ? raw.defaultGroups.map(String).filter((item) => ["offer", "creative", "funnel", "account", "date"].includes(item)).slice(0, 5)
      : fallback.defaultGroups,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 20) : fallback.warnings
  };
}

async function saveReport(projectId: string, report: ProjectAIReport, brief: string): Promise<void> {
  const { db, pool } = createDatabase();
  try {
    const [recipe] = await db
      .select({ id: reportRecipes.id, config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, projectId), eq(reportRecipes.enabled, true)))
      .limit(1);
    if (!recipe) return;
    await db
      .update(reportRecipes)
      .set({
        config: {
          ...(recipe.config as Record<string, unknown>),
          projectBrief: brief,
          uiVersion: projectId === LEGACY_DMND_PROJECT_ID ? "legacy-dmnd" : "ai-v1",
          aiReport: report
        },
        updatedAt: new Date()
      })
      .where(eq(reportRecipes.id, recipe.id));
  } finally {
    await pool.end();
  }
}

export async function analyzeProjectReport(input: {
  projectId: string;
  brief?: string;
}): Promise<ProjectAIReport> {
  const { db, pool } = createDatabase();
  let brief = input.brief?.trim() ?? "";
  try {
    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new Error("Project not found");

    const [recipe] = await db
      .select({ config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
      .limit(1);
    const recipeConfig = (recipe?.config ?? {}) as Record<string, unknown>;
    if (!brief && typeof recipeConfig.projectBrief === "string") brief = recipeConfig.projectBrief;

    const rows = await db
      .select({
        date: dailyInsights.insightDate,
        metrics: dailyInsights.metrics,
        accountName: adAccounts.name,
        campaignName: campaigns.name,
        objective: campaigns.objective,
        adName: ads.name,
        creativeName: mediaAssets.canonicalName,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        archivedMediaUrl: mediaAssets.archivedMediaUrl
      })
      .from(dailyInsights)
      .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
      .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
      .leftJoin(ads, eq(dailyInsights.adId, ads.id))
      .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
      .where(eq(dailyInsights.projectId, project.id))
      .orderBy(asc(dailyInsights.insightDate));

    const aggregates = new Map<string, CampaignAggregate>();
    const accountNames = new Set<string>();
    const adNames = new Set<string>();
    const creativeNames = new Set<string>();

    for (const row of rows) {
      const campaignName = row.campaignName?.trim() || "Без назви кампанії";
      const accountName = row.accountName || "Без назви кабінету";
      accountNames.add(accountName);
      if (row.adName) adNames.add(row.adName);
      if (row.creativeName) creativeNames.add(row.creativeName);
      const key = `${accountName}\u001f${campaignName}`;
      let aggregate = aggregates.get(key);
      if (!aggregate) {
        aggregate = {
          campaignName,
          accountName,
          objective: row.objective ?? "",
          spend: 0,
          impressions: 0,
          clicks: 0,
          actions: {},
          adNames: new Set(),
          creativeNames: new Set(),
          imageUrls: new Set()
        };
        aggregates.set(key, aggregate);
      }
      const metrics = (row.metrics ?? {}) as RawMetrics;
      aggregate.spend += numberValue(metrics.spend);
      aggregate.impressions += numberValue(metrics.impressions);
      aggregate.clicks += numberValue(metrics.clicks);
      for (const [metric, value] of Object.entries(metrics)) {
        if (metric.startsWith("action.")) aggregate.actions[metric] = (aggregate.actions[metric] ?? 0) + numberValue(value);
      }
      if (row.adName) aggregate.adNames.add(row.adName);
      if (row.creativeName) aggregate.creativeNames.add(row.creativeName);
      const imageUrl = row.archivedMediaUrl ?? row.thumbnailUrl;
      if (imageUrl) aggregate.imageUrls.add(imageUrl);
    }

    const campaignAggregates = Array.from(aggregates.values());
    const inventory = {
      accounts: accountNames.size,
      campaigns: campaignAggregates.length,
      ads: adNames.size,
      creatives: creativeNames.size,
      dailyFacts: rows.length
    };
    const noKeyFallback = fallbackReport(
      campaignAggregates,
      inventory,
      process.env.OPENAI_API_KEY ? "fallback" : "needs_key",
      process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY не налаштовано — використано безпечний детермінований аналіз."
    );

    if (!process.env.OPENAI_API_KEY || campaignAggregates.length === 0) {
      await saveReport(project.id, noKeyFallback, brief);
      return noKeyFallback;
    }

    const model = process.env.OPENAI_REPORT_MODEL ?? "gpt-5";
    const campaignPayload = campaignAggregates.map((item) => ({
      campaignName: item.campaignName,
      accountName: item.accountName,
      objective: item.objective,
      spend: Number(item.spend.toFixed(2)),
      impressions: item.impressions,
      clicks: item.clicks,
      actions: item.actions,
      adNames: Array.from(item.adNames),
      creativeNames: Array.from(item.creativeNames)
    }));
    const imageItems = campaignAggregates
      .flatMap((item) => Array.from(item.imageUrls).map((imageUrl) => ({ imageUrl, campaignName: item.campaignName })))
      .filter((item, index, values) => values.findIndex((candidate) => candidate.imageUrl === item.imageUrl) === index)
      .slice(0, 16);

    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: [
          `Проєкт: ${project.name}`,
          `Побажання користувача: ${brief || "не задано"}`,
          "Проаналізуй лише дані цього проєкту. Не покладайся тільки на перше слово неймінгу.",
          "Врахуй назви кампаній, цілі, події, креативи, співвідношення метрик і візуальний контекст.",
          "Сформуй логічні офери/напрями та точне зіставлення кожної кампанії. Не вигадуй кампаній.",
          JSON.stringify({ inventory, campaigns: campaignPayload })
        ].join("\n\n")
      }
    ];
    imageItems.forEach((item, index) => {
      content.push({ type: "input_text", text: `Креатив ${index + 1}, кампанія: ${item.campaignName}` });
      content.push({ type: "input_image", image_url: item.imageUrl, detail: "low" });
    });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions: "Ти — senior marketing analytics architect. Відповідай українською. Структуруй звіт консервативно й доказово.",
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "project_report_configuration",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "confidence", "offers", "campaignMap", "defaultGroups", "warnings"],
              properties: {
                summary: { type: "string" },
                confidence: { type: "number" },
                offers: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["key", "label", "description", "resultMetric", "resultLabel"],
                    properties: {
                      key: { type: "string" },
                      label: { type: "string" },
                      description: { type: "string" },
                      resultMetric: { type: "string" },
                      resultLabel: { type: "string" }
                    }
                  }
                },
                campaignMap: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["campaignName", "offer", "funnel", "resultMetric", "rationale"],
                    properties: {
                      campaignName: { type: "string" },
                      offer: { type: "string" },
                      funnel: { type: "string" },
                      resultMetric: { type: "string" },
                      rationale: { type: "string" }
                    }
                  }
                },
                defaultGroups: {
                  type: "array",
                  items: { type: "string", enum: ["offer", "creative", "funnel", "account", "date"] }
                },
                warnings: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      }),
      signal: AbortSignal.timeout(90_000)
    });

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 800);
      const fallback = { ...noKeyFallback, status: "failed" as const, warnings: [`OpenAI API: ${response.status} ${errorText}`] };
      await saveReport(project.id, fallback, brief);
      return fallback;
    }

    const payload = await response.json() as Record<string, unknown>;
    const text = outputText(payload);
    const parsed = text ? JSON.parse(text) as unknown : null;
    const report = normalizeAIReport(parsed, noKeyFallback, model);
    await saveReport(project.id, report, brief);
    return report;
  } finally {
    await pool.end();
  }
}
