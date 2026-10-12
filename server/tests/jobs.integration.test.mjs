import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import webpush from "web-push";

await import("./test-database.mjs");
const bootstrap = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const schema = `job_test_${randomUUID().replaceAll("-", "")}`;
// Isolate both tables and advisory keys from other parallel test files.
// Production keys stay fixed. LIKE copies current migrated checks/indexes/
// defaults/generated columns; these jobs do not exercise foreign-key changes.
await bootstrap.query(`create schema "${schema}"`);
const tables = (await bootstrap.query("select tablename from pg_tables where schemaname = 'public' and tablename <> 'pgmigrations'")).rows.map((r) => r.tablename);
for (const table of tables) await bootstrap.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);
const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
databaseUrl.searchParams.set("options", `-c search_path=${schema},public`);
process.env.DATABASE_URL = databaseUrl.href;
const { pool } = await import("../src/db.ts");
const isolatedNamespace = randomInt(0x10000000, 0x70000000);
pool.on("connect", (client) => {
  const query = client.query.bind(client);
  client.query = function (sql, params, ...rest) {
    if (typeof sql === "string" && /pg_(try_advisory_lock|advisory_unlock)\(/.test(sql)) {
      params = [isolatedNamespace, params[1]];
    }
    return query(sql, params, ...rest);
  };
});
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
let push = async () => { assert.fail("unexpected external push"); };
const realSend = webpush.sendNotification;
webpush.sendNotification = (...args) => push(...args);
const { createJobRunner, jobRunner } = await import("../src/jobs/runner.ts");
const { closeOverdueAssignments } = await import("../src/jobs/deadlines.ts");
const { generateReportForDate, ensureReportsUpToYesterday, checkScheduledReports } = await import("../src/jobs/reports.ts");
const { checkAndSendNotifications } = await import("../src/jobs/notifications.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { adminReportRoutes } = await import("../src/routes/admin-reports.ts");
const { adminNotificationRuleRoutes } = await import("../src/routes/admin-notification-rules.ts");
const { adminAssignmentRoutes } = await import("../src/routes/admin-assignments.ts");
const { installApiErrors } = await import("../src/api-validation.ts");
const { installPrivacyHeaders } = await import("../src/privacy.ts");
const { installCsrfProtection } = await import("../src/csrf.ts");
const app = Fastify();
installApiErrors(app); installPrivacyHeaders(app);
installCsrfProtection(app, "https://lms.example.test");
const runner = () => createJobRunner(pool, () => {});
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
async function hold(job, callback) {
  const entered = deferred(), gate = deferred(), independent = runner();
  const active = independent.run(job, async () => { entered.resolve(); await gate.promise; });
  await entered.promise;
  try { return await callback(); }
  finally { gate.resolve(); await active; await independent.stop(); }
}
let employeeId, otherId, adminId, courseId, assignmentId, adminCookies, employeeCookies;
before(async () => {
  await app.register(cookie);
  await app.register(adminReportRoutes);
  await app.register(adminNotificationRuleRoutes);
  await app.register(adminAssignmentRoutes);
  await app.ready();
});
beforeEach(async () => {
  for (const table of tables) await pool.query(`delete from "${schema}"."${table}"`);
  [employeeId, otherId, adminId, courseId, assignmentId] = Array.from({ length: 5 }, () => randomUUID());
  await pool.query(`insert into users (id, full_name, role) values
    ($1, 'CI job employee', 'employee'), ($2, 'CI other employee', 'employee'), ($3, 'CI job admin', 'admin')`,
  [employeeId, otherId, adminId]);
  await pool.query("insert into courses (id, title, status) values ($1, 'CI job course', 'published')", [courseId]);
  await pool.query(`insert into assignments (id, user_id, course_id, deadline)
    values ($1, $2, $3, clock_timestamp() - interval '1 day')`, [assignmentId, employeeId, courseId]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  employeeCookies = { [SESSION_COOKIE]: (await createSession(employeeId)).token };
  push = async () => assert.fail("unexpected external push");
});
after(async () => {
  try { await app.close(); await jobRunner.stop(); await pool.end(); }
  finally { webpush.sendNotification = realSend; await bootstrap.query(`drop schema "${schema}" cascade`); await bootstrap.end(); }
});
async function count(table) { return Number((await pool.query(`select count(*) as n from "${schema}"."${table}"`)).rows[0].n); }
async function assignment() { return (await pool.query("select * from assignments where id = $1", [assignmentId])).rows[0]; }
const request = (url, cookies = adminCookies, origin = "https://lms.example.test") => app.inject({
  method: "POST", url, cookies, headers: origin ? { origin } : {},
  ...(url.includes("daily/generate") ? { payload: { date: "2026-01-20" } } : {})
});

test("separate runner instances share the PostgreSQL lock; different jobs remain independent", async () => {
  await hold("reports", async () => {
    const second = runner();
    await assert.rejects(second.run("reports", () => assert.fail("overlap")), { code: "job_in_progress" });
    assert.equal(await second.run("deadlines", async () => 8), 8);
    await second.stop();
  });
  assert.equal(await runner().run("reports", async () => 9), 9);
});

test("rollback releases an advisory lock and restores actual database writes", async () => {
  const first = runner();
  await assert.rejects(first.run("deadlines", async (client) => {
    await client.query("update assignments set status = 'overdue' where id = $1", [assignmentId]);
    throw new Error("controlled failure");
  }));
  assert.equal((await assignment()).status, "assigned");
  assert.equal(await runner().run("deadlines", async () => 1), 1);
});

test("backend termination releases the session lock and the failed owner cannot commit", async () => {
  const entered = deferred(), gate = deferred(), owner = runner(); let pid;
  const task = owner.run("reports", async (client) => {
    pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
    entered.resolve(); await gate.promise;
    return 1;
  });
  const rejected = assert.rejects(task);
  await entered.promise;
  assert.equal((await bootstrap.query("select pg_terminate_backend($1) as stopped", [pid])).rows[0].stopped, true);
  // Await server termination acknowledgement before trying a fresh session.
  for (let i = 0; i < 100; i++) {
    if ((await bootstrap.query("select 1 from pg_stat_activity where pid = $1", [pid])).rowCount === 0) break;
    if (i === 99) assert.fail("terminated session remained active");
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(await runner().run("reports", async () => 2), 2);
  gate.resolve(); await rejected;
});

test("deadline status and event commit together and repeated checks do not duplicate events", async () => {
  assert.equal(await closeOverdueAssignments(), 1);
  assert.equal((await assignment()).status, "overdue");
  assert.ok((await assignment()).closed_at);
  assert.equal(await count("events"), 1);
  assert.equal(await closeOverdueAssignments(), 0);
  assert.equal(await count("events"), 1);
});

test("failed closure event rolls back deadline status and can be retried", async () => {
  await pool.query(`create function "${schema}".reject_event() returns trigger language plpgsql as $$
    begin raise exception 'controlled event failure'; end $$`);
  await pool.query("create trigger reject_event before insert on events for each row execute function reject_event()");
  try {
    await assert.rejects(closeOverdueAssignments(), /controlled event failure/);
    assert.equal((await assignment()).status, "assigned");
    assert.equal((await assignment()).closed_at, null);
    assert.equal(await count("events"), 0);
  } finally { await pool.query("drop trigger reject_event on events"); }
  assert.equal(await closeOverdueAssignments(), 1);
  await pool.query("drop function reject_event()");
});

test("manual, login and scheduled reports use the same lane with no partial writes", async () => {
  await hold("reports", async () => {
    for (const work of [() => generateReportForDate("2026-01-20", "manual"),
      () => ensureReportsUpToYesterday("login"), () => checkScheduledReports()]) {
      await assert.rejects(work(), { code: "job_in_progress" });
    }
    assert.equal(await count("daily_reports"), 0);
  });
  assert.equal(await generateReportForDate("2026-01-20", "manual"), 2);
  assert.equal(await count("daily_reports"), 2);
});

test("failure after the first report insert rolls back the entire date", async () => {
  await pool.query(`create function "${schema}".reject_partial_report() returns trigger language plpgsql as $$
    begin if exists (select 1 from daily_reports) then raise exception 'controlled second report failure'; end if; return new; end $$`);
  await pool.query("create trigger reject_partial_report before insert on daily_reports for each row execute function reject_partial_report()");
  try {
    await assert.rejects(generateReportForDate("2026-01-20", "manual"), /controlled second report failure/);
    assert.equal(await count("daily_reports"), 0);
  } finally { await pool.query("drop trigger reject_partial_report on daily_reports"); }
  assert.equal(await generateReportForDate("2026-01-20", "manual"), 2);
  await pool.query("drop function reject_partial_report()");
});

test("failed scheduled backfill retries on the same day instead of caching failure", async () => {
  await pool.query(`insert into analytics_settings (key, value) values ('report.mode', '"schedule"'), ('report.schedule_time', '"00:00"')`);
  await pool.query(`create function "${schema}".reject_backfill() returns trigger language plpgsql as $$
    begin if exists (select 1 from daily_reports where report_date < new.report_date) then raise exception 'controlled backfill failure'; end if; return new; end $$`);
  await pool.query("create trigger reject_backfill before insert on daily_reports for each row execute function reject_backfill()");
  try {
    await assert.rejects(checkScheduledReports(), /controlled backfill failure/);
    assert.equal(await count("daily_reports"), 0);
  } finally { await pool.query("drop trigger reject_backfill on daily_reports"); }
  assert.equal((await checkScheduledReports()).length, 14);
  assert.equal(await count("daily_reports"), 28);
  assert.deepEqual(await checkScheduledReports(), []);
  await pool.query("drop function reject_backfill()");
});

test("notifications seed defaults once and persist deduplication across runner instances", async () => {
  await pool.query("update assignments set status = 'overdue' where id = $1", [assignmentId]);
  assert.equal(await checkAndSendNotifications(), 2);
  assert.equal(await count("notification_rules"), 8);
  assert.equal(await count("notifications"), 2);
  assert.equal(await checkAndSendNotifications(), 0);
  assert.equal(await count("notification_rules"), 8);
  await hold("notifications", async () => {
    await assert.rejects(checkAndSendNotifications(), { code: "job_in_progress" });
  });
  assert.equal(await checkAndSendNotifications(), 0);
});

test("notification database failure rolls back seed and claims before any push", async () => {
  await pool.query("update assignments set status = 'overdue' where id = $1", [assignmentId]);
  await pool.query(`create function "${schema}".reject_notification() returns trigger language plpgsql as $$
    begin raise exception 'controlled notification failure'; end $$`);
  await pool.query("create trigger reject_notification before insert on notifications for each row execute function reject_notification()");
  try {
    await assert.rejects(checkAndSendNotifications(), /controlled notification failure/);
    assert.equal(await count("notifications"), 0);
    assert.equal(await count("notification_rules"), 0);
  } finally { await pool.query("drop trigger reject_notification on notifications"); }
  assert.equal(await checkAndSendNotifications(), 2);
  await pool.query("drop function reject_notification()");
});

test("push sees committed claims and holds the job lock until delivery finishes", async () => {
  await pool.query("update assignments set status = 'overdue' where id = $1", [assignmentId]);
  await pool.query(`insert into push_subscriptions (user_id, endpoint, keys) values ($1, $2, $3)`,
    [employeeId, "https://example.invalid/ci-push", JSON.stringify({ p256dh: "test", auth: "test" })]);
  const entered = deferred(), gate = deferred(); let deliveries = 0;
  push = async (_sub, _body, options) => {
    deliveries++; assert.equal(options.timeout, 10_000);
    assert.equal(await count("notifications"), 2); // separate database session
    entered.resolve(); await gate.promise;
  };
  const running = checkAndSendNotifications();
  await entered.promise;
  try { await assert.rejects(checkAndSendNotifications(), { code: "job_in_progress" }); }
  finally { gate.resolve(); }
  assert.equal(await running, 2);
  assert.equal(await checkAndSendNotifications(), 0);
  assert.equal(deliveries, 1);
});

test("push transport failure keeps claims durable and does not silently re-send", async () => {
  await pool.query("update assignments set status = 'overdue' where id = $1", [assignmentId]);
  await pool.query(`insert into push_subscriptions (user_id, endpoint, keys) values ($1, $2, $3)`,
    [employeeId, "https://example.invalid/ci-push", JSON.stringify({ p256dh: "test", auth: "test" })]);
  let deliveries = 0;
  push = async () => { deliveries++; throw new Error("controlled transport failure"); };
  assert.equal(await checkAndSendNotifications(), 2);
  assert.equal(await checkAndSendNotifications(), 0);
  assert.equal(deliveries, 1);
  assert.equal(await count("notifications"), 2);
});

test("actual manual job routes return private fixed 409 while their lane is busy", async () => {
  for (const [job, url] of [["reports", "/admin/reports/daily/generate"],
    ["notifications", "/admin/notification-rules/run-check"], ["deadlines", "/admin/assignments/run-deadline-check"]]) {
    await hold(job, async () => {
      const result = await request(url);
      assert.equal(result.statusCode, 409, result.body);
      assert.deepEqual(result.json(), { error: "job_in_progress" });
      assert.equal(result.headers["cache-control"], "no-store");
    });
    assert.equal((await request(url)).statusCode, 200);
  }
});

test("manual job routes still require administrator and trusted Origin", async () => {
  for (const url of ["/admin/reports/daily/generate", "/admin/notification-rules/run-check", "/admin/assignments/run-deadline-check"]) {
    assert.equal((await request(url, employeeCookies)).statusCode, 403);
    assert.equal((await request(url, {})).statusCode, 401);
    // Explicitly omit Origin (default parameter would otherwise supply it).
    assert.equal((await request(url, adminCookies, null)).statusCode, 403);
  }
});
