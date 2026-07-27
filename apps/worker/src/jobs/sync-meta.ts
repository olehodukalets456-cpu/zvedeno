import { normalizeCreativeName } from "@zvedeno/classification";

export async function runMetaSync(): Promise<void> {
  // Planned flow:
  // 1. Load active project/account connections.
  // 2. Pull Meta Insights in bounded chunks with pagination and retries.
  // 3. Save raw payload metadata, then UPSERT normalized daily facts.
  // 4. Re-fetch the configured lookback window for late attribution.
  // 5. Aggregate creatives by project + normalized ad/creative name.
  const example = normalizeCreativeName("  TT   Buyer  ");
  console.info(JSON.stringify({ job: "sync-meta", status: "scaffold", normalizedName: example }));
}
