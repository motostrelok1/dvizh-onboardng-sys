import { useEffect, useState } from "react";

// Баннер «нет сети»: показывается, пока браузер считает соединение
// отсутствующим (navigator.onLine + события online/offline). Не делает
// сетевых запросов сам — только отражает состояние браузера.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: "#c98000",
        color: "#fff",
        textAlign: "center",
        padding: "6px 12px",
        fontSize: 14
      }}
    >
      Нет подключения к интернету — часть функций недоступна
    </div>
  );
}
