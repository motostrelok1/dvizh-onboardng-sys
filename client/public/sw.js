// Минимальный service worker — только для push-уведомлений (этап 11).
// Кэширование и офлайн-режим для полноценного PWA добавятся в этапе 12.

self.addEventListener("push", (event) => {
  let data = { title: "Уведомление", body: "" };
  try {
    data = event.data.json();
  } catch {
    // тело не JSON — покажем как есть
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.png",
      badge: "/icon.png"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("/");
    })
  );
});
