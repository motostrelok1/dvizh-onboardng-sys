import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { getVapidPublicKey, pushConfigured } from "../push.js";

// Публичный роут регистрируется отдельным плагином: addHook в Fastify
// действует на все маршруты в пределах одного encapsulation-контекста
// независимо от порядка регистрации, поэтому requireAuth ниже затронул бы
// и его, окажись они в одной функции.
export async function publicPushRoutes(app: FastifyInstance) {
  app.get("/push/vapid-public-key", async () => {
    return { publicKey: getVapidPublicKey(), configured: pushConfigured };
  });
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/me/notifications", async (req) => {
    const res = await pool.query(
      `select id, kind, title, body, sent_at, read_at from notifications
       where user_id = $1 order by sent_at desc limit 50`,
      [req.currentUser!.id]
    );
    const unreadRes = await pool.query(
      `select count(*)::int as n from notifications where user_id = $1 and read_at is null`,
      [req.currentUser!.id]
    );
    return { notifications: res.rows, unreadCount: unreadRes.rows[0].n };
  });

  app.post<{ Params: { id: string } }>("/me/notifications/:id/read", async (req) => {
    await pool.query(
      `update notifications set read_at = now() where id = $1 and user_id = $2 and read_at is null`,
      [req.params.id, req.currentUser!.id]
    );
    return { ok: true };
  });

  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>(
    "/me/push-subscription",
    async (req, reply) => {
      const { endpoint, keys } = req.body ?? {};
      if (!endpoint || !keys) {
        reply.code(400);
        return { error: "endpoint_and_keys_required" };
      }
      await pool.query(
        `insert into push_subscriptions (user_id, endpoint, keys) values ($1, $2, $3)
         on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys`,
        [req.currentUser!.id, endpoint, JSON.stringify(keys)]
      );
      return { ok: true };
    }
  );

  app.delete<{ Body: { endpoint: string } }>("/me/push-subscription", async (req) => {
    await pool.query(`delete from push_subscriptions where endpoint = $1 and user_id = $2`, [
      req.body.endpoint,
      req.currentUser!.id
    ]);
    return { ok: true };
  });
}
