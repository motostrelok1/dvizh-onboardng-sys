import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { logEventsBatch } from "../events.js";

// С клиента сейчас принимаем только события просмотра урока — именно их
// клиент может достоверно знать (когда открыл/закрыл экран урока).
// Остальные типы (попытки теста, скачивания, сессии) сервер пишет сам
// в момент соответствующего действия, чтобы их нельзя было подделать.
const ALLOWED_CLIENT_EVENT_TYPES = new Set(["lesson_view_start", "lesson_view_end"]);

type ClientEvent = {
  eventType: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
};

export async function eventRoutes(app: FastifyInstance) {
  app.post<{ Body: { events: ClientEvent[] } }>(
    "/events",
    { preHandler: requireAuth },
    async (req, reply) => {
      const events = req.body?.events ?? [];
      if (!Array.isArray(events) || events.length === 0) {
        reply.code(400);
        return { error: "events_required" };
      }
      if (events.length > 200) {
        reply.code(400);
        return { error: "too_many_events" };
      }

      const rows = [];
      for (const e of events) {
        if (!ALLOWED_CLIENT_EVENT_TYPES.has(e.eventType)) continue; // молча пропускаем неразрешённое
        const occurredAt = new Date(e.occurredAt);
        if (isNaN(occurredAt.getTime())) continue;
        rows.push({
          userId: req.currentUser!.id,
          eventType: e.eventType,
          entityType: "lesson",
          entityId: e.entityId ?? null,
          payload: e.payload ?? {},
          occurredAt
        });
      }

      await logEventsBatch(rows);
      return { accepted: rows.length };
    }
  );
}
