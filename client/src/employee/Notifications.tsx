import { useEffect, useState } from "react";
import { api } from "../admin/api";
import { enablePush, disablePush, getPushSubscriptionStatus } from "../push";

type Notification = { id: string; title: string; body: string | null; sent_at: string; read_at: string | null };

export function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushStatus, setPushStatus] = useState<"subscribed" | "not-subscribed" | "unsupported">("not-subscribed");

  function reload() {
    api
      .get<{ notifications: Notification[]; unreadCount: number }>("/me/notifications")
      .then((d) => {
        setItems(d.notifications);
        setUnreadCount(d.unreadCount);
      });
  }

  useEffect(() => {
    reload();
    getPushSubscriptionStatus().then(setPushStatus);
    const interval = setInterval(reload, 60_000); // обновляем раз в минуту
    return () => clearInterval(interval);
  }, []);

  async function markRead(id: string) {
    await api.post(`/me/notifications/${id}/read`);
    reload();
  }

  async function togglePush() {
    if (pushStatus === "subscribed") {
      await disablePush();
      setPushStatus("not-subscribed");
    } else {
      const result = await enablePush();
      if (result === "ok") setPushStatus("subscribed");
      else if (result === "denied") alert("Уведомления заблокированы в браузере.");
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ position: "relative" }}>
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "crimson",
              color: "#fff",
              borderRadius: 99,
              fontSize: 10,
              padding: "1px 5px"
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "110%",
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 10,
            width: 300,
            maxHeight: 360,
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            zIndex: 10
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid #eee", fontSize: 12 }}>
            {pushStatus !== "unsupported" && (
              <button onClick={togglePush} style={{ fontSize: 12 }}>
                {pushStatus === "subscribed" ? "Отключить push" : "Включить push-уведомления"}
              </button>
            )}
          </div>
          {items.length === 0 && <p style={{ padding: 12, color: "#888", fontSize: 13 }}>Уведомлений нет.</p>}
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read_at && markRead(n.id)}
              style={{
                padding: 10,
                borderBottom: "1px solid #f0f0f0",
                background: n.read_at ? "#fff" : "#eef4ff",
                cursor: n.read_at ? "default" : "pointer"
              }}
            >
              <div style={{ fontSize: 13, fontWeight: n.read_at ? 400 : 700 }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 12, color: "#666" }}>{n.body}</div>}
              <div style={{ fontSize: 11, color: "#aaa" }}>{new Date(n.sent_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
