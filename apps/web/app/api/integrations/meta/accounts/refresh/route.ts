import { NextRequest, NextResponse } from "next/server";
import { refreshMetaAdAccounts } from "../../../../../../lib/meta-account-refresh";

const oneTimeNonce = "zv-refresh-20260730-f73c9a41";
const oneTimeExpiresAt = Date.parse("2026-07-30T16:30:00.000Z");

function setupUrl(params: Record<string, string>): URL {
  const url = new URL("/setup/accounts", process.env.APP_URL ?? "http://localhost:3000");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export async function GET(request: NextRequest) {
  const allowed = process.env.VERCEL_ENV === "preview"
    && Date.now() < oneTimeExpiresAt
    && request.nextUrl.searchParams.get("nonce") === oneTimeNonce;

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  try {
    const summary = await refreshMetaAdAccounts();
    return NextResponse.json({ ok: summary.errors === 0, ...summary }, {
      status: summary.errors === 0 ? 200 : 207
    });
  } catch (error) {
    console.error("One-time Meta account refresh failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "meta_account_refresh_failed"
    }, { status: 500 });
  }
}

export async function POST() {
  try {
    const summary = await refreshMetaAdAccounts();
    return NextResponse.redirect(setupUrl({
      refresh: summary.errors === 0 ? "done" : "partial",
      accounts: String(summary.accounts),
      direct: String(summary.direct),
      businesses: String(summary.businesses),
      owned: String(summary.owned),
      client: String(summary.client),
      warnings: String(summary.warnings),
      errors: String(summary.errors)
    }), 303);
  } catch (error) {
    console.error("Manual Meta account refresh failed", error);
    return NextResponse.redirect(setupUrl({ refresh: "failed" }), 303);
  }
}
