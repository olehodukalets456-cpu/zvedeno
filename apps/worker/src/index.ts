import { runMetaSync } from "./jobs/sync-meta";
import { runSheetsSync } from "./jobs/sync-sheets";

const job = process.argv[2] ?? "health";

async function main(): Promise<void> {
  if (job === "sync-meta") {
    await runMetaSync();
    return;
  }

  if (job === "sync-sheets") {
    await runSheetsSync();
    return;
  }

  console.info(JSON.stringify({ service: "zvedeno-worker", status: "ok", job }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
