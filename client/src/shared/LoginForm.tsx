import { useState } from "react";
import { api } from "../admin/api";

export type SessionUser = { id: string; fullName: string; email: string; role: string };

export function LoginForm({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const d = await api.post<{ user: SessionUser }>("/auth/login", { email, password });
      onLogin(d.user);
    } catch {
      setError("Неверный email или пароль");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Вход</h1>
      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ display: "block", width: "100%", marginBottom: 8, padding: 8 }}
      />
      <input
        placeholder="Пароль"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ display: "block", width: "100%", marginBottom: 8, padding: 8 }}
      />
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <button type="submit">Войти</button>
    </form>
  );
}
