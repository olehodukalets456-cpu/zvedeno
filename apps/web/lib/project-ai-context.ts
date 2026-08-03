import { eq } from "drizzle-orm";
import {
  ads,
  adSets,
  campaigns,
  createDatabase,
  mediaAssets
} from "@zvedeno/database";

type JsonRecord = Record<string, unknown>;

export type DeepProjectContext = {
  campaigns: Array<Record<string, unknown>>;
  adSets: Array<Record<string, unknown>>;
  ads: Array<Record<string, unknown>>;
  creatives: Array<Record<string, unknown>>;
  truncated: {
    campaignFields: number;
    adSetFields: number;
    adFields: number;
  };
};

function flattenRaw(value: unknown, prefix = "", output: string[] = [], limit = 180): string[] {
  if (output.length >= limit || value === null || value === undefined) return output;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (text) output.push(`${prefix || "value"}=${text.slice(0, 1800)}`);
    return output;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && output.length < limit; index += 1) {
      flattenRaw(value[index], `${prefix}[${index}]`, output, limit);
    }
    return output;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      if (output.length >= limit) break;
      const path = prefix ? `${prefix}.${key}` : key;
      flattenRaw(nested, path, output, limit);
    }
  }
  return output;
}

function rawContext(raw: JsonRecord | null | undefined, limit = 180) {
  const all = flattenRaw(raw ?? {}, "", [], limit + 1);
  return {
    fields: all.slice(0, limit),
    truncated: Math.max(0, all.length - limit)
  };
}

export async function loadDeepProjectContext(projectId: string): Promise<DeepProjectContext> {
  const { db, pool } = createDatabase();
  try {
    const campaignRows = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        objective: campaigns.objective,
        status: campaigns.status,
        effectiveStatus: campaigns.effectiveStatus,
        raw: campaigns.raw
      })
      .from(campaigns)
      .where(eq(campaigns.projectId, projectId));

    const adSetRows = await db
      .select({
        id: adSets.id,
        campaignId: adSets.campaignId,
        name: adSets.name,
        optimizationGoal: adSets.optimizationGoal,
        status: adSets.status,
        raw: adSets.raw
      })
      .from(adSets)
      .innerJoin(campaigns, eq(adSets.campaignId, campaigns.id))
      .where(eq(campaigns.projectId, projectId));

    const adRows = await db
      .select({
        id: ads.id,
        campaignId: ads.campaignId,
        adSetId: ads.adSetId,
        name: ads.name,
        normalizedCreativeName: ads.normalizedCreativeName,
        externalCreativeId: ads.externalCreativeId,
        status: ads.status,
        raw: ads.raw
      })
      .from(ads)
      .innerJoin(campaigns, eq(ads.campaignId, campaigns.id))
      .where(eq(campaigns.projectId, projectId));

    const creativeRows = await db
      .select({
        id: mediaAssets.id,
        name: mediaAssets.canonicalName,
        normalizedName: mediaAssets.normalizedName,
        type: mediaAssets.type,
        width: mediaAssets.width,
        height: mediaAssets.height,
        durationSeconds: mediaAssets.durationSeconds,
        externalVideoId: mediaAssets.externalVideoId,
        contentFingerprint: mediaAssets.contentFingerprint,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        archivedMediaUrl: mediaAssets.archivedMediaUrl,
        firstSeenAt: mediaAssets.firstSeenAt,
        lastSeenAt: mediaAssets.lastSeenAt,
        conflictDetected: mediaAssets.conflictDetected
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.projectId, projectId));

    let campaignFields = 0;
    let adSetFields = 0;
    let adFields = 0;

    return {
      campaigns: campaignRows.map((row) => {
        const context = rawContext(row.raw);
        campaignFields += context.truncated;
        return { ...row, raw: undefined, rawFields: context.fields };
      }),
      adSets: adSetRows.map((row) => {
        const context = rawContext(row.raw);
        adSetFields += context.truncated;
        return { ...row, raw: undefined, rawFields: context.fields };
      }),
      ads: adRows.map((row) => {
        const context = rawContext(row.raw);
        adFields += context.truncated;
        return { ...row, raw: undefined, rawFields: context.fields };
      }),
      creatives: creativeRows,
      truncated: { campaignFields, adSetFields, adFields }
    };
  } finally {
    await pool.end();
  }
}
