import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { getCourseProgress } from "../progress.js";
import { getFlagsForUser } from "../analytics/rules.js";

const ACTIVE_WINDOW_DAYS = 7;

export async function adminDashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get<{ Querystring: { departmentId?: string; groupId?: string } }>(
    "/admin/dashboard",
    async (req) => {
      const { departmentId, groupId } = req.query;

      let employeesRes;
      if (groupId) {
        employeesRes = await pool.query(
          `select u.id, u.full_name, u.department_id, d.name as department_name
           from users u
           join group_members gm on gm.user_id = u.id
           left join departments d on d.id = u.department_id
           where u.role = 'employee' and gm.group_id = $1
             and ($2::uuid is null or u.department_id = $2)
           order by u.full_name`,
          [groupId, departmentId ?? null]
        );
      } else {
        employeesRes = await pool.query(
          `select u.id, u.full_name, u.department_id, d.name as department_name
           from users u
           left join departments d on d.id = u.department_id
           where u.role = 'employee' and ($1::uuid is null or u.department_id = $1)
           order by u.full_name`,
          [departmentId ?? null]
        );
      }
      const employees = employeesRes.rows;

      const employeeRows = [];
      for (const emp of employees) {
        const assignRes = await pool.query(
          `select a.course_id, a.status, c.title as course_title
           from assignments a join courses c on c.id = a.course_id
           where a.user_id = $1`,
          [emp.id]
        );

        let progressSum = 0;
        let progressCount = 0;
        let overdueCount = 0;
        for (const a of assignRes.rows) {
          if (a.status === "overdue") overdueCount++;
          const progress = await getCourseProgress(emp.id, a.course_id);
          progressSum += progress.percent;
          progressCount++;
        }
        const averageProgress = progressCount > 0 ? Math.round(progressSum / progressCount) : null;

        const lastSessionRes = await pool.query(
          `select max(occurred_at) as last from events where user_id = $1 and event_type = 'session_start'`,
          [emp.id]
        );
        const lastSessionAt = lastSessionRes.rows[0].last;
        const flagsCount = (await getFlagsForUser(emp.id)).length;

        employeeRows.push({
          id: emp.id,
          fullName: emp.full_name,
          departmentName: emp.department_name,
          assignedCourses: assignRes.rows.length,
          averageProgress,
          overdueCount,
          flagsCount,
          lastSessionAt
        });
      }

      const activeCutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const activeEmployeesCount = employeeRows.filter(
        (e) => e.lastSessionAt && new Date(e.lastSessionAt) > activeCutoff
      ).length;
      const withProgress = employeeRows.filter((e) => e.averageProgress !== null);
      const averageProgressPercent =
        withProgress.length > 0
          ? Math.round(withProgress.reduce((s, e) => s + (e.averageProgress ?? 0), 0) / withProgress.length)
          : null;
      const overdueAssignmentsCount = employeeRows.reduce((s, e) => s + e.overdueCount, 0);
      const flaggedEmployeesCount = employeeRows.filter((e) => e.flagsCount > 0).length;

      return {
        summary: {
          totalEmployees: employeeRows.length,
          activeEmployees: activeEmployeesCount,
          averageProgressPercent,
          overdueAssignmentsCount,
          flaggedEmployeesCount
        },
        employees: employeeRows
      };
    }
  );

  // Карточка сотрудника: назначения с прогрессом, сводная статистика,
  // последние события журнала.
  app.get<{ Params: { id: string } }>("/admin/users/:id/log", async (req, reply) => {
    const userRes = await pool.query(
      `select u.*, d.name as department_name from users u
       left join departments d on d.id = u.department_id where u.id = $1`,
      [req.params.id]
    );
    const user = userRes.rows[0];
    if (!user) {
      reply.code(404);
      return { error: "not_found" };
    }

    const assignRes = await pool.query(
      `select a.id, a.status, a.deadline, a.is_required, c.id as course_id, c.title as course_title
       from assignments a join courses c on c.id = a.course_id
       where a.user_id = $1 order by a.assigned_at desc`,
      [req.params.id]
    );
    const assignments = [];
    for (const a of assignRes.rows) {
      const progress = await getCourseProgress(req.params.id, a.course_id);
      assignments.push({ ...a, progress });
    }

    const statsRes = await pool.query(
      `select
         count(*) filter (where event_type = 'session_start') as total_sessions,
         count(*) filter (where event_type = 'question_answered' and (payload->>'isCorrect')::boolean = true) as correct_answers,
         count(*) filter (where event_type = 'question_answered' and (payload->>'isCorrect')::boolean = false) as incorrect_answers,
         count(*) filter (where event_type = 'test_attempt_end') as test_attempts,
         coalesce(sum((payload->>'durationMs')::bigint) filter (where event_type = 'lesson_view_end'), 0) as total_view_ms
       from events where user_id = $1`,
      [req.params.id]
    );
    const stats = statsRes.rows[0];

    const eventsRes = await pool.query(
      `select event_type, entity_type, entity_id, payload, occurred_at
       from events where user_id = $1 order by occurred_at desc limit 50`,
      [req.params.id]
    );

    const flags = await getFlagsForUser(req.params.id);

    return {
      flags,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        departmentName: user.department_name,
        timezone: user.timezone,
        isActive: user.is_active,
        createdAt: user.created_at
      },
      assignments,
      stats: {
        totalSessions: Number(stats.total_sessions),
        correctAnswers: Number(stats.correct_answers),
        incorrectAnswers: Number(stats.incorrect_answers),
        testAttempts: Number(stats.test_attempts),
        totalViewMinutes: Math.round(Number(stats.total_view_ms) / 60000)
      },
      recentEvents: eventsRes.rows
    };
  });
}
