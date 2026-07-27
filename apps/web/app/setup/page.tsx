import Link from "next/link";

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
  const metaReady = missingMetaEnv.length === 0;
  const error = typeof params.error === "string" ? params.error : undefined;
  const connected = params.meta === "connected";
  const accounts = typeof params.accounts === "string" ? params.accounts : undefined;

  return (
    <main className="setupMain">
      <Link className="backLink" href="/">← На головну</Link>

      <header className="setupHeader">
        <div className="eyebrow">Налаштування звіту</div>
        <h1>Підключаємо джерела без ручної возні.</h1>
        <p>
          Спочатку підключаємо Meta. Після цього сервіс покаже рекламні кабінети,
          кампанії та доступні результати для майбутнього звіту.
        </p>

        {error === "meta_not_configured" && (
          <div className="errorNotice">Meta OAuth ще не налаштований у локальному .env.</div>
        )}
        {error === "meta_oauth_failed" && (
          <div className="errorNotice">Meta не завершила авторизацію. Деталі дивись у Terminal.</div>
        )}
        {connected && (
          <div className="successNotice">
            Meta підключено. Знайдено рекламних кабінетів: {accounts ?? "0"}.
          </div>
        )}
      </header>

      <section className="setupList">
        <article className="setupCard">
          <div className="setupIndex">1</div>
          <div className="setupCopy">
            <h2>Підключити Meta</h2>
            <p>Авторизація, отримання доступних рекламних кабінетів і збереження підключення.</p>
            {!metaReady && (
              <div className="configNotice">
                Спершу треба створити Meta App і заповнити змінні:
                <ul className="missingList">
                  {missingMetaEnv.map((key) => <li key={key}>{key}</li>)}
                </ul>
              </div>
            )}
          </div>
          {metaReady ? (
            <Link className="primaryButton" href="/api/integrations/meta/connect">Підключити Meta</Link>
          ) : (
            <span className="disabledButton" aria-disabled="true">Потрібні ключі Meta</span>
          )}
        </article>

        <article className="setupCard isLocked">
          <div className="setupIndex">2</div>
          <div className="setupCopy">
            <h2>Обрати кабінети та проєкти</h2>
            <p>Старі й нові рекламні кабінети можна буде обʼєднати в один постійний проєкт.</p>
          </div>
          <span className="disabledButton" aria-disabled="true">Після Meta</span>
        </article>

        <article className="setupCard isLocked">
          <div className="setupIndex">3</div>
          <div className="setupCopy">
            <h2>Обрати дані й період</h2>
            <p>Кампанії, дні, креативи, результати, воронка та частота оновлення.</p>
          </div>
          <span className="disabledButton" aria-disabled="true">Після кабінетів</span>
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
}
