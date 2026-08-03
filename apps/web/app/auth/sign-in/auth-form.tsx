"use client";

import { FormEvent, useState } from "react";
import { authClient } from "../../../lib/auth/client";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0], callbackURL: callbackUrl })
        : await authClient.signIn.email({ email, password, callbackURL: callbackUrl });

      if (result.error) {
        setMessage(result.error.message || "Не вдалося завершити авторизацію.");
        return;
      }
      window.location.assign(callbackUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завершити авторизацію.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="authCard aiGlass">
      <div className="authTabs" role="tablist" aria-label="Режим авторизації">
        <button className={mode === "sign-in" ? "isActive" : ""} type="button" onClick={() => setMode("sign-in")}>Увійти</button>
        <button className={mode === "sign-up" ? "isActive" : ""} type="button" onClick={() => setMode("sign-up")}>Створити кабінет</button>
      </div>

      <form className="authForm" onSubmit={submit}>
        {mode === "sign-up" && (
          <label className="fieldLabel">Імʼя<input name="name" autoComplete="name" placeholder="Олег" /></label>
        )}
        <label className="fieldLabel">Email<input name="email" type="email" autoComplete="email" required placeholder="name@company.com" /></label>
        <label className="fieldLabel">Пароль<input name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={8} required placeholder="Мінімум 8 символів" /></label>
        {message && <div className="errorNotice">{message}</div>}
        <button className="primaryButton aiPrimary authSubmit" type="submit" disabled={pending}>
          {pending ? "Зачекай…" : mode === "sign-up" ? "Створити кабінет" : "Увійти"}
        </button>
      </form>

      <p className="authFootnote">
        Після реєстрації email автоматично зіставиться з роллю, яку адміністратор підготував у workspace.
      </p>
    </div>
  );
}
