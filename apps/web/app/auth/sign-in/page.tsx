import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { createDatabase, users, workspaceMembers, workspaces } from "@zvedeno/database";
import { AuthForm } from "./auth-form";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function callbackValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/projects";
  try {
    const parsed = new URL(raw, "https://zvedeno.local");
    return parsed.origin === "https://zvedeno.local" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/projects";
  } catch {
    return "/projects";
  }
}

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const callbackUrl = callbackValue(query.callbackUrl);
  const error = single(query.error);
  const requestedMode = single(query.mode);

  const { db, pool } = createDatabase();
  try {
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [owner] = await db
      .select({ email: users.email, name: users.name })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(and(eq(workspaces.slug, workspaceSlug), eq(workspaceMembers.role, "owner")))
      .limit(1);

    let ownerNeedsActivation = false;
    if (owner?.email) {
      const result = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM neon_auth."user" WHERE lower(email) = lower($1)) AS exists',
        [owner.email]
      );
      ownerNeedsActivation = !Boolean(result.rows[0]?.exists);
    }

    const initialMode = requestedMode === "sign-up" || ownerNeedsActivation ? "sign-up" : "sign-in";
    const initialEmail = single(query.email) || (ownerNeedsActivation ? owner?.email ?? "" : "");

    return (
      <main className="aiShell authPage">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <Link className="aiBrand authBrand" href="/auth/sign-in"><span className="aiBrandMark" />Zvedeno</Link>
        <section className="authLayout">
          <div className="authIntro">
            <div className="eyebrow">SECURE WORKSPACE</div>
            <h1>Спочатку кабінет. Потім Meta. Потім проєкти й звіти.</h1>
            <p>
              Після входу ти потрапляєш у власний список проєктів. Звідти можна підключити Meta,
              створити проєкт, вибрати рекламні кабінети, зібрати звіт і перемикатися між збереженими проєктами.
            </p>
            {ownerNeedsActivation && (
              <div className="successNotice authInviteNotice">
                Owner-доступ для <strong>{owner?.email}</strong> уже підготовлений. Задай свій пароль праворуч — це і буде твій кабінет.
              </div>
            )}
            {error === "not_invited" && (
              <div className="errorNotice authInviteNotice">
                Цей email не має доступу до workspace. Owner або admin має спочатку додати його в розділі «Користувачі».
              </div>
            )}
          </div>
          <AuthForm
            callbackUrl={callbackUrl}
            initialEmail={initialEmail}
            initialMode={initialMode}
            ownerActivation={ownerNeedsActivation}
          />
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
