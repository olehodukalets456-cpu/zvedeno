import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/app/projects/[projectId]/analytics/page.tsx";
let source = readFileSync(path, "utf8");

if (source.includes("function groupColumnTrack(")) {
  console.log("Analytics stable grid patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Analytics stable grid patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
  `function rowGridStyle(groups: DimensionKey[]): CSSProperties {
  const groupColumns = groups.length
    ? groups.map((group) => group === "creative" ? "minmax(230px, 1.35fr)" : "minmax(165px, 1fr)")
    : ["minmax(320px, 1fr)"];
  const metricColumns = Array.from({ length: 7 }, () => "minmax(92px, 112px)");
  const groupWidth = groups.length
    ? groups.reduce((sum, group) => sum + (group === "creative" ? 245 : 175), 0)
    : 320;

  return {
    gridTemplateColumns: [...groupColumns, ...metricColumns].join(" "),
    minWidth: \`${"${Math.max(1120, groupWidth + 7 * 105)}px"}\`
  };
}`,
  `function groupColumnTrack(group: DimensionKey, groupCount: number): string {
  if (group === "creative") {
    return groupCount >= 3 ? "minmax(205px, 1.55fr)" : "minmax(235px, 1.7fr)";
  }
  if (group === "account") {
    return groupCount >= 3 ? "minmax(185px, 1.3fr)" : "minmax(180px, 1.15fr)";
  }
  return groupCount >= 3 ? "minmax(130px, .9fr)" : "minmax(150px, 1fr)";
}

function rowGridStyle(groups: DimensionKey[]): CSSProperties {
  const groupCount = Math.max(groups.length, 1);
  const groupColumns = groups.length
    ? groups.map((group) => groupColumnTrack(group, groupCount))
    : ["minmax(280px, 1.8fr)"];
  const metricColumns = Array.from(
    { length: 7 },
    () => groupCount >= 3 ? "minmax(66px, .62fr)" : "minmax(76px, .7fr)"
  );
  const minimumWidth = groupCount >= 4 ? 1160 : groupCount === 3 ? 1040 : 980;

  return {
    gridTemplateColumns: [...groupColumns, ...metricColumns].join(" "),
    minWidth: \`${"${minimumWidth}px"}\`,
    width: "100%"
  };
}`,
  "adaptive report grid tracks"
);

replaceOnce(
  `      <span className="trackerTreeLabelText">`,
  `      <span className="trackerTreeLabelText" title={node.label}>`,
  "full label tooltip"
);

replaceOnce(
  `  const columnCount = Math.max(groups.length, 1);
  const activeColumn = node.depth === 0 ? 0 : Math.min(node.depth - 1, columnCount - 1);

  return Array.from({ length: columnCount }, (_, index) => (`,
  `  const columnCount = Math.max(groups.length, 1);

  if (node.depth === 0) {
    return (
      <span
        className="trackerDimensionCell trackerDimensionTotalCell"
        style={{ gridColumn: \`1 / span ${"${columnCount}"}\` }}
      >
        <NodeLabel node={node} expandable={expandable} />
      </span>
    );
  }

  const activeColumn = Math.min(node.depth - 1, columnCount - 1);
  return Array.from({ length: columnCount }, (_, index) => (`,
  "total row spanning dimension columns"
);

replaceOnce(
  `<section className="trackerTreePanel">`,
  `<section className="trackerTreePanel" key={groups.join("|") || "total"}>`,
  "reset horizontal scroll when grouping changes"
);

writeFileSync(path, source);
console.log("Applied stable responsive analytics grid");
