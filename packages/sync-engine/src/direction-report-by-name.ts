import { desc, eq } from "drizzle-orm";
import {
  adAccounts,
  ads,
  campaigns,
  createDatabase,
  dailyInsights,
  mediaAssets,
  sheetRowMappings,
  syncErrors,
  syncRuns
} from "@zvedeno/database";
import {
  archiveRemoteImageToDrive,
  ensureGoogleReportTabs,
  googleSheetsBatchUpdate,
  googleValuesAppend,
  googleValuesBatchUpdate,
  parseUpdatedRangeStartRow
} from "./google-client";
import { googleValuesGet } from "./google-values";

type Database = ReturnType<typeof createDatabase>["db"];
type SheetCell = string | number | boolean | null;

type ManagedRow = {
  key: string;
  values: SheetCell[];
};

export type DirectionRule = {
  key: string;
  resultLabel?: string | undefined;
};

export type DirectionReportConfig = {
  resultMetric?: string;
  resultLabel?: string;
  directions?: DirectionRule[];
  manualResultLabel?: string;
};

export type DirectionReportInput = {
  db: Database;
  accessToken: string;
  reportId: string;
  spreadsheetId: string;
  projectId: string;
  projectName: string;
  config: DirectionReportConfig;
};

export type DirectionReportResult = {
  appended: number;
  updated: number;
  directions: number;
};

type CreativeAggregate = {
  direction: string;
  identity: string;
  displayName: string;
  creativeType: string;
  assetIds: Set<string>;
  thumbnailUrl?: string;
  archivedMediaUrl?: string;
  periodStart: string;
  periodEnd: string;
  launchDate: string;
  lastActivityDate: string;
  active: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
};

const LEGACY_TABS = [
  "Weekly Summary",
  "Campaigns",
  "Daily",
  "Creatives",
  "Creative Weekly",
  "Manual Input",
  "Funnel"
];

function numberMetric(metrics: Record<string, string | number | null>, key: string): number {
  const value = metrics[key];
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveResultMetric(
  metrics: Record<string, string | number | null>,
  configured?: string
): string | undefined {
  if (configured && configured in metrics) return configured;
  const preferred = [
    "action.lead",
    "action.offsite_conversion.fb_pixel_lead",
    "action.messaging_conversation_started_7d",
    "action.omni_purchase",
    "action.purchase",
    "action.link_click"
  ];
  return preferred.find((key) => key in metrics)
    ?? Object.keys(metrics).find((key) => key.startsWith("action."));
}

function rounded(value: number | null, digits = 2): number | string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits));
}

function escapeFormula(value: string): string {
  return value.replace(/"/g, '""');
}

function escapeSheetTitle(value: string): string {
  return value.replace(/'/g, "''");
}

function columnName(column: number): string {
  let result = "";
  let value = column;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function directionFromCampaign(campaignName: string | null | undefined): string {
  const value = String(campaignName ?? "").trim();
  const first = value.split(/[|\s—–-]+/u).find(Boolean);
  return (first ?? "OTHER").toLocaleUpperCase("uk-UA");
}

function cleanCreativeName(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeCreativeName(value: string): string {
  return cleanCreativeName(value).toLocaleLowerCase("uk-UA");
}

function stableCreativeKey(direction: string, identity: string): string {
  return `creative:${direction}:${encodeURIComponent(identity)}`;
}

function safeSheetTitle(value: string): string {
  const cleaned = value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "OTHER").slice(0, 90);
}

function normalizeRules(config: DirectionReportConfig, discovered: Set<string>): DirectionRule[] {
  const configured = (config.directions ?? [])
    .map((rule) => ({
      key: String(rule.key ?? "").trim().toLocaleUpperCase("uk-UA"),
      resultLabel: String(rule.resultLabel ?? "").trim() || undefined
    }))
    .filter((rule) => rule.key);

  const source: DirectionRule[] = configured.length > 0
    ? configured
    : Array.from(discovered)
      .sort()
      .map((key) => ({
        key,
        resultLabel: config.manualResultLabel ?? "Фактичний результат"
      }));

  const seen = new Set<string>();
  return source.filter((rule) => {
    if (seen.has(rule.key)) return false;
    seen.add(rule.key);
    return true;
  });
}

async function syncManagedRows(input: {
  db: Database;
  accessToken: string;
  reportId: string;
  spreadsheetId: string;
  tab: string;
  rows: ManagedRow[];
  managedColumns: number;
  clearLegacyDirectionRows?: boolean;
}): Promise<{ appended: number; updated: number }> {
  const {
    db,
    accessToken,
    reportId,
    spreadsheetId,
    tab,
    rows,
    managedColumns,
    clearLegacyDirectionRows = false
  } = input;

  const keyColumn = await googleValuesGet(
    accessToken,
    spreadsheetId,
    `'${escapeSheetTitle(tab)}'!A2:A`
  );
  const liveRows = new Map<string, number>();
  const legacyClearData: Array<{ range: string; values: SheetCell[][] }> = [];

  keyColumn.forEach((row, index) => {
    const key = String(row[0] ?? "").trim();
    if (!key) return;
    const rowNumber = index + 2;
    if (clearLegacyDirectionRows && key.startsWith("direction:")) {
      legacyClearData.push({
        range: `'${escapeSheetTitle(tab)}'!A${rowNumber}:O${rowNumber}`,
        values: [Array.from({ length: 15 }, () => "")]
      });
      return;
    }
    liveRows.set(key, rowNumber);
  });

  for (let index = 0; index < legacyClearData.length; index += 250) {
    await googleValuesBatchUpdate(
      accessToken,
      spreadsheetId,
      legacyClearData.slice(index, index + 250)
    );
  }

  if (rows.length === 0) {
    return { appended: 0, updated: 0 };
  }

  const appendRows: ManagedRow[] = [];
  const updateData: Array<{ range: string; values: SheetCell[][] }> = [];

  for (const row of rows) {
    const rowNumber = liveRows.get(row.key);
    if (rowNumber) {
      updateData.push({
        range: `'${escapeSheetTitle(tab)}'!A${rowNumber}:${columnName(managedColumns)}${rowNumber}`,
        values: [row.values.slice(0, managedColumns)]
      });
      await db
        .insert(sheetRowMappings)
        .values({
          googleReportId: reportId,
          tabName: tab,
          stableRowKey: row.key,
          rowNumber,
          sourceUpdatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [
            sheetRowMappings.googleReportId,
            sheetRowMappings.tabName,
            sheetRowMappings.stableRowKey
          ],
          set: {
            rowNumber,
            sourceUpdatedAt: new Date(),
            updatedAt: new Date()
          }
        });
    } else {
      appendRows.push(row);
    }
  }

  for (let index = 0; index < updateData.length; index += 250) {
    await googleValuesBatchUpdate(
      accessToken,
      spreadsheetId,
      updateData.slice(index, index + 250)
    );
  }

  if (appendRows.length > 0) {
    const result = await googleValuesAppend(
      accessToken,
      spreadsheetId,
      `'${escapeSheetTitle(tab)}'!A2`,
      appendRows.map((row) => row.values)
    );
    const startRow = parseUpdatedRangeStartRow(result.updatedRange);
    if (startRow) {
      for (let index = 0; index < appendRows.length; index += 1) {
        const row = appendRows[index];
        if (!row) continue;
        await db
          .insert(sheetRowMappings)
          .values({
            googleReportId: reportId,
            tabName: tab,
            stableRowKey: row.key,
            rowNumber: startRow + index,
            sourceUpdatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: [
              sheetRowMappings.googleReportId,
              sheetRowMappings.tabName,
              sheetRowMappings.stableRowKey
            ],
            set: {
              rowNumber: startRow + index,
              sourceUpdatedAt: new Date(),
              updatedAt: new Date()
            }
          });
      }
    }
  }

  return { appended: appendRows.length, updated: updateData.length };
}

async function configureSheets(input: {
  accessToken: string;
  spreadsheetId: string;
  directions: Array<{ key: string; tab: string; resultLabel: string }>;
}): Promise<void> {
  const spreadsheet = await ensureGoogleReportTabs(
    input.accessToken,
    input.spreadsheetId,
    ["Dashboard", ...input.directions.map((item) => item.tab), "Sync Status", "Raw Data"]
  );
  const titleToId = new Map<string, number>();
  for (const sheet of spreadsheet.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId !== undefined) titleToId.set(title, sheetId);
  }

  const headerUpdates: Array<{ range: string; values: SheetCell[][] }> = [];
  for (const item of input.directions) {
    headerUpdates.push({
      range: `'${escapeSheetTitle(item.tab)}'!A1`,
      values: [[
        "__key",
        "Період",
        "Запуск",
        "Стоп",
        "Креатив",
        "Назва креативу",
        "Спенд",
        "Покази",
        "Кліки",
        "Meta результат",
        "Ціна Meta результату",
        "Статус",
        item.resultLabel,
        `Ціна за ${item.resultLabel}`,
        "Коментар"
      ]]
    });
    headerUpdates.push({
      range: `'${escapeSheetTitle(item.tab)}'!N2`,
      values: [["=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(M2:M>0,G2:G/M2:M,\"\")))"]]
    });
  }
  headerUpdates.push({
    range: "'Dashboard'!A1:F1",
    values: [[
      "Напрямок",
      "Спенд",
      "Meta результат",
      "Фактичний результат",
      "Фактична ціна",
      "Оновлено"
    ]]
  });
  await googleValuesBatchUpdate(input.accessToken, input.spreadsheetId, headerUpdates);

  const requests: unknown[] = [];
  const hiddenTabs = new Set([...LEGACY_TABS, "Sync Status", "Raw Data"]);
  for (const [title, sheetId] of titleToId) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, hidden: hiddenTabs.has(title) },
        fields: "hidden"
      }
    });
  }

  for (const item of input.directions) {
    const sheetId = titleToId.get(item.tab);
    if (sheetId === undefined) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 15
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.05, green: 0.16, blue: 0.27 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
      }
    });
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 1
        },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser"
      }
    });
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startRowIndex: 1
        },
        properties: { pixelSize: 128 },
        fields: "pixelSize"
      }
    });
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 4,
          endIndex: 5
        },
        properties: { pixelSize: 130 },
        fields: "pixelSize"
      }
    });
    requests.push({
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
          startIndex: 14,
          endIndex: 15
        },
        properties: { pixelSize: 240 },
        fields: "pixelSize"
      }
    });
    requests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: 15
          }
        }
      }
    });
  }

  await googleSheetsBatchUpdate(input.accessToken, input.spreadsheetId, requests);
}

export async function syncDirectionReport(
  input: DirectionReportInput
): Promise<DirectionReportResult> {
  const insightRows = await input.db
    .select({
      factKey: dailyInsights.factKey,
      date: dailyInsights.insightDate,
      metrics: dailyInsights.metrics,
      accountExternalId: adAccounts.externalAccountId,
      campaignExternalId: campaigns.externalCampaignId,
      campaignName: campaigns.name,
      adExternalId: ads.externalAdId,
      adName: ads.name,
      adStatus: ads.status,
      assetId: mediaAssets.id,
      assetName: mediaAssets.canonicalName,
      assetType: mediaAssets.type,
      thumbnailUrl: mediaAssets.thumbnailUrl,
      archivedMediaUrl: mediaAssets.archivedMediaUrl
    })
    .from(dailyInsights)
    .innerJoin(adAccounts, eq(dailyInsights.adAccountId, adAccounts.id))
    .leftJoin(campaigns, eq(dailyInsights.campaignId, campaigns.id))
    .leftJoin(ads, eq(dailyInsights.adId, ads.id))
    .leftJoin(mediaAssets, eq(dailyInsights.mediaAssetId, mediaAssets.id))
    .where(eq(dailyInsights.projectId, input.projectId));

  const discovered = new Set<string>();
  for (const row of insightRows) {
    discovered.add(directionFromCampaign(row.campaignName));
  }
  const rules = normalizeRules(input.config, discovered);
  const allowed = new Set(rules.map((rule) => rule.key));
  const directions = rules.map((rule) => ({
    key: rule.key,
    tab: safeSheetTitle(rule.key),
    resultLabel: rule.resultLabel
      ?? input.config.manualResultLabel
      ?? "Фактичний результат"
  }));

  await configureSheets({
    accessToken: input.accessToken,
    spreadsheetId: input.spreadsheetId,
    directions
  });

  const aggregates = new Map<string, CreativeAggregate>();
  const rawRows: ManagedRow[] = [];

  for (const row of insightRows) {
    const direction = directionFromCampaign(row.campaignName);
    if (!allowed.has(direction)) continue;

    const displayName = cleanCreativeName(row.assetName ?? row.adName);
    if (!displayName) continue;
    const identity = normalizeCreativeName(displayName);
    if (!identity) continue;

    const aggregateKey = `${direction}:${identity}`;
    const metrics = row.metrics as Record<string, string | number | null>;
    const resultMetric = resolveResultMetric(metrics, input.config.resultMetric);
    const current = aggregates.get(aggregateKey) ?? {
      direction,
      identity,
      displayName,
      creativeType: row.assetType ?? "unknown",
      assetIds: new Set<string>(),
      thumbnailUrl: row.thumbnailUrl ?? undefined,
      archivedMediaUrl: row.archivedMediaUrl ?? undefined,
      periodStart: row.date,
      periodEnd: row.date,
      launchDate: row.date,
      lastActivityDate: row.date,
      active: false,
      spend: 0,
      impressions: 0,
      clicks: 0,
      results: 0
    } satisfies CreativeAggregate;

    if (row.assetId) current.assetIds.add(row.assetId);
    if (row.date < current.periodStart) current.periodStart = row.date;
    if (row.date > current.periodEnd) current.periodEnd = row.date;
    if (row.date < current.launchDate) current.launchDate = row.date;
    if (row.date > current.lastActivityDate) current.lastActivityDate = row.date;
    current.active = current.active
      || String(row.adStatus ?? "").toUpperCase() === "ACTIVE";
    if (!current.archivedMediaUrl && row.archivedMediaUrl) {
      current.archivedMediaUrl = row.archivedMediaUrl;
    }
    if (!current.thumbnailUrl && row.thumbnailUrl) {
      current.thumbnailUrl = row.thumbnailUrl;
    }
    current.spend += numberMetric(metrics, "spend");
    current.impressions += numberMetric(metrics, "impressions");
    current.clicks += numberMetric(metrics, "clicks");
    if (resultMetric) {
      current.results += numberMetric(metrics, resultMetric);
    }
    aggregates.set(aggregateKey, current);

    rawRows.push({
      key: row.factKey,
      values: [
        row.factKey,
        row.date,
        row.accountExternalId,
        row.campaignExternalId ?? "",
        row.adExternalId ?? "",
        row.assetId ?? "",
        direction,
        identity,
        JSON.stringify(metrics)
      ]
    });
  }

  let archivedCount = 0;
  for (const aggregate of aggregates.values()) {
    if (
      archivedCount >= 25
      || aggregate.archivedMediaUrl
      || !aggregate.thumbnailUrl
    ) {
      continue;
    }
    try {
      const archivedUrl = await archiveRemoteImageToDrive(
        input.accessToken,
        aggregate.thumbnailUrl,
        `${input.projectName}-${aggregate.direction}-${aggregate.displayName}`
      );
      aggregate.archivedMediaUrl = archivedUrl;
      for (const assetId of aggregate.assetIds) {
        await input.db
          .update(mediaAssets)
          .set({ archivedMediaUrl: archivedUrl, updatedAt: new Date() })
          .where(eq(mediaAssets.id, assetId));
      }
      archivedCount += 1;
    } catch (error) {
      console.warn(
        "Creative preview archive failed",
        aggregate.direction,
        aggregate.displayName,
        error
      );
    }
  }

  let appended = 0;
  let updated = 0;
  for (const direction of directions) {
    const rows = Array.from(aggregates.values())
      .filter((aggregate) => aggregate.direction === direction.key)
      .sort((a, b) => b.spend - a.spend || a.displayName.localeCompare(b.displayName))
      .map((aggregate): ManagedRow => {
        const key = stableCreativeKey(direction.key, aggregate.identity);
        const previewUrl = aggregate.archivedMediaUrl ?? aggregate.thumbnailUrl;
        const preview = previewUrl
          ? `=IFERROR(IMAGE("${escapeFormula(previewUrl)}",4,120,120),"")`
          : "";
        const metaCpa = aggregate.results > 0
          ? aggregate.spend / aggregate.results
          : null;

        return {
          key,
          values: [
            key,
            `${aggregate.periodStart} — ${aggregate.periodEnd}`,
            aggregate.launchDate,
            aggregate.active ? "" : aggregate.lastActivityDate,
            preview,
            aggregate.displayName,
            rounded(aggregate.spend),
            aggregate.impressions,
            aggregate.clicks,
            aggregate.results,
            rounded(metaCpa),
            aggregate.active ? "Активний" : "Зупинено"
          ]
        };
      });

    const result = await syncManagedRows({
      db: input.db,
      accessToken: input.accessToken,
      reportId: input.reportId,
      spreadsheetId: input.spreadsheetId,
      tab: direction.tab,
      rows,
      managedColumns: 12,
      clearLegacyDirectionRows: true
    });
    appended += result.appended;
    updated += result.updated;
  }

  const rawResult = await syncManagedRows({
    db: input.db,
    accessToken: input.accessToken,
    reportId: input.reportId,
    spreadsheetId: input.spreadsheetId,
    tab: "Raw Data",
    rows: rawRows,
    managedColumns: 9
  });
  appended += rawResult.appended;
  updated += rawResult.updated;

  const dashboardRows: SheetCell[][] = directions.map((direction, index) => {
    const row = index + 2;
    const tab = escapeSheetTitle(direction.tab);
    return [
      direction.key,
      `=SUM('${tab}'!G2:G)`,
      `=SUM('${tab}'!J2:J)`,
      `=SUM('${tab}'!M2:M)`,
      `=IF(D${row}>0,B${row}/D${row},"")`,
      new Date().toISOString()
    ];
  });
  if (dashboardRows.length > 0) {
    await googleValuesBatchUpdate(input.accessToken, input.spreadsheetId, [
      { range: "'Dashboard'!A2:F100", values: dashboardRows }
    ]);
  }

  const latestRuns = await input.db
    .select({
      account: adAccounts.name,
      status: syncRuns.status,
      finishedAt: syncRuns.finishedAt,
      rows: syncRuns.rowsReceived,
      runId: syncRuns.id
    })
    .from(syncRuns)
    .leftJoin(adAccounts, eq(syncRuns.adAccountId, adAccounts.id))
    .where(eq(syncRuns.projectId, input.projectId))
    .orderBy(desc(syncRuns.createdAt))
    .limit(20);

  const statusValues: SheetCell[][] = [];
  for (const run of latestRuns) {
    const [error] = await input.db
      .select({ message: syncErrors.message })
      .from(syncErrors)
      .where(eq(syncErrors.syncRunId, run.runId))
      .limit(1);
    statusValues.push([
      run.account ?? "Project",
      run.status,
      run.finishedAt?.toISOString() ?? "—",
      run.rows,
      error?.message ?? ""
    ]);
  }
  if (statusValues.length > 0) {
    await googleValuesBatchUpdate(input.accessToken, input.spreadsheetId, [
      { range: "'Sync Status'!A2:E100", values: statusValues }
    ]);
  }

  return { appended, updated, directions: directions.length };
}
