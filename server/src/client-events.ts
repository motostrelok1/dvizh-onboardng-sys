import type { PublicUser } from "./auth/service.js";
import { withTransaction } from "./data-integrity.js";
import { pool } from "./db.js";

export type ClientEvent = {
  eventId: string; entityId: string; eventType: "lesson_view_start" | "lesson_view_end";
  occurredAt: string; payload?: { durationMs?: number };
};
export const EVENT_WINDOW_SECONDS = 60;
export const EVENT_REQUEST_MAX = 30;

// One bounded bucket per user, shared across all processes/sessions. Denials
// never extend the window; deleting a user cascades its bucket.
export async function consumeEventRequest(userId: string) {
  const result = await pool.query(`insert into event_rate_limits(user_id,requests,expires_at)
    values ($1,1,statement_timestamp()+$2*interval '1 second')
    on conflict(user_id) do update set
      requests=case when event_rate_limits.expires_at<=statement_timestamp() then 1
        else least(event_rate_limits.requests+1,$3+1) end,
      expires_at=case when event_rate_limits.expires_at<=statement_timestamp()
        then statement_timestamp()+$2*interval '1 second' else event_rate_limits.expires_at end
    returning requests,greatest(1,ceil(extract(epoch from
      (expires_at-statement_timestamp()))))::integer as retry_seconds`,
  [userId, EVENT_WINDOW_SECONDS, EVENT_REQUEST_MAX]);
  return { allowed: result.rows[0].requests <= EVENT_REQUEST_MAX,
    retryAfterSeconds: result.rows[0].retry_seconds as number };
}

export function eventTime(value: string): Date | null {
  const date = new Date(value), calendar = value.slice(0, 10);
  const day = new Date(`${calendar}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== calendar) return null;
  return date;
}

export async function acceptClientEvents(user: PublicUser, events: ClientEvent[]) {
  const ids = events.map(e => e.eventId.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error("invalid_event_batch"), { statusCode: 400 });
  }
  return withTransaction(async client => {
    // Same user lock as deactivation, acquired before hierarchy/assignments.
    const active = (await client.query("select is_active,role from users where id=$1 for no key update", [user.id])).rows[0];
    if (!active?.is_active) throw Object.assign(new Error("inactive_event_owner"), { statusCode: 401 });
    const acceptedIds: string[] = [], rejected: Array<{ eventId: string; error: string }> = [];
    let inserted = 0;
    for (const event of events) {
      const id = event.eventId.toLowerCase(), lessonId = event.entityId.toLowerCase();
      const date = eventTime(event.occurredAt), payload = event.payload ?? {};
      const reject = (error: string) => rejected.push({ eventId: id, error });
      if (!date || (event.eventType === "lesson_view_start" && Object.keys(payload).length > 0)) {
        reject("invalid_event"); continue;
      }
      const existing = (await client.query(`select event_type=$3 and entity_type='lesson' and
        entity_id=$4 and occurred_at=$5 and payload=$6::jsonb as identical
        from events where user_id=$1 and client_event_id=$2`,
      [user.id,id,event.eventType,lessonId,date,JSON.stringify(payload)])).rows[0];
      // ACK committed duplicates even if access has since expired. Reusing an
      // ID with different data never overwrites the append-only journal.
      if (existing) {
        if (existing.identical) acceptedIds.push(id); else reject("event_id_conflict");
        continue;
      }
      const lesson = (await client.query(`select c.id as course_id,c.status,c.visibility
        from lessons l join modules m on m.id=l.module_id join courses c on c.id=m.course_id
        where l.id=$1 for share of c,m,l`, [lessonId])).rows[0];
      if (!lesson) { reject("not_found"); continue; }
      const assignment = (await client.query(`select id,status,deadline from assignments
        where user_id=$1 and course_id=$2 for share`, [user.id,lesson.course_id])).rows[0];
      // Evaluate database time after waiting for locks, not the supplied time.
      const clock = (await client.query(`select clock_timestamp() as received_at,
        coalesce($1::timestamptz<=clock_timestamp(),false) as expired`, [assignment?.deadline ?? null])).rows[0];
      if (date.getTime() > clock.received_at.getTime() + 5 * 60_000) { reject("invalid_event_time"); continue; }
      if (active.role !== "admin") {
        if (lesson.status === "archived") { reject("not_found"); continue; }
        if (!assignment) {
          reject(lesson.visibility === "open_catalog" && lesson.status === "published" ? "not_enrolled" : "not_assigned");
          continue;
        }
        if (assignment.status === "overdue" || clock.expired) { reject("deadline_passed"); continue; }
      }
      const added = await client.query(`insert into events(user_id,client_event_id,event_type,
        entity_type,entity_id,payload,occurred_at,created_at)
        values ($1,$2,$3,'lesson',$4,$5,$6,$7)
        on conflict(user_id,client_event_id) do nothing returning id`,
      [user.id,id,event.eventType,lessonId,JSON.stringify(payload),date,clock.received_at]);
      if (!added.rowCount) throw new Error("unexpected_event_conflict");
      inserted++; acceptedIds.push(id);
    }
    // This result is returned only after COMMIT; a lost reply can be retried.
    return { accepted: acceptedIds.length, inserted, acceptedIds, rejected };
  });
}
