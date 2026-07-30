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
  projects: SetupProjectOption[];
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

export function AccountSelector({ projects, accounts }: AccountSelectorProps) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("uk-UA");

  const activeAccounts = useMemo(() => (
    accounts.filter((account) => account.status === "active" && accountMatches(account, normalizedSearch))
  ), [accounts, normalizedSearch]);
  const inactiveAccounts = useMemo(() => (
    accounts.filter((account) => account.status !== "active" && accountMatches(account, normalizedSearch))
  ), [accounts, normalizedSearch]);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedAccountIds(new Set(
      projectId
        ? accounts
            .filter((account) => account.linkedProjects.some((project) => project.id === projectId))
            .map((account) => account.id)
        : []
    ));
  }

  function toggleAccount(accountId: string) {
    setSelectedAccountIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function renderAccount(account: SetupAccountOption) {
    const linkedNames = account.linkedProjects.map((project) => project.name).join(", ");
    return (
      <label className="accountOption" key={account.id}>
        <input
          checked={selectedAccountIds.has(account.id)}
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
          </small>
        </div>
      </label>
    );
  }

  return (
    <>
      <section className="formSection twoColumns">
        <div>
          <div className="formHeading">
            <span>Продовжити</span>
            <h2>Додати кабінети до існуючого проєкту</h2>
          </div>
          <label className="fieldLabel">
            Існуючий проєкт
            <select
              name="existingProjectId"
              onChange={(event) => selectProject(event.target.value)}
              value={selectedProjectId}
            >
              <option value="">Створити новий проєкт</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {selectedProjectId && (
            <p>
              Уже прив’язані кабінети відмічені автоматично. Додай нові або зніми зайві позначки перед збереженням.
            </p>
          )}
        </div>
        <div>
          <div className="formHeading">
            <span>Новий</span>
            <h2>Або створи новий проєкт</h2>
          </div>
          <label className="fieldLabel">
            Назва нового проєкту
            <input
              disabled={Boolean(selectedProjectId)}
              name="projectName"
              placeholder="Наприклад, DMND"
            />
          </label>
        </div>
      </section>

      <section className="formSection">
        <div className="formHeading">
          <span>Джерела</span>
          <h2>Які рекламні кабінети належать цьому проєкту?</h2>
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
        <p>
          Активних: <strong>{accounts.filter((account) => account.status === "active").length}</strong> ·
          недоступних або заблокованих: <strong>{accounts.filter((account) => account.status !== "active").length}</strong> ·
          вибрано: <strong>{selectedAccountIds.size}</strong>
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
