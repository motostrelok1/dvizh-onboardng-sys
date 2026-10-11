/// <reference lib="webworker" />
// Service worker: precache оболочки приложения (workbox injectManifest) +
// push-уведомления (этап 11) + клик по уведомлению.
// API (/api/...) и файлы вложений никогда не кэшируются — только статика
// сборки клиента, перечисленная ниже в self.__WB_MANIFEST.

import { precacheAndRoute } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

// SPA-навигация: отдаём предкэшированный index.html для любых переходов,
// кроме запросов к /api — чтобы бэкенд всегда отвечал сам, а не из кэша.
const navigationRoute = new NavigationRoute(
  async (params) => {
    const cache = await caches.open("workbox-precache-v2");
    const match = await cache.match(new URL("/index.html", self.location.origin).toString());
    if (match) return match;
    return fetch(params.request);
  },
  {
    denylist: [/^\/api\//]
  }
);
registerRoute(navigationRoute);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string } = { title: "Уведомление", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // тело не JSON — покажем дефолт
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Уведомление", {
      body: data.body ?? "",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url ?? "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
