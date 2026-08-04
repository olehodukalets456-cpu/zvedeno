import { NextResponse, type NextRequest } from "next/server";
import { canManageWorkspace, currentWorkspaceAccess } from "./lib/auth/workspace-user";

function loginRedirect(request: NextRequest, error?: string): NextResponse {
  const loginUrl = new URL("/auth/sign-in", request.url);
  if (request.method === "GET") {
    loginUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  if (error) loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl, 303);
}

function forbiddenResponse(request: NextRequest): NextResponse {
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (acceptsHtml) {
    const url = new URL("/projects", request.url);
    url.searchParams.set("error", "forbidden");
    return NextResponse.redirect(url, 303);
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export default async function proxy(request: NextRequest) {
  const access = await currentWorkspaceAccess();
  if (access.status === "anonymous") return loginRedirect(request);
  if (access.status !== "allowed") return loginRedirect(request, "not_invited");

  const pathname = request.nextUrl.pathname;
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const isAdminOnly =
    pathname.startsWith("/api/users") ||
    pathname.startsWith("/api/integrations") ||
    (pathname === "/api/projects" && isMutation) ||
    pathname.includes("/settings");

  if (isAdminOnly && !canManageWorkspace(access.user)) return forbiddenResponse(request);
  if (isMutation && access.user.role === "viewer") return forbiddenResponse(request);

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/setup/:path*",
    "/users/:path*",
    "/api/projects/:path*",
    "/api/users/:path*",
    "/api/integrations/:path*"
  ]
};
