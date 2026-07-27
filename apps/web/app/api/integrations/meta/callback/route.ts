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
import { encryptSecret } from "../../../../../lib/secrets";

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
};

async function readJson<T>(response: Response, label: string): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

function setupUrl(params: Record<string, string>) {
  const url = new URL("/setup", process.env.APP_URL ?? "http://localhost:3000");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("zvedeno_meta_oauth_state")?.value;

  if (oauthError || !code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(setupUrl({ error: "meta_oauth_failed" }));
  }

  const version = process.env.META_GRAPH_API_VERSION;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!version || !appId || !appSecret || !redirectUri) {
    return NextResponse.redirect(setupUrl({ error: "meta_not_configured" }));
  }

  const { db, pool } = createDatabase();

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const token = await readJson<MetaTokenResponse>(await fetch(tokenUrl), "Meta token exchange");

    const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
    profileUrl.searchParams.set("fields", "id,name");
    profileUrl.searchParams.set("access_token", token.access_token);
    const profile = await readJson<MetaProfile>(await fetch(profileUrl), "Meta profile request");

    const accountsUrl = new URL(`https://graph.facebook.com/${version}/me/adaccounts`);
    accountsUrl.searchParams.set("fields", "id,name,account_status,currency,timezone_name");
    accountsUrl.searchParams.set("limit", "500");
    accountsUrl.searchParams.set("access_token", token.access_token);
    const accountPage = await readJson<MetaAdAccountPage>(await fetch(accountsUrl), "Meta ad accounts request");

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

    const [workspace] = await db
      .insert(workspaces)
      .values({ name: workspaceName, slug: workspaceSlug })
      .onConflictDoUpdate({
        target: workspaces.slug,
        set: { name: workspaceName, updatedAt: now }
      })
      .returning({ id: workspaces.id });

    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: owner.id, role: "owner" })
      .onConflictDoNothing();

    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;

    const [existingConnection] = await db
      .select({ id: metaConnections.id })
      .from(metaConnections)
      .where(
        and(
          eq(metaConnections.workspaceId, workspace.id),
          eq(metaConnections.externalUserId, profile.id)
        )
      )
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
      connectionId = created.id;
    }

    for (const account of accountPage.data) {
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

    const response = NextResponse.redirect(
      setupUrl({ meta: "connected", accounts: String(accountPage.data.length) })
    );
    response.cookies.delete("zvedeno_meta_oauth_state");
    return response;
  } catch (error) {
    console.error("Meta OAuth callback failed", error);
    return NextResponse.redirect(setupUrl({ error: "meta_oauth_failed" }));
  } finally {
    await pool.end();
  }
}
