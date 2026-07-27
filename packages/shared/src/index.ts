export type EntityId = string;

export type SyncStatus = "queued" | "running" | "succeeded" | "failed" | "partial";

export type DateRange = {
  from: string;
  to: string;
};

export type MetricValue = string | number | boolean | null;

export type MetricBag = Record<string, MetricValue>;

export type ManualColumnDefinition = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  options?: string[];
};
