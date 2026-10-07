import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { generateReportForDate } from "../jobs/reports.js";
import { getGeneralSettings, setGeneralSetting } from "../analytics/settings.js";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function adminReportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get<{ Querystring: { date?: string; departmentId?: string; groupId?: string } }>(
    "/admin/reports/daily",
    async (req) => {
      const date = req.query.date ?? yesterdayStr();
      const { departmentId, groupId } = req.query;

      const res = await pool.query(
        `select r.*, u.full_name, u.department_id, d.name as department_name
         from daily_reports r
         join users u on u.id = r.user_id
         left join departments d on d.id = u.department_id
         where r.report_date = $1
           and ($2::uuid is null or u.department_id = $2)
           and ($3::uuid is null or exists (select 1 from group_members gm where gm.user_id = u.id and gm.group_id = $3))
         order by u.full_name`,
        [date, departmentId ?? null, groupId ?? null]
      );
      return { date, reports: res.rows };
    }
  );

  app.get<{ Querystring: { from?: string; to?: string; departmentId?: string; groupId?: string } }>(
    "/admin/reports",
    async (req, reply) => {
      const { from, to, departmentId, groupId } = req.query;
      if (!from || !to) {
        reply.code(400);
        return { error: "from_to_required" };
      }
      const res = await pool.query(
        `select r.*, u.full_name, u.department_id, d.name as department_name
         from daily_reports r
         join users u on u.id = r.user_id
         left join departments d on d.id = u.department_id
         where r.report_date between $1 and $2
           and ($3::uuid is null or u.department_id = $3)
           and ($4::uuid is null or exists (select 1 from group_members gm where gm.user_id = u.id and gm.group_id = $4))
         order by r.report_date, u.full_name`,
        [from, to, departmentId ?? null, groupId ?? null]
      );
      return { reports: res.rows };
    }
  );

  app.get<{ Querystring: { from?: string; to?: string } }>("/admin/reports/export.csv", async (req, reply) => {
    const from = req.query.from ?? yesterdayStr();
    const to = req.query.to ?? yesterdayStr();
    const res = await pool.query(
      `select r.report_date, u.full_name,
              (r.summary->'answers'->'today'->>'correct') as correct_today,
              (r.summary->'answers'->'today'->>'incorrect') as incorrect_today,
              (r.summary->>'viewMinutesToday') as view_minutes_today,
              (r.summary->'sessions'->>'today') as sessions_today,
              jsonb_array_length(r.flags) as flags_count
       from daily_reports r join users u on u.id = r.user_id
       where r.report_date between $1 and $2
       order by r.report_date, u.full_name`,
      [from, to]
    );

    const header = "Дата,Сотрудник,Верных за день,Неверных за день,Минут на уроках,Входов,Флагов";
    const lines = res.rows.map((r) =>
      [
        r.report_date instanceof Date ? r.report_date.toISOString().slice(0, 10) : r.report_date,
        r.full_name,
        r.correct_today,
        r.incorrect_today,
        r.view_minutes_today,
        r.sessions_today,
        r.flags_count
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...lines].join("\n");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="reports_${from}_${to}.csv"`);
    return "\uFEFF" + csv; // BOM — чтобы Excel не ломал кириллицу
  });

  // Ручной запуск/пересборка отчёта за конкретный день (по умолчанию — вчера)
  app.post<{ Body: { date?: string } }>("/admin/reports/daily/generate", async (req) => {
    const date = req.body?.date ?? yesterdayStr();
    const count = await generateReportForDate(date, "manual");
    return { date, generated: count };
  });

  app.get("/admin/settings/reports", async () => {
    const settings = await getGeneralSettings();
    return { mode: settings["report.mode"], scheduleTime: settings["report.schedule_time"] };
  });

  app.put<{ Body: { mode?: string; scheduleTime?: string } }>("/admin/settings/reports", async (req) => {
    if (req.body.mode) await setGeneralSetting("report.mode", req.body.mode, req.currentUser!.id);
    if (req.body.scheduleTime) await setGeneralSetting("report.schedule_time", req.body.scheduleTime, req.currentUser!.id);
    const settings = await getGeneralSettings();
    return { mode: settings["report.mode"], scheduleTime: settings["report.schedule_time"] };
  });
}
