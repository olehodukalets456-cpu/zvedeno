"use client";

import { useMemo, useState } from "react";

export type SetupProjectOption = {
  id: string;
  name: string;
};

export type SetupAccountOption = {
  id: string;
  externalId: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  status: string;
  linkedProjects: SetupProjectOption[];
};

type AccountSelectorProps = {
  targetProject?: SetupProjectOption | null;
  accounts: SetupAccountOption[];
};

function accountMatches(account: SetupAccountOption, search: string): boolean {
  if (!search) return true;
  const haystack = [
    account.name,
    account.externalId,
    account.currency ?? "",
    ...account.linkedProjects.map((project) => project.name)
  ].join(" ").toLocaleLowerCase("uk-UA");
  return haystack.includes(search);
}

export function AccountSelector({ targetProject, accounts }: AccountSelectorProps) {
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("uk-UA");

  const activeAccounts = useMemo(() => (
    accounts.filter((account) => account.status === "active" && accountMatches(account, normalizedSearch))
  ), [accounts, normalizedSearch]);
  const inactiveAccounts = useMemo(() => (
    accounts.filter((account) => account.status !== "active" && accountMatches(account, normalizedSearch))
  ), [accounts, normalizedSearch]);
  const linkedAccountIds = useMemo(() => new Set(
    targetProject
      ? accounts
          .filter((account) => account.linkedProjects.some((project) => project.id === targetProject.id))
          .map((account) => account.id)
      : []
  ), [accounts, targetProject]);

  function toggleAccount(accountId: string) {
    if (linkedAccountIds.has(accountId)) return;
    setSelectedAccountIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function renderAccount(account: SetupAccountOption) {
    const linkedNames = account.linkedProjects.map((project) => project.name).join(", ");
    const alreadyLinked = linkedAccountIds.has(account.id);
    return (
      <label className={`accountOption ${alreadyLinked ? "isLinked" : ""}`} key={account.id}>
        <input
          checked={alreadyLinked || selectedAccountIds.has(account.id)}
          disabled={alreadyLinked}
          name="accountIds"
          onChange={() => toggleAccount(account.id)}
          type="checkbox"
          value={account.id}
        />
        <div>
          <strong>{account.name}</strong>
          <small>
            {account.externalId} · {account.currency ?? "—"} · {account.status}
            {linkedNames ? ` · у проєкті: ${linkedNames}` : ""}
            {alreadyLinked ? " · уже підключений" : ""}
          </small>
        </div>
      </label>
    );
  }

  return (
    <>
      <section className="formSection aiGlass projectIdentityStep">
        <div className="formHeading">
          <span>Крок 3 · Проєкт</span>
          <h2>{targetProject ? `Додаємо джерела до ${targetProject.name}` : "Назви новий проєкт"}</h2>
        </div>
        {targetProject ? (
          <>
            <input type="hidden" name="existingProjectId" value={targetProject.id} />
            <p>Поточні кабінети вже позначені. Нижче обери лише нові джерела, які треба додати.</p>
          </>
        ) : (
          <label className="fieldLabel">
            Назва проєкту
            <input name="projectName" placeholder="Наприклад, DMND" required />
          </label>
        )}
      </section>

      <section className="formSection aiGlass">
        <div className="formHeading">
          <span>Крок 4 · Джерела</span>
          <h2>Обери рекламні кабінети для цього проєкту</h2>
        </div>
        <label className="fieldLabel">
          Пошук кабінету
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Назва, ID, валюта або проєкт"
            type="search"
            value={search}
          />
        </label>
        <p className="accountSelectionSummary">
          Активних: <strong>{accounts.filter((account) => account.status === "active").length}</strong> ·
          недоступних: <strong>{accounts.filter((account) => account.status !== "active").length}</strong> ·
          уже підключено: <strong>{linkedAccountIds.size}</strong> ·
          вибрано нових: <strong>{selectedAccountIds.size}</strong>
        </p>

        <div className="accountGrid">
          {activeAccounts.map(renderAccount)}
        </div>
        {activeAccounts.length === 0 && <p>Активних кабінетів за цим пошуком немає.</p>}

        {inactiveAccounts.length > 0 && (
          <details>
            <summary>Показати недоступні або заблоковані кабінети ({inactiveAccounts.length})</summary>
            <div className="accountGrid">
              {inactiveAccounts.map(renderAccount)}
            </div>
          </details>
        )}
      </section>
    </>
  );
}
