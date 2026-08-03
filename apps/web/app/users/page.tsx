import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { createDatabase, users, workspaceMembers, workspaces } from "@zvedeno/database";

type UsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const query = await searchParams;
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
        <Link className="backLink aiBack" href="/">← На головну</Link>
        <header className="setupHeader compactHeader aiPageHeader">
          <div className="eyebrow">TEAM ACCESS</div>
          <h1>Кабінети користувачів і ролі доступу.</h1>
          <p>
            Користувачі зберігаються окремо від Meta-підключень. Роль визначає рівень доступу
            до workspace: owner, admin, member або viewer.
          </p>
        </header>

        {query.saved === "1" && <div className="successNotice">Користувача збережено.</div>}
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
            <div className="formHeading"><span>New account</span><h2>Додати користувача</h2></div>
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
              <button className="primaryButton aiPrimary" type="submit">Створити кабінет</button>
            </form>
            <p className="teamAuthNote">
              Обліковий запис і роль уже створюються в базі. Авторизацію через magic link або Google
              підключимо окремим auth-шаром, щоб не зберігати паролі самостійно.
            </p>
          </article>
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
