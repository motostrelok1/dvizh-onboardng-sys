import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { installApiValidation, schema, object, uuid, success } from "../api-validation.js";
import { acceptClientEvents, consumeEventRequest, type ClientEvent } from "../client-events.js";

// С клиента сейчас принимаем только события просмотра урока — именно их
// клиент может достоверно знать (когда открыл/закрыл экран урока).
// Остальные типы (попытки теста, скачивания, сессии) сервер пишет сам
// в момент соответствующего действия, чтобы их нельзя было подделать.
const event = object({ eventId: uuid, entityId: uuid,
  eventType: { type: "string", enum: ["lesson_view_start", "lesson_view_end"] },
  occurredAt: { type: "string", maxLength: 40,
    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$" },
  payload: object({ durationMs: { type: "integer", minimum: 0, maximum: 2147483647 } })
}, ["eventId", "entityId", "eventType", "occurredAt"]);

export async function eventRoutes(app: FastifyInstance) {
  installApiValidation(app);
  app.post<{ Body: { ownerId: string; events: ClientEvent[] } }>(
    "/events",
    { bodyLimit: 64 * 1024, preHandler: requireAuth,
      schema: schema(object({ ownerId: uuid,
        events: { type: "array", minItems: 1, maxItems: 100, items: event }
      }, ["ownerId", "events"]), undefined, success({
        accepted: { type: "integer" }, inserted: { type: "integer" },
        acceptedIds: { type: "array", items: uuid },
        rejected: { type: "array", items: object({ eventId: uuid, error: { type: "string" } }, ["eventId", "error"]) }
      })) },
    async (req, reply) => {
      // The queue owner must match the session; it never selects the DB user.
      if (req.body.ownerId.toLowerCase() !== req.currentUser!.id) {
        return reply.code(403).send({ error: "event_owner_mismatch" });
      }
      const limit = await consumeEventRequest(req.currentUser!.id);
      if (!limit.allowed) return reply.header("Retry-After", String(limit.retryAfterSeconds))
        .code(429).send({ error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds });
      return acceptClientEvents(req.currentUser!, req.body.events);
    }
  );
}
