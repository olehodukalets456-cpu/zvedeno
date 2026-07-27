import Link from "next/link";
import { eq } from "drizzle-orm";
import { adAccounts, createDatabase, workspaces } from "@zvedeno/database";

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

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const missingMetaEnv = requiredMetaEnv.filter((key) => !process.env[key]);
  const oauthReady = missingMetaEnv.length === 0;
  const systemUserReady = oauthReady && Boolean(process.env.META_SYSTEM_USER_TOKEN);
  const error = typeof params.error === "string" ? params.error : undefined;
  const connected = params.meta === "connected";
  const connectedCount = typeof params.accounts === "string" ? params.accounts : undefined;

  const { db, pool } = createDatabase();
  try {
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);
    const existingAccounts = workspace
      ? await db.select({ id: adAccounts.id }).from(adAccounts).where(eq(adAccounts.workspaceId, workspace.id))
      : [];
    const hasAccounts = existingAccounts.length > 0;

    return (
      <main className="setupMain">
        <Link className="backLink" href="/">← На головну</Link>

        <header className="setupHeader">
          <div className="eyebrow">Налаштування звіту</div>
          <h1>Підключаємо джерела без ручної возні.</h1>
          <p>
            Підключаєш Meta, обираєш кабінети, період і структуру. Після цього сервіс сам
            підтримує базу та постійну Google-таблицю.
          </p>

          {error === "meta_not_configured" && (
            <div className="errorNotice">Meta App ще не налаштований у локальному файлі .env.</div>
          )}
          {error === "meta_system_user_not_configured" && (
            <div className="errorNotice">System User token або ключі Meta відсутні у .env.</div>
          )}
          {error === "meta_system_user_failed" && (
            <div className="errorNotice">System User token не пройшов перевірку. Деталі дивись у Terminal.</div>
          )}
          {error === "meta_oauth_failed" && (
            <div className="errorNotice">Meta не завершила авторизацію або не видала довгостроковий токен. Деталі дивись у Terminal.</div>
          )}
          {connected && (
            <div className="successNotice">
              Meta підключено. Знайдено рекламних кабінетів: {connectedCount ?? existingAccounts.length}.
            </div>
          )}
        </header>

        <section className="setupList">
          <article className="setupCard">
            <div className="setupIndex">1</div>
            <div className="setupCopy">
              <h2>Підключити або оновити Meta</h2>
              <p>Ці значення не вводяться на сторінці. Власник сервісу один раз записує їх у файл <code>.env</code>.</p>
              {!oauthReady && (
                <div className="configNotice">
                  Відкрий <code>~/Desktop/zvedeno/.env</code> і заповни:
                  <ul className="missingList">
                    {missingMetaEnv.map((key) => <li key={key}>{key}</li>)}
                  </ul>
                  Для постійного підключення також додай <code>META_SYSTEM_USER_TOKEN</code>.
                </div>
              )}
              {oauthReady && !systemUserReady && (
                <div className="configNotice">
                  OAuth готовий. Він автоматично обмінює короткий токен на довгостроковий. Для підключення без регулярної повторної авторизації додай у <code>.env</code> постійний <code>META_SYSTEM_USER_TOKEN</code>.
                </div>
              )}
            </div>
            <div className="setupActions">
              {systemUserReady && (
                <Link className="primaryButton" href="/api/integrations/meta/system-user/connect">
                  Підключити System User
                </Link>
              )}
              {oauthReady ? (
                <Link className={systemUserReady ? "secondaryButton" : "primaryButton"} href="/api/integrations/meta/connect">
                  {hasAccounts ? "Оновити через Facebook" : "Підключити через Facebook"}
                </Link>
              ) : (
                <span className="disabledButton" aria-disabled="true">Потрібні ключі Meta</span>
              )}
            </div>
          </article>

          <article className={`setupCard ${hasAccounts ? "" : "isLocked"}`}>
            <div className="setupIndex">2</div>
            <div className="setupCopy">
              <h2>Обрати кабінети, проєкт і дані</h2>
              <p>Створити новий проєкт або додати новий кабінет до вже існуючого звіту.</p>
            </div>
            {hasAccounts ? (
              <Link className="primaryButton" href="/setup/accounts">Продовжити</Link>
            ) : (
              <span className="disabledButton" aria-disabled="true">Після Meta</span>
            )}
          </article>

          <article className="setupCard isLocked">
            <div className="setupIndex">3</div>
            <div className="setupCopy">
              <h2>Підключити Google</h2>
              <p>Сервіс отримує refresh token і може оновлювати таблицю без твоєї присутності.</p>
            </div>
            <span className="disabledButton" aria-disabled="true">Після проєкту</span>
          </article>

          <article className="setupCard isLocked">
            <div className="setupIndex">4</div>
            <div className="setupCopy">
              <h2>Створити Google-звіт</h2>
              <p>Постійна таблиця з Dashboard, Campaigns, Daily, Creatives, Funnel і Sync Status.</p>
            </div>
            <span className="disabledButton" aria-disabled="true">Фінальний крок</span>
          </article>
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
