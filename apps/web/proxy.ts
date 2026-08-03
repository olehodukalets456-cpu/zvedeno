import { NextResponse, type NextRequest } from "next/server";
import { currentWorkspaceUser } from "./lib/auth/workspace-user";

export default async function proxy(request: NextRequest) {
  if (process.env.AUTH_ENFORCED !== "true") {
    return NextResponse.next();
  }

  const currentUser = await currentWorkspaceUser();
  if (currentUser) return NextResponse.next();

  const loginUrl = new URL("/auth/sign-in", request.url);
  if (request.method === "GET") {
    loginUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  loginUrl.searchParams.set("error", "not_invited");
  return NextResponse.redirect(loginUrl, 303);
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/setup/:path*",
    "/users/:path*",
    "/api/projects/:path*",
    "/api/users/:path*"
  ]
};
