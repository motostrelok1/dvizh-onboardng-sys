import { useEffect, useState } from "react";
import "./admin-dashboard.css";
import { api } from "./api";
import { EmployeesTab } from "./EmployeesTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { GroupsTab } from "./GroupsTab";
import { CoursesTab } from "./CoursesTab";
import { AssignmentsTab } from "./AssignmentsTab";
import { DashboardTab } from "./DashboardTab";
import { ReportsTab } from "./ReportsTab";
import { SettingsTab } from "./SettingsTab";
import { LoginForm, type SessionUser as User } from "../shared/LoginForm";

export default function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = ещё не проверили
  const [tab, setTab] = useState<
    "dashboard" | "employees" | "departments" | "groups" | "courses" | "assignments" | "reports" | "settings"
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

  const navItems = [
    ["dashboard", "Дашборд"], ["courses", "Курсы"], ["assignments", "Назначения"],
    ["reports", "Отчёты"], ["settings", "Настройки"], ["employees", "Сотрудники"],
    ["departments", "Отделы"], ["groups", "Группы"]
  ] as const;
  const currentLabel = navItems.find(([key]) => key === tab)?.[1] ?? "Дашборд";

  return (
    <div className="lms-admin">
      <aside className="lms-sidebar" aria-label="Навигация администратора">
        <div className="lms-brand"><div className="lms-brand-mark" aria-hidden="true">D</div><div>ДВИЖ<small>LEARNING SYSTEM</small></div></div>
        <nav className="lms-nav" aria-label="Разделы LMS">
          {navItems.map(([key, label]) => (
            <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        <div className="lms-side-bottom">ДВИЖ LMS · Панель администратора</div>
      </aside>
      <main className="lms-main">
        <header className="lms-topbar">
          <div><div className="lms-overline">Управление обучением</div><h1 className="lms-page-title">{currentLabel}</h1></div>
          <div className="lms-user-controls"><span>{"Администратор"}</span><button className="lms-logout" onClick={() => api.post("/auth/logout").then(() => setUser(null))}>Выйти</button></div>
        </header>
        <div className="lms-content">
          {tab === "dashboard" && <DashboardTab />}
          {tab === "courses" && <CoursesTab />}
          {tab === "assignments" && <AssignmentsTab />}
          {tab === "reports" && <ReportsTab />}
          {tab === "settings" && <SettingsTab />}
          {tab === "employees" && <EmployeesTab />}
          {tab === "departments" && <DepartmentsTab />}
          {tab === "groups" && <GroupsTab />}
        </div>
      </main>
    </div>
  );
}
