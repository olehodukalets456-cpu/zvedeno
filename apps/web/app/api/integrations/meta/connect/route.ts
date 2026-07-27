import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

const requiredEnv = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_API_VERSION",
  "META_REDIRECT_URI",
  "TOKEN_ENCRYPTION_KEY"
] as const;

export async function GET() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return NextResponse.redirect(new URL("/setup?error=meta_not_configured", process.env.APP_URL ?? "http://localhost:3000"));
  }

  const state = randomUUID();
  const version = process.env.META_GRAPH_API_VERSION!;
  const authorizationUrl = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  authorizationUrl.searchParams.set("client_id", process.env.META_APP_ID!);
  authorizationUrl.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI!);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "ads_read,business_management");

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("zvedeno_meta_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/"
  });

  return response;
}
