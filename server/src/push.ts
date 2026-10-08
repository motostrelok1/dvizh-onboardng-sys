import webpush from "web-push";
import { pool } from "./db.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

// Отправляет push всем подпискам сотрудника. Молча пропускает, если push
// не настроен (нет VAPID-ключей) — это отдельный канал уведомлений,
// остальная система работает и без него.
export async function sendPushToUser(userId: string, payload: { title: string; body?: string }) {
  if (!pushConfigured) return;

  const subsRes = await pool.query(`select * from push_subscriptions where user_id = $1`, [userId]);
  for (const sub of subsRes.rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
      );
    } catch (err: any) {
      // 404/410 — подписка больше не действительна (сотрудник отключил
      // уведомления в браузере, переустановил приложение и т.п.)
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query(`delete from push_subscriptions where id = $1`, [sub.id]);
      } else {
        console.error("Ошибка отправки push:", err.message);
      }
    }
  }
}
