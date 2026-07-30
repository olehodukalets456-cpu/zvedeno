import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/app/projects/[projectId]/analytics/page.tsx";
let source = readFileSync(path, "utf8");

if (source.includes("const linkedAccounts = await db")) {
  console.log("Analytics linked-account filter patch already applied");
  process.exit(0);
}

const replacements = [
  {
    marker: 'import { and, asc, eq, gte, lte } from "drizzle-orm";',
    replacement: 'import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";'
  },
  {
    marker: `  mediaAssets,
  projects,
  reportRecipes`,
    replacement: `  mediaAssets,
  projectAdAccounts,
  projects,
  reportRecipes`
  },
  {
    marker: `    account: row.accountName || row.accountId,`,
    replacement: `    account: row.accountName ? \`${"${row.accountName} · ${row.accountId}"}\` : row.accountId,`
  },
  {
    marker: `    const source = await db`,
    replacement: `    const linkedAccounts = await db
      .select({
        externalId: adAccounts.externalAccountId,
        name: adAccounts.name,
        status: adAccounts.status
      })
      .from(projectAdAccounts)
      .innerJoin(adAccounts, eq(projectAdAccounts.adAccountId, adAccounts.id))
      .where(and(
        eq(projectAdAccounts.projectId, project.id),
        isNull(projectAdAccounts.activeTo)
      ))
      .orderBy(asc(adAccounts.status), asc(adAccounts.name));

    const source = await db`
  },
  {
    marker: `    const accounts = Array.from(new Set(dimensionCache.map(({ dimensions }) => dimensions.account))).sort();`,
    replacement: `    const linkedAccountOptions = linkedAccounts.map((account) => ({
      value: account.externalId,
      label: \`${"${account.name} · ${account.externalId}${account.status === \"active\" ? \"\" : \" · недоступний\"}"}\`
    }));
    const accounts = linkedAccountOptions.length > 0
      ? linkedAccountOptions
      : Array.from(new Map(rows.map((row) => [row.accountId, {
          value: row.accountId,
          label: \`${"${row.accountName || row.accountId} · ${row.accountId}"}\`
        }])).values()).sort((left, right) => left.label.localeCompare(right.label, "uk-UA"));`
  },
  {
    marker: `      if (accountFilter && dimensions.account !== accountFilter) return false;`,
    replacement: `      if (
        accountFilter
        && row.accountId !== accountFilter
        && row.accountName !== accountFilter
        && dimensions.account !== accountFilter
      ) return false;`
  },
  {
    marker: `{accounts.map((value) => <option value={value} key={value}>{value}</option>)}`,
    replacement: `{accounts.map((account) => (
                  <option value={account.value} key={account.value}>{account.label}</option>
                ))}`
  }
];

for (const { marker, replacement } of replacements) {
  if (!source.includes(marker)) {
    throw new Error(`Analytics linked-account filter patch failed: marker not found:\n${marker}`);
  }
  source = source.replace(marker, replacement);
}

writeFileSync(path, source);
console.log("Applied linked-project account options to analytics filter");
