import { NextResponse } from "next/server";
import { refreshMetaAdAccounts } from "../../../../../../lib/meta-account-refresh";

function setupUrl(params: Record<string, string>): URL {
  const url = new URL("/setup/accounts", process.env.APP_URL ?? "http://localhost:3000");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
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
