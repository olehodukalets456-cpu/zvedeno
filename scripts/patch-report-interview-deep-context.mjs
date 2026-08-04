import fs from "node:fs";

const path = "apps/web/lib/report-interview.ts";
let source = fs.readFileSync(path, "utf8");

source = source.replace(
  "  ads,\n  campaigns,",
  "  ads,\n  adSets,\n  campaigns,"
);

const analyzeStart = source.indexOf("async function analyzeInventory(");
const analyzeEnd = source.indexOf("async function askArchitect", analyzeStart);
if (analyzeStart < 0 || analyzeEnd < 0) throw new Error("Report inventory analyzer block not found");

const analyzer = `async function analyzeInventory(projectId: string): Promise<{
  projectName: string;
  inventory: ReportMetricInventoryItem[];
  context: Record<string, unknown>;
  images: Array<{ url: string; creative: string; campaign: string }>;
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
        campaignRaw: campaigns.raw,
        adSet: adSets.name,
        optimizationGoal: adSets.optimizationGoal,
        adSetRaw: adSets.raw,
        ad: ads.name,
        adRaw: ads.raw,
        creative: mediaAssets.canonicalName,
        creativeType: mediaAssets.type,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        archivedMediaUrl: mediaAssets.archivedMediaUrl
      })
      .from(dailyInsights)
      .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
      .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
      .leftJoin(adSets, eq(dailyInsights.adSetId, adSets.id))
      .leftJoin(ads, eq(dailyInsights.adId, ads.id))
      .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
      .where(eq(dailyInsights.projectId, projectId))
      .orderBy(asc(dailyInsights.insightDate));

    const inventory = inventoryFromRows(rows);
    type CampaignContext = {
      account: string;
      campaign: string;
      objective: string;
      spend: number;
      metricTotals: Record<string, number>;
      adSets: Set<string>;
      optimizationGoals: Set<string>;
      ads: Set<string>;
      creatives: Set<string>;
      creativeTypes: Set<string>;
      rawCampaign: Record<string, unknown>;
      rawAdSetSamples: Record<string, unknown>[];
      rawAdSamples: Record<string, unknown>[];
    };
    const campaignsMap = new Map<string, CampaignContext>();
    const imageMap = new Map<string, { url: string; creative: string; campaign: string; spend: number }>();

    for (const row of rows) {
      const campaignName = row.campaign ?? "Без назви";
      const key = \`\${row.account}\\u001f\${campaignName}\`;
      const item = campaignsMap.get(key) ?? {
        account: row.account,
        campaign: campaignName,
        objective: row.objective ?? "",
        spend: 0,
        metricTotals: {},
        adSets: new Set<string>(),
        optimizationGoals: new Set<string>(),
        ads: new Set<string>(),
        creatives: new Set<string>(),
        creativeTypes: new Set<string>(),
        rawCampaign: (row.campaignRaw ?? {}) as Record<string, unknown>,
        rawAdSetSamples: [],
        rawAdSamples: []
      };
      const metrics = (row.metrics ?? {}) as MetricBag;
      const rowSpend = numberValue(metrics.spend);
      item.spend += rowSpend;
      for (const [metric, value] of Object.entries(metrics)) {
        const numeric = numberValue(value);
        if (numeric !== 0) item.metricTotals[metric] = (item.metricTotals[metric] ?? 0) + numeric;
      }
      if (row.adSet) item.adSets.add(row.adSet);
      if (row.optimizationGoal) item.optimizationGoals.add(row.optimizationGoal);
      if (row.ad) item.ads.add(row.ad);
      if (row.creative) item.creatives.add(row.creative);
      if (row.creativeType) item.creativeTypes.add(row.creativeType);
      if (row.adSetRaw && item.rawAdSetSamples.length < 3) {
        const raw = row.adSetRaw as Record<string, unknown>;
        if (!item.rawAdSetSamples.some((candidate) => JSON.stringify(candidate) === JSON.stringify(raw))) item.rawAdSetSamples.push(raw);
      }
      if (row.adRaw && item.rawAdSamples.length < 5) {
        const raw = row.adRaw as Record<string, unknown>;
        if (!item.rawAdSamples.some((candidate) => JSON.stringify(candidate) === JSON.stringify(raw))) item.rawAdSamples.push(raw);
      }
      campaignsMap.set(key, item);

      const imageUrl = row.archivedMediaUrl ?? row.thumbnailUrl;
      if (imageUrl) {
        const current = imageMap.get(imageUrl) ?? {
          url: imageUrl,
          creative: row.creative ?? row.ad ?? "Без назви креативу",
          campaign: campaignName,
          spend: 0
        };
        current.spend += rowSpend;
        imageMap.set(imageUrl, current);
      }
    }

    const campaignContexts = Array.from(campaignsMap.values())
      .sort((a, b) => b.spend - a.spend)
      .map((item) => ({
        account: item.account,
        campaign: item.campaign,
        objective: item.objective,
        spend: Number(item.spend.toFixed(2)),
        metricTotals: Object.fromEntries(
          Object.entries(item.metricTotals)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            .slice(0, 80)
            .map(([key, value]) => [key, Number(value.toFixed(4))])
        ),
        adSets: Array.from(item.adSets).slice(0, 30),
        optimizationGoals: Array.from(item.optimizationGoals),
        ads: Array.from(item.ads).slice(0, 50),
        creatives: Array.from(item.creatives).slice(0, 50),
        creativeTypes: Array.from(item.creativeTypes),
        rawCampaign: item.rawCampaign,
        rawAdSetSamples: item.rawAdSetSamples,
        rawAdSamples: item.rawAdSamples
      }));

    const topCampaigns = campaignContexts.slice(0, 180);
    const tailCampaigns = campaignContexts.length > 180 ? campaignContexts.slice(-20) : [];
    const contextCampaigns = [...topCampaigns, ...tailCampaigns.filter((item) => !topCampaigns.includes(item))];
    const images = Array.from(imageMap.values())
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 24)
      .map(({ url, creative, campaign }) => ({ url, creative, campaign }));

    return {
      projectName: project.name,
      inventory,
      images,
      context: {
        dateFrom: rows[0]?.date ?? null,
        dateTo: rows.at(-1)?.date ?? null,
        factsScanned: rows.length,
        accounts: new Set(rows.map((row) => row.account)).size,
        campaignCount: campaignContexts.length,
        campaignsIncludedInModelContext: contextCampaigns.length,
        campaigns: contextCampaigns,
        adSets: new Set(rows.map((row) => row.adSet).filter(Boolean)).size,
        ads: new Set(rows.map((row) => row.ad).filter(Boolean)).size,
        creatives: new Set(rows.map((row) => row.creative).filter(Boolean)).size,
        metricCount: inventory.length,
        metricInventory: inventory
      }
    };
  } finally {
    await pool.end();
  }
}

`;
source = source.slice(0, analyzeStart) + analyzer + source.slice(analyzeEnd);

const inputTypeMarker = `  context: Record<string, unknown>;
  brief: string;`;
if (!source.includes(inputTypeMarker)) throw new Error("Report architect input marker not found");
source = source.replace(
  inputTypeMarker,
  `  context: Record<string, unknown>;
  images: Array<{ url: string; creative: string; campaign: string }>;
  brief: string;`
);

const responseMarker = `  const model = process.env.OPENAI_REPORT_BUILDER_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? "gpt-5.6";
  const response = await fetch("https://api.openai.com/v1/responses", {`;
if (!source.includes(responseMarker)) throw new Error("Report architect request marker not found");
source = source.replace(
  responseMarker,
  `  const model = process.env.OPENAI_REPORT_BUILDER_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? "gpt-5.6";
  const { images, ...textContext } = input;
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: JSON.stringify(textContext) }
  ];
  images.forEach((image, index) => {
    content.push({ type: "input_text", text: \`Creative visual \${index + 1}: \${image.creative}; campaign: \${image.campaign}\` });
    content.push({ type: "input_image", image_url: image.url, detail: "low" });
  });
  const response = await fetch("https://api.openai.com/v1/responses", {`
);

const oldInput = `      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }],`;
if (!source.includes(oldInput)) throw new Error("Report architect content marker not found");
source = source.replace(oldInput, `      input: [{ role: "user", content }],`);

const oldInstruction = `        "Проаналізуй фактичний inventory Meta Ads і сформуй лише питання, без яких неможливо побудувати коректний індивідуальний звіт.",`;
if (!source.includes(oldInstruction)) throw new Error("Report architect instruction marker not found");
source = source.replace(
  oldInstruction,
  `${oldInstruction}
        "Враховуй усі проскановані metric keys, objectives, optimization goals, raw Meta-поля, неймінг і візуальний контекст креативів. Неймінг — лише один із сигналів.",
        "Якщо кабінет великий, контекст містить усі агреговані метрики та репрезентативну вибірку кампаній; не роби висновків лише за першими рядками.",`
);

fs.writeFileSync(path, source);
console.log("Applied deep Meta and creative context to report interview");
