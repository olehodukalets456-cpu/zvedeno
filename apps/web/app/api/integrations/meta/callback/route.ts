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

type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type MetaProfile = {
  id: string;
  name?: string;
};

type MetaAdAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
};

type MetaAdAccountPage = {
  data: MetaAdAccount[];
  paging?: { next?: string };
};

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
  try {
    return await readJson<MetaTokenResponse>(await fetch(url), "Meta long-lived token exchange");
  } catch (error) {
    console.warn("Long-lived token exchange failed; keeping the original token", error);
    return input.shortToken;
  }
}

async function fetchAllAdAccounts(version: string, accessToken: string): Promise<MetaAdAccount[]> {
  const initial = new URL(`https://graph.facebook.com/${version}/me/adaccounts`);
  initial.searchParams.set("fields", "id,name,account_status,currency,timezone_name");
  initial.searchParams.set("limit", "500");
  initial.searchParams.set("access_token", accessToken);

  const accounts: MetaAdAccount[] = [];
  let next: string | undefined = initial.toString();
  while (next) {
    const page: MetaAdAccountPage = await readJson<MetaAdAccountPage>(await fetch(next), "Meta ad accounts request");
    accounts.push(...page.data);
    next = page.paging?.next;
  }
  return accounts;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("zvedeno_meta_oauth_state")?.value;

  if (oauthError || !code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(appUrl("/setup", { error: "meta_oauth_failed" }));
  }

  const version = process.env.META_GRAPH_API_VERSION;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!version || !appId || !appSecret || !redirectUri) {
    return NextResponse.redirect(appUrl("/setup", { error: "meta_not_configured" }));
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

    const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
    profileUrl.searchParams.set("fields", "id,name");
    profileUrl.searchParams.set("access_token", token.access_token);
    const profile = await readJson<MetaProfile>(await fetch(profileUrl), "Meta profile request");
    const accountList = await fetchAllAdAccounts(version, token.access_token);

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

    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
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

    for (const account of accountList) {
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
      accounts: String(accountList.length)
    }));
    response.cookies.delete("zvedeno_meta_oauth_state");
    return response;
  } catch (error) {
    console.error("Meta OAuth callback failed", error);
    return NextResponse.redirect(appUrl("/setup", { error: "meta_oauth_failed" }));
  } finally {
    await pool.end();
  }
}
