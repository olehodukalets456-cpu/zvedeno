export async function runSheetsSync(): Promise<void> {
  // Planned flow:
  // 1. Read changed database rows since the last successful export cursor.
  // 2. Append new rows and update changed rows using stable hidden row keys.
  // 3. Never clear report sheets and never overwrite manual columns.
  // 4. Recalculate dashboard, creative and funnel views.
  console.info(JSON.stringify({ job: "sync-sheets", status: "scaffold" }));
}
