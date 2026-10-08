// Без явного возвращаемого типа: так TypeScript выводит Uint8Array<ArrayBuffer>,
// которого требует applicationServerKey (а не Uint8Array<ArrayBufferLike>).
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function isPushSupported(): Promise<boolean> {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function getPushSubscriptionStatus(): Promise<"subscribed" | "not-subscribed" | "unsupported"> {
  if (!(await isPushSupported())) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "not-subscribed";
}

// Запрашивает разрешение и оформляет push-подписку. Вызывается по клику
// пользователя (не автоматически) — иначе браузер может заблокировать
// запрос разрешения или он выглядит навязчиво.
export async function enablePush(): Promise<"ok" | "denied" | "unsupported"> {
  if (!(await isPushSupported())) return "unsupported";

  const keyRes = await fetch("/api/push/vapid-public-key");
  const { publicKey, configured } = await keyRes.json();
  if (!configured) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = await navigator.serviceWorker.register("/sw.js");
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await fetch("/api/me/push-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON())
  });

  return "ok";
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/me/push-subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    await sub.unsubscribe();
  }
}
