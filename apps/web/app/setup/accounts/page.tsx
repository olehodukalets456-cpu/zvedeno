import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  adAccounts,
  createDatabase,
  projectAdAccounts,
  projects
} from "@zvedeno/database";
import { canManageWorkspace, currentWorkspaceUser } from "../../../lib/auth/workspace-user";
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

export const dynamic = "force-dynamic";

export default async function AccountsSetupPage({ searchParams }: AccountsSetupPageProps) {
  const query = await searchParams;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect("/auth/sign-in?callbackUrl=/setup/accounts");
  if (!canManageWorkspace(currentUser)) redirect("/projects?error=forbidden");

  const targetProjectId = single(query.projectId);
  const { db, pool } = createDatabase();
  try {
    const accounts = await db
      .select({
        id: adAccounts.id,
        externalId: adAccounts.externalAccountId,
        name: adAccounts.name,
        currency: adAccounts.currency,
        timezone: adAccounts.timezone,
        status: adAccounts.status
      })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, currentUser.workspaceId))
      .orderBy(asc(adAccounts.name));

    const workspaceProjects = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.workspaceId, currentUser.workspaceId), eq(projects.archived, false)))
      .orderBy(asc(projects.name));

    const targetProject = targetProjectId
      ? workspaceProjects.find((project) => project.id === targetProjectId) ?? null
      : null;
    if (targetProjectId && !targetProject) redirect("/projects?error=project_not_found");

    const accountLinks = await db
      .select({
        accountId: projectAdAccounts.adAccountId,
        projectId: projects.id,
        projectName: projects.name
      })
      .from(projectAdAccounts)
      .innerJoin(projects, eq(projectAdAccounts.projectId, projects.id))
      .where(eq(projects.workspaceId, currentUser.workspaceId));

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
    const error = single(query.error);

    return (
      <main className="setupMain aiShell">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <div className="setupWorkspaceTopline">
          <Link className="backLink aiBack" href="/projects">← До кабінету проєктів</Link>
          <span>{currentUser.email} · {currentUser.role}</span>
        </div>

        <div className="onboardingProgress" aria-label="Етапи налаштування">
          <span className="isDone">1. Кабінет</span>
          <span className="isDone">2. Meta</span>
          <span className="isActive">3. Проєкт</span>
          <span>4. AI-інтервʼю</span>
          <span>5. Звіт</span>
        </div>

        <header className="setupHeader compactHeader aiPageHeader">
          <div className="eyebrow">PROJECT BUILDER</div>
          <h1>{targetProject ? `Додай джерела до ${targetProject.name}` : "Обери Meta-кабінети для нового проєкту."}</h1>
          <p>
            {targetProject
              ? "Система завантажить дані з нових кабінетів, повторно просканує доступні метрики й запропонує оновити структуру звіту."
              : "Після вибору кабінетів система спочатку завантажить фактичні дані Meta. Лише потім AI проаналізує події, цінності, кампанії, креативи й поставить уточнювальні питання."}
          </p>
        </header>

        {error && <div className="errorNotice">Не вдалося завершити крок: {error}</div>}

        <section className="formSection aiGlass aiMetaRefresh">
          <div className="formHeading">
            <span>Meta inventory</span>
            <h2>Не бачиш потрібного кабінету?</h2>
          </div>
          <p>Оновимо особисті, власні та партнерські кабінети з усіх доступних Business Manager.</p>
          <form action="/api/integrations/meta/accounts/refresh" method="post">
            <button className="secondaryButton aiSecondary" type="submit">Оновити список кабінетів</button>
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
            <h2>Рекламні кабінети ще не підключені</h2>
            <p>Повернись до кроку Meta, авторизуй Facebook і тільки після цього створюй проєкт.</p>
            <Link className="primaryButton aiPrimary" href="/setup">Підключити Meta</Link>
          </section>
        ) : (
          <form className="projectForm aiProjectForm" action="/api/projects" method="post">
            <AccountSelector targetProject={targetProject} accounts={accountOptions} />

            <section className="formSection aiGlass aiBriefSection">
              <div className="formHeading">
                <span>Необовʼязковий контекст</span>
                <h2>Одним абзацом: що це за бізнес?</h2>
              </div>
              <p>
                Не потрібно вручну проєктувати звіт. Напиши лише те, чого Meta не може знати: що вважається реальною покупкою,
                чи є CRM, Telegram, бот, підтверджені ліди або інший фінальний результат поза рекламним кабінетом.
              </p>
              <label className="fieldLabel aiPromptField">
                Контекст для першого AI-аудиту
                <textarea
                  name="projectBrief"
                  rows={5}
                  placeholder="Наприклад: e-commerce. Головне — реальний дохід і ROAS. Частина покупок фіксується на сайті, повернення у Meta не передаються."
                />
              </label>
              <input type="hidden" name="useAi" value="on" />
            </section>

            <section className="formSection twoColumns aiGlass">
              <div>
                <div className="formHeading"><span>Період</span><h2>Скільки історії проаналізувати</h2></div>
                <label className="fieldLabel">Початкова дата<input type="date" name="startDate" defaultValue={defaultStartDate()} required /></label>
                <label className="fieldLabel">
                  Повторно перевіряти останні
                  <select name="lookbackDays" defaultValue="28">
                    <option value="7">7 днів</option><option value="14">14 днів</option><option value="28">28 днів</option><option value="60">60 днів</option>
                  </select>
                </label>
              </div>
              <div>
                <div className="formHeading"><span>Оновлення</span><h2>Режим синхронізації</h2></div>
                <label className="fieldLabel">
                  Частота
                  <select name="refreshMinutes" defaultValue="60">
                    <option value="15">Кожні 15 хвилин</option><option value="30">Кожні 30 хвилин</option><option value="60">Щогодини</option><option value="1440">Раз на день</option>
                  </select>
                </label>
                <div className="configNotice">
                  Результат, дохід, ROAS, креативи, графіки та вкладки не обираються навмання на цьому кроці. AI запропонує їх після аналізу реальних даних.
                </div>
              </div>
            </section>

            <button className="primaryButton submitButton aiPrimary aiLaunchButton" type="submit">
              {targetProject ? "Завантажити нові дані й оновити AI-аудит" : "Завантажити дані й перейти до AI-інтервʼю"}
            </button>
          </form>
        )}
      </main>
    );
  } finally {
    await pool.end();
  }
}
