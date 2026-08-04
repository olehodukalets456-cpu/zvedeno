import fs from "node:fs";

const path = "packages/sync-engine/src/adaptive-report-sync.ts";
let source = fs.readFileSync(path, "utf8");

const typeMarker = "type MetricBag = Record<string, string | number | boolean | null>;\n";
if (!source.includes(typeMarker)) throw new Error("Adaptive metric type marker not found");
source = source.replace(typeMarker, `${typeMarker}\ntype SpreadsheetWithCharts = Omit<GoogleSpreadsheet, "sheets"> & {\n  sheets?: Array<{\n    properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } };\n    charts?: Array<{ chartId?: number }>;\n  }>;\n};\n`);

const oldSignature = `async function spreadsheetWithCharts(accessToken: string, spreadsheetId: string): Promise<GoogleSpreadsheet & {\n  sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } }; charts?: Array<{ chartId?: number }> }>;\n}> {`;
if (!source.includes(oldSignature)) throw new Error("Adaptive spreadsheet metadata signature not found");
source = source.replace(oldSignature, "async function spreadsheetWithCharts(accessToken: string, spreadsheetId: string): Promise<SpreadsheetWithCharts> {");

const oldCast = `  const payload = await response.json() as GoogleSpreadsheet & {\n    sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } }; charts?: Array<{ chartId?: number }> }>;\n  };`;
if (!source.includes(oldCast)) throw new Error("Adaptive spreadsheet metadata cast not found");
source = source.replace(oldCast, "  const payload = await response.json() as SpreadsheetWithCharts;");

fs.writeFileSync(path, source);
console.log("Applied adaptive report type patch");
