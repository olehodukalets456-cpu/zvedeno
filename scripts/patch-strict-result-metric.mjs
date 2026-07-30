import { readFileSync, writeFileSync } from "node:fs";

const path = "packages/sync-engine/src/direction-report-by-name.ts";
const looseResolver = "if (configured && configured in metrics) return configured;";
const strictResolver = "if (configured) return configured;";

let source = readFileSync(path, "utf8");

if (source.includes(strictResolver) && !source.includes(looseResolver)) {
  console.log(`Strict result metric already applied: ${path}`);
} else {
  if (!source.includes(looseResolver)) {
    throw new Error(`Could not find result metric resolver in ${path}`);
  }

  source = source.replaceAll(looseResolver, strictResolver);
  writeFileSync(path, source);
  console.log(`Applied strict configured result metric: ${path}`);
}
