import fs from "node:fs";

const path = "packages/sync-engine/src/adaptive-report-sync.ts";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  ["function weekStartfunction weekStart", "function weekStart"],
  ["function previewFormulafunction previewFormula", "function previewFormula"],
  ["function funnelValuesfunction funnelValues", "function funnelValues"]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`Duplicated adaptive function marker not found: ${from}`);
  source = source.replace(from, to);
}

fs.writeFileSync(path, source);
console.log("Fixed adaptive dynamic metric function markers");
