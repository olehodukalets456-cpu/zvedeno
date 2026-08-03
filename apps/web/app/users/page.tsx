import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { createDatabase, users, workspaceMembers, workspaces } from "@zvedeno/database";
import { currentWorkspaceUser } from "../../lib/auth/workspace-user";
import { AuthActions } from "./auth-actions";

type UsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const query = await searchParams;
  const currentUser = await currentWorkspaceUser();
  const canManage = currentUser?.role === "owner" || currentUser?.role === "admin" || process.env.AUTH_ENFORCED !== "true";
  const { db, pool } = createDatabase();
  try {
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);

    const members = workspace
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            imageUrl: users.imageUrl,
            role: workspaceMembers.role,
            createdAt: workspaceMembers.createdAt
          })
          .from(workspaceMembers)
          .innerJoin(users, eq(workspaceMembers.userId, users.id))
          .where(eq(workspaceMembers.workspaceId, workspace.id))
          .orderBy(asc(users.name), asc(users.email))
      : [];

    return (
      <main className="setupMain aiShell teamPage">
        <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        <div className="teamPageTopline">
          <Link className="backLink aiBack" href="/">← На головну</Link>
          <AuthActions authenticated={Boolean(currentUser)} />
        </div>
        <header className="setupHeader compactHeader aiPageHeader">
          <div className="eyebrow">TEAM ACCESS</div>
          <h1>Кабінети користувачів і ролі доступу.</h1>
          <p>
            Neon Auth відповідає за реєстрацію, вхід і сесії. Workspace-роль визначає,
            хто керує проєктами, хто працює зі звітами, а хто лише переглядає.
          </p>
        </header>

        {currentUser ? (
          <div className="successNotice">Увійшов як {currentUser.email} · {currentUser.role}</div>
        ) : (
          <div className="configNotice">Авторизація готова, але примусовий захист поки не ввімкнено. Створи owner-сесію перед активацією AUTH_ENFORCED.</div>
        )}
        {query.saved === "1" && <div className="successNotice">Користувача й роль збережено.</div>}
        {query.error && <div className="errorNotice">Не вдалося зберегти користувача: {String(query.error)}</div>}

        <section className="projectGrid teamGrid">
          <article className="projectPanel aiGlass">
            <div className="formHeading"><span>Workspace</span><h2>{workspace?.name ?? "Не знайдено"}</h2></div>
            <div className="teamMemberList">
              {members.map((member) => (
                <div className="teamMember" key={member.id}>
                  <div className="teamAvatar">{(member.name ?? member.email).slice(0, 1).toUpperCase()}</div>
                  <div><strong>{member.name ?? "Без імені"}</strong><small>{member.email}</small></div>
                  <span className={`teamRole teamRole-${member.role}`}>{member.role}</span>
                </div>
              ))}
              {members.length === 0 && <p>У workspace ще немає користувачів.</p>}
            </div>
          </article>

          <article className="projectPanel aiGlass">
            <div className="formHeading"><span>New account</span><h2>Підготувати доступ користувачу</h2></div>
            {canManage ? (
              <form className="teamInviteForm" action="/api/users" method="post">
                <label className="fieldLabel">Імʼя<input name="name" placeholder="Імʼя користувача" /></label>
                <label className="fieldLabel">Email<input name="email" type="email" required placeholder="name@company.com" /></label>
                <label className="fieldLabel">
                  Роль
                  <select name="role" defaultValue="viewer">
                    <option value="viewer">Viewer — лише перегляд</option>
                    <option value="member">Member — робота зі звітами</option>
                    <option value="admin">Admin — керування проєктами</option>
                    <option value="owner">Owner — повний доступ</option>
                  </select>
                </label>
                <button className="primaryButton aiPrimary" type="submit">Зберегти доступ</button>
              </form>
            ) : (
              <div className="configNotice">Додавати людей можуть лише owner або admin.</div>
            )}
            <p className="teamAuthNote">
              Тут наперед задається email і роль. Людина реєструється з цим самим email на сторінці входу,
              після чого її Neon Auth-сесія автоматично прив’язується до підготовленого доступу.
            </p>
          </article>
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
