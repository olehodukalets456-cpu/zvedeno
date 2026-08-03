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
      <main className="setupMain aiShell">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <Link className="backLink aiBack" href="/setup">← До підключень</Link>
        <header className="setupHeader compactHeader aiPageHeader">
          <div className="eyebrow">AI PROJECT BUILDER · КРОК 2</div>
          <h1>Обери джерела. Опиши бізнес. Решту структури збере система.</h1>
          <p>
            Zvedeno сканує тільки вибрані кабінети конкретного проєкту: кампанії, цілі,
            оголошення, назви, події, креативи та фактичну поведінку метрик. Після цього AI
            пропонує офери, воронки й основні результати для міні-кейтаро.
          </p>
        </header>

        <section className="formSection aiGlass aiMetaRefresh">
          <div className="formHeading">
            <span>Meta inventory</span>
            <h2>Оновити доступні рекламні кабінети</h2>
          </div>
          <p>
            Перевіряємо особисті кабінети, власні кабінети Business Manager і партнерські клієнтські кабінети.
          </p>
          <form action="/api/integrations/meta/accounts/refresh" method="post">
            <button className="primaryButton aiPrimary" type="submit">Оновити список кабінетів</button>
          </form>

          {(refreshStatus || discoveryStatus === "connected") && (
            <p className="aiInlineStatus">
              {refreshStatus === "failed"
                ? "Оновлення не вдалося. Перевіримо токен і доступи Meta."
                : `Знайдено ${discoveredAccounts || accounts.length} кабінетів: напряму ${directAccounts || "—"}, Business Manager ${businesses || "—"}, власних ${ownedAccounts || "—"}, партнерських ${clientAccounts || "—"}. Попереджень: ${warnings || "0"}${errors ? `, помилок: ${errors}` : ""}.`}
            </p>
          )}
        </section>

        {accounts.length === 0 ? (
          <section className="emptyState aiGlass">
            <h2>Рекламні кабінети ще не знайдені</h2>
            <p>Повернись назад і підключи Meta або онови список вище.</p>
            <Link className="primaryButton aiPrimary" href="/setup">Підключити Meta</Link>
          </section>
        ) : (
          <form className="projectForm aiProjectForm" action="/api/projects" method="post">
            <AccountSelector projects={existingProjects} accounts={accountOptions} />

            <section className="formSection aiGlass aiBriefSection">
              <div className="formHeading">
                <span>Business context</span>
                <h2>Що саме ти хочеш бачити у звіті?</h2>
              </div>
              <p>
                Пиши нормальною мовою. Наприклад: які продукти або напрями є в кабінеті,
                куди веде реклама, що вважається реальною конверсією та які зрізи потрібні команді.
                AI зіставить цей опис із фактичним контекстом кабінету, а не сліпо повірить неймінгу.
              </p>
              <label className="fieldLabel aiPromptField">
                Завдання для AI
                <textarea
                  name="projectBrief"
                  rows={7}
                  placeholder="Наприклад: у проєкті є вакансії, Telegram-канал і продаж доменів. Для вакансій розділяй сайт та лід-форми, для каналу рахуй реальні підписки окремо від Meta Lead, для бота основний результат — покупка. Показуй креативи, воронки, кабінети та фактичний CPA."
                />
              </label>
              <label className="aiToggleCard">
                <input type="checkbox" name="useAi" value="on" defaultChecked />
                <span><strong>Проаналізувати проєкт за допомогою AI</strong><small>Назви, цілі, події, метрики й доступні превʼю креативів. Токен Meta моделі не передається.</small></span>
              </label>

              <details className="aiAdvanced">
                <summary>Ручні правила як fallback</summary>
                <p>Необовʼязково. Один рядок: <strong>КЛЮЧ:Фактичний результат</strong>.</p>
                <label className="fieldLabel">
                  Напрямки та результат
                  <textarea
                    name="directionRules"
                    rows={4}
                    placeholder={"JOB:Ліди\nDMND:Підписки"}
                  />
                </label>
              </details>
            </section>

            <section className="formSection twoColumns aiGlass">
              <div>
                <div className="formHeading">
                  <span>Період</span>
                  <h2>Глибина аналізу</h2>
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
                  <h2>Режим синхронізації</h2>
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
                    <option value="auto">AI визначить по контексту</option>
                    <option value="action.lead">Ліди</option>
                    <option value="action.messaging_conversation_started_7d">Переписки</option>
                    <option value="action.link_click">Кліки</option>
                    <option value="action.omni_purchase">Покупки</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="formSection aiGlass aiProcessSection">
              <div className="formHeading">
                <span>How it works</span>
                <h2>Не магія, а контрольований pipeline</h2>
              </div>
              <div className="aiProcessGrid">
                <div><b>01</b><strong>Сканування</strong><small>Усі вибрані кампанії, оголошення, події й креативи.</small></div>
                <div><b>02</b><strong>Контекст</strong><small>AI порівнює неймінг із цілями, метриками та візуалом.</small></div>
                <div><b>03</b><strong>Конфіг</strong><small>Офери, воронки, result metric і стартові групування.</small></div>
                <div><b>04</b><strong>Перевірка</strong><small>Конфіг можна перезапустити або скоригувати без змішування проєктів.</small></div>
              </div>
            </section>

            <button className="primaryButton submitButton aiPrimary aiLaunchButton" type="submit">
              Створити проєкт і зібрати звіт
            </button>
          </form>
        )}
      </main>
    );
  } finally {
    await pool.end();
  }
}
