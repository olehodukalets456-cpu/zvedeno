import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/app/projects/[projectId]/analytics/page.tsx";
let source = readFileSync(path, "utf8");

if (source.includes("<ProjectAnalyticsV2 projectId={projectId}")) {
  console.log("Project-scoped analytics patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Project-scoped analytics patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
  `} from "./analytics-controls";\n`,
  `} from "./analytics-controls";\nimport { ProjectAnalyticsV2 } from "../project-analytics-v2";\n`,
  "Analytics V2 import"
);

replaceOnce(
  `  const { projectId } = await params;\n  const query = await searchParams;\n  const { db, pool } = createDatabase();`,
  `  const { projectId } = await params;
  const query = await searchParams;

  if (projectId !== "cc6f71d1-1043-4a2e-96d7-8f50484c010e") {
    return <ProjectAnalyticsV2 projectId={projectId} query={query} />;
  }

  const { db, pool } = createDatabase();`,
  "legacy DMND isolation guard"
);

writeFileSync(path, source);
console.log("Routed every non-DMND project to isolated Analytics V2");
