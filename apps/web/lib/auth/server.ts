import { createNeonAuth } from "@neondatabase/auth/next/server";

const provisionedAuthUrl = "https://ep-red-rice-axbbft4h.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth";
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET ?? process.env.TOKEN_ENCRYPTION_KEY;

if (!cookieSecret || cookieSecret.length < 32) {
  throw new Error("Neon Auth requires NEON_AUTH_COOKIE_SECRET or TOKEN_ENCRYPTION_KEY with at least 32 characters");
}

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? provisionedAuthUrl,
  cookies: {
    secret: cookieSecret
  }
});
