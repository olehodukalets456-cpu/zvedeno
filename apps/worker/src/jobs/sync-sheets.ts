import { syncGoogleReports, syncManualWeeklyReports } from "@zvedeno/sync-engine";

export async function runSheetsSync(): Promise<void> {
  const base = await syncGoogleReports();
  const weekly = await syncManualWeeklyReports();
  console.info(JSON.stringify({
    job: "sync-sheets",
    status: base.errors + weekly.errors > 0 ? "partial" : "ok",
    base,
    weekly
  }));
}
