import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { closeOverdueAssignments } from "../jobs/deadlines.js";
import { logEvent } from "../events.js";
import { installApiValidation, schema, object, uuid, boolean } from "../api-validation.js";
import { IntegrityError, withTransaction } from "../data-integrity.js";

type TargetType = "user" | "group" | "department";

export async function adminAssignmentRoutes(app: FastifyInstance) {
  installApiValidation(app);
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
  }>("/admin/assignments", { schema: schema(object({ courseId: uuid, targetId: uuid,
    targetType: { type: "string", enum: ["user", "group", "department"] },
    deadline: { type: "string", nullable: true, maxLength: 100 }, isRequired: boolean },
    ["courseId", "targetType", "targetId"])) }, async (req, reply) => {
    const { courseId, targetType, targetId, deadline, isRequired } = req.body;
    if (!courseId || !targetType || !targetId) {
      reply.code(400);
      return { error: "course_id_target_type_target_id_required" };
    }

    const assignedCount = await withTransaction(async client => {
      const course = await client.query("select id from courses where id = $1 for key share", [courseId]);
      if (!course.rows[0]) throw new IntegrityError(404);
      const targetTable = targetType === "user" ? "users" : targetType === "group" ? "groups" : "departments";
      const target = await client.query(`select id from ${targetTable} where id = $1 for key share`, [targetId]);
      if (!target.rows[0]) throw new IntegrityError(404);
      const selected = targetType === "user" ? [{ id: target.rows[0].id }] : targetType === "group"
        ? (await client.query("select user_id as id from group_members where group_id = $1", [targetId])).rows
        : (await client.query("select id from users where department_id = $1", [targetId])).rows;
      // Every bulk operation takes assignment locks in the same user ID order,
      // including overlapping groups/departments, avoiding reversed-row deadlocks.
      const userIds = [...new Set<string>(selected.map(row => row.id))].sort();
      const sourceGroupId = targetType === "group" ? target.rows[0].id : null;
      const sourceDepartmentId = targetType === "department" ? target.rows[0].id : null;
      for (const userId of userIds) {
        const res = await client.query(
          `insert into assignments (user_id, course_id, assigned_by, source_group_id, source_department_id, deadline, is_required)
           values ($1, $2, $3, $4, $5, $6, coalesce($7, true))
           on conflict (user_id, course_id) do update set
             deadline = excluded.deadline,
             is_required = excluded.is_required,
             source_group_id = excluded.source_group_id,
             source_department_id = excluded.source_department_id,
             status = case when assignments.status = 'overdue' then 'assigned' else assignments.status end,
             closed_at = case when assignments.status = 'overdue' then null else assignments.closed_at end
           returning id`,
          [userId, courseId, req.currentUser!.id, sourceGroupId, sourceDepartmentId, deadline ?? null, isRequired]
        );
        await logEvent(userId, "assignment_created", {
          entityType: "assignment", entityId: res.rows[0].id,
          payload: { courseId, assignedBy: req.currentUser!.id }
        }, client);
      }
      return userIds.length;
    });
    if (!assignedCount) {
      reply.code(400);
      return { error: "no_users_in_target" };
    }

    reply.code(201);
    return { assignedCount };
  });

  // Перенести дедлайн — возвращает доступ, если он был закрыт по сроку
  app.post<{ Params: { id: string }; Body: { deadline: string | null } }>(
    "/admin/assignments/:id/extend-deadline",
    async (req) => {
      const before = await pool.query(`select deadline from assignments where id = $1`, [req.params.id]);
      const res = await pool.query(
        `update assignments set
           deadline = $2,
           status = case when status = 'overdue' then 'assigned' else status end,
           closed_at = case when status = 'overdue' then null else closed_at end
         where id = $1
         returning *`,
        [req.params.id, req.body.deadline]
      );
      const assignment = res.rows[0];
      if (assignment) {
        await logEvent(assignment.user_id, "deadline_extended", {
          entityType: "assignment",
          entityId: assignment.id,
          payload: { oldDeadline: before.rows[0]?.deadline ?? null, newDeadline: req.body.deadline, by: req.currentUser!.id }
        });
      }
      return { assignment };
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
