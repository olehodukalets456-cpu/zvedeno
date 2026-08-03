import { readFileSync, writeFileSync } from "node:fs";

const analyticsPath = "apps/web/app/projects/[projectId]/project-analytics-v2.tsx";
let analytics = readFileSync(analyticsPath, "utf8");
let analyticsChanged = false;
const wrongImport = 'from "../../lib/project-ai";';
const correctImport = 'from "../../../lib/project-ai";';
if (analytics.includes(wrongImport)) {
  analytics = analytics.replace(wrongImport, correctImport);
  analyticsChanged = true;
  console.log("Normalized Project Analytics V2 AI import path");
} else if (!analytics.includes(correctImport)) {
  throw new Error("Project AI module path patch failed: import marker not found");
}

const narrowTabs = "  const tabs = unique.map((item) => ({ key: item.key.toLocaleLowerCase(\"en-US\"), label: item.label, offer: item.key, groups, sort: \"results\" as const, order: \"desc\" as const }));";
const typedTabs = "  const tabs: ReportTab[] = unique.map((item) => ({ key: item.key.toLocaleLowerCase(\"en-US\"), label: item.label, offer: item.key, groups, sort: \"results\", order: \"desc\" }));";
if (analytics.includes(narrowTabs)) {
  analytics = analytics.replace(narrowTabs, typedTabs);
  analyticsChanged = true;
  console.log("Widened Analytics V2 report tab types");
} else if (!analytics.includes(typedTabs)) {
  throw new Error("Project Analytics V2 type patch failed: tabs marker not found");
}

if (analyticsChanged) writeFileSync(analyticsPath, analytics);

const routePath = "apps/web/app/api/projects/route.ts";
let route = readFileSync(routePath, "utf8");
const wrongCheckbox = '  const useAi = String(form.get("useAi") ?? "on") !== "off";';
const correctCheckbox = '  const useAi = form.has("useAi");';
if (route.includes(wrongCheckbox)) {
  route = route.replace(wrongCheckbox, correctCheckbox);
  writeFileSync(routePath, route);
  console.log("Normalized AI onboarding checkbox behavior");
} else if (!route.includes(correctCheckbox)) {
  throw new Error("Project AI form patch failed: checkbox marker not found");
}
