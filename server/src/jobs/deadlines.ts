import { jobRunner } from "./runner.js";
import { startSerialScheduler } from "./scheduler.js";
import { logEvent } from "../events.js";

// Фиксируем просрочку незавершённых назначений и событие (SPEC §5.1).
// Доступ закрывает checkCourseAccess непосредственно по времени БД,
// независимо от запуска job. Завершённые назначения сохраняют свой статус,
// но дедлайн закрывает доступ к ним тоже; данные и логи не удаляются.
export async function closeOverdueAssignments(): Promise<number> {
  return jobRunner.run("deadlines", async (client) => {
    const res = await client.query(
      `update assignments
         set status = 'overdue', closed_at = clock_timestamp()
       where deadline is not null
         and deadline <= clock_timestamp()
         and status in ('assigned', 'in_progress')
       returning id, user_id, course_id`
    );

    for (const row of res.rows) {
      await logEvent(row.user_id, "access_closed", {
        entityType: "assignment",
        entityId: row.id,
        payload: { courseId: row.course_id, reason: "deadline" }
      }, client);
    }

    return res.rowCount ?? 0;
  });
}

export function startDeadlineChecker(intervalMs = 60_000) {
  return startSerialScheduler(closeOverdueAssignments, intervalMs);
}
