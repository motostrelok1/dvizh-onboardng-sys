import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-deadline-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { meRoutes } = await import("../src/routes/me.ts");
const { testAttemptRoutes } = await import("../src/routes/test-attempts.ts");
const { adminAssignmentRoutes } = await import("../src/routes/admin-assignments.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const { ensureLessonDir, UPLOAD_DIR } = await import("../src/storage.ts");
const { installPrivacyHeaders } = await import("../src/privacy.ts");

// Register actual routes, deliberately never start the deadline scheduler.
const app = Fastify();
installPrivacyHeaders(app);
let employeeId, adminId, otherId, courseId, moduleId, lessonId, attachmentId;
let testId, moduleTestId, questionId, answerId, attemptId, assignmentId;
let employeeCookies, adminCookies, otherCookies;
let courseIds, testIds;

before(async () => {
  await app.register(cookie);
  await app.register(meRoutes);
  await app.register(testAttemptRoutes);
  await app.register(adminAssignmentRoutes);
  await app.register(adminAttachmentRoutes);
  await app.ready();
});

beforeEach(async () => {
  [employeeId, adminId, otherId, courseId, moduleId, lessonId, attachmentId,
    testId, moduleTestId, questionId, answerId, attemptId, assignmentId] =
    Array.from({ length: 13 }, () => randomUUID());
  courseIds = [courseId];
  testIds = [testId, moduleTestId];
  await pool.query(`insert into users (id, full_name, role) values
    ($1, 'CI Deadline Employee', 'employee'), ($2, 'CI Deadline Admin', 'admin'),
    ($3, 'CI Deadline Other', 'employee')`, [employeeId, adminId, otherId]);
  await pool.query("insert into courses (id, title, status) values ($1, 'CI Deadline Course', 'published')", [courseId]);
  await pool.query("insert into modules (id, course_id, title) values ($1, $2, 'CI Module')", [moduleId, courseId]);
  await pool.query("insert into lessons (id, module_id, title, text_content) values ($1, $2, 'CI Lesson', 'private lesson')", [lessonId, moduleId]);
  const path = join(await ensureLessonDir(lessonId), `${attachmentId}.pdf`);
  await writeFile(path, "private legacy attachment");
  await pool.query(`insert into lesson_attachments (id, lesson_id, file_name, file_path)
    values ($1, $2, 'legacy.pdf', $3)`, [attachmentId, lessonId, path]);
  await pool.query(`insert into tests (id, scope, parent_id, show_correct_answers) values
    ($1, 'lesson', $2, true), ($3, 'module', $4, false)`, [testId, lessonId, moduleTestId, moduleId]);
  await pool.query("insert into questions (id, test_id, text) values ($1, $2, 'CI Question')", [questionId, testId]);
  await pool.query("insert into answers (id, question_id, text, is_correct) values ($1, $2, 'CI Answer', true)", [answerId, questionId]);
  const moduleQuestion = randomUUID();
  await pool.query("insert into questions(id,test_id,text) values ($1,$2,'CI Module Question')", [moduleQuestion, moduleTestId]);
  await pool.query("insert into answers(question_id,text,is_correct) values ($1,'CI Module Answer',true)", [moduleQuestion]);
  await pool.query(`insert into assignments (id, user_id, course_id, assigned_by, deadline)
    values ($1, $2, $3, $4, clock_timestamp() + interval '1 day')`, [assignmentId, employeeId, courseId, adminId]);
  await pool.query(`insert into test_attempts (id, user_id, test_id, attempt_number)
    values ($1, $2, $3, 1)`, [attemptId, employeeId, testId]);
  employeeCookies = { [SESSION_COOKIE]: (await createSession(employeeId)).token };
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  otherCookies = { [SESSION_COOKIE]: (await createSession(otherId)).token };
});

afterEach(async () => {
  // Tests have polymorphic parents without FK; remove only our own UUIDs.
  await pool.query("delete from tests where id = any($1::uuid[])", [testIds]);
  await pool.query("delete from courses where id = any($1::uuid[])", [courseIds]);
  await pool.query("delete from users where id = any($1::uuid[])", [[employeeId, adminId, otherId]]);
  await rm(UPLOAD_DIR, { recursive: true, force: true });
});

after(async () => {
  try { await app.close(); }
  finally { await pool.end(); await rm(scratch, { recursive: true, force: true }); }
});

function request(url, method = "GET", payload, cookies = employeeCookies) {
  return app.inject({ url, method, payload, cookies });
}
function answer(cookies = employeeCookies) {
  return request(`/attempts/${attemptId}/answers`, "POST", { questionId, selectedAnswerIds: [answerId] }, cookies);
}
function finish(cookies = employeeCookies) {
  return request(`/attempts/${attemptId}/finish`, "POST", undefined, cookies);
}
async function expire(status = "assigned") {
  await pool.query(`update assignments set deadline = clock_timestamp() - interval '1 microsecond',
    status = $2 where id = $1`, [assignmentId, status]);
}
async function assignment() {
  return (await pool.query("select * from assignments where id = $1", [assignmentId])).rows[0];
}
async function futureDeadline() {
  return (await pool.query("select clock_timestamp() + interval '1 day' as deadline")).rows[0].deadline.toISOString();
}
async function extend(deadline) {
  const response = await request(`/admin/assignments/${assignmentId}/extend-deadline`, "POST", { deadline }, adminCookies);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().assignment;
}
async function contentAllowed(cookies = employeeCookies) {
  for (const url of [`/me/courses/${courseId}`, `/lessons/${lessonId}`, `/attachments/${attachmentId}/download`,
    `/tests/${testId}/attempts`, `/tests/${moduleTestId}/attempts`]) {
    const response = await request(url, "GET", undefined, cookies);
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
  }
}
async function forbidden(response, reason = "deadline_passed") {
  assert.equal(response.statusCode, 403, response.body);
  assert.deepEqual(response.json(), { error: reason });
  assert.equal(response.headers["cache-control"], "no-store");
}
async function allDenied(reason = "deadline_passed") {
  for (const url of [`/me/courses/${courseId}`, `/lessons/${lessonId}`, `/attachments/${attachmentId}/download`,
    `/tests/${testId}/attempts`, `/tests/${moduleTestId}/attempts`]) await forbidden(await request(url), reason);
  for (const id of [testId, moduleTestId]) await forbidden(await request(`/tests/${id}/attempts`, "POST"), reason);
  await forbidden(await answer(), reason);
  await forbidden(await finish(), reason);
}
async function unchangedAttempt() {
  const row = (await pool.query("select * from test_attempts where id = $1", [attemptId])).rows[0];
  assert.equal(row.status, "in_progress");
  assert.equal(row.score, null);
  assert.equal(row.finished_at, null);
  assert.equal((await pool.query("select id from attempt_answers where attempt_id = $1", [attemptId])).rowCount, 0);
  assert.equal((await pool.query(`select id from events where user_id = $1 and event_type in
    ('test_attempt_start', 'test_attempt_end', 'question_answered', 'attachment_download')`, [employeeId])).rowCount, 0);
  assert.equal((await pool.query("select id from test_attempts where user_id = $1", [employeeId])).rowCount, 1);
}

test("future deadline permits content, resume, answers and scored finish", async () => {
  await contentAllowed();
  const resumed = await request(`/tests/${testId}/attempts`, "POST");
  assert.equal(resumed.statusCode, 201);
  assert.equal(resumed.json().attempt.id, attemptId);
  assert.equal(resumed.json().questions[0].answers[0].is_correct, undefined);
  assert.equal((await request(`/tests/${moduleTestId}/attempts`, "POST")).statusCode, 201);
  assert.equal((await answer()).statusCode, 200);
  const result = await finish();
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().score, 100);
  assert.equal(result.json().passed, true);
  assert.equal(result.json().review[0].yourCorrect, true);
});

test("null deadline permits content and attempts without a scheduler", async () => {
  await pool.query("update assignments set deadline = null where id = $1", [assignmentId]);
  await contentAllowed();
  assert.equal((await answer()).statusCode, 200);
  assert.equal((await finish()).statusCode, 200);
});

for (const status of ["assigned", "in_progress", "completed"]) {
  test(`expired ${status} blocks every content/test path before the job and preserves data`, async () => {
    await expire(status);
    await allDenied();
    await unchangedAttempt();
    const stored = await assignment();
    assert.equal(stored.status, status);
    assert.equal(stored.closed_at, null);
    const list = await request("/me/courses");
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().assigned.find(row => row.course_id === courseId).status, "overdue");
  });
}

test("a completed course with a future or absent deadline remains readable", async () => {
  await pool.query("update assignments set status = 'completed' where id = $1", [assignmentId]);
  await contentAllowed();
  await pool.query("update assignments set deadline = null where id = $1", [assignmentId]);
  await contentAllowed();
  assert.equal((await request("/me/courses")).json().assigned.find(row => row.course_id === courseId).status, "completed");
});

test("stored overdue is denied even with a future or null deadline until admin extension", async () => {
  await pool.query("update assignments set status = 'overdue' where id = $1", [assignmentId]);
  await allDenied();
  await pool.query("update assignments set deadline = null where id = $1", [assignmentId]);
  await allDenied();
});

test("real deadline crossing immediately denies access without persisting overdue", async () => {
  await pool.query("update assignments set deadline = clock_timestamp() + interval '1 second' where id = $1", [assignmentId]);
  assert.equal((await request(`/lessons/${lessonId}`)).statusCode, 200);
  // Wait against the same DB clock, without relying on the Node wall clock.
  await pool.query(`select pg_sleep(greatest(0, extract(epoch from (deadline - clock_timestamp()))) + 0.002)
    from assignments where id = $1`, [assignmentId]);
  await forbidden(await request(`/lessons/${lessonId}`));
  assert.equal((await assignment()).status, "assigned");
});

test("skewed Node clock cannot reopen an expired assignment", async () => {
  await expire();
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ["2000-01-01T00:00:00Z"])); }
    static now() { return RealDate.parse("2000-01-01T00:00:00Z"); }
  };
  try { await allDenied(); }
  finally { globalThis.Date = RealDate; }
});

test("extension before the job restores course, lesson, file, resume, answers and finish", async () => {
  await expire();
  await allDenied();
  await extend(await futureDeadline());
  await contentAllowed();
  assert.equal((await request(`/tests/${testId}/attempts`, "POST")).json().attempt.id, attemptId);
  assert.equal((await answer()).statusCode, 200);
  assert.equal((await finish()).json().score, 100);
  assert.equal((await assignment()).status, "assigned");
});

test("job persists one closure event; repeat is idempotent and extension restores access", async () => {
  await expire("in_progress");
  for (let i = 0; i < 2; i++) {
    const result = await request("/admin/assignments/run-deadline-check", "POST", undefined, adminCookies);
    assert.equal(result.statusCode, 200);
  }
  assert.equal((await assignment()).status, "overdue");
  assert.ok((await assignment()).closed_at);
  assert.equal((await pool.query("select id from events where entity_id = $1 and event_type = 'access_closed'", [assignmentId])).rowCount, 1);
  await allDenied();
  const restored = await extend(await futureDeadline());
  assert.equal(restored.status, "assigned");
  assert.equal(restored.closed_at, null);
  await contentAllowed();
});

test("removing an expired deadline through admin extension restores access", async () => {
  await expire();
  await allDenied();
  await extend(null);
  await contentAllowed();
});

test("admin extension to a past deadline cannot reopen access", async () => {
  await expire("overdue");
  await extend("2000-01-01T00:00:00Z");
  assert.equal((await assignment()).status, "assigned");
  await allDenied();
});

test("completed history survives expiry and extension without resetting completion", async () => {
  await expire("completed");
  await pool.query("update test_attempts set status = 'finished', score = 100, passed = true, finished_at = now() where id = $1", [attemptId]);
  await forbidden(await request(`/tests/${testId}/attempts`));
  await extend(await futureDeadline());
  assert.equal((await assignment()).status, "completed");
  const history = await request(`/tests/${testId}/attempts`);
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().attempts[0].score, 100);
  assert.equal(history.json().attempts[0].status, "finished");
});

test("catalog enrollment cannot bypass an expired existing assignment", async () => {
  await pool.query("update courses set visibility = 'open_catalog' where id = $1", [courseId]);
  await expire();
  assert.equal((await request(`/courses/${courseId}/enroll`, "POST")).statusCode, 200);
  await allDenied();
  assert.equal((await assignment()).status, "assigned");
  assert.equal((await request("/me/courses")).json().catalog.some(row => row.course_id === courseId), false);
});

test("removing assignment also denies answers and finish for an already open attempt", async () => {
  await pool.query("delete from assignments where id = $1", [assignmentId]);
  await allDenied("not_assigned");
  await unchangedAttempt();
});

test("expiry affects only one course and keeps the session and another course usable", async () => {
  const secondCourse = randomUUID();
  courseIds.push(secondCourse);
  await pool.query("insert into courses (id, title, status) values ($1, 'CI Unaffected Course', 'published')", [secondCourse]);
  await pool.query("insert into assignments (user_id, course_id) values ($1, $2)", [employeeId, secondCourse]);
  await expire();
  await forbidden(await request(`/me/courses/${courseId}`));
  assert.equal((await request(`/me/courses/${secondCourse}`)).statusCode, 200);
  assert.equal((await request("/me/courses")).statusCode, 200);
  assert.equal((await pool.query("select is_active from users where id = $1", [employeeId])).rows[0].is_active, true);
});

test("admin content access remains exempt from employee deadlines", async () => {
  await expire();
  await contentAllowed(adminCookies);
});

test("another employee cannot answer or finish the owner's attempt before or after expiry", async () => {
  for (let i = 0; i < 2; i++) {
    for (const response of [await answer(otherCookies), await finish(otherCookies)]) {
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), { error: "not_found" });
    }
    await expire();
  }
  await unchangedAttempt();
});
