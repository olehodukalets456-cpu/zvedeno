export type ManualWeeklyReportSyncOptions = {
  projectId?: string;
  reportId?: string;
};

export type ManualWeeklyReportSyncSummary = {
  reports: number;
  appended: number;
  updated: number;
  importedManualValues: number;
  errors: number;
};

/**
 * Legacy compatibility hook.
 *
 * Direction reports now keep the factual result and comment directly in each
 * direction tab, so the old Weekly Summary / Creative Weekly / Manual Input
 * pipeline must not recreate or update those client-facing tabs.
 */
export async function syncManualWeeklyReports(
  _options: ManualWeeklyReportSyncOptions = {}
): Promise<ManualWeeklyReportSyncSummary> {
  return {
    reports: 0,
    appended: 0,
    updated: 0,
    importedManualValues: 0,
    errors: 0
  };
}
