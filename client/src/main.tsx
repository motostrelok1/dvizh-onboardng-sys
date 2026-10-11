import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Регистрация service worker — только в production-сборке: в dev vite
// отдаёт неоптимизированные модули, которые SW только мешал бы кэшировать.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const hadControllerBeforeRegister = Boolean(navigator.serviceWorker.controller);
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      // Если на сервере уже лежит новая версия оболочки — подхватываем её
      // сразу после установки (sw.ts сам вызывает skipWaiting/clients.claim).
      // При самой первой установке (controller ещё не было) перезагрузка не нужна —
      // страница и так уже загружена нужной версией.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "activated" && hadControllerBeforeRegister) {
            window.location.reload();
          }
        });
      });
    }).catch(() => {
      // Регистрация SW не критична для работы приложения — молча пропускаем.
    });
  });
}
