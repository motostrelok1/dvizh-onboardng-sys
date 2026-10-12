import { pool, type DbExecutor } from "./db.js";
import { sendPushToUser } from "./push.js";

export async function createNotification(
  userId: string,
  assignmentId: string | null,
  kind: string,
  channel: "in_app" | "push",
  title: string,
  body: string,
  executor: DbExecutor = pool,
  sendImmediately = true
) {
  await executor.query(
    `insert into notifications (user_id, assignment_id, kind, channel, title, body)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId, assignmentId, kind, channel, title, body]
  );
  if (channel === "push" && sendImmediately) {
    await sendPushToUser(userId, { title, body });
  }
}
