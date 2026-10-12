import type { PoolClient } from "pg";
import { jobRunner } from "./runner.js";
import { startSerialScheduler } from "./scheduler.js";
import { getFlagsForUser } from "../analytics/rules.js";
import { getCourseProgress } from "../progress.js";
import { getGeneralSettings } from "../analytics/settings.js";

// Упрощение: границы «дня» считаются в UTC, а не в часовом поясе каждого
// сотрудника (SPEC §8 требует второе) — это предстоит доработать отдельно.
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function yesterdayStr(): string {
  return toDateStr(addDays(new Date(), -1));
}

async function generateReportUnlocked(
  client: PoolClient,
  dateStr: string,
  trigger: "login" | "schedule" | "manual"
): Promise<number> {
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;

  const employeesRes = await client.query(`select id, full_name from users where role = 'employee'`);

  for (const emp of employeesRes.rows) {
    const assignRes = await client.query(
      `select a.course_id, a.status, c.title as course_title
       from assignments a join courses c on c.id = a.course_id
       where a.user_id = $1`,
      [emp.id]
    );
    const progress = [];
    for (const a of assignRes.rows) {
      const p = await getCourseProgress(emp.id, a.course_id, client);
      progress.push({ courseId: a.course_id, courseTitle: a.course_title, status: a.status, percent: p.percent });
    }

    const answersDayRes = await client.query(
      `select
         count(*) filter (where (payload->>'isCorrect')::boolean = true) as correct,
         count(*) filter (where (payload->>'isCorrect')::boolean = false) as incorrect
       from events
       where user_id = $1 and event_type = 'question_answered' and occurred_at between $2 and $3`,
      [emp.id, dayStart, dayEnd]
    );
    const answersTotalRes = await client.query(
      `select
         count(*) filter (where (payload->>'isCorrect')::boolean = true) as correct,
         count(*) filter (where (payload->>'isCorrect')::boolean = false) as incorrect
       from events where user_id = $1 and event_type = 'question_answered'`,
      [emp.id]
    );

    const sessionsDayRes = await client.query(
      `select count(*) filter (where event_type = 'session_start') as starts,
              count(*) filter (where event_type = 'session_end') as ends
       from events where user_id = $1 and occurred_at between $2 and $3`,
      [emp.id, dayStart, dayEnd]
    );
    const sessionsTotalRes = await client.query(
      `select count(*) as starts from events where user_id = $1 and event_type = 'session_start'`,
      [emp.id]
    );

    const viewMinutesDayRes = await client.query(
      `select coalesce(sum((payload->>'durationMs')::bigint), 0) as ms
       from events where user_id = $1 and event_type = 'lesson_view_end' and occurred_at between $2 and $3`,
      [emp.id, dayStart, dayEnd]
    );

    const testsDayRes = await client.query(
      `select count(*) as total, count(*) filter (where (payload->>'passed')::boolean = true) as passed
       from events where user_id = $1 and event_type = 'test_attempt_end' and occurred_at between $2 and $3`,
      [emp.id, dayStart, dayEnd]
    );

    const flags = await getFlagsForUser(emp.id, client);

    const summary = {
      progress,
      answers: {
        today: { correct: Number(answersDayRes.rows[0].correct), incorrect: Number(answersDayRes.rows[0].incorrect) },
        total: { correct: Number(answersTotalRes.rows[0].correct), incorrect: Number(answersTotalRes.rows[0].incorrect) }
      },
      sessions: {
        today: Number(sessionsDayRes.rows[0].starts),
        todayEnds: Number(sessionsDayRes.rows[0].ends),
        total: Number(sessionsTotalRes.rows[0].starts)
      },
      viewMinutesToday: Math.round(Number(viewMinutesDayRes.rows[0].ms) / 60000),
      tests: { attemptedToday: Number(testsDayRes.rows[0].total), passedToday: Number(testsDayRes.rows[0].passed) }
    };

    await client.query(
      `insert into daily_reports (user_id, report_date, summary, flags, trigger)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, report_date) do update set
         summary = excluded.summary, flags = excluded.flags,
         generated_at = now(), trigger = excluded.trigger`,
      [emp.id, dateStr, JSON.stringify(summary), JSON.stringify(flags), trigger]
    );
  }

  return employeesRes.rows.length;
}

// Докатить пропущенные дни: от (последний сформированный день + 1) до вчера
// включительно. Если отчётов ещё не было — не уходим в прошлое больше чем
// на 14 дней, чтобы не делать тяжёлый backfill при первом запуске.
async function ensureReportsUnlocked(client: PoolClient, trigger: "login" | "schedule"): Promise<string[]> {
  const yesterday = yesterdayStr();
  const lastRes = await client.query(`select max(report_date) as last from daily_reports`);
  let cursor: Date = lastRes.rows[0].last
    ? addDays(new Date(lastRes.rows[0].last), 1)
    : addDays(new Date(yesterday), -13);

  const generatedDates: string[] = [];
  const yesterdayDate = new Date(yesterday);
  while (cursor <= yesterdayDate) {
    const dateStr = toDateStr(cursor);
    await generateReportUnlocked(client, dateStr, trigger);
    generatedDates.push(dateStr);
    cursor = addDays(cursor, 1);
  }
  return generatedDates;
}

export async function generateReportForDate(dateStr: string, trigger: "login" | "schedule" | "manual"): Promise<number> {
  return jobRunner.run("reports", (client) => generateReportUnlocked(client, dateStr, trigger));
}

export async function ensureReportsUpToYesterday(trigger: "login" | "schedule"): Promise<string[]> {
  return jobRunner.run("reports", (client) => ensureReportsUnlocked(client, trigger));
}

// UTC policy is unchanged. Persisted reports are the cursor; a failed run
// leaves no partial date and is retried on the next scheduler check.
export async function checkScheduledReports(now = new Date()): Promise<string[]> {
  return jobRunner.run("reports", async (client) => {
    const settings = await getGeneralSettings(client);
    const mode = settings["report.mode"];
    if (mode !== "schedule" && mode !== "both") return [];
    const [h, m] = String(settings["report.schedule_time"] ?? "07:00").split(":").map(Number);
    if (!(now.getUTCHours() * 60 + now.getUTCMinutes() >= h * 60 + m)) return [];
    return ensureReportsUnlocked(client, "schedule");
  });
}

export function startReportScheduler(checkIntervalMs = 5 * 60_000) {
  return startSerialScheduler(checkScheduledReports, checkIntervalMs);
}
