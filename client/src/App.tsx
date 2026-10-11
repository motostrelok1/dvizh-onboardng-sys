import { useEffect, useState } from "react";
import { api } from "./admin/api";
import { LoginForm, type SessionUser } from "./shared/LoginForm";
import OfflineBanner from "./shared/OfflineBanner";
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

  if (user === undefined)
    return (
      <>
        <OfflineBanner />
        <p style={{ padding: 24 }}>Загрузка…</p>
      </>
    );
  if (user === null)
    return (
      <>
        <OfflineBanner />
        <LoginForm onLogin={setUser} />
      </>
    );
  return (
    <>
      <OfflineBanner />
      {user.role === "admin" ? <AdminApp /> : <EmployeeApp />}
    </>
  );
}
