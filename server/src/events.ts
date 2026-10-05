import { pool } from "./db.js";

export type EventType =
  | "session_start"
  | "session_end"
  | "lesson_view_start"
  | "lesson_view_end"
  | "test_attempt_start"
  | "test_attempt_end"
  | "question_answered"
  | "assignment_created"
  | "course_completed"
  | "deadline_extended"
  | "access_closed"
  | "attachment_download";

// Журнал событий — append-only: отсюда потом (этапы 9–10) считаются прогресс,
// карточка сотрудника и флаги аналитики. Ничего из него не редактируется
// и не удаляется в обычной работе приложения.
export async function logEvent(
  userId: string,
  eventType: EventType,
  opts: { entityType?: string; entityId?: string | null; payload?: Record<string, unknown>; occurredAt?: Date } = {}
) {
  await pool.query(
    `insert into events (user_id, event_type, entity_type, entity_id, payload, occurred_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      eventType,
      opts.entityType ?? null,
      opts.entityId ?? null,
      JSON.stringify(opts.payload ?? {}),
      opts.occurredAt ?? new Date()
    ]
  );
}

// Пакетная вставка — для событий, присланных клиентом (/events), и для
// массового закрытия просроченных назначений.
export async function logEventsBatch(
  rows: Array<{
    userId: string;
    eventType: string;
    entityType?: string | null;
    entityId?: string | null;
    payload?: Record<string, unknown>;
    occurredAt: Date;
  }>
) {
  if (rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const r of rows) {
      await client.query(
        `insert into events (user_id, event_type, entity_type, entity_id, payload, occurred_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [r.userId, r.eventType, r.entityType ?? null, r.entityId ?? null, JSON.stringify(r.payload ?? {}), r.occurredAt]
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
