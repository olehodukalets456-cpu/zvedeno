export type ReportTemplateId =
  | "commerce_roas"
  | "lead_generation"
  | "creative_intelligence"
  | "custom_funnel"
  | "minimal";

export type ReportGranularity = "daily" | "weekly" | "monthly";

export type ReportTabKind =
  | "dashboard"
  | "trend"
  | "campaigns"
  | "adsets"
  | "creatives"
  | "funnel"
  | "raw"
  | "sync";

export type ReportMetricCategory =
  | "delivery"
  | "traffic"
  | "conversion"
  | "value"
  | "video"
  | "quality"
  | "other";

export type ReportMetricInventoryItem = {
  key: string;
  label: string;
  category: ReportMetricCategory;
  total: number;
  nonZeroRows: number;
  coverageRows: number;
};

export type ReportQuestionOption = {
  value: string;
  label: string;
  description: string;
};

export type ReportQuestion = {
  id: string;
  label: string;
  help: string;
  type: "single" | "multi" | "boolean" | "text";
  required: boolean;
  options: ReportQuestionOption[];
};

export type ReportTemplateRecommendation = {
  templateId: ReportTemplateId;
  label: string;
  score: number;
  reason: string;
};

export type AdaptiveReportTab = {
  kind: ReportTabKind;
  title: string;
  metrics: string[];
};

export type AdaptiveReportBlueprint = {
  version: "adaptive-v1";
  templateId: ReportTemplateId;
  title: string;
  description: string;
  granularity: ReportGranularity;
  includeDashboard: boolean;
  includeCharts: boolean;
  includeCampaigns: boolean;
  includeAdSets: boolean;
  includeCreatives: boolean;
  includeFunnel: boolean;
  includeRawData: boolean;
  primaryMetrics: string[];
  resultMetrics: string[];
  revenueMetrics: string[];
  funnelMetrics: string[];
  tabs: AdaptiveReportTab[];
};

export type ReportInterviewState = {
  version: "adaptive-v1";
  status: "questionnaire" | "ready" | "failed";
  model: string;
  round: number;
  analyzedAt: string;
  summary: string;
  metricInventory: ReportMetricInventoryItem[];
  recommendations: ReportTemplateRecommendation[];
  questions: ReportQuestion[];
  answers: Record<string, string | string[] | boolean>;
  blueprint: AdaptiveReportBlueprint;
  warnings: string[];
};

export type ReportTemplateDefinition = {
  id: ReportTemplateId;
  label: string;
  description: string;
  bestFor: string;
  blueprint: AdaptiveReportBlueprint;
};

function tabs(...items: Array<[ReportTabKind, string]>): AdaptiveReportTab[] {
  return items.map(([kind, title]) => ({ kind, title, metrics: [] }));
}

export const REPORT_TEMPLATE_CATALOG: ReportTemplateDefinition[] = [
  {
    id: "commerce_roas",
    label: "Продажі та ROAS",
    description: "Дохід, покупки, ROAS, CPA, динаміка, кампанії та креативи.",
    bestFor: "e-commerce, продажі та підписки з цінністю конверсії",
    blueprint: {
      version: "adaptive-v1",
      templateId: "commerce_roas",
      title: "Performance dashboard",
      description: "Контроль окупності та масштабування продажів.",
      granularity: "monthly",
      includeDashboard: true,
      includeCharts: true,
      includeCampaigns: true,
      includeAdSets: false,
      includeCreatives: true,
      includeFunnel: true,
      includeRawData: true,
      primaryMetrics: ["spend", "impressions", "reach", "derived.frequency", "inline_link_clicks", "business.result", "business.revenue", "derived.roas", "derived.cpa", "derived.cpm", "derived.cpc", "derived.ctr"],
      resultMetrics: ["action.omni_purchase", "action.purchase", "action.offsite_conversion.fb_pixel_purchase"],
      revenueMetrics: ["action_value.omni_purchase", "action_value.purchase", "action_value.offsite_conversion.fb_pixel_purchase"],
      funnelMetrics: ["action.landing_page_view", "action.initiate_checkout", "business.result"],
      tabs: tabs(["dashboard", "Dashboard"], ["trend", "Monthly"], ["campaigns", "Campaigns"], ["creatives", "Creatives"], ["funnel", "Funnel"], ["raw", "Raw Data"], ["sync", "Sync Status"])
    }
  },
  {
    id: "lead_generation",
    label: "Ліди та CPA",
    description: "Ліди, CPL/CPA, кампанії, динаміка та креативи.",
    bestFor: "послуги, нерухомість, вакансії, B2B, форми та повідомлення",
    blueprint: {
      version: "adaptive-v1",
      templateId: "lead_generation",
      title: "Lead generation dashboard",
      description: "Контроль кількості й вартості лідів.",
      granularity: "daily",
      includeDashboard: true,
      includeCharts: true,
      includeCampaigns: true,
      includeAdSets: true,
      includeCreatives: true,
      includeFunnel: false,
      includeRawData: true,
      primaryMetrics: ["spend", "impressions", "reach", "inline_link_clicks", "business.result", "derived.cpa", "derived.cpm", "derived.cpc", "derived.ctr"],
      resultMetrics: ["action.lead", "action.offsite_conversion.fb_pixel_lead", "action.messaging_conversation_started_7d"],
      revenueMetrics: [],
      funnelMetrics: [],
      tabs: tabs(["dashboard", "Dashboard"], ["trend", "Daily"], ["campaigns", "Campaigns"], ["adsets", "Ad Sets"], ["creatives", "Creatives"], ["raw", "Raw Data"], ["sync", "Sync Status"])
    }
  },
  {
    id: "creative_intelligence",
    label: "Ефективність креативів",
    description: "Превʼю, запуск, витрати, результат, CPA/ROAS і рейтинг креативів.",
    bestFor: "команди, які оптимізують рекламу насамперед через креативи",
    blueprint: {
      version: "adaptive-v1",
      templateId: "creative_intelligence",
      title: "Creative intelligence",
      description: "Пошук креативів, які реально дають результат.",
      granularity: "weekly",
      includeDashboard: true,
      includeCharts: false,
      includeCampaigns: false,
      includeAdSets: false,
      includeCreatives: true,
      includeFunnel: false,
      includeRawData: true,
      primaryMetrics: ["spend", "impressions", "reach", "inline_link_clicks", "business.result", "business.revenue", "derived.roas", "derived.cpa", "derived.cpm", "derived.cpc", "derived.ctr"],
      resultMetrics: ["action.omni_purchase", "action.purchase", "action.lead"],
      revenueMetrics: ["action_value.omni_purchase", "action_value.purchase"],
      funnelMetrics: [],
      tabs: tabs(["dashboard", "Dashboard"], ["trend", "Weekly"], ["creatives", "Creatives"], ["raw", "Raw Data"], ["sync", "Sync Status"])
    }
  },
  {
    id: "custom_funnel",
    label: "Кастомна воронка",
    description: "Meta-події плюс реальні підписки, реєстрації, покупки або інші результати.",
    bestFor: "Telegram, боти, складні воронки та результати поза Meta",
    blueprint: {
      version: "adaptive-v1",
      templateId: "custom_funnel",
      title: "Funnel dashboard",
      description: "Зіставлення рекламних подій із фінальним бізнес-результатом.",
      granularity: "weekly",
      includeDashboard: true,
      includeCharts: true,
      includeCampaigns: true,
      includeAdSets: false,
      includeCreatives: true,
      includeFunnel: true,
      includeRawData: true,
      primaryMetrics: ["spend", "impressions", "inline_link_clicks", "business.result", "derived.cpa", "derived.cpc", "derived.ctr"],
      resultMetrics: ["action.lead", "action.link_click", "action.purchase", "action.complete_registration"],
      revenueMetrics: ["action_value.purchase", "action_value.omni_purchase"],
      funnelMetrics: ["action.landing_page_view", "action.lead", "action.complete_registration", "action.purchase"],
      tabs: tabs(["dashboard", "Dashboard"], ["trend", "Weekly"], ["campaigns", "Campaigns"], ["creatives", "Creatives"], ["funnel", "Funnel"], ["raw", "Raw Data"], ["sync", "Sync Status"])
    }
  },
  {
    id: "minimal",
    label: "Мінімальний звіт",
    description: "Тільки вибрані KPI й динаміка без креативів та зайвих зрізів.",
    bestFor: "власники бізнесу та прості проєкти з кількома ключовими показниками",
    blueprint: {
      version: "adaptive-v1",
      templateId: "minimal",
      title: "Compact dashboard",
      description: "Короткий звіт без зайвих вкладок.",
      granularity: "monthly",
      includeDashboard: true,
      includeCharts: true,
      includeCampaigns: false,
      includeAdSets: false,
      includeCreatives: false,
      includeFunnel: false,
      includeRawData: false,
      primaryMetrics: ["spend", "business.result", "derived.cpa"],
      resultMetrics: ["action.lead", "action.purchase", "action.link_click"],
      revenueMetrics: ["action_value.purchase", "action_value.omni_purchase"],
      funnelMetrics: [],
      tabs: tabs(["dashboard", "Dashboard"], ["trend", "Monthly"], ["sync", "Sync Status"])
    }
  }
];

export function reportTemplateById(id: ReportTemplateId): ReportTemplateDefinition {
  return REPORT_TEMPLATE_CATALOG.find((template) => template.id === id) ?? REPORT_TEMPLATE_CATALOG[0]!;
}
