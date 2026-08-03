import { and, count, eq } from "drizzle-orm";
import { createDatabase, users, workspaceMembers, workspaces } from "@zvedeno/database";
import { auth } from "./server";

export type CurrentWorkspaceUser = {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: "owner" | "admin" | "member" | "viewer";
};

export async function currentWorkspaceUser(): Promise<CurrentWorkspaceUser | null> {
  const { data: session } = await auth.getSession();
  const authUser = session?.user;
  const email = authUser?.email?.trim().toLocaleLowerCase("en-US");
  if (!authUser || !email) return null;

  const fallbackName = email.split("@")[0] || "Zvedeno user";
  const { db, pool } = createDatabase();
  try {
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);
    if (!workspace) return null;

    const [membershipSummary] = await db
      .select({ total: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    const workspaceHasMembers = Number(membershipSummary?.total ?? 0) > 0;

    let [appUser] = await db
      .select({ id: users.id, email: users.email, name: users.name, imageUrl: users.imageUrl })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!appUser) {
      if (workspaceHasMembers) return null;
      [appUser] = await db
        .insert(users)
        .values({
          email,
          name: authUser.name ?? fallbackName,
          imageUrl: authUser.image ?? null
        })
        .returning({ id: users.id, email: users.email, name: users.name, imageUrl: users.imageUrl });
    } else {
      const nextName = authUser.name ?? appUser.name;
      const nextImage = authUser.image ?? appUser.imageUrl;
      if (nextName !== appUser.name || nextImage !== appUser.imageUrl) {
        await db
          .update(users)
          .set({ name: nextName, imageUrl: nextImage, updatedAt: new Date() })
          .where(eq(users.id, appUser.id));
        appUser = { ...appUser, name: nextName, imageUrl: nextImage };
      }
    }

    if (!appUser) return null;

    let [membership] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, appUser.id)))
      .limit(1);

    if (!membership) {
      if (workspaceHasMembers) return null;
      [membership] = await db
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId: appUser.id, role: "owner" })
        .returning({ role: workspaceMembers.role });
    }

    return membership ? { ...appUser, role: membership.role } : null;
  } finally {
    await pool.end();
  }
}
