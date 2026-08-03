import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createDatabase, users, workspaceMembers, workspaces } from "@zvedeno/database";
import { currentWorkspaceUser } from "../../../lib/auth/workspace-user";

const ROLES = new Set(["owner", "admin", "member", "viewer"] as const);
type Role = "owner" | "admin" | "member" | "viewer";

function redirectUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000");
}

export async function POST(request: NextRequest) {
  if (process.env.AUTH_ENFORCED === "true") {
    const currentUser = await currentWorkspaceUser();
    if (currentUser?.role !== "owner" && currentUser?.role !== "admin") {
      return NextResponse.redirect(redirectUrl("/users?error=forbidden"), 303);
    }
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
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);
    if (!workspace) return NextResponse.redirect(redirectUrl("/users?error=workspace_not_found"), 303);

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
      .values({ workspaceId: workspace.id, userId: user.id, role })
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
