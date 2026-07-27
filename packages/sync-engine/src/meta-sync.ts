import { and, eq } from "drizzle-orm";
import { normalizeCreativeName } from "@zvedeno/classification";
import {
  adAccounts,
  adMediaAssets,
  ads,
  adSets,
  campaigns,
  createDatabase,
  dailyInsights,
  mediaAssets,
  metaConnections,
  projectAdAccounts,
  projects,
  reportRecipes,
  syncErrors,
  syncRuns
} from "@zvedeno/database";
import { MetaClient } from "@zvedeno/meta-api";
import { decryptSecret } from "@zvedeno/shared";

type MetaCampaign = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  updated_time?: string;
  [key: string]: unknown;
};

type MetaAdSet = {
  id: string;
  name: string;
  campaign_id: string;
  optimization_goal?: string;
  status?: string;
  effective_status?: string;
  updated_time?: string;
  [key: string]: unknown;
};

type MetaCreative = {
  id?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  object_story_spec?: Record<string, unknown>;
  asset_feed_spec?: Record<string, unknown>;
  [key: string]: unknown;
};

type MetaAd = {
  id: string;
  name: string;
  campaign_id: string;
  adset_id: string;
  status?: string;
  effective_status?: string;
  creative?: MetaCreative;
  updated_time?: string;
  [key: string]: unknown;
};

type ActionValue = {
  action_type?: string;
  value?: string | number;
};

type MetaInsight = {
  date_start: string;
  date_stop?: string;
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  actions?: ActionValue[];
  action_values?: ActionValue[];
  cost_per_action_type?: ActionValue[];
  video_play_actions?: ActionValue[];
  video_thruplay_watched_actions?: ActionValue[];
  video_p25_watched_actions?: ActionValue[];
  video_p50_watched_actions?: ActionValue[];
  video_p75_watched_actions?: ActionValue[];
  video_p95_watched_actions?: ActionValue[];
  video_p100_watched_actions?: ActionValue[];
  [key: string]: unknown;
};

type RecipeConfig = {
  startDate?: string;
  lookbackDays?: number;
  includeCreatives?: boolean;
  metrics?: string[];
};

export type MetaSyncOptions = {
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  fullBackfill?: boolean;
};

export type MetaSyncSummary = {
  projects: number;
  accounts: number;
  insights: number;
  errors: number;
};

const INSIGHT_FIELDS = [
  "date_start",
  "date_stop",
  "account_id",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "cpc",
  "cpm",
  "ctr",
  "actions",
  "action_values",
  "cost_per_action_type",
  "video_play_actions",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions"
].join(",");

function isoDate(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function daysBefore(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return isoDate(value);
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

function accountPath(externalAccountId: string): string {
  return externalAccountId.startsWith("act_") ? externalAccountId : `act_${externalAccountId}`;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addActionValues(
  target: Record<string, string | number | null>,
  prefix: string,
  values: ActionValue[] | undefined
): void {
  for (const item of values ?? []) {
    if (!item.action_type) continue;
    target[`${prefix}.${item.action_type}`] = numberValue(item.value);
  }
}

function insightMetrics(insight: MetaInsight): Record<string, string | number | null> {
  const metrics: Record<string, string | number | null> = {
    spend: numberValue(insight.spend),
    impressions: numberValue(insight.impressions),
    reach: numberValue(insight.reach),
    frequency: numberValue(insight.frequency),
    clicks: numberValue(insight.clicks),
    inline_link_clicks: numberValue(insight.inline_link_clicks),
    cpc: numberValue(insight.cpc),
    cpm: numberValue(insight.cpm),
    ctr: numberValue(insight.ctr)
  };

  addActionValues(metrics, "action", insight.actions);
  addActionValues(metrics, "action_value", insight.action_values);
  addActionValues(metrics, "cost_per_action", insight.cost_per_action_type);
  addActionValues(metrics, "video_play", insight.video_play_actions);
  addActionValues(metrics, "video_thruplay", insight.video_thruplay_watched_actions);
  addActionValues(metrics, "video_25", insight.video_p25_watched_actions);
  addActionValues(metrics, "video_50", insight.video_p50_watched_actions);
  addActionValues(metrics, "video_75", insight.video_p75_watched_actions);
  addActionValues(metrics, "video_95", insight.video_p95_watched_actions);
  addActionValues(metrics, "video_100", insight.video_p100_watched_actions);

  return metrics;
}

function inferAssetType(creative: MetaCreative | undefined): "image" | "video" | "carousel" | "unknown" {
  if (!creative) return "unknown";
  if (creative.video_id) return "video";
  if (creative.asset_feed_spec) return "carousel";
  if (creative.image_url || creative.thumbnail_url) return "image";
  return "unknown";
}

function extractVideoId(creative: MetaCreative | undefined): string | undefined {
  if (creative?.video_id) return creative.video_id;
  const spec = creative?.object_story_spec;
  if (!spec || typeof spec !== "object") return undefined;
  const videoData = (spec as { video_data?: { video_id?: string } }).video_data;
  return videoData?.video_id;
}

async function loadRecipeConfig(
  db: ReturnType<typeof createDatabase>["db"],
  projectId: string
): Promise<RecipeConfig> {
  const [recipe] = await db
    .select({ config: reportRecipes.config })
    .from(reportRecipes)
    .where(and(eq(reportRecipes.projectId, projectId), eq(reportRecipes.enabled, true)))
    .limit(1);
  return (recipe?.config ?? {}) as RecipeConfig;
}

export async function syncMetaData(options: MetaSyncOptions = {}): Promise<MetaSyncSummary> {
  const { db, pool } = createDatabase();
  const summary: MetaSyncSummary = { projects: 0, accounts: 0, insights: 0, errors: 0 };

  try {
    const pairsQuery = db
      .select({
        workspaceId: projects.workspaceId,
        projectId: projects.id,
        projectName: projects.name,
        accountId: adAccounts.id,
        externalAccountId: adAccounts.externalAccountId,
        accountName: adAccounts.name,
        encryptedAccessToken: metaConnections.encryptedAccessToken
      })
      .from(projectAdAccounts)
      .innerJoin(projects, eq(projectAdAccounts.projectId, projects.id))
      .innerJoin(adAccounts, eq(projectAdAccounts.adAccountId, adAccounts.id))
      .innerJoin(metaConnections, eq(adAccounts.metaConnectionId, metaConnections.id));

    const pairs = options.projectId
      ? await pairsQuery.where(and(eq(projects.id, options.projectId), eq(projects.archived, false)))
      : await pairsQuery.where(eq(projects.archived, false));

    summary.projects = new Set(pairs.map((pair) => pair.projectId)).size;
    summary.accounts = pairs.length;

    for (const pair of pairs) {
      const now = new Date();
      const [run] = await db
        .insert(syncRuns)
        .values({
          workspaceId: pair.workspaceId,
          projectId: pair.projectId,
          adAccountId: pair.accountId,
          jobType: "meta_sync",
          status: "running",
          startedAt: now,
          metadata: { account: pair.externalAccountId }
        })
        .returning({ id: syncRuns.id });

      if (!run) {
        summary.errors += 1;
        console.error("Could not create Meta sync run", pair.externalAccountId);
        continue;
      }

      try {
        const config = await loadRecipeConfig(db, pair.projectId);
        const today = options.dateTo ?? isoDate();
        const configuredStart = options.dateFrom ?? config.startDate ?? daysBefore(today, 90);
        const lookbackDays = Math.max(1, Number(config.lookbackDays ?? process.env.SYNC_LOOKBACK_DAYS ?? 28));
        const dateFrom = options.fullBackfill
          ? configuredStart
          : laterDate(configuredStart, daysBefore(today, lookbackDays));

        const client = new MetaClient({
          accessToken: decryptSecret(pair.encryptedAccessToken),
          apiVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0"
        });
        const account = accountPath(pair.externalAccountId);

        const campaignMap = new Map<string, string>();
        for await (const campaign of client.paginate<MetaCampaign>(`${account}/campaigns`, {
          fields: "id,name,objective,status,effective_status,updated_time",
          limit: "500"
        })) {
          const [saved] = await db
            .insert(campaigns)
            .values({
              workspaceId: pair.workspaceId,
              adAccountId: pair.accountId,
              projectId: pair.projectId,
              externalCampaignId: campaign.id,
              name: campaign.name,
              objective: campaign.objective,
              status: campaign.status,
              effectiveStatus: campaign.effective_status,
              raw: campaign
            })
            .onConflictDoUpdate({
              target: [campaigns.adAccountId, campaigns.externalCampaignId],
              set: {
                projectId: pair.projectId,
                name: campaign.name,
                objective: campaign.objective,
                status: campaign.status,
                effectiveStatus: campaign.effective_status,
                raw: campaign,
                updatedAt: now
              }
            })
            .returning({ id: campaigns.id });
          if (!saved) throw new Error(`Failed to save Meta campaign ${campaign.id}`);
          campaignMap.set(campaign.id, saved.id);
        }

        const adSetMap = new Map<string, string>();
        for await (const adSet of client.paginate<MetaAdSet>(`${account}/adsets`, {
          fields: "id,name,campaign_id,optimization_goal,status,effective_status,updated_time",
          limit: "500"
        })) {
          const campaignId = campaignMap.get(adSet.campaign_id);
          if (!campaignId) continue;
          const [saved] = await db
            .insert(adSets)
            .values({
              workspaceId: pair.workspaceId,
              adAccountId: pair.accountId,
              campaignId,
              externalAdSetId: adSet.id,
              name: adSet.name,
              optimizationGoal: adSet.optimization_goal,
              status: adSet.effective_status ?? adSet.status,
              raw: adSet
            })
            .onConflictDoUpdate({
              target: [adSets.adAccountId, adSets.externalAdSetId],
              set: {
                campaignId,
                name: adSet.name,
                optimizationGoal: adSet.optimization_goal,
                status: adSet.effective_status ?? adSet.status,
                raw: adSet,
                updatedAt: now
              }
            })
            .returning({ id: adSets.id });
          if (!saved) throw new Error(`Failed to save Meta ad set ${adSet.id}`);
          adSetMap.set(adSet.id, saved.id);
        }

        const adMap = new Map<string, { adId: string; assetId: string }>();
        for await (const ad of client.paginate<MetaAd>(`${account}/ads`, {
          fields: "id,name,campaign_id,adset_id,status,effective_status,updated_time,creative{id,thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}",
          limit: "500"
        })) {
          const campaignId = campaignMap.get(ad.campaign_id);
          const adSetId = adSetMap.get(ad.adset_id);
          if (!campaignId || !adSetId) continue;

          const normalizedName = normalizeCreativeName(ad.name);
          const [savedAd] = await db
            .insert(ads)
            .values({
              workspaceId: pair.workspaceId,
              adAccountId: pair.accountId,
              campaignId,
              adSetId,
              externalAdId: ad.id,
              externalCreativeId: ad.creative?.id,
              name: ad.name,
              normalizedCreativeName: normalizedName,
              status: ad.effective_status ?? ad.status,
              raw: ad
            })
            .onConflictDoUpdate({
              target: [ads.adAccountId, ads.externalAdId],
              set: {
                campaignId,
                adSetId,
                externalCreativeId: ad.creative?.id,
                name: ad.name,
                normalizedCreativeName: normalizedName,
                status: ad.effective_status ?? ad.status,
                raw: ad,
                updatedAt: now
              }
            })
            .returning({ id: ads.id });
          if (!savedAd) throw new Error(`Failed to save Meta ad ${ad.id}`);

          const [asset] = await db
            .insert(mediaAssets)
            .values({
              workspaceId: pair.workspaceId,
              projectId: pair.projectId,
              canonicalName: ad.name,
              normalizedName,
              type: inferAssetType(ad.creative),
              externalVideoId: extractVideoId(ad.creative),
              thumbnailUrl: ad.creative?.thumbnail_url ?? ad.creative?.image_url,
              firstSeenAt: now,
              lastSeenAt: now
            })
            .onConflictDoUpdate({
              target: [mediaAssets.projectId, mediaAssets.normalizedName],
              set: {
                canonicalName: ad.name,
                type: inferAssetType(ad.creative),
                externalVideoId: extractVideoId(ad.creative),
                thumbnailUrl: ad.creative?.thumbnail_url ?? ad.creative?.image_url,
                lastSeenAt: now,
                updatedAt: now
              }
            })
            .returning({ id: mediaAssets.id });
          if (!asset) throw new Error(`Failed to save media asset for ad ${ad.id}`);

          await db
            .insert(adMediaAssets)
            .values({ adId: savedAd.id, mediaAssetId: asset.id })
            .onConflictDoNothing();

          adMap.set(ad.id, { adId: savedAd.id, assetId: asset.id });
        }

        let received = 0;
        for await (const insight of client.paginate<MetaInsight>(`${account}/insights`, {
          level: "ad",
          time_increment: "1",
          time_range: JSON.stringify({ since: dateFrom, until: today }),
          fields: INSIGHT_FIELDS,
          limit: "500"
        })) {
          if (!insight.ad_id || !insight.date_start) continue;
          const localAd = adMap.get(insight.ad_id);
          const campaignId = insight.campaign_id ? campaignMap.get(insight.campaign_id) : undefined;
          const adSetId = insight.adset_id ? adSetMap.get(insight.adset_id) : undefined;
          const factKey = [
            pair.projectId,
            pair.accountId,
            insight.date_start,
            insight.ad_id,
            "none",
            "default"
          ].join(":");

          await db
            .insert(dailyInsights)
            .values({
              workspaceId: pair.workspaceId,
              projectId: pair.projectId,
              adAccountId: pair.accountId,
              campaignId,
              adSetId,
              adId: localAd?.adId,
              mediaAssetId: localAd?.assetId,
              insightDate: insight.date_start,
              factKey,
              entityLevel: "ad",
              entityExternalId: insight.ad_id,
              metrics: insightMetrics(insight),
              sourceUpdatedAt: now
            })
            .onConflictDoUpdate({
              target: [dailyInsights.workspaceId, dailyInsights.factKey],
              set: {
                campaignId,
                adSetId,
                adId: localAd?.adId,
                mediaAssetId: localAd?.assetId,
                metrics: insightMetrics(insight),
                sourceUpdatedAt: now,
                updatedAt: now
              }
            });
          received += 1;
        }

        summary.insights += received;
        await db
          .update(adAccounts)
          .set({ lastSuccessfulSyncAt: now, status: "active", updatedAt: now })
          .where(eq(adAccounts.id, pair.accountId));
        await db
          .update(syncRuns)
          .set({
            status: "succeeded",
            finishedAt: new Date(),
            rowsReceived: received,
            rowsUpdated: received,
            metadata: { dateFrom, dateTo: today, account: pair.externalAccountId }
          })
          .where(eq(syncRuns.id, run.id));
      } catch (error) {
        summary.errors += 1;
        const message = error instanceof Error ? error.message : String(error);
        await db.insert(syncErrors).values({
          syncRunId: run.id,
          message,
          retryable: /429|timeout|temporar/i.test(message),
          details: { account: pair.externalAccountId }
        });
        await db
          .update(syncRuns)
          .set({ status: "failed", finishedAt: new Date() })
          .where(eq(syncRuns.id, run.id));
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
