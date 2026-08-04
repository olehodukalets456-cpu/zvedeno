"use client";

import { useState } from "react";
import { authClient } from "../../lib/auth/client";

export function SignOutButton({ className = "workspaceSignOut" }: { className?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      className={className}
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await authClient.signOut();
          window.location.assign("/auth/sign-in");
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Вихід…" : "Вийти"}
    </button>
  );
}
