import { useEffect, useState } from "react";
import { api } from "./admin/api";
import { LoginForm, type SessionUser } from "./shared/LoginForm";
import AdminApp from "./admin/AdminApp";
import EmployeeApp from "./employee/EmployeeApp";

export default function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ user: SessionUser }>("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <p style={{ padding: 24 }}>Загрузка…</p>;
  if (user === null) return <LoginForm onLogin={setUser} />;
  return user.role === "admin" ? <AdminApp /> : <EmployeeApp />;
}
