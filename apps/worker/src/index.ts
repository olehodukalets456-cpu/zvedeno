import { runMetaSync } from "./jobs/sync-meta";
import { runSheetsSync } from "./jobs/sync-sheets";

const job = process.argv[2] ?? "scheduler";

async function runCycle(): Promise<void> {
  await runMetaSync();
  await runSheetsSync();
}

async function runScheduler(): Promise<void> {
  const minutes = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES ?? 60));
  const intervalMs = minutes * 60 * 1000;
  let running = false;

  const execute = async () => {
    if (running) {
      console.warn(JSON.stringify({ job: "scheduler", status: "skipped", reason: "previous cycle is still running" }));
      return;
    }
    running = true;
    try {
      await runCycle();
    } catch (error) {
      console.error("Scheduled synchronization failed", error);
    } finally {
      running = false;
    }
  };

  console.info(JSON.stringify({ service: "zvedeno-worker", status: "running", job: "scheduler", intervalMinutes: minutes }));
  await execute();
  setInterval(() => void execute(), intervalMs);
}

async function main(): Promise<void> {
  if (job === "sync-meta") {
    await runMetaSync();
    return;
  }

  if (job === "sync-sheets") {
    await runSheetsSync();
    return;
  }

  if (job === "sync-all") {
    await runCycle();
    return;
  }

  if (job === "scheduler") {
    await runScheduler();
    return;
  }

  console.info(JSON.stringify({ service: "zvedeno-worker", status: "ok", job }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
