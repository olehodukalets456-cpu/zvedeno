export type MetaAdAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
};

type MetaBusiness = {
  id: string;
  name?: string;
};

type MetaPage<T> = {
  data: T[];
  paging?: { next?: string };
};

export type MetaAccountDiscovery = {
  accounts: MetaAdAccount[];
  directCount: number;
  businessCount: number;
  ownedCount: number;
  clientCount: number;
  warnings: string[];
};

const ACCOUNT_FIELDS = "id,name,account_status,currency,timezone_name";

async function readJson<T>(response: Response, label: string): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function fetchAllPages<T>(initial: URL, label: string): Promise<T[]> {
  const values: T[] = [];
  let next: string | undefined = initial.toString();

  while (next) {
    const response: Response = await fetch(next, { cache: "no-store" });
    const page: MetaPage<T> = await readJson<MetaPage<T>>(response, label);
    values.push(...page.data);
    next = page.paging?.next;
  }

  return values;
}

function graphUrl(version: string, path: string, accessToken: string, fields: string, limit = "500"): URL {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", limit);
  url.searchParams.set("access_token", accessToken);
  return url;
}

function mergeAccounts(target: Map<string, MetaAdAccount>, accounts: MetaAdAccount[]): void {
  for (const account of accounts) {
    const current = target.get(account.id);
    target.set(account.id, {
      ...current,
      ...account,
      name: account.name ?? current?.name,
      currency: account.currency ?? current?.currency,
      timezone_name: account.timezone_name ?? current?.timezone_name,
      account_status: account.account_status ?? current?.account_status
    });
  }
}

export async function discoverMetaAdAccounts(
  version: string,
  accessToken: string
): Promise<MetaAccountDiscovery> {
  const warnings: string[] = [];
  const merged = new Map<string, MetaAdAccount>();

  const direct = await fetchAllPages<MetaAdAccount>(
    graphUrl(version, "me/adaccounts", accessToken, ACCOUNT_FIELDS),
    "Meta direct ad accounts request"
  );
  mergeAccounts(merged, direct);

  let businesses: MetaBusiness[] = [];
  try {
    businesses = await fetchAllPages<MetaBusiness>(
      graphUrl(version, "me/businesses", accessToken, "id,name", "100"),
      "Meta businesses request"
    );
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  const ownedIds = new Set<string>();
  const clientIds = new Set<string>();

  for (const business of businesses) {
    try {
      const owned = await fetchAllPages<MetaAdAccount>(
        graphUrl(version, `${business.id}/owned_ad_accounts`, accessToken, ACCOUNT_FIELDS),
        `Meta owned ad accounts request for ${business.name ?? business.id}`
      );
      owned.forEach((account) => ownedIds.add(account.id));
      mergeAccounts(merged, owned);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }

    try {
      const clients = await fetchAllPages<MetaAdAccount>(
        graphUrl(version, `${business.id}/client_ad_accounts`, accessToken, ACCOUNT_FIELDS),
        `Meta client ad accounts request for ${business.name ?? business.id}`
      );
      clients.forEach((account) => clientIds.add(account.id));
      mergeAccounts(merged, clients);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    accounts: Array.from(merged.values()).sort((left, right) => (
      (left.name ?? left.id).localeCompare(right.name ?? right.id, "uk-UA")
    )),
    directCount: new Set(direct.map((account) => account.id)).size,
    businessCount: businesses.length,
    ownedCount: ownedIds.size,
    clientCount: clientIds.size,
    warnings
  };
}
