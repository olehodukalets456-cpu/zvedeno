import { redirect } from "next/navigation";
import { currentWorkspaceAccess } from "../lib/auth/workspace-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const access = await currentWorkspaceAccess();
  if (access.status === "allowed") redirect("/projects");
  redirect("/auth/sign-in?callbackUrl=/projects");
}
