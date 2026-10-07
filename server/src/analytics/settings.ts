import { pool } from "../db.js";

// Стартовые значения из SPEC §9.1. Ключи с префиксом правила можно
// переопределить для отдельного курса; report.* — только общие.
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "problem_question.enabled": true,
  "problem_question.min_correct_percent": 50,
  "problem_question.min_answers": 10,

  "skipped_lesson.enabled": true,
  "skipped_lesson.max_percent_of_median": 30,

  "needs_help.enabled": true,
  "needs_help.attempts_without_improvement": 3,

  "guessing.enabled": true,
  "guessing.max_seconds_per_question": 5,

  "stuck.enabled": true,
  "stuck.inactive_days": 3,

  "deadline_risk.enabled": true,
  "deadline_risk.days_before": 3,
  "deadline_risk.max_progress_percent": 50,

  // Не переопределяются по курсу — настройка формирования отчёта (SPEC §8)
  "report.mode": "login", // login | schedule | both
  "report.schedule_time": "07:00"
};

const COURSE_OVERRIDABLE_PREFIXES = [
  "problem_question.",
  "skipped_lesson.",
  "needs_help.",
  "guessing.",
  "stuck.",
  "deadline_risk."
];

export function isCourseOverridable(key: string): boolean {
  return COURSE_OVERRIDABLE_PREFIXES.some((p) => key.startsWith(p));
}

// Общие настройки поверх дефолтов (без учёта курса)
export async function getGeneralSettings(): Promise<Record<string, unknown>> {
  const result = { ...DEFAULT_SETTINGS };
  const rows = await pool.query(`select key, value from analytics_settings`);
  for (const r of rows.rows) result[r.key] = r.value;
  return result;
}

// Эффективные настройки для конкретного курса: дефолты → общие → переопределения курса
export async function getEffectiveSettings(courseId: string | null): Promise<Record<string, unknown>> {
  const result = await getGeneralSettings();
  if (courseId) {
    const overrides = await pool.query(
      `select key, value from analytics_overrides where course_id = $1`,
      [courseId]
    );
    for (const r of overrides.rows) result[r.key] = r.value;
  }
  return result;
}

async function logChange(
  changedBy: string | null,
  courseId: string | null,
  key: string,
  oldValue: unknown,
  newValue: unknown
) {
  await pool.query(
    `insert into settings_log (changed_by, course_id, key, old_value, new_value)
     values ($1, $2, $3, $4, $5)`,
    [changedBy, courseId, key, JSON.stringify(oldValue ?? null), JSON.stringify(newValue ?? null)]
  );
}

export async function setGeneralSetting(key: string, value: unknown, changedBy: string) {
  const before = await pool.query(`select value from analytics_settings where key = $1`, [key]);
  await pool.query(
    `insert into analytics_settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  await logChange(changedBy, null, key, before.rows[0]?.value ?? DEFAULT_SETTINGS[key] ?? null, value);
}

export async function resetGeneralSettings(changedBy: string) {
  const before = await pool.query(`select key, value from analytics_settings`);
  await pool.query(`delete from analytics_settings`);
  for (const r of before.rows) {
    await logChange(changedBy, null, r.key, r.value, DEFAULT_SETTINGS[r.key] ?? null);
  }
}

export async function setCourseOverride(courseId: string, key: string, value: unknown, changedBy: string) {
  if (!isCourseOverridable(key)) throw new Error("key_not_course_overridable");
  const before = await pool.query(
    `select value from analytics_overrides where course_id = $1 and key = $2`,
    [courseId, key]
  );
  await pool.query(
    `insert into analytics_overrides (course_id, key, value) values ($1, $2, $3)
     on conflict (course_id, key) do update set value = excluded.value, updated_at = now()`,
    [courseId, key, JSON.stringify(value)]
  );
  await logChange(changedBy, courseId, key, before.rows[0]?.value ?? null, value);
}

export async function resetCourseOverrides(courseId: string, changedBy: string) {
  const before = await pool.query(
    `select key, value from analytics_overrides where course_id = $1`,
    [courseId]
  );
  await pool.query(`delete from analytics_overrides where course_id = $1`, [courseId]);
  for (const r of before.rows) {
    await logChange(changedBy, courseId, r.key, r.value, null);
  }
}

export async function getSettingsLog(limit = 100) {
  const res = await pool.query(
    `select sl.*, u.full_name as changed_by_name, c.title as course_title
     from settings_log sl
     left join users u on u.id = sl.changed_by
     left join courses c on c.id = sl.course_id
     order by sl.changed_at desc limit $1`,
    [limit]
  );
  return res.rows;
}
