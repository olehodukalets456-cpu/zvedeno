import { and, asc, eq } from "drizzle-orm";
import {
  creativeWeeklySnapshots,
  manualMetricDefinitions,
  manualMetricValues,
  mediaAssets,
  sheetRowMappings
} from "@zvedeno/database";
import { googleValuesAppend, googleValuesBatchUpdate, parseUpdatedRangeStartRow } from "./google-client";
import { googleValuesGet } from "./google-values";

export type SheetCell = string | number | boolean | null;

type ManagedRow = {
  key: string;
  values: SheetCell[];
};

type Database = Parameters<typeof import("@zvedeno/database").createDatabase>[0] extends never
  ? never
  : ReturnType<typeof import("@zvedeno/database").createDatabase>["db"];

type ManualDefinition = {
  id: string;
  key: string;
  label: string;
  scope: "project" | "campaign" | "creative";
  period: "day" | "week" | "month" | "lifetime";
  conversionBaseMetric: string | null;
  includeConversionRate: boolean;
  includeCostPerValue: boolean;
};

type WeeklySnapshot = {
  id: string;
  mediaAssetId: string;
  weekStart: string;
  weekEnd: string;
  accountNames: string[];
  metrics: Record<string, string | number | null>;
  creativeName: string;
  creativeType: string;
  thumbnailUrl: string | null;
};

type ManualValue = {
  definitionId: string;
  entityKey: string;
  periodStart: string;
  periodEnd: string;
  value: string;
  note: string | null;
};

export type ManualWeeklySyncInput = {
  db: Database;
  accessToken: string;
  reportId: string;
  spreadsheetId: string;
  workspaceId: string;
  projectId: string;
};

export type ManualWeeklySyncResult = {
  appended: number;
  updated: number;
  importedManualValues: number;
};

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

function rounded(value: number | null, digits = 2): number | string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits));
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeFormula(value: string): string {
  return value.replace(/"/g, '""');
}

function manualKey(definitionId: string, entityKey: string, periodStart: string, periodEnd: string): string {
  return `manual:${definitionId}:${entityKey}:${periodStart}:${periodEnd}`;
}

function parseManualKey(value: string): {
  definitionId: string;
  entityKey: string;
  periodStart: string;
  periodEnd: string;
} | null {
  const match = value.match(/^manual:([^:]+):([^:]+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return null;
  return { definitionId: match[1], entityKey: match[2], periodStart: match[3], periodEnd: match[4] };
}

async function syncManagedRows(input: {
  db: Database;
  accessToken: string;
  reportId: string;
  spreadsheetId: string;
  tab: string;
  rows: ManagedRow[];
  managedColumns: number;
}): Promise<{ appended: number; updated: number }> {
  const { db, accessToken, reportId, spreadsheetId, tab, rows, managedColumns } = input;
  if (rows.length === 0) return { appended: 0, updated: 0 };

  const keyColumn = await googleValuesGet(accessToken, spreadsheetId, `'${tab}'!A2:A`);
  const liveRows = new Map<string, number>();
  keyColumn.forEach((row, index) => {
    const key = String(row[0] ?? "").trim();
    if (key) liveRows.set(key, index + 2);
  });

  const appendRows: ManagedRow[] = [];
  const updateData: Array<{ range: string; values: SheetCell[][] }> = [];

  for (const row of rows) {
    const rowNumber = liveRows.get(row.key);
    if (rowNumber) {
      updateData.push({
        range: `'${tab}'!A${rowNumber}:${columnName(managedColumns)}${rowNumber}`,
        values: [row.values.slice(0, managedColumns)]
      });
      await db
        .insert(sheetRowMappings)
        .values({ googleReportId: reportId, tabName: tab, stableRowKey: row.key, rowNumber, sourceUpdatedAt: new Date() })
        .onConflictDoUpdate({
          target: [sheetRowMappings.googleReportId, sheetRowMappings.tabName, sheetRowMappings.stableRowKey],
          set: { rowNumber, sourceUpdatedAt: new Date(), updatedAt: new Date() }
        });
    } else {
      appendRows.push(row);
    }
  }

  for (let index = 0; index < updateData.length; index += 250) {
    await googleValuesBatchUpdate(accessToken, spreadsheetId, updateData.slice(index, index + 250));
  }

  if (appendRows.length > 0) {
    const result = await googleValuesAppend(
      accessToken,
      spreadsheetId,
      `'${tab}'!A2`,
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
            target: [sheetRowMappings.googleReportId, sheetRowMappings.tabName, sheetRowMappings.stableRowKey],
            set: { rowNumber: startRow + index, sourceUpdatedAt: new Date(), updatedAt: new Date() }
          });
      }
    }
  }

  return { appended: appendRows.length, updated: updateData.length };
}

async function importManualValuesFromSheet(input: {
  db: Database;
  accessToken: string;
  spreadsheetId: string;
  workspaceId: string;
  projectId: string;
  validDefinitionIds: Set<string>;
}): Promise<number> {
  const rows = await googleValuesGet(input.accessToken, input.spreadsheetId, "'Manual Input'!A2:H");
  let imported = 0;

  for (const row of rows) {
    const parsedKey = parseManualKey(String(row[0] ?? ""));
    if (!parsedKey || !input.validDefinitionIds.has(parsedKey.definitionId)) continue;
    const numericValue = Number(row[6]);
    if (!Number.isFinite(numericValue)) continue;
    const note = String(row[7] ?? "").trim();

    await input.db
      .insert(manualMetricValues)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        definitionId: parsedKey.definitionId,
        entityKey: parsedKey.entityKey,
        periodStart: parsedKey.periodStart,
        periodEnd: parsedKey.periodEnd,
        value: String(numericValue),
        note: note || null,
        source: "google_sheets"
      })
      .onConflictDoUpdate({
        target: [
          manualMetricValues.definitionId,
          manualMetricValues.entityKey,
          manualMetricValues.periodStart,
          manualMetricValues.periodEnd
        ],
        set: {
          value: String(numericValue),
          note: note || null,
          source: "google_sheets",
          updatedAt: new Date()
        }
      });
    imported += 1;
  }

  return imported;
}

function valueKey(definitionId: string, entityKey: string, periodStart: string, periodEnd: string): string {
  return `${definitionId}:${entityKey}:${periodStart}:${periodEnd}`;
}

function conversionBase(snapshot: WeeklySnapshot, definition: ManualDefinition): number {
  const metric = definition.conversionBaseMetric ?? "result";
  if (metric === "result" || metric === "results") return numberValue(snapshot.metrics.results);
  return numberValue(snapshot.metrics[metric]);
}

export async function syncManualAndWeeklySheets(input: ManualWeeklySyncInput): Promise<ManualWeeklySyncResult> {
  const definitions = await input.db
    .select({
      id: manualMetricDefinitions.id,
      key: manualMetricDefinitions.key,
      label: manualMetricDefinitions.label,
      scope: manualMetricDefinitions.scope,
      period: manualMetricDefinitions.period,
      conversionBaseMetric: manualMetricDefinitions.conversionBaseMetric,
      includeConversionRate: manualMetricDefinitions.includeConversionRate,
      includeCostPerValue: manualMetricDefinitions.includeCostPerValue
    })
    .from(manualMetricDefinitions)
    .where(and(
      eq(manualMetricDefinitions.projectId, input.projectId),
      eq(manualMetricDefinitions.enabled, true)
    ))
    .orderBy(asc(manualMetricDefinitions.sortOrder), asc(manualMetricDefinitions.label)) as ManualDefinition[];

  const validDefinitionIds = new Set(definitions.map((definition) => definition.id));
  const importedManualValues = await importManualValuesFromSheet({
    db: input.db,
    accessToken: input.accessToken,
    spreadsheetId: input.spreadsheetId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    validDefinitionIds
  });

  const snapshots = await input.db
    .select({
      id: creativeWeeklySnapshots.id,
      mediaAssetId: creativeWeeklySnapshots.mediaAssetId,
      weekStart: creativeWeeklySnapshots.weekStart,
      weekEnd: creativeWeeklySnapshots.weekEnd,
      accountNames: creativeWeeklySnapshots.accountNames,
      metrics: creativeWeeklySnapshots.metrics,
      creativeName: mediaAssets.canonicalName,
      creativeType: mediaAssets.type,
      thumbnailUrl: mediaAssets.thumbnailUrl
    })
    .from(creativeWeeklySnapshots)
    .innerJoin(mediaAssets, eq(creativeWeeklySnapshots.mediaAssetId, mediaAssets.id))
    .where(eq(creativeWeeklySnapshots.projectId, input.projectId))
    .orderBy(asc(creativeWeeklySnapshots.weekStart), asc(mediaAssets.canonicalName)) as WeeklySnapshot[];

  const storedValues = await input.db
    .select({
      definitionId: manualMetricValues.definitionId,
      entityKey: manualMetricValues.entityKey,
      periodStart: manualMetricValues.periodStart,
      periodEnd: manualMetricValues.periodEnd,
      value: manualMetricValues.value,
      note: manualMetricValues.note
    })
    .from(manualMetricValues)
    .where(eq(manualMetricValues.projectId, input.projectId)) as ManualValue[];
  const values = new Map(storedValues.map((item) => [
    valueKey(item.definitionId, item.entityKey, item.periodStart, item.periodEnd),
    item
  ]));

  const weeks = new Map<string, { weekStart: string; weekEnd: string; snapshots: WeeklySnapshot[] }>();
  for (const snapshot of snapshots) {
    const current = weeks.get(snapshot.weekStart) ?? {
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      snapshots: []
    };
    current.snapshots.push(snapshot);
    weeks.set(snapshot.weekStart, current);
  }

  const manualRows: ManagedRow[] = [];
  for (const definition of definitions.filter((item) => item.period === "week")) {
    if (definition.scope === "project") {
      for (const week of weeks.values()) {
        const key = manualKey(definition.id, "project", week.weekStart, week.weekEnd);
        const stored = values.get(valueKey(definition.id, "project", week.weekStart, week.weekEnd));
        manualRows.push({
          key,
          values: [key, week.weekStart, week.weekEnd, "Project", "Project total", definition.label, stored ? numberValue(stored.value) : "", stored?.note ?? ""]
        });
      }
    }
    if (definition.scope === "creative") {
      for (const snapshot of snapshots) {
        const key = manualKey(definition.id, snapshot.mediaAssetId, snapshot.weekStart, snapshot.weekEnd);
        const stored = values.get(valueKey(definition.id, snapshot.mediaAssetId, snapshot.weekStart, snapshot.weekEnd));
        manualRows.push({
          key,
          values: [key, snapshot.weekStart, snapshot.weekEnd, "Creative", snapshot.creativeName, definition.label, stored ? numberValue(stored.value) : "", stored?.note ?? ""]
        });
      }
    }
  }

  const manualResult = await syncManagedRows({
    db: input.db,
    accessToken: input.accessToken,
    reportId: input.reportId,
    spreadsheetId: input.spreadsheetId,
    tab: "Manual Input",
    rows: manualRows,
    managedColumns: 6
  });

  const projectDefinitions = definitions.filter((item) => item.scope === "project" && item.period === "week");
  const weeklySummaryRows: ManagedRow[] = [];
  for (const week of weeks.values()) {
    const aggregate = week.snapshots.reduce((total, snapshot) => ({
      spend: total.spend + numberValue(snapshot.metrics.spend),
      impressions: total.impressions + numberValue(snapshot.metrics.impressions),
      clicks: total.clicks + numberValue(snapshot.metrics.clicks),
      results: total.results + numberValue(snapshot.metrics.results)
    }), { spend: 0, impressions: 0, clicks: 0, results: 0 });
    const definitionsForRows: Array<ManualDefinition | null> = projectDefinitions.length > 0 ? projectDefinitions : [null];

    for (const definition of definitionsForRows) {
      const stored = definition
        ? values.get(valueKey(definition.id, "project", week.weekStart, week.weekEnd))
        : undefined;
      const manualValue = stored ? numberValue(stored.value) : null;
      const base = definition
        ? definition.conversionBaseMetric === "clicks"
          ? aggregate.clicks
          : definition.conversionBaseMetric === "impressions"
            ? aggregate.impressions
            : aggregate.results
        : aggregate.results;
      weeklySummaryRows.push({
        key: `weekly-summary:${week.weekStart}:${definition?.id ?? "none"}`,
        values: [
          `weekly-summary:${week.weekStart}:${definition?.id ?? "none"}`,
          `${week.weekStart} — ${week.weekEnd}`,
          rounded(aggregate.spend),
          aggregate.impressions,
          aggregate.clicks,
          aggregate.results,
          rounded(aggregate.results > 0 ? aggregate.spend / aggregate.results : null),
          definition?.label ?? "—",
          manualValue ?? "",
          definition?.includeCostPerValue && manualValue && manualValue > 0 ? rounded(aggregate.spend / manualValue) : "—",
          definition?.includeConversionRate && manualValue !== null && base > 0 ? rounded((manualValue / base) * 100) : "—"
        ]
      });
    }
  }

  const weeklySummaryResult = await syncManagedRows({
    db: input.db,
    accessToken: input.accessToken,
    reportId: input.reportId,
    spreadsheetId: input.spreadsheetId,
    tab: "Weekly Summary",
    rows: weeklySummaryRows,
    managedColumns: 11
  });

  const creativeDefinitions = definitions.filter((item) => item.scope === "creative" && item.period === "week");
  const creativeWeeklyRows: ManagedRow[] = [];
  for (const snapshot of snapshots) {
    const definitionsForRows: Array<ManualDefinition | null> = creativeDefinitions.length > 0 ? creativeDefinitions : [null];
    for (const definition of definitionsForRows) {
      const stored = definition
        ? values.get(valueKey(definition.id, snapshot.mediaAssetId, snapshot.weekStart, snapshot.weekEnd))
        : undefined;
      const manualValue = stored ? numberValue(stored.value) : null;
      const spend = numberValue(snapshot.metrics.spend);
      const metaResults = numberValue(snapshot.metrics.results);
      const base = definition ? conversionBase(snapshot, definition) : metaResults;
      const preview = snapshot.thumbnailUrl
        ? `=IFERROR(IMAGE("${escapeFormula(snapshot.thumbnailUrl)}",4,120,120),"")`
        : "";
      creativeWeeklyRows.push({
        key: `creative-week:${snapshot.id}:${definition?.id ?? "none"}`,
        values: [
          `creative-week:${snapshot.id}:${definition?.id ?? "none"}`,
          preview,
          `${snapshot.weekStart} — ${snapshot.weekEnd}`,
          snapshot.creativeName,
          snapshot.creativeType,
          snapshot.accountNames.join(", "),
          rounded(spend),
          numberValue(snapshot.metrics.impressions),
          numberValue(snapshot.metrics.clicks),
          metaResults,
          rounded(metaResults > 0 ? spend / metaResults : null),
          definition?.label ?? "—",
          manualValue ?? "",
          definition?.includeCostPerValue && manualValue && manualValue > 0 ? rounded(spend / manualValue) : "—",
          definition?.includeConversionRate && manualValue !== null && base > 0 ? rounded((manualValue / base) * 100) : "—"
        ]
      });
    }
  }

  const creativeWeeklyResult = await syncManagedRows({
    db: input.db,
    accessToken: input.accessToken,
    reportId: input.reportId,
    spreadsheetId: input.spreadsheetId,
    tab: "Creative Weekly",
    rows: creativeWeeklyRows,
    managedColumns: 15
  });

  return {
    appended: manualResult.appended + weeklySummaryResult.appended + creativeWeeklyResult.appended,
    updated: manualResult.updated + weeklySummaryResult.updated + creativeWeeklyResult.updated,
    importedManualValues
  };
}
