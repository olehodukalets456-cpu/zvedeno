import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createDatabase, googleConnections, projects } from "@zvedeno/database";
import { encryptSecret } from "@zvedeno/shared";

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

type GoogleUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

async function readJson<T>(response: Response, label: string): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`${label} failed with status ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}

function setupUrl(projectId: string, params: Record<string, string>): URL {
  const url = new URL("/setup/google", process.env.APP_URL ?? "http://localhost:3000");
  url.searchParams.set("projectId", projectId);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("zvedeno_google_oauth_state")?.value;
  const projectId = cookieStore.get("zvedeno_google_project_id")?.value ?? "";

  if (!projectId || oauthError || !code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(setupUrl(projectId, { error: "google_oauth_failed" }));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(setupUrl(projectId, { error: "google_not_configured" }));
  }

  const { db, pool } = createDatabase();
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
    const token = await readJson<GoogleTokenResponse>(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      }),
      "Google token exchange"
    );

    const user = await readJson<GoogleUserInfo>(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` }
      }),
      "Google user info"
    );
    const [project] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new Error("Project was not found for Google OAuth callback");

    const [existing] = await db
      .select({ id: googleConnections.id, encryptedRefreshToken: googleConnections.encryptedRefreshToken })
      .from(googleConnections)
      .where(and(eq(googleConnections.workspaceId, project.workspaceId), eq(googleConnections.email, user.email ?? "")))
      .limit(1);

    if (!token.refresh_token && !existing) {
      throw new Error("Google did not return a refresh token. Revoke the app access and connect again with consent.");
    }

    if (existing) {
      await db
        .update(googleConnections)
        .set({
          email: user.email,
          encryptedRefreshToken: token.refresh_token
            ? encryptSecret(token.refresh_token)
            : existing.encryptedRefreshToken,
          status: "active",
          updatedAt: new Date()
        })
        .where(eq(googleConnections.id, existing.id));
    } else {
      await db.insert(googleConnections).values({
        workspaceId: project.workspaceId,
        email: user.email,
        encryptedRefreshToken: encryptSecret(token.refresh_token!),
        status: "active"
      });
    }

    const response = NextResponse.redirect(setupUrl(projectId, { google: "connected" }));
    response.cookies.delete("zvedeno_google_oauth_state");
    response.cookies.delete("zvedeno_google_project_id");
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return NextResponse.redirect(setupUrl(projectId, { error: "google_oauth_failed" }));
  } finally {
    await pool.end();
  }
}
