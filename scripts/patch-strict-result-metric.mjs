import { readFileSync, writeFileSync } from "node:fs";

const files = [
  "packages/sync-engine/src/direction-report-by-name.ts",
  "packages/sync-engine/src/weekly-creative-snapshots.ts",
  "packages/sync-engine/src/sheets-sync.ts"
];

const looseResolver = "if (configured && configured in metrics) return configured;";
const strictResolver = "if (configured) return configured;";

for (const path of files) {
  let source = readFileSync(path, "utf8");

  if (source.includes(strictResolver) && !source.includes(looseResolver)) {
    console.log(`Strict result metric already applied: ${path}`);
    continue;
  }

  if (!source.includes(looseResolver)) {
    throw new Error(`Could not find result metric resolver in ${path}`);
  }

  source = source.replaceAll(looseResolver, strictResolver);
  writeFileSync(path, source);
  console.log(`Applied strict configured result metric: ${path}`);
}
