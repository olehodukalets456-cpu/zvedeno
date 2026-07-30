import { readFileSync, writeFileSync } from "node:fs";

const path = "packages/sync-engine/src/direction-report-by-name.ts";
let source = readFileSync(path, "utf8");

if (source.includes('numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" }')) {
  console.log("Report date formatting patch already applied");
  process.exit(0);
}

const marker = `    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: 1
        },
        properties: { pixelSize: 128 },
        fields: "pixelSize"
      }
    });`;

if (!source.includes(marker)) {
  throw new Error("Report date formatting patch failed: row-height marker not found");
}

const replacement = `${marker}
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 2,
          endColumnIndex: 4
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    });`;

source = source.replace(marker, replacement);
writeFileSync(path, source);
console.log("Applied date formatting to Launch and Stop columns");
