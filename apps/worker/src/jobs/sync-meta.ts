import { syncMetaData } from "@zvedeno/sync-engine";

export async function runMetaSync(): Promise<void> {
  const summary = await syncMetaData();
  console.info(JSON.stringify({ job: "sync-meta", status: summary.errors > 0 ? "partial" : "ok", ...summary }));
}
