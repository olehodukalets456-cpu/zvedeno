import { NextResponse, type NextRequest } from "next/server";
import { auth } from "./lib/auth/server";

const protectedProxy = auth.middleware({
  loginUrl: "/auth/sign-in"
});

export default function proxy(request: NextRequest) {
  if (process.env.AUTH_ENFORCED !== "true") {
    return NextResponse.next();
  }
  return protectedProxy(request);
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/setup/:path*",
    "/users/:path*"
  ]
};
