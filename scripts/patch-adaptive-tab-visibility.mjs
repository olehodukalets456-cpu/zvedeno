import fs from "node:fs";

const file = "packages/sync-engine/src/adaptive-report-sync.ts";
let text = fs.readFileSync(file, "utf8");
const before = "  const requests: unknown[] = [];\n  for (const [title, values] of valuesByTab) {";
const after = `  const requests: unknown[] = [];
  const activeTitles = new Set(valuesByTab.keys());
  for (const sheet of metadata.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (!title || sheetId === undefined) continue;
    requests.push({ updateSheetProperties: { properties: { sheetId, hidden: !activeTitles.has(title) }, fields: "hidden" } });
  }
  for (const [title, values] of valuesByTab) {`;
if (!text.includes(before)) throw new Error("Adaptive tab request marker missing");
text = text.replace(before, after);
fs.writeFileSync(file, text);
console.log("Applied adaptive tab visibility patch");
