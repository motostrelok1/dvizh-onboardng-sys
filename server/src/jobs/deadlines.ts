import { pool } from "../db.js";
import { logEvent } from "../events.js";

// Назначения, у которых наступил дедлайн, переводим в overdue — это и есть
// «закрыт доступ к этому курсу» (SPEC §5.1). Курс не удаляется, прогресс и
// логи сохраняются, затрагивается только это назначение.
export async function closeOverdueAssignments(): Promise<number> {
  const res = await pool.query(
    `update assignments
       set status = 'overdue', closed_at = now()
     where deadline is not null
       and deadline < now()
       and status in ('assigned', 'in_progress')
     returning id, user_id, course_id`
  );

  for (const row of res.rows) {
    await logEvent(row.user_id, "access_closed", {
      entityType: "assignment",
      entityId: row.id,
      payload: { courseId: row.course_id, reason: "deadline" }
    });
  }

  return res.rowCount ?? 0;
}

export function startDeadlineChecker(intervalMs = 60_000) {
  const run = () => {
    closeOverdueAssignments().catch((err) => {
      console.error("Ошибка проверки дедлайнов:", err);
    });
  };
  run(); // сразу при старте, не дожидаясь первого интервала
  return setInterval(run, intervalMs);
}
