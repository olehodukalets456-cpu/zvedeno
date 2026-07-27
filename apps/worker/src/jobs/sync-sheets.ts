import { syncGoogleReports } from "@zvedeno/sync-engine";

export async function runSheetsSync(): Promise<void> {
  const summary = await syncGoogleReports();
  console.info(JSON.stringify({ job: "sync-sheets", status: summary.errors > 0 ? "partial" : "ok", ...summary }));
}
