export type SheetValue = string | number | boolean | null;

export type SheetRow = {
  stableRowKey: string;
  values: Record<string, SheetValue>;
};

export type SheetMutationPlan = {
  append: SheetRow[];
  update: SheetRow[];
  preserveColumns: string[];
};

export interface GoogleReportAdapter {
  createReport(input: { title: string; tabs: string[] }): Promise<{ spreadsheetId: string; url: string }>;
  applyMutations(input: { spreadsheetId: string; tab: string; plan: SheetMutationPlan }): Promise<void>;
  uploadStableThumbnail(input: { bytes: Uint8Array; contentType: string; fileName: string }): Promise<{ url: string }>;
}

export function createEmptyMutationPlan(preserveColumns: string[] = []): SheetMutationPlan {
  return { append: [], update: [], preserveColumns };
}
