import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  adAccounts,
  createDatabase,
  metaConnections,
  users,
  workspaceMembers,
  workspaces
} from "@zvedeno/database";
import { encryptSecret } from "@zvedeno/shared";
import { discoverMetaAdAccounts } from "../../../../../lib/meta-account-discovery";

type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type MetaDebugTokenResponse = {
  data: {
    app_id?: string;
    application?: string;
    data_access_expires_at?: number;
    expires_at?: number;
    is_valid: boolean;
    scopes?: string[];
    type?: string;
    user_id?: string;
  };
};

type MetaProfile = {
  id: string;
  name?: string;
};

const oauthStateCookie = "zvedeno_meta_oauth_states";
const legacyOauthStateCookie = "zvedeno_meta_oauth_state";

async function readJson<T>(response: Response, label: string): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

function appUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, process.env.APP_URL ?? "http://localhost:3000");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function oauthFailure(error: string) {
  const response = NextResponse.redirect(appUrl("/setup", { error }));
  response.cookies.delete(oauthStateCookie);
  response.cookies.delete(legacyOauthStateCookie);
  return response;
}

async function exchangeLongLivedToken(input: {
  version: string;
  appId: string;
  appSecret: string;
  shortToken: MetaTokenResponse;
}): Promise<MetaTokenResponse> {
  const url = new URL(`https://graph.facebook.com/${input.version}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("fb_exchange_token", input.shortToken.access_token);
  return readJson<MetaTokenResponse>(await fetch(url), "Meta long-lived token exchange");
}

async function debugAccessToken(input: {
  version: string;
  appId: string;
  appSecret: string;
  accessToken: string;
}): Promise<MetaDebugTokenResponse> {
  const url = new URL(`https://graph.facebook.com/${input.version}/debug_token`);
  url.searchParams.set("input_token", input.accessToken);
  url.searchParams.set("access_token", `${input.appId}|${input.appSecret}`);
  return readJson<MetaDebugTokenResponse>(await fetch(url), "Meta token debug");
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const oauthErrorDescription = request.nextUrl.searchParams.get("error_description");
  const cookieStore = await cookies();
  const acceptedStates = new Set(
    [
      ...(cookieStore.get(oauthStateCookie)?.value.split(",").filter(Boolean) ?? []),
      cookieStore.get(legacyOauthStateCookie)?.value
    ].filter((value): value is string => Boolean(value))
  );

  if (oauthError) {
    console.error("Meta OAuth was denied or cancelled", {
      oauthError,
      oauthErrorDescription
    });
    return oauthFailure("meta_oauth_denied");
  }

  if (!code || !returnedState) {
    console.error("Meta OAuth callback is missing code or state", {
      hasCode: Boolean(code),
      hasState: Boolean(returnedState)
    });
    return oauthFailure("meta_oauth_invalid_response");
  }

  if (!acceptedStates.has(returnedState)) {
    console.error("Meta OAuth state mismatch", {
      returnedState,
      acceptedStateCount: acceptedStates.size
    });
    return oauthFailure("meta_oauth_state_mismatch");
  }

  const version = process.env.META_GRAPH_API_VERSION;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!version || !appId || !appSecret || !redirectUri) {
    return oauthFailure("meta_not_configured");
  }

  const { db, pool } = createDatabase();
  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const shortToken = await readJson<MetaTokenResponse>(await fetch(tokenUrl), "Meta token exchange");
    const token = await exchangeLongLivedToken({ version, appId, appSecret, shortToken });
    const debug = await debugAccessToken({
      version,
      appId,
      appSecret,
      accessToken: token.access_token
    });

    if (!debug.data.is_valid) {
      throw new Error("Meta returned an invalid access token");
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    const expiresAtEpoch = debug.data.expires_at && debug.data.expires_at > 0
      ? debug.data.expires_at
      : token.expires_in
        ? nowEpoch + token.expires_in
        : undefined;

    if (debug.data.type === "USER" && (!expiresAtEpoch || expiresAtEpoch < nowEpoch + 7 * 24 * 60 * 60)) {
      throw new Error("Meta returned a short-lived user token instead of a long-lived token");
    }

    const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
    profileUrl.searchParams.set("fields", "id,name");
    profileUrl.searchParams.set("access_token", token.access_token);
    const profile = await readJson<MetaProfile>(await fetch(profileUrl), "Meta profile request");
    const discovery = await discoverMetaAdAccounts(version, token.access_token);

    if (discovery.warnings.length > 0) {
      console.warn("Meta account discovery completed with warnings", discovery.warnings);
    }

    const ownerEmail = process.env.OWNER_EMAIL ?? "owner@zvedeno.local";
    const workspaceName = process.env.DEFAULT_WORKSPACE_NAME ?? "Oleh workspace";
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const now = new Date();

    const [owner] = await db
      .insert(users)
      .values({ email: ownerEmail, name: profile.name ?? "Owner" })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: profile.name ?? "Owner", updatedAt: now }
      })
      .returning({ id: users.id });
    if (!owner) throw new Error("Failed to create the local owner");

    const [workspace] = await db
      .insert(workspaces)
      .values({ name: workspaceName, slug: workspaceSlug })
      .onConflictDoUpdate({
        target: workspaces.slug,
        set: { name: workspaceName, updatedAt: now }
      })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("Failed to create the local workspace");

    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: owner.id, role: "owner" })
      .onConflictDoNothing();

    const expiresAt = expiresAtEpoch ? new Date(expiresAtEpoch * 1000) : null;
    const [existingConnection] = await db
      .select({ id: metaConnections.id })
      .from(metaConnections)
      .where(and(eq(metaConnections.workspaceId, workspace.id), eq(metaConnections.externalUserId, profile.id)))
      .limit(1);

    let connectionId: string;
    if (existingConnection) {
      const [updated] = await db
        .update(metaConnections)
        .set({
          label: profile.name ?? "Meta connection",
          encryptedAccessToken: encryptSecret(token.access_token),
          tokenExpiresAt: expiresAt,
          status: "active",
          lastCheckedAt: now,
          updatedAt: now
        })
        .where(eq(metaConnections.id, existingConnection.id))
        .returning({ id: metaConnections.id });
      if (!updated) throw new Error("Failed to update Meta connection");
      connectionId = updated.id;
    } else {
      const [created] = await db
        .insert(metaConnections)
        .values({
          workspaceId: workspace.id,
          label: profile.name ?? "Meta connection",
          externalUserId: profile.id,
          encryptedAccessToken: encryptSecret(token.access_token),
          tokenExpiresAt: expiresAt,
          status: "active",
          lastCheckedAt: now
        })
        .returning({ id: metaConnections.id });
      if (!created) throw new Error("Failed to save Meta connection");
      connectionId = created.id;
    }

    for (const account of discovery.accounts) {
      await db
        .insert(adAccounts)
        .values({
          workspaceId: workspace.id,
          metaConnectionId: connectionId,
          externalAccountId: account.id,
          name: account.name ?? account.id,
          currency: account.currency,
          timezone: account.timezone_name,
          status: account.account_status === 1 ? "active" : "blocked"
        })
        .onConflictDoUpdate({
          target: [adAccounts.workspaceId, adAccounts.externalAccountId],
          set: {
            metaConnectionId: connectionId,
            name: account.name ?? account.id,
            currency: account.currency,
            timezone: account.timezone_name,
            status: account.account_status === 1 ? "active" : "blocked",
            updatedAt: now
          }
        });
    }

    const response = NextResponse.redirect(appUrl("/setup/accounts", {
      meta: "connected",
      accounts: String(discovery.accounts.length),
      direct: String(discovery.directCount),
      businesses: String(discovery.businessCount),
      owned: String(discovery.ownedCount),
      client: String(discovery.clientCount),
      warnings: String(discovery.warnings.length),
      mode: debug.data.type === "SYSTEM_USER" ? "system_user" : "oauth_long_lived"
    }));
    response.cookies.delete(oauthStateCookie);
    response.cookies.delete(legacyOauthStateCookie);
    return response;
  } catch (error) {
    console.error("Meta OAuth callback failed", error);
    return oauthFailure("meta_token_exchange_failed");
  } finally {
    await pool.end();
  }
}
