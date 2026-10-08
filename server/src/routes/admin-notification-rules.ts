import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { checkAndSendNotifications } from "../jobs/notifications.js";

export async function adminNotificationRuleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/notification-rules", async () => {
    const res = await pool.query(
      `select r.*, c.title as course_title from notification_rules r
       left join courses c on c.id = r.course_id
       order by r.kind, r.offset_days desc, r.channel`
    );
    return { rules: res.rows };
  });

  app.post<{
    Body: { courseId?: string | null; kind: string; offsetDays: number; channel: string };
  }>("/admin/notification-rules", async (req, reply) => {
    const { courseId, kind, offsetDays, channel } = req.body;
    if (!["before_deadline", "on_deadline", "overdue"].includes(kind)) {
      reply.code(400);
      return { error: "invalid_kind" };
    }
    if (!["in_app", "push"].includes(channel)) {
      reply.code(400);
      return { error: "invalid_channel" };
    }
    const res = await pool.query(
      `insert into notification_rules (course_id, kind, offset_days, channel) values ($1, $2, $3, $4) returning *`,
      [courseId ?? null, kind, offsetDays ?? 0, channel]
    );
    reply.code(201);
    return { rule: res.rows[0] };
  });

  app.patch<{ Params: { id: string }; Body: { offsetDays?: number; isActive?: boolean } }>(
    "/admin/notification-rules/:id",
    async (req) => {
      const res = await pool.query(
        `update notification_rules set
           offset_days = coalesce($2, offset_days),
           is_active = coalesce($3, is_active)
         where id = $1 returning *`,
        [req.params.id, req.body.offsetDays, req.body.isActive]
      );
      return { rule: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/notification-rules/:id", async (req) => {
    await pool.query(`delete from notification_rules where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // Ручной запуск проверки — удобно для отладки, не дожидаясь часового интервала
  app.post("/admin/notification-rules/run-check", async () => {
    const sent = await checkAndSendNotifications();
    return { sent };
  });
}
