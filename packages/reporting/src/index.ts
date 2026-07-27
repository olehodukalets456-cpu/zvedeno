import type { ManualColumnDefinition } from "@zvedeno/shared";

export type ReportLevel = "account" | "campaign" | "adset" | "ad" | "creative" | "daily" | "monthly";

export type ResultDefinition = {
  id: string;
  label: string;
  source: "meta" | "google_sheet" | "crm" | "telegram" | "sms" | "manual" | "custom_api";
  sourceEvent: string;
  aggregation: "sum" | "unique" | "latest";
};

export type FunnelStep = {
  id: string;
  label: string;
  resultDefinitionId: string;
};

export type ReportRecipe = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  accountIds: string[];
  levels: ReportLevel[];
  metricKeys: string[];
  resultDefinitions: ResultDefinition[];
  funnel: FunnelStep[];
  updateFrequencyMinutes: number;
  historicalLookbackDays: number;
  manualColumns: ManualColumnDefinition[];
  sheetTabs: Array<"dashboard" | "campaigns" | "daily" | "monthly" | "creatives" | "funnel" | "sync_status">;
};

export function createDefaultRecipe(input: Pick<ReportRecipe, "id" | "workspaceId" | "projectId" | "name" | "accountIds">): ReportRecipe {
  return {
    ...input,
    levels: ["campaign", "ad", "creative", "daily", "monthly"],
    metricKeys: ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "results", "cost_per_result"],
    resultDefinitions: [],
    funnel: [],
    updateFrequencyMinutes: 60,
    historicalLookbackDays: 28,
    manualColumns: [
      { key: "status", label: "Status", type: "select", options: ["Active", "Winner", "Pause", "Review"] },
      { key: "comment", label: "Comment", type: "text" }
    ],
    sheetTabs: ["dashboard", "campaigns", "daily", "monthly", "creatives", "funnel", "sync_status"]
  };
}
