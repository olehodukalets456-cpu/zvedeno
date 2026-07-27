import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  adAccounts,
  createDatabase,
  metaConnections,
  users,
  workspaceMembers,
  workspaces
} from "@zvedeno/database";
import { encryptSecret } from "@zvedeno/shared";

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

type MetaDebugTokenResponse = {
  data?: {
    is_valid?: boolean;
    expires_at?: number;
    type?: string;
    user_id?: string;
    scopes?: string[];
  };
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

async function fetchAllAdAccounts(version: string, accessToken: string): Promise<MetaAdAccount[]> {
  const initial = new URL(`https://graph.facebook.com/${version}/me/adaccounts`);
  initial.searchParams.set("fields", "id,name,account_status,currency,timezone_name");
  initial.searchParams.set("limit", "500");
  initial.searchParams.set("access_token", accessToken);

  const accounts: MetaAdAccount[] = [];
  let next: string | undefined = initial.toString();
  while (next) {
    const page = await readJson<MetaAdAccountPage>(await fetch(next), "Meta ad accounts request");
    accounts.push(...page.data);
    next = page.paging?.next;
  }
  return accounts;
}

export async function GET() {
  const version = process.env.META_GRAPH_API_VERSION;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const accessToken = process.env.META_SYSTEM_USER_TOKEN;

  if (!version || !appId || !appSecret || !accessToken || !process.env.TOKEN_ENCRYPTION_KEY) {
    return NextResponse.redirect(appUrl("/setup", { error: "meta_system_user_not_configured" }));
  }

  const { db, pool } = createDatabase();
  try {
    const debugUrl = new URL(`https://graph.facebook.com/${version}/debug_token`);
    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
    const debug = await readJson<MetaDebugTokenResponse>(await fetch(debugUrl), "Meta token validation");
    const debugData = debug.data;
    if (!debugData?.is_valid) throw new Error("Meta system user token is invalid");

    const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
    profileUrl.searchParams.set("fields", "id,name");
    profileUrl.searchParams.set("access_token", accessToken);
    const profile = await readJson<MetaProfile>(await fetch(profileUrl), "Meta system user profile request");
    const accountList = await fetchAllAdAccounts(version, accessToken);

    const ownerEmail = process.env.OWNER_EMAIL ?? "owner@zvedeno.local";
    const workspaceName = process.env.DEFAULT_WORKSPACE_NAME ?? "Oleh workspace";
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const now = new Date();
    const expiresAt = debugData.expires_at && debugData.expires_at > 0
      ? new Date(debugData.expires_at * 1000)
      : null;

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
          label: `${profile.name ?? "Meta"} · System User`,
          encryptedAccessToken: encryptSecret(accessToken),
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
          label: `${profile.name ?? "Meta"} · System User`,
          externalUserId: profile.id,
          encryptedAccessToken: encryptSecret(accessToken),
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

    return NextResponse.redirect(appUrl("/setup/accounts", {
      meta: "connected",
      accounts: String(accountList.length),
      mode: expiresAt ? "system_user_expiring" : "system_user_permanent"
    }));
  } catch (error) {
    console.error("Meta system user connection failed", error);
    return NextResponse.redirect(appUrl("/setup", { error: "meta_system_user_failed" }));
  } finally {
    await pool.end();
  }
}
