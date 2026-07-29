import { NextRequest, NextResponse } from "next/server";
import {
  refreshCreativeWeeklySnapshots,
  syncGoogleReports,
  syncManualWeeklyReports,
  syncMetaData
} from "@zvedeno/sync-engine";

function projectUrl(projectId: string): URL {
  return new URL(`/projects/${projectId}`, process.env.APP_URL ?? "http://localhost:3000");
}

async function runProjectSync(projectId: string) {
  try {
    const meta = await syncMetaData({ projectId });
    const weekly = await refreshCreativeWeeklySnapshots({ projectId });
    const sheets = await syncGoogleReports({ projectId });
    const manualWeekly = await syncManualWeeklyReports({ projectId });
    const url = projectUrl(projectId);
    url.searchParams.set("sync", "done");
    url.searchParams.set("meta", String(meta.insights));
    url.searchParams.set("weekly", String(weekly.snapshots));
    url.searchParams.set("sheets", String(
      sheets.appended + sheets.updated + manualWeekly.appended + manualWeekly.updated
    ));
    url.searchParams.set("errors", String(meta.errors + sheets.errors + manualWeekly.errors));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Manual project sync failed", error);
    const url = projectUrl(projectId);
    url.searchParams.set("error", "sync_failed");
    return NextResponse.redirect(url, 303);
  }
}

export async function POST(_request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  return runProjectSync(projectId);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  return runProjectSync(projectId);
}
