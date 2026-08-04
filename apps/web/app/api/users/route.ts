import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createDatabase, users, workspaceMembers } from "@zvedeno/database";
import { canManageWorkspace, currentWorkspaceUser } from "../../../lib/auth/workspace-user";

const ROLES = new Set(["owner", "admin", "member", "viewer"] as const);
type Role = "owner" | "admin" | "member" | "viewer";

function redirectUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "https://etarget.site");
}

export async function POST(request: NextRequest) {
  const currentUser = await currentWorkspaceUser();
  if (!currentUser || !canManageWorkspace(currentUser)) {
    return NextResponse.redirect(redirectUrl("/projects?error=forbidden"), 303);
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLocaleLowerCase("en-US");
  const name = String(form.get("name") ?? "").trim();
  const requestedRole = String(form.get("role") ?? "viewer") as Role;
  const role: Role = ROLES.has(requestedRole) ? requestedRole : "viewer";

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.redirect(redirectUrl("/users?error=invalid_email"), 303);
  }

  const { db, pool } = createDatabase();
  try {
    let [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({ email, name: name || email.split("@")[0] })
        .returning({ id: users.id });
    } else if (name) {
      await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
    }

    if (!user) throw new Error("User creation failed");

    await db
      .insert(workspaceMembers)
      .values({ workspaceId: currentUser.workspaceId, userId: user.id, role })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role }
      });

    return NextResponse.redirect(redirectUrl("/users?saved=1"), 303);
  } catch (error) {
    console.error("User account save failed", error);
    return NextResponse.redirect(redirectUrl("/users?error=save_failed"), 303);
  } finally {
    await pool.end();
  }
}
