import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { adAccounts, createDatabase, projects, workspaces } from "@zvedeno/database";

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
    const existingProjects = workspace
      ? await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.workspaceId, workspace.id))
          .orderBy(asc(projects.name))
      : [];

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

        {accounts.length === 0 ? (
          <section className="emptyState">
            <h2>Рекламні кабінети ще не знайдені</h2>
            <p>Повернись назад і підключи Meta.</p>
            <Link className="primaryButton" href="/setup">Підключити Meta</Link>
          </section>
        ) : (
          <form className="projectForm" action="/api/projects" method="post">
            <section className="formSection twoColumns">
              <div>
                <div className="formHeading">
                  <span>Продовжити</span>
                  <h2>Додати кабінет до існуючого проєкту</h2>
                </div>
                <label className="fieldLabel">
                  Існуючий проєкт
                  <select name="existingProjectId" defaultValue="">
                    <option value="">Створити новий проєкт</option>
                    {existingProjects.map((project) => (
                      <option value={project.id} key={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <div className="formHeading">
                  <span>Новий</span>
                  <h2>Або створи новий проєкт</h2>
                </div>
                <label className="fieldLabel">
                  Назва нового проєкту
                  <input name="projectName" placeholder="Наприклад, DMND" />
                </label>
              </div>
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
