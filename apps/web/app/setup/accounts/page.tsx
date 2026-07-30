import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import {
  adAccounts,
  createDatabase,
  projectAdAccounts,
  projects,
  workspaces
} from "@zvedeno/database";
import { AccountSelector, type SetupAccountOption } from "./account-selector";

type AccountsSetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function defaultStartDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString().slice(0, 10);
}

export default async function AccountsSetupPage({ searchParams }: AccountsSetupPageProps) {
  const query = await searchParams;
  const { db, pool } = createDatabase();
  try {
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);

    const accounts = workspace
      ? await db
          .select({
            id: adAccounts.id,
            externalId: adAccounts.externalAccountId,
            name: adAccounts.name,
            currency: adAccounts.currency,
            timezone: adAccounts.timezone,
            status: adAccounts.status
          })
          .from(adAccounts)
          .where(eq(adAccounts.workspaceId, workspace.id))
          .orderBy(asc(adAccounts.name))
      : [];
    const existingProjects = workspace
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.workspaceId, workspace.id))
          .orderBy(asc(projects.name))
      : [];
    const accountLinks = workspace
      ? await db
          .select({
            accountId: projectAdAccounts.adAccountId,
            projectId: projects.id,
            projectName: projects.name
          })
          .from(projectAdAccounts)
          .innerJoin(projects, eq(projectAdAccounts.projectId, projects.id))
          .where(eq(projects.workspaceId, workspace.id))
      : [];

    const linkedProjectsByAccount = new Map<string, Array<{ id: string; name: string }>>();
    for (const link of accountLinks) {
      const current = linkedProjectsByAccount.get(link.accountId) ?? [];
      if (!current.some((project) => project.id === link.projectId)) {
        current.push({ id: link.projectId, name: link.projectName });
      }
      linkedProjectsByAccount.set(link.accountId, current);
    }

    const accountOptions: SetupAccountOption[] = accounts.map((account) => ({
      ...account,
      status: String(account.status),
      linkedProjects: linkedProjectsByAccount.get(account.id) ?? []
    }));

    const refreshStatus = single(query.refresh);
    const discoveryStatus = single(query.meta);
    const discoveredAccounts = single(query.accounts);
    const directAccounts = single(query.direct);
    const businesses = single(query.businesses);
    const ownedAccounts = single(query.owned);
    const clientAccounts = single(query.client);
    const warnings = single(query.warnings);
    const errors = single(query.errors);

    return (
      <main className="setupMain">
        <Link className="backLink" href="/setup">← До підключень</Link>
        <header className="setupHeader compactHeader">
          <div className="eyebrow">Крок 2</div>
          <h1>Обери кабінети, напрямки й фактичний результат.</h1>
          <p>
            Кабінети можна міняти й додавати пізніше. Історія проєкту та Google-звіт не стираються.
          </p>
        </header>

        <section className="formSection">
          <div className="formHeading">
            <span>Meta</span>
            <h2>Оновити доступні рекламні кабінети</h2>
          </div>
          <p>
            Перевіряємо особисті кабінети, власні кабінети Business Manager і партнерські клієнтські кабінети.
          </p>
          <form action="/api/integrations/meta/accounts/refresh" method="post">
            <button className="primaryButton" type="submit">Оновити список кабінетів</button>
          </form>

          {(refreshStatus || discoveryStatus === "connected") && (
            <p>
              {refreshStatus === "failed"
                ? "Оновлення не вдалося. Перевіримо токен і доступи Meta."
                : `Знайдено ${discoveredAccounts || accounts.length} кабінетів: напряму ${directAccounts || "—"}, Business Manager ${businesses || "—"}, власних ${ownedAccounts || "—"}, партнерських ${clientAccounts || "—"}. Попереджень: ${warnings || "0"}${errors ? `, помилок: ${errors}` : ""}.`}
            </p>
          )}
        </section>

        {accounts.length === 0 ? (
          <section className="emptyState">
            <h2>Рекламні кабінети ще не знайдені</h2>
            <p>Повернись назад і підключи Meta або онови список вище.</p>
            <Link className="primaryButton" href="/setup">Підключити Meta</Link>
          </section>
        ) : (
          <form className="projectForm" action="/api/projects" method="post">
            <AccountSelector projects={existingProjects} accounts={accountOptions} />

            <section className="formSection twoColumns">
              <div>
                <div className="formHeading">
                  <span>Період</span>
                  <h2>Звідки тягнути історію нового джерела?</h2>
                </div>
                <label className="fieldLabel">
                  Початкова дата
                  <input type="date" name="startDate" defaultValue={defaultStartDate()} required />
                </label>
                <label className="fieldLabel">
                  Перевіряти атрибуцію за останні
                  <select name="lookbackDays" defaultValue="28">
                    <option value="7">7 днів</option>
                    <option value="14">14 днів</option>
                    <option value="28">28 днів</option>
                    <option value="60">60 днів</option>
                  </select>
                </label>
              </div>

              <div>
                <div className="formHeading">
                  <span>Оновлення</span>
                  <h2>Як часто оновлювати звіт?</h2>
                </div>
                <label className="fieldLabel">
                  Частота
                  <select name="refreshMinutes" defaultValue="60">
                    <option value="15">Кожні 15 хвилин</option>
                    <option value="30">Кожні 30 хвилин</option>
                    <option value="60">Щогодини</option>
                    <option value="1440">Раз на день</option>
                  </select>
                </label>
                <label className="fieldLabel">
                  Основний результат Meta
                  <select name="resultMetric" defaultValue="auto">
                    <option value="auto">Визначати автоматично</option>
                    <option value="action.lead">Ліди</option>
                    <option value="action.messaging_conversation_started_7d">Переписки</option>
                    <option value="action.link_click">Кліки</option>
                    <option value="action.omni_purchase">Покупки</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="formSection">
              <div className="formHeading">
                <span>Напрямки</span>
                <h2>Які окремі вкладки створити?</h2>
              </div>
              <p>
                Сервіс бере перше слово з назви кампанії. Кожен рядок нижче: <strong>КЛЮЧ:Фактичний результат</strong>.
                Для існуючого проєкту поле можна лишити порожнім, якщо правила не змінюються.
              </p>
              <label className="fieldLabel">
                Напрямки та результат
                <textarea
                  name="directionRules"
                  rows={5}
                  placeholder={"JOB:Ліди\nDMND:Підписки"}
                />
              </label>
            </section>

            <section className="formSection">
              <div className="formHeading">
                <span>Структура</span>
                <h2>Звіт формується автоматично</h2>
              </div>
              <p>
                Видимими будуть Dashboard і вкладки напрямків. У кожній — тижневе порівняння креативів,
                дата запуску й стопу, спенд, покази, кліки, Meta-результат і поле для фактичного результату.
                Технічні дані зберігаються в прихованих вкладках.
              </p>
            </section>

            <button className="primaryButton submitButton" type="submit">Зберегти та завантажити дані</button>
          </form>
        )}
      </main>
    );
  } finally {
    await pool.end();
  }
}
