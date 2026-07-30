import { readFileSync, writeFileSync } from "node:fs";

const path = "packages/sync-engine/src/direction-report-by-name.ts";
let source = readFileSync(path, "utf8");

if (source.includes("function funnelFromCampaign")) {
  console.log("JOB funnel column patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`JOB funnel patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
`  displayName: string;
  creativeType: string;
  assetIds: Set<string>;`,
`  displayName: string;
  creativeType: string;
  funnel: string;
  assetIds: Set<string>;`,
"aggregate funnel field"
);

replaceOnce(
`function directionFromCampaign(campaignName: string | null | undefined): string {
  const value = String(campaignName ?? "").trim();
  const first = value.split(/[|\\s—–-]+/u).find(Boolean);
  return (first ?? "OTHER").toLocaleUpperCase("uk-UA");
}`,
`function directionFromCampaign(campaignName: string | null | undefined): string {
  const value = String(campaignName ?? "").trim();
  const first = value.split(/[|\\s—–-]+/u).find(Boolean);
  return (first ?? "OTHER").toLocaleUpperCase("uk-UA");
}

function funnelFromCampaign(campaignName: string | null | undefined): string {
  const value = String(campaignName ?? "").toLocaleUpperCase("uk-UA");
  if (/\\bFORMS?\\b/u.test(value)) return "Лід-форма Meta";
  if (/\\bSITE\\b/u.test(value) || /\\bLEADS?\\b/u.test(value)) {
    return "Лендінг / сайт";
  }
  return "Інше";
}`,
"funnel resolver"
);

replaceOnce(
`  const headerUpdates: Array<{ range: string; values: SheetCell[][] }> = [];`,
`  const funnelColumnRequests: unknown[] = [];
  for (const item of input.directions) {
    const sheetId = titleToId.get(item.tab);
    if (sheetId === undefined) continue;
    const currentHeader = await googleValuesGet(
      input.accessToken,
      input.spreadsheetId,
      \`'\${escapeSheetTitle(item.tab)}'!G1\`
    );
    if (String(currentHeader[0]?.[0] ?? "").trim() === "Воронка") continue;
    funnelColumnRequests.push({
      insertDimension: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 6,
          endIndex: 7
        },
        inheritFromBefore: false
      }
    });
  }
  if (funnelColumnRequests.length > 0) {
    await googleSheetsBatchUpdate(
      input.accessToken,
      input.spreadsheetId,
      funnelColumnRequests
    );
  }

  const headerUpdates: Array<{ range: string; values: SheetCell[][] }> = [];`,
"insert funnel column once"
);

replaceOnce(
`        "Креатив",
        "Назва креативу",
        "Спенд",`,
`        "Креатив",
        "Назва креативу",
        "Воронка",
        "Спенд",`,
"funnel header"
);

replaceOnce("!N2`,", "!O2`,", "manual CPA range");
replaceOnce(
  "IF(M2:M>0,G2:G/M2:M",
  "IF(N2:N>0,H2:H/N2:N",
  "manual CPA formula"
);

source = source.replaceAll("endColumnIndex: 15", "endColumnIndex: 16");

replaceOnce(
`          startIndex: 14,
          endIndex: 15`,
`          startIndex: 15,
          endIndex: 16`,
"comment column width"
);

replaceOnce(
`    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 5,
          endIndex: 6
        },
        properties: { pixelSize: 260 },
        fields: "pixelSize"
      }
    });`,
`    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 5,
          endIndex: 6
        },
        properties: { pixelSize: 260 },
        fields: "pixelSize"
      }
    });
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 6,
          endIndex: 7
        },
        properties: { pixelSize: 150 },
        fields: "pixelSize"
      }
    });`,
"funnel column width"
);

replaceOnce(
`        range: \`'\${escapeSheetTitle(tab)}'!A\${rowNumber}:O\${rowNumber}\`,
        values: [Array.from({ length: 15 }, () => "")]`,
`        range: \`'\${escapeSheetTitle(tab)}'!A\${rowNumber}:P\${rowNumber}\`,
        values: [Array.from({ length: 16 }, () => "")]`,
"stale row clear width"
);

replaceOnce(
`    const identity = normalizeCreativeName(displayName);
    if (!identity) continue;

    const lifecycleKey = \`\${direction}:\${identity}\`;`,
`    const identity = normalizeCreativeName(displayName);
    if (!identity) continue;
    const funnel = direction === "JOB" ? funnelFromCampaign(row.campaignName) : "";
    const groupedIdentity = funnel ? \`\${identity}::\${funnel}\` : identity;

    const lifecycleKey = \`\${direction}:\${groupedIdentity}\`;`,
"group identity by funnel"
);

replaceOnce(
`    const aggregateKey = \`\${direction}:\${identity}:\${weekStart}\`;`,
`    const aggregateKey = \`\${direction}:\${groupedIdentity}:\${weekStart}\`;`,
"weekly aggregate funnel key"
);

replaceOnce(
`      direction,
      identity,
      displayName,
      creativeType: row.assetType ?? "unknown",`,
`      direction,
      identity: groupedIdentity,
      displayName,
      creativeType: row.assetType ?? "unknown",
      funnel,`,
"aggregate funnel value"
);

replaceOnce(
`            aggregate.displayName,
            rounded(aggregate.spend),`,
`            aggregate.displayName,
            aggregate.funnel,
            rounded(aggregate.spend),`,
"output funnel value"
);

replaceOnce(
`      managedColumns: 12,`,
`      managedColumns: 13,`,
"managed columns"
);

replaceOnce(
`      \`=SUM('\${tab}'!G2:G)\`,
      \`=SUM('\${tab}'!J2:J)\`,
      \`=SUM('\${tab}'!M2:M)\`,`,
`      \`=SUM('\${tab}'!H2:H)\`,
      \`=SUM('\${tab}'!K2:K)\`,
      \`=SUM('\${tab}'!N2:N)\`,`,
"dashboard shifted columns"
);

writeFileSync(path, source);
console.log("Applied JOB funnel column and funnel-aware creative grouping");
