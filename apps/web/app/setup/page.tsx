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
      <div className="aiShell">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <header className="aiTopbar">
          <Link className="aiBrand" href="/"><span className="aiBrandMark" />Zvedeno</Link>
          <nav className="aiNav" aria-label="Основна навігація">
            <Link href="/setup/accounts">Проєкти</Link>
            <Link href="/users">Користувачі</Link>
          </nav>
        </header>

        <main className="setupMain">
          <Link className="backLink aiBack" href="/">← На головну</Link>

          <header className="setupHeader aiPageHeader">
            <div className="eyebrow">SOURCE CONNECTION</div>
            <h1>Підключаємо джерела. Далі AI збере логіку проєкту.</h1>
            <p>
              Meta дає фактичні кампанії, оголошення, події та креативи. На наступному кроці
              ти обереш кабінети й опишеш, що має бачити команда у міні-кейтаро.
            </p>

            {error === "meta_not_configured" && (
              <div className="errorNotice">У Vercel відсутні обов’язкові ключі Meta.</div>
            )}
            {error === "meta_system_user_not_configured" && (
              <div className="errorNotice">System User token або ключі Meta відсутні у Vercel.</div>
            )}
            {error === "meta_system_user_failed" && (
              <div className="errorNotice">System User token не пройшов перевірку. Деталі є у Vercel Logs.</div>
            )}
            {error === "meta_oauth_denied" && (
              <div className="errorNotice">Авторизацію Meta скасовано або доступ не підтверджено.</div>
            )}
            {error === "meta_oauth_invalid_response" && (
              <div className="errorNotice">Meta повернула неповну OAuth-відповідь. Запусти підключення ще раз.</div>
            )}
            {error === "meta_oauth_state_mismatch" && (
              <div className="errorNotice">Сесія авторизації застаріла. Натисни підключення один раз і заверши його в цій самій вкладці.</div>
            )}
            {error === "meta_token_exchange_failed" && (
              <div className="errorNotice">Meta не дозволила отримати або перевірити довгостроковий токен. Точна причина записана у Vercel Logs.</div>
            )}
            {error === "meta_oauth_failed" && (
              <div className="errorNotice">Meta не завершила авторизацію. Запусти підключення ще раз одним кліком.</div>
            )}
            {connected && (
              <div className="successNotice">
                Meta підключено. Знайдено рекламних кабінетів: {connectedCount ?? existingAccounts.length}.
              </div>
            )}
          </header>

          <section className="setupList aiSetupTimeline">
            <article className="setupCard aiGlass">
              <div className="setupIndex">01</div>
              <div className="setupCopy">
                <h2>Підключити або оновити Meta</h2>
                <p>Ключі застосунку зберігаються у Vercel, а отриманий токен — зашифровано в базі.</p>
                {!oauthReady && (
                  <div className="configNotice">
                    Додай у Vercel Environment Variables:
                    <ul className="missingList">
                      {missingMetaEnv.map((key) => <li key={key}>{key}</li>)}
                    </ul>
                  </div>
                )}
                {oauthReady && !systemUserReady && (
                  <div className="configNotice">
                    OAuth готовий. Він бачить кабінети різних Business Manager, до яких має доступ Facebook-профіль.
                    Постійний серверний доступ краще робити через System User і призначені бізнес-активи.
                  </div>
                )}
              </div>
              <div className="setupActions">
                {systemUserReady && (
                  <Link className="primaryButton aiPrimary" href="/api/integrations/meta/system-user/connect">
                    Підключити System User
                  </Link>
                )}
                {oauthReady ? (
                  <Link className={systemUserReady ? "secondaryButton aiSecondary" : "primaryButton aiPrimary"} href="/api/integrations/meta/connect">
                    {hasAccounts ? "Оновити через Facebook" : "Підключити через Facebook"}
                  </Link>
                ) : (
                  <span className="disabledButton" aria-disabled="true">Потрібні ключі Meta</span>
                )}
              </div>
            </article>

            <article className={`setupCard aiGlass ${hasAccounts ? "" : "isLocked"}`}>
              <div className="setupIndex">02</div>
              <div className="setupCopy">
                <h2>Обрати кабінети й описати бізнес</h2>
                <p>Новий проєкт отримує власні джерела, власний AI-конфіг і власні вкладки звіту.</p>
              </div>
              {hasAccounts ? (
                <Link className="primaryButton aiPrimary" href="/setup/accounts">Запустити AI Builder</Link>
              ) : (
                <span className="disabledButton" aria-disabled="true">Після Meta</span>
              )}
            </article>

            <article className="setupCard aiGlass isLocked">
              <div className="setupIndex">03</div>
              <div className="setupCopy">
                <h2>Перевірити структуру міні-кейтаро</h2>
                <p>AI пропонує офери, воронки та ключові результати на основі саме вибраного проєкту.</p>
              </div>
              <span className="disabledButton" aria-disabled="true">Після аналізу</span>
            </article>

            <article className="setupCard aiGlass isLocked">
              <div className="setupIndex">04</div>
              <div className="setupCopy">
                <h2>Підключити Google-звіт</h2>
                <p>Окремий постійний Sheet залишається додатковим каналом експорту, а не джерелом логіки.</p>
              </div>
              <span className="disabledButton" aria-disabled="true">Фінальний крок</span>
            </article>
          </section>
        </main>
      </div>
    );
  } finally {
    await pool.end();
  }
}
