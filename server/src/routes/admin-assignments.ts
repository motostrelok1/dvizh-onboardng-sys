import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { closeOverdueAssignments } from "../jobs/deadlines.js";

type TargetType = "user" | "group" | "department";

export async function adminAssignmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get<{ Querystring: { courseId?: string } }>("/admin/assignments", async (req) => {
    const { courseId } = req.query;
    const res = await pool.query(
      `select a.*, u.full_name as user_name, c.title as course_title
       from assignments a
       join users u on u.id = a.user_id
       join courses c on c.id = a.course_id
       where $1::uuid is null or a.course_id = $1
       order by a.assigned_at desc`,
      [courseId ?? null]
    );
    return { assignments: res.rows };
  });

  // Назначить курс одному сотруднику, всей группе или всему отделу.
  // Повторное назначение тому же человеку обновляет дедлайн (не дублирует строку).
  app.post<{
    Body: {
      courseId: string;
      targetType: TargetType;
      targetId: string;
      deadline?: string | null;
      isRequired?: boolean;
    };
  }>("/admin/assignments", async (req, reply) => {
    const { courseId, targetType, targetId, deadline, isRequired } = req.body;
    if (!courseId || !targetType || !targetId) {
      reply.code(400);
      return { error: "course_id_target_type_target_id_required" };
    }

    let userIds: string[] = [];
    let sourceGroupId: string | null = null;
    let sourceDepartmentId: string | null = null;

    if (targetType === "user") {
      userIds = [targetId];
    } else if (targetType === "group") {
      const res = await pool.query(`select user_id from group_members where group_id = $1`, [targetId]);
      userIds = res.rows.map((r) => r.user_id);
      sourceGroupId = targetId;
    } else if (targetType === "department") {
      const res = await pool.query(`select id from users where department_id = $1`, [targetId]);
      userIds = res.rows.map((r) => r.id);
      sourceDepartmentId = targetId;
    } else {
      reply.code(400);
      return { error: "invalid_target_type" };
    }

    if (userIds.length === 0) {
      reply.code(400);
      return { error: "no_users_in_target" };
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const userId of userIds) {
        await client.query(
          `insert into assignments (user_id, course_id, assigned_by, source_group_id, source_department_id, deadline, is_required)
           values ($1, $2, $3, $4, $5, $6, coalesce($7, true))
           on conflict (user_id, course_id) do update set
             deadline = excluded.deadline,
             is_required = excluded.is_required,
             source_group_id = excluded.source_group_id,
             source_department_id = excluded.source_department_id,
             status = case when assignments.status = 'overdue' then 'assigned' else assignments.status end,
             closed_at = case when assignments.status = 'overdue' then null else assignments.closed_at end`,
          [userId, courseId, req.currentUser!.id, sourceGroupId, sourceDepartmentId, deadline ?? null, isRequired]
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    reply.code(201);
    return { assignedCount: userIds.length };
  });

  // Перенести дедлайн — возвращает доступ, если он был закрыт по сроку
  app.post<{ Params: { id: string }; Body: { deadline: string | null } }>(
    "/admin/assignments/:id/extend-deadline",
    async (req) => {
      const res = await pool.query(
        `update assignments set
           deadline = $2,
           status = case when status = 'overdue' then 'assigned' else status end,
           closed_at = case when status = 'overdue' then null else closed_at end
         where id = $1
         returning *`,
        [req.params.id, req.body.deadline]
      );
      return { assignment: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/assignments/:id", async (req) => {
    await pool.query(`delete from assignments where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // Ручной запуск проверки дедлайнов — удобно для проверки и для админа,
  // не дожидаясь фонового интервала. Полноценный планировщик — этап 11.
  app.post("/admin/assignments/run-deadline-check", async () => {
    const closed = await closeOverdueAssignments();
    return { closed };
  });
}
