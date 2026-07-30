import { eq } from "drizzle-orm";
import {
  adAccounts,
  createDatabase,
  metaConnections
} from "@zvedeno/database";
import { decryptSecret } from "@zvedeno/shared";
import { discoverMetaAdAccounts } from "./meta-account-discovery";

export type MetaAccountRefreshSummary = {
  connections: number;
  accounts: number;
  direct: number;
  businesses: number;
  owned: number;
  client: number;
  warnings: number;
  errors: number;
};

export async function refreshMetaAdAccounts(): Promise<MetaAccountRefreshSummary> {
  const version = process.env.META_GRAPH_API_VERSION ?? "v23.0";
  const { db, pool } = createDatabase();
  const summary: MetaAccountRefreshSummary = {
    connections: 0,
    accounts: 0,
    direct: 0,
    businesses: 0,
    owned: 0,
    client: 0,
    warnings: 0,
    errors: 0
  };

  try {
    const connections = await db
      .select({
        id: metaConnections.id,
        workspaceId: metaConnections.workspaceId,
        encryptedAccessToken: metaConnections.encryptedAccessToken
      })
      .from(metaConnections)
      .where(eq(metaConnections.status, "active"));

    summary.connections = connections.length;

    for (const connection of connections) {
      const now = new Date();
      try {
        const discovery = await discoverMetaAdAccounts(
          version,
          decryptSecret(connection.encryptedAccessToken)
        );

        for (const account of discovery.accounts) {
          await db
            .insert(adAccounts)
            .values({
              workspaceId: connection.workspaceId,
              metaConnectionId: connection.id,
              externalAccountId: account.id,
              name: account.name ?? account.id,
              currency: account.currency,
              timezone: account.timezone_name,
              status: account.account_status === 1 ? "active" : "blocked"
            })
            .onConflictDoUpdate({
              target: [adAccounts.workspaceId, adAccounts.externalAccountId],
              set: {
                metaConnectionId: connection.id,
                name: account.name ?? account.id,
                currency: account.currency,
                timezone: account.timezone_name,
                status: account.account_status === 1 ? "active" : "blocked",
                updatedAt: now
              }
            });
        }

        await db
          .update(metaConnections)
          .set({ lastCheckedAt: now, updatedAt: now })
          .where(eq(metaConnections.id, connection.id));

        summary.accounts += discovery.accounts.length;
        summary.direct += discovery.directCount;
        summary.businesses += discovery.businessCount;
        summary.owned += discovery.ownedCount;
        summary.client += discovery.clientCount;
        summary.warnings += discovery.warnings.length;

        if (discovery.warnings.length > 0) {
          console.warn("Meta account refresh completed with warnings", {
            connectionId: connection.id,
            warnings: discovery.warnings
          });
        }
      } catch (error) {
        summary.errors += 1;
        console.error("Meta account refresh failed", {
          connectionId: connection.id,
          error
        });
      }
    }

    return summary;
  } finally {
    await pool.end();
  }
}
