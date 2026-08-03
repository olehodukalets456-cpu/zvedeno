import Link from "next/link";
import { AuthForm } from "./auth-form";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function callbackValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const parsed = new URL(raw, "https://zvedeno.local");
    return parsed.origin === "https://zvedeno.local" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch {
    return "/";
  }
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const callbackUrl = callbackValue(query.callbackUrl);
  const error = single(query.error);

  return (
    <main className="aiShell authPage">
      <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
      <Link className="aiBrand authBrand" href="/"><span className="aiBrandMark" />Zvedeno</Link>
      <section className="authLayout">
        <div className="authIntro">
          <div className="eyebrow">SECURE WORKSPACE</div>
          <h1>Твої проєкти. Твої дані. Без чужих звітів.</h1>
          <p>
            Авторизація працює через Neon Auth. Сесії та користувачі зберігаються у тій самій
            інфраструктурі, а workspace-роль визначає доступ до звітів і налаштувань.
          </p>
          {error === "not_invited" && (
            <div className="errorNotice authInviteNotice">
              Цей email ще не доданий до workspace. Owner або admin має спочатку підготувати доступ у розділі «Користувачі».
            </div>
          )}
        </div>
        <AuthForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
