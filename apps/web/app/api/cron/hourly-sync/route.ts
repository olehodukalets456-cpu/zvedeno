import { NextRequest, NextResponse } from "next/server";
import { runScheduledSyncCycle } from "@zvedeno/sync-engine";
import { refreshMetaAdAccounts } from "../../../../lib/meta-account-refresh";

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
    const accountRefresh = await refreshMetaAdAccounts();
    const summary = await runScheduledSyncCycle();
    const errors = summary.errors + accountRefresh.errors;

    return NextResponse.json({
      ok: errors === 0,
      ranAt: new Date().toISOString(),
      accountRefresh,
      ...summary,
      errors
    }, { status: errors === 0 ? 200 : 207 });
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
