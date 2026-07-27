import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { adAccounts, createDatabase, workspaces } from "@zvedeno/database";

function defaultStartDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString().slice(0, 10);
}

export default async function AccountsSetupPage() {
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

    return (
      <main className="setupMain">
        <Link className="backLink" href="/setup">← До підключень</Link>
        <header className="setupHeader compactHeader">
          <div className="eyebrow">Крок 2</div>
          <h1>Обери кабінети й створи постійний проєкт.</h1>
          <p>
            Один проєкт може містити старий, новий і резервний рекламні кабінети. Історія буде
            обʼєднуватися в одному звіті.
          </p>
        </header>

        {accounts.length === 0 ? (
          <section className="emptyState">
            <h2>Рекламні кабінети ще не знайдені</h2>
            <p>Повернись назад і підключи Meta.</p>
            <Link className="primaryButton" href="/setup">Підключити Meta</Link>
          </section>
        ) : (
          <form className="projectForm" action="/api/projects" method="post">
            <section className="formSection">
              <div className="formHeading">
                <span>Проєкт</span>
                <h2>Як називається клієнт або напрямок?</h2>
              </div>
              <label className="fieldLabel">
                Назва проєкту
                <input name="projectName" required placeholder="Наприклад, DMND" />
              </label>
            </section>

            <section className="formSection">
              <div className="formHeading">
                <span>Джерела</span>
                <h2>Які рекламні кабінети належать цьому проєкту?</h2>
              </div>
              <div className="accountGrid">
                {accounts.map((account) => (
                  <label className="accountOption" key={account.id}>
                    <input type="checkbox" name="accountIds" value={account.id} />
                    <div>
                      <strong>{account.name}</strong>
                      <small>{account.externalId} · {account.currency ?? "—"} · {account.status}</small>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="formSection twoColumns">
              <div>
                <div className="formHeading">
                  <span>Період</span>
                  <h2>Звідки тягнути історію?</h2>
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
                  Основний результат
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
                <span>Структура</span>
                <h2>Що додати у звіт?</h2>
              </div>
              <div className="toggleGrid">
                <label><input type="checkbox" name="includeDaily" defaultChecked /> Дані по днях</label>
                <label><input type="checkbox" name="includeCreatives" defaultChecked /> Креативи</label>
                <label><input type="checkbox" name="includeCampaigns" defaultChecked /> Кампанії</label>
                <label><input type="checkbox" name="includeFunnel" defaultChecked /> Воронка</label>
              </div>
            </section>

            <button className="primaryButton submitButton" type="submit">Створити проєкт і завантажити дані</button>
          </form>
        )}
      </main>
    );
  } finally {
    await pool.end();
  }
}
