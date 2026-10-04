import { useEffect, useState } from "react";
import { api } from "./api";
import { EmployeesTab } from "./EmployeesTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { GroupsTab } from "./GroupsTab";
import { CoursesTab } from "./CoursesTab";

type User = { id: string; fullName: string; email: string; role: string };

export default function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = ещё не проверили
  const [tab, setTab] = useState<"employees" | "departments" | "groups" | "courses">("courses");

  useEffect(() => {
    api
      .get<{ user: User }>("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <p style={{ padding: 24 }}>Загрузка…</p>;
  if (user === null) return <LoginForm onLogin={setUser} />;
  if (user.role !== "admin") return <p style={{ padding: 24 }}>Доступ только для администратора.</p>;

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <h1>Админка</h1>
        <button onClick={() => api.post("/auth/logout").then(() => setUser(null))}>Выйти</button>
      </header>

      <nav style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(
          [
            ["courses", "Курсы"],
            ["employees", "Сотрудники"],
            ["departments", "Отделы"],
            ["groups", "Группы"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{ fontWeight: tab === key ? 700 : 400 }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "courses" && <CoursesTab />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "departments" && <DepartmentsTab />}
      {tab === "groups" && <GroupsTab />}
    </div>
  );
}

function LoginForm({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const d = await api.post<{ user: User }>("/auth/login", { email, password });
      onLogin(d.user);
    } catch {
      setError("Неверный email или пароль");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Вход в админку</h1>
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
