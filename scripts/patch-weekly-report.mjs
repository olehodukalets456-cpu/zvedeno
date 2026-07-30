import { readFileSync, writeFileSync } from "node:fs";

const path = "packages/sync-engine/src/direction-report-by-name.ts";
let source = readFileSync(path, "utf8");

if (source.includes("const weekStart = mondayOf(row.date);")) {
  console.log("Weekly creative report patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Weekly report patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
`function columnName(column: number): string {
  let result = "";
  let value = column;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
`,
`function columnName(column: number): string {
  let result = "";
  let value = column;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function mondayOf(dateValue: string): string {
  const date = new Date(\`${'${dateValue}'}T00:00:00.000Z\`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function addDays(dateValue: string, days: number): string {
  const date = new Date(\`${'${dateValue}'}T00:00:00.000Z\`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
`,
"date helpers"
);

replaceOnce(
`function stableCreativeKey(direction: string, identity: string): string {
  return \`creative:${'${direction}'}:${'${encodeURIComponent(identity)}'}\`;
}`,
`function stableCreativeKey(direction: string, identity: string, weekStart: string): string {
  return \`creative:${'${direction}'}:${'${encodeURIComponent(identity)}'}:${'${weekStart}'}\`;
}`,
"weekly stable key"
);

replaceOnce(
`    if (clearLegacyDirectionRows && key.startsWith("direction:")) {
      legacyClearData.push({`,
`    const legacyAllTimeCreative = key.startsWith("creative:")
      && !/:\\d{4}-\\d{2}-\\d{2}$/.test(key);
    if (
      clearLegacyDirectionRows
      && (key.startsWith("direction:") || legacyAllTimeCreative)
    ) {
      legacyClearData.push({`,
"legacy all-time row cleanup"
);

replaceOnce(
`  const aggregates = new Map<string, CreativeAggregate>();
  const rawRows: ManagedRow[] = [];`,
`  const aggregates = new Map<string, CreativeAggregate>();
  const lifecycle = new Map<string, {
    launchDate: string;
    lastActivityDate: string;
    active: boolean;
  }>();
  const rawRows: ManagedRow[] = [];`,
"creative lifecycle map"
);

replaceOnce(
`    const aggregateKey = \`${'${direction}'}:${'${identity}'}\`;
    const metrics = row.metrics as Record<string, string | number | null>;`,
`    const lifecycleKey = \`${'${direction}'}:${'${identity}'}\`;
    const lifecycleState = lifecycle.get(lifecycleKey) ?? {
      launchDate: row.date,
      lastActivityDate: row.date,
      active: false
    };
    if (row.date < lifecycleState.launchDate) lifecycleState.launchDate = row.date;
    if (row.date > lifecycleState.lastActivityDate) lifecycleState.lastActivityDate = row.date;
    lifecycleState.active = lifecycleState.active
      || String(row.adStatus ?? "").toUpperCase() === "ACTIVE";
    lifecycle.set(lifecycleKey, lifecycleState);

    const weekStart = mondayOf(row.date);
    const weekEnd = addDays(weekStart, 6);
    const aggregateKey = \`${'${direction}'}:${'${identity}'}:${'${weekStart}'}\`;
    const metrics = row.metrics as Record<string, string | number | null>;`,
"weekly aggregation key"
);

replaceOnce(
`      periodStart: row.date,
      periodEnd: row.date,`,
`      periodStart: weekStart,
      periodEnd: weekEnd,`,
"Monday-Sunday period boundaries"
);

replaceOnce(
`  let archivedCount = 0;
  for (const aggregate of aggregates.values()) {`,
`  for (const aggregate of aggregates.values()) {
    const state = lifecycle.get(\`${'${aggregate.direction}'}:${'${aggregate.identity}'}\`);
    if (!state) continue;
    aggregate.launchDate = state.launchDate;
    aggregate.lastActivityDate = state.lastActivityDate;
    aggregate.active = state.active;
  }

  let archivedCount = 0;
  for (const aggregate of aggregates.values()) {`,
"global launch and stop dates"
);

replaceOnce(
`.sort((a, b) => b.spend - a.spend || a.displayName.localeCompare(b.displayName))`,
`.sort((a, b) =>
        b.periodStart.localeCompare(a.periodStart)
        || b.spend - a.spend
        || a.displayName.localeCompare(b.displayName)
      )`,
"weekly row ordering"
);

replaceOnce(
`        const key = stableCreativeKey(direction.key, aggregate.identity);`,
`        const key = stableCreativeKey(
          direction.key,
          aggregate.identity,
          aggregate.periodStart
        );`,
"weekly output key"
);

writeFileSync(path, source);
console.log("Applied Monday-Sunday weekly creative aggregation");
