import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createDatabase, users, workspaceMembers, workspaces } from "@zvedeno/database";
import { canManageWorkspace, currentWorkspaceUser } from "../../lib/auth/workspace-user";
import { AuthActions } from "./auth-actions";

type UsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const query = await searchParams;
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) redirect("/auth/sign-in?callbackUrl=/users");
  const canManage = canManageWorkspace(currentUser);
  const { db, pool } = createDatabase();
  try {
    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, currentUser.workspaceId))
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
          <Link className="backLink aiBack" href="/projects">← До кабінету проєктів</Link>
          <AuthActions authenticated />
        </div>
        <header className="setupHeader compactHeader aiPageHeader">
          <div className="eyebrow">TEAM ACCESS</div>
          <h1>Користувачі, запрошення й ролі доступу.</h1>
          <p>
            Спочатку owner або admin додає email і роль. Потім людина створює кабінет із цим самим email
            та отримує доступ до workspace. Випадкова реєстрація без запрошення не відкриває жодних проєктів.
          </p>
        </header>

        <div className="successNotice">Увійшов як {currentUser.email} · {currentUser.role}</div>
        {query.saved === "1" && <div className="successNotice">Email і роль підготовлено. Людина може створити кабінет.</div>}
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
            </div>
          </article>

          <article className="projectPanel aiGlass">
            <div className="formHeading"><span>Invitation</span><h2>Підготувати доступ користувачу</h2></div>
            {canManage ? (
              <form className="teamInviteForm" action="/api/users" method="post">
                <label className="fieldLabel">Імʼя<input name="name" placeholder="Імʼя користувача" /></label>
                <label className="fieldLabel">Email<input name="email" type="email" required placeholder="name@company.com" /></label>
                <label className="fieldLabel">
                  Роль
                  <select name="role" defaultValue="viewer">
                    <option value="viewer">Viewer — лише перегляд</option>
                    <option value="member">Member — звіти та ручні результати</option>
                    <option value="admin">Admin — проєкти, Meta і команда</option>
                    <option value="owner">Owner — повний доступ</option>
                  </select>
                </label>
                <button className="primaryButton aiPrimary" type="submit">Підготувати доступ</button>
              </form>
            ) : <div className="configNotice">Додавати людей можуть лише owner або admin.</div>}
            <p className="teamAuthNote">
              Після цього надішли людині посилання <strong>etarget.site/auth/sign-in?mode=sign-up</strong>.
              Вона сама задасть пароль — адміністратори його не бачать і не створюють.
            </p>
          </article>
        </section>
      </main>
    );
  } finally {
    await pool.end();
  }
}
