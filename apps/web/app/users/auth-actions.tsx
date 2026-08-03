"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "../../lib/auth/client";

export function AuthActions({ authenticated }: { authenticated: boolean }) {
  const [pending, setPending] = useState(false);

  if (!authenticated) {
    return <Link className="primaryButton aiPrimary" href="/auth/sign-in?callbackUrl=/users">Увійти або створити кабінет</Link>;
  }

  return (
    <button
      className="secondaryButton aiSecondary"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await authClient.signOut();
          window.location.assign("/");
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Вихід…" : "Вийти"}
    </button>
  );
}
