import "./ui-theme.css";
import { useEffect, useState } from "react";
import { api } from "./admin/api";
import { LoginForm, type SessionUser } from "./shared/LoginForm";
import { InviteScreen } from "./shared/InviteScreen";
import OfflineBanner from "./shared/OfflineBanner";
import AdminApp from "./admin/AdminApp";
import EmployeeApp from "./employee/EmployeeApp";
import { readInviteToken } from "./shared/invitation-location";

// Read once before React renders: StrictMode may call state initializers twice.
const initialInviteToken = readInviteToken(window.location, window.history);

export default function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);

  useEffect(() => {
    if (inviteToken) return;
    api
      .get<{ user: SessionUser }>("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, [inviteToken]);

  if (inviteToken) {
    return (
      <>
        <OfflineBanner />
        <InviteScreen
          token={inviteToken}
          onLogin={(u) => {
            // После успешного приёма приглашения убираем /invite/... из адресной
            // строки, чтобы обновление страницы не возвращало на этот экран.
            window.history.replaceState(null, "", "/");
            setInviteToken(null);
            setUser(u);
          }}
        />
      </>
    );
  }

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
