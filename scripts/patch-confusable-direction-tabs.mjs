import { readFileSync, writeFileSync } from "node:fs";

const path = "packages/sync-engine/src/direction-report-by-name.ts";
let source = readFileSync(path, "utf8");

if (source.includes("const duplicateDirectionTab =")) {
  console.log("Confusable direction tab patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Confusable tab patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
  `async function configureSheets(input: {`,
  `function confusableTabKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("uk-UA")
    .replace(/О/g, "O")
    .replace(/В/g, "B")
    .replace(/А/g, "A")
    .replace(/С/g, "C")
    .replace(/Е/g, "E")
    .replace(/Н/g, "H")
    .replace(/К/g, "K")
    .replace(/М/g, "M")
    .replace(/Р/g, "P")
    .replace(/Т/g, "T")
    .replace(/Х/g, "X")
    .replace(/І/g, "I");
}

async function configureSheets(input: {`,
  "confusable tab key helper"
);

replaceOnce(
  `  const requests: unknown[] = [];
  const hiddenTabs = new Set([...LEGACY_TABS, "Sync Status", "Raw Data"]);
  for (const [title, sheetId] of titleToId) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, hidden: hiddenTabs.has(title) },`,
  `  const requests: unknown[] = [];
  const hiddenTabs = new Set([...LEGACY_TABS, "Sync Status", "Raw Data"]);
  const configuredTabs = new Set(input.directions.map((item) => item.tab));
  const configuredSkeletons = new Set(
    input.directions.map((item) => confusableTabKey(item.tab))
  );
  for (const [title, sheetId] of titleToId) {
    const duplicateDirectionTab = !configuredTabs.has(title)
      && configuredSkeletons.has(confusableTabKey(title));
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          hidden: hiddenTabs.has(title) || duplicateDirectionTab
        },`,
  "hide confusable duplicate direction tabs"
);

writeFileSync(path, source);
console.log("Applied confusable direction tab cleanup");
