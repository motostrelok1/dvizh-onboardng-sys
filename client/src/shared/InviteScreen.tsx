import { useEffect, useState } from "react";
import { api } from "../admin/api";
import type { SessionUser } from "./LoginForm";

type InvitationStatus =
  | { phase: "loading" }
  | { phase: "invalid"; reason: string }
  | { phase: "ready"; fullName: string; email: string }
  | { phase: "accepted" }
  | { phase: "limited" };

const REASON_TEXT: Record<string, string> = {
  not_found: "Ссылка-приглашение не найдена.",
  expired: "Срок действия ссылки истёк.",
  used: "Эта ссылка уже использована.",
  inactive: "Учётная запись отключена — обратитесь к администратору."
};

export function InviteScreen({ token, onLogin }: { token: string; onLogin: (u: SessionUser) => void }) {
  const [status, setStatus] = useState<InvitationStatus>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<{ valid: boolean; reason?: string; fullName?: string; email?: string }>(
        `/auth/invitations/${encodeURIComponent(token)}`
      )
      .then((d) => {
        if (d.valid && d.fullName && d.email) {
          setStatus({ phase: "ready", fullName: d.fullName, email: d.email });
        } else {
          setStatus({ phase: "invalid", reason: d.reason ?? "not_found" });
        }
      })
      .catch((err) => setStatus(err instanceof Error && err.message === "rate_limited"
        ? { phase: "limited" } : { phase: "invalid", reason: "not_found" }));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError("Пароль слишком длинный: максимум 72 байта (буквы кириллицы занимают больше одного байта).");
      return;
    }
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setSubmitting(true);
    try {
      await api.post<{ ok: true }>(`/auth/invitations/${encodeURIComponent(token)}/accept`, { password });
      const me = await api.get<{ user: SessionUser }>("/auth/me");
      setStatus({ phase: "accepted" });
      onLogin(me.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message === "rate_limited"
        ? "Слишком много попыток. Подождите до 10 минут и попробуйте снова."
        : message === "password_too_long" ? "Пароль слишком длинный: максимум 72 байта."
        : message || "Не удалось задать пароль");
      setSubmitting(false);
    }
  }

  if (status.phase === "loading") {
    return <p style={{ padding: 24, fontFamily: "system-ui" }}>Проверяем ссылку…</p>;
  }

  if (status.phase === "limited") {
    return <p style={{ padding: 24, fontFamily: "system-ui" }}>
      Слишком много запросов. Подождите до 10 минут, затем откройте ссылку снова.
    </p>;
  }

  if (status.phase === "invalid") {
    return (
      <div style={{ maxWidth: 320, margin: "80px auto", fontFamily: "system-ui", textAlign: "center" }}>
        <h1>Ссылка недействительна</h1>
        <p>{REASON_TEXT[status.reason] ?? "Ссылка-приглашение недействительна."}</p>
        <p>Попросите администратора прислать новую ссылку.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Добро пожаловать, {status.phase === "ready" ? status.fullName : ""}</h1>
      <p style={{ color: "#6b7686" }}>{status.phase === "ready" ? status.email : ""}</p>
      <p>Задайте пароль, чтобы войти в систему.</p>
      <input
        placeholder="Пароль (от 8 символов)"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ display: "block", width: "100%", marginBottom: 8, padding: 8 }}
      />
      <input
        placeholder="Повторите пароль"
        type="password"
        value={password2}
        onChange={(e) => setPassword2(e.target.value)}
        style={{ display: "block", width: "100%", marginBottom: 8, padding: 8 }}
      />
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Сохраняем…" : "Войти"}
      </button>
    </form>
  );
}
