import fs from "node:fs";

const path = "apps/web/lib/report-interview.ts";
let source = fs.readFileSync(path, "utf8");

const toggles = `  blueprint.includeCreatives = answerBoolean(answers.includeCreatives, blueprint.includeCreatives);
  blueprint.includeCharts = answerBoolean(answers.includeCharts, blueprint.includeCharts);
  blueprint.includeFunnel = answerBoolean(answers.externalResult, blueprint.includeFunnel);`;
if (!source.includes(toggles)) throw new Error("Adaptive blueprint toggle marker not found");
source = source.replace(
  toggles,
  `  blueprint.includeCreatives = answerBoolean(answers.includeCreatives, blueprint.includeCreatives);
  blueprint.includeCharts = answerBoolean(answers.includeCharts, blueprint.includeCharts);
  blueprint.includeCampaigns = answerBoolean(answers.includeCampaigns, blueprint.includeCampaigns);
  blueprint.includeAdSets = answerBoolean(answers.includeAdSets, blueprint.includeAdSets);
  blueprint.includeRawData = answerBoolean(answers.includeRawData, blueprint.includeRawData);
  blueprint.includeFunnel = answerBoolean(
    answers.includeFunnel,
    answerBoolean(answers.externalResult, blueprint.includeFunnel)
  );`
);

const oldTabs = `  const trendTitle = blueprint.granularity === "daily" ? "Daily" : blueprint.granularity === "weekly" ? "Weekly" : "Monthly";
  blueprint.tabs = blueprint.tabs
    .filter((tab) => {
      if (tab.kind === "creatives") return blueprint.includeCreatives;
      if (tab.kind === "funnel") return blueprint.includeFunnel;
      if (tab.kind === "raw") return blueprint.includeRawData;
      return true;
    })
    .map((tab) => tab.kind === "trend" ? { ...tab, title: trendTitle } : tab);
  return blueprint;`;
if (!source.includes(oldTabs)) throw new Error("Adaptive blueprint tab marker not found");
source = source.replace(
  oldTabs,
  `  const trendTitle = blueprint.granularity === "daily" ? "Daily" : blueprint.granularity === "weekly" ? "Weekly" : "Monthly";
  blueprint.tabs = blueprint.tabs.filter((tab) => {
    if (tab.kind === "campaigns") return blueprint.includeCampaigns;
    if (tab.kind === "adsets") return blueprint.includeAdSets;
    if (tab.kind === "creatives") return blueprint.includeCreatives;
    if (tab.kind === "funnel") return blueprint.includeFunnel;
    if (tab.kind === "raw") return blueprint.includeRawData;
    return true;
  });
  const ensureTab = (kind: AdaptiveReportBlueprint["tabs"][number]["kind"], title: string) => {
    if (blueprint.tabs.some((tab) => tab.kind === kind)) return;
    const syncIndex = blueprint.tabs.findIndex((tab) => tab.kind === "sync");
    const tab = { kind, title, metrics: [] };
    if (syncIndex >= 0) blueprint.tabs.splice(syncIndex, 0, tab);
    else blueprint.tabs.push(tab);
  };
  ensureTab("dashboard", "Dashboard");
  ensureTab("trend", trendTitle);
  if (blueprint.includeCampaigns) ensureTab("campaigns", "Campaigns");
  if (blueprint.includeAdSets) ensureTab("adsets", "Ad Sets");
  if (blueprint.includeCreatives) ensureTab("creatives", "Creatives");
  if (blueprint.includeFunnel) ensureTab("funnel", "Funnel");
  if (blueprint.includeRawData) ensureTab("raw", "Raw Data");
  ensureTab("sync", "Sync Status");
  blueprint.tabs = blueprint.tabs.map((tab) => tab.kind === "trend" ? { ...tab, title: trendTitle } : tab);
  return blueprint;`
);

fs.writeFileSync(path, source);
console.log("Applied adaptive blueprint follow-up mapping patch");
