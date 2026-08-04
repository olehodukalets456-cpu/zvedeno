import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { adAccounts, createDatabase, projects } from "@zvedeno/database";
import { canManageWorkspace, currentWorkspaceUser } from "../../lib/auth/workspace-user";

const requiredMetaEnv = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_API_VERSION",
  "META_REDIRECT_URI",
  "TOKEN_ENCRYPTION_KEY"
] as const;

type SetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect("/auth/sign-in?callbackUrl=/setup");
  if (!canManageWorkspace(currentUser)) redirect("/projects?error=forbidden");

  const missingMetaEnv = requiredMetaEnv.filter((key) => !process.env[key]);
  const oauthReady = missingMetaEnv.length === 0;
  const systemUserReady = oauthReady && Boolean(process.env.META_SYSTEM_USER_TOKEN);
  const error = typeof params.error === "string" ? params.error : undefined;
  const connected = params.meta === "connected";
  const connectedCount = typeof params.accounts === "string" ? params.accounts : undefined;

  const { db, pool } = createDatabase();
  try {
    const [accountSummary] = await db
      .select({ total: count() })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, currentUser.workspaceId));
    const [projectSummary] = await db
      .select({ total: count() })
      .from(projects)
      .where(eq(projects.workspaceId, currentUser.workspaceId));

    const accountCount = Number(accountSummary?.total ?? 0);
    const projectCount = Number(projectSummary?.total ?? 0);
    const hasAccounts = accountCount > 0;

    return (
      <div className="aiShell">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <header className="aiTopbar">
          <Link className="aiBrand" href="/projects"><span className="aiBrandMark" />Zvedeno</Link>
          <nav className="aiNav" aria-label="Основна навігація">
            <Link href="/projects">Проєкти</Link>
            <Link href="/users">Користувачі</Link>
          </nav>
        </header>

        <main className="setupMain">
          <Link className="backLink aiBack" href="/projects">← До кабінету проєктів</Link>

          <div className="onboardingProgress" aria-label="Етапи налаштування">
            <span className="isDone">1. Кабінет</span>
            <span className="isActive">2. Meta</span>
            <span className={hasAccounts ? "isDone" : ""}>3. Проєкт</span>
            <span className={projectCount > 0 ? "isDone" : ""}>4. Звіт</span>
          </div>

          <header className="setupHeader aiPageHeader">
            <div className="eyebrow">КРОК 2 · META CONNECTION</div>
            <h1>Підключи Facebook один раз. Далі обирай кабінети окремо для кожного проєкту.</h1>
            <p>
              Авторизація Meta відкриває список доступних рекламних кабінетів у твоєму workspace.
              Самі проєкти створюються наступним кроком і не змішують дані між собою.
            </p>

            {error === "meta_not_configured" && <div className="errorNotice">У Vercel відсутні обов’язкові ключі Meta.</div>}
            {error === "meta_system_user_not_configured" && <div className="errorNotice">System User token або ключі Meta відсутні у Vercel.</div>}
            {error === "meta_system_user_failed" && <div className="errorNotice">System User token не пройшов перевірку. Деталі є у Vercel Logs.</div>}
            {error === "meta_oauth_denied" && <div className="errorNotice">Авторизацію Meta скасовано або доступ не підтверджено.</div>}
            {error === "meta_oauth_invalid_response" && <div className="errorNotice">Meta повернула неповну OAuth-відповідь. Запусти підключення ще раз.</div>}
            {error === "meta_oauth_state_mismatch" && <div className="errorNotice">Сесія авторизації застаріла. Запусти підключення ще раз у цій вкладці.</div>}
            {error === "meta_token_exchange_failed" && <div className="errorNotice">Meta не дозволила отримати або перевірити довгостроковий токен.</div>}
            {error === "meta_oauth_failed" && <div className="errorNotice">Meta не завершила авторизацію. Запусти підключення ще раз.</div>}
            {connected && (
              <div className="successNotice">Meta підключено. Знайдено рекламних кабінетів: {connectedCount ?? accountCount}.</div>
            )}
          </header>

          <section className="setupList aiSetupTimeline">
            <article className="setupCard aiGlass isComplete">
              <div className="setupIndex">01</div>
              <div className="setupCopy">
                <h2>Кабінет користувача</h2>
                <p>{currentUser.email} · роль {currentUser.role}. Приватні сторінки вже закриті авторизацією.</p>
              </div>
              <span className="connectedBadge">Готово</span>
            </article>

            <article className="setupCard aiGlass">
              <div className="setupIndex">02</div>
              <div className="setupCopy">
                <h2>{hasAccounts ? "Meta підключено" : "Підключити Meta"}</h2>
                <p>{hasAccounts ? `У workspace доступно ${accountCount} рекламних кабінетів.` : "Ключі застосунку зберігаються у Vercel, а отриманий токен — зашифровано в базі."}</p>
                {!oauthReady && (
                  <div className="configNotice">
                    Додай у Vercel Environment Variables:
                    <ul className="missingList">{missingMetaEnv.map((key) => <li key={key}>{key}</li>)}</ul>
                  </div>
                )}
                {oauthReady && !systemUserReady && !hasAccounts && (
                  <div className="configNotice">OAuth готовий. Підключення побачить усі кабінети, доступні твоєму Facebook-профілю.</div>
                )}
              </div>
              <div className="setupActions">
                {systemUserReady && <Link className="primaryButton aiPrimary" href="/api/integrations/meta/system-user/connect">Підключити System User</Link>}
                {oauthReady ? (
                  <Link className={systemUserReady ? "secondaryButton aiSecondary" : "primaryButton aiPrimary"} href="/api/integrations/meta/connect">
                    {hasAccounts ? "Оновити доступи Facebook" : "Підключити Facebook"}
                  </Link>
                ) : <span className="disabledButton" aria-disabled="true">Потрібні ключі Meta</span>}
              </div>
            </article>

            <article className={`setupCard aiGlass ${hasAccounts ? "" : "isLocked"}`}>
              <div className="setupIndex">03</div>
              <div className="setupCopy">
                <h2>Створити проєкт і вибрати кабінети</h2>
                <p>Кожен проєкт отримує власні джерела, власну статистику та власний конфіг звіту.</p>
              </div>
              {hasAccounts ? <Link className="primaryButton aiPrimary" href="/setup/accounts">Перейти до проєкту</Link> : <span className="disabledButton" aria-disabled="true">Після Meta</span>}
            </article>

            <article className={`setupCard aiGlass ${projectCount > 0 ? "" : "isLocked"}`}>
              <div className="setupIndex">04</div>
              <div className="setupCopy">
                <h2>Відкрити готовий звіт</h2>
                <p>Збережені проєкти та перемикання між ними знаходяться в кабінеті проєктів.</p>
              </div>
              {projectCount > 0 ? <Link className="primaryButton aiPrimary" href="/projects">Відкрити проєкти</Link> : <span className="disabledButton" aria-disabled="true">Після створення</span>}
            </article>
          </section>
        </main>
      </div>
    );
  } finally {
    await pool.end();
  }
}
