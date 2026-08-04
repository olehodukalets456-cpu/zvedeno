import { execSync } from "node:child_process";

function run(command) {
  execSync(command, { stdio: "inherit", shell: "/bin/bash" });
}

run("node scripts/patch-weekly-report.mjs");
run("node scripts/patch-confusable-direction-tabs.mjs");
run("node scripts/patch-strict-result-metric.mjs");
run("node scripts/patch-job-funnel-column.mjs");
run("node scripts/patch-report-date-format.mjs");
run("node scripts/patch-analytics-linked-account-filter.mjs");
run("node scripts/patch-keitaro-offers-ui.mjs");
run("node scripts/patch-analytics-stable-grid.mjs");
run("node scripts/patch-project-ai-module-paths.mjs");
run("node scripts/patch-project-ai-deep-context.mjs");
run("node scripts/patch-project-scoped-analytics.mjs");
run("node scripts/patch-project-ai-dashboard.mjs");
run("node scripts/patch-adaptive-report-types.mjs");
run("node scripts/patch-meta-complete-metrics.mjs");
run("npx -y pnpm@9.15.9 --filter @zvedeno/database exec drizzle-kit push --force");
run("npx -y pnpm@9.15.9 --filter @zvedeno/web build");
