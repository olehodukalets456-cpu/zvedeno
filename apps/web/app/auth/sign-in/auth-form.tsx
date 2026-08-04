"use client";

import { FormEvent, useState } from "react";
import { authClient } from "../../../lib/auth/client";

type AuthMode = "sign-in" | "sign-up";

type AuthFormProps = {
  callbackUrl?: string;
  initialEmail?: string;
  initialMode?: AuthMode;
  ownerActivation?: boolean;
};

function friendlyError(message: string): string {
  if (/invalid origin/i.test(message)) return "Домен авторизації ще не дозволений. Онови сторінку й повтори спробу.";
  if (/invalid.*password|incorrect.*password|invalid credentials/i.test(message)) return "Неправильний email або пароль.";
  if (/already exists|already registered/i.test(message)) return "Кабінет із цим email уже створений. Перемкнись на «Увійти».";
  if (/password/i.test(message) && /8|short|min/i.test(message)) return "Пароль має містити щонайменше 8 символів.";
  return message || "Не вдалося завершити авторизацію.";
}

export function AuthForm({
  callbackUrl = "/projects",
  initialEmail = "",
  initialMode = "sign-in",
  ownerActivation = false
}: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
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
    const displayName = name || email.split("@")[0] || "Zvedeno user";

    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: displayName })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setMessage(friendlyError(result.error.message || ""));
        return;
      }
      window.location.assign(callbackUrl);
    } catch (error) {
      setMessage(friendlyError(error instanceof Error ? error.message : ""));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="authCard aiGlass">
      <div className="authTabs" role="tablist" aria-label="Режим авторизації">
        <button className={mode === "sign-in" ? "isActive" : ""} type="button" onClick={() => { setMode("sign-in"); setMessage(""); }}>
          Увійти
        </button>
        <button className={mode === "sign-up" ? "isActive" : ""} type="button" onClick={() => { setMode("sign-up"); setMessage(""); }}>
          {ownerActivation ? "Активувати owner" : "Створити кабінет"}
        </button>
      </div>

      {ownerActivation && mode === "sign-up" && (
        <div className="authActivationHint">
          Акаунт ще не має пароля. Придумай його зараз — готового або «стандартного» пароля не існує.
        </div>
      )}

      <form className="authForm" onSubmit={submit}>
        {mode === "sign-up" && (
          <label className="fieldLabel">Імʼя<input name="name" autoComplete="name" placeholder="Олег" defaultValue={ownerActivation ? "Oleh" : ""} /></label>
        )}
        <label className="fieldLabel">
          Email
          <input name="email" type="email" autoComplete="email" required placeholder="name@company.com" defaultValue={initialEmail} />
        </label>
        <label className="fieldLabel">
          {mode === "sign-up" ? "Створи пароль" : "Пароль"}
          <input name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={8} required placeholder="Мінімум 8 символів" />
        </label>
        {message && <div className="errorNotice">{message}</div>}
        <button className="primaryButton aiPrimary authSubmit" type="submit" disabled={pending}>
          {pending ? "Зачекай…" : mode === "sign-up" ? "Створити й увійти" : "Увійти"}
        </button>
      </form>

      <p className="authFootnote">
        Після входу відкриється кабінет проєктів. Доступ отримують лише email, які вже додані до workspace.
      </p>
    </div>
  );
}
