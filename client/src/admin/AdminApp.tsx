import { useEffect, useState } from "react";
import { api } from "./api";
import { EmployeesTab } from "./EmployeesTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { GroupsTab } from "./GroupsTab";
import { CoursesTab } from "./CoursesTab";
import { AssignmentsTab } from "./AssignmentsTab";
import { DashboardTab } from "./DashboardTab";
import { LoginForm, type SessionUser as User } from "../shared/LoginForm";

export default function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = ещё не проверили
  const [tab, setTab] = useState<
    "dashboard" | "employees" | "departments" | "groups" | "courses" | "assignments"
  >("dashboard");

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
            ["dashboard", "Дашборд"],
            ["courses", "Курсы"],
            ["assignments", "Назначения"],
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

      {tab === "dashboard" && <DashboardTab />}
      {tab === "courses" && <CoursesTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "departments" && <DepartmentsTab />}
      {tab === "groups" && <GroupsTab />}
    </div>
  );
}
