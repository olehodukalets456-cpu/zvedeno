import { NextRequest, NextResponse } from "next/server";
import { runScheduledSyncCycle } from "@zvedeno/sync-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScheduledSyncCycle();
    return NextResponse.json({
      ok: summary.errors === 0,
      ranAt: new Date().toISOString(),
      ...summary
    }, { status: summary.errors === 0 ? 200 : 207 });
  } catch (error) {
    console.error("Hourly sync failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "hourly_sync_failed"
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
