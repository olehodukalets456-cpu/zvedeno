import { NextRequest, NextResponse } from "next/server";
import { refreshCreativeWeeklySnapshots, syncGoogleReports, syncMetaData } from "@zvedeno/sync-engine";

function projectUrl(projectId: string): URL {
  return new URL(`/projects/${projectId}`, process.env.APP_URL ?? "http://localhost:3000");
}

export async function POST(_request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  try {
    const meta = await syncMetaData({ projectId });
    const weekly = await refreshCreativeWeeklySnapshots({ projectId });
    const sheets = await syncGoogleReports({ projectId });
    const url = projectUrl(projectId);
    url.searchParams.set("sync", "done");
    url.searchParams.set("meta", String(meta.insights));
    url.searchParams.set("weekly", String(weekly.snapshots));
    url.searchParams.set("sheets", String(sheets.appended + sheets.updated));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Manual project sync failed", error);
    const url = projectUrl(projectId);
    url.searchParams.set("error", "sync_failed");
    return NextResponse.redirect(url, 303);
  }
}
