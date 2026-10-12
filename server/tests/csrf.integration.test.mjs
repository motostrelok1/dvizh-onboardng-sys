import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { installCsrfProtection } from "../src/csrf.ts";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installApiErrors } from "../src/api-validation.ts";
import { PDF } from "./file-fixtures.mjs";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-csrf-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { hashPassword } = await import("../src/auth/crypto.ts");
const { createSession, createInvitation } = await import("../src/auth/service.ts");
const { authRateLimitKey } = await import("../src/auth/rate-limit.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { authRoutes } = await import("../src/routes/auth.ts");
const { adminUserRoutes } = await import("../src/routes/admin-users.ts");
const { adminCourseRoutes } = await import("../src/routes/admin-courses.ts");
const { adminTestRoutes } = await import("../src/routes/admin-tests.ts");
const { adminAnalyticsSettingsRoutes } = await import("../src/routes/admin-analytics-settings.ts");
const { meRoutes } = await import("../src/routes/me.ts");
const { testAttemptRoutes } = await import("../src/routes/test-attempts.ts");
const { eventRoutes } = await import("../src/routes/events.ts");
const { notificationRoutes } = await import("../src/routes/notifications.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const origin = "https://edu.example.test", foreign = "https://hr.example.test";
const logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installPrivacyHeaders(app); installApiErrors(app); installCsrfProtection(app, origin);
const password = "CI-csrf-password";
let hash, adminId, userId, courseId, moduleId, lessonId, testId, questionId, answerId, attachmentId;
let adminCookies, userCookies, invitationToken, email, dir, userIds, keys, sequence = 0, requests;

before(async () => {
  hash = await hashPassword(password);
  await app.register(cookie); await app.register(multipart);
  for (const route of [authRoutes, adminUserRoutes, adminCourseRoutes, adminTestRoutes, adminAnalyticsSettingsRoutes,
    meRoutes, testAttemptRoutes, eventRoutes, notificationRoutes, adminAttachmentRoutes]) await app.register(route);
  await app.ready();
});
beforeEach(async () => {
  sequence++; requests = 0; keys = new Set(); logs.length = 0;
  [adminId, userId, courseId, moduleId, lessonId, testId, questionId, answerId, attachmentId] =
    Array.from({ length: 9 }, () => randomUUID());
  userIds = [adminId, userId]; email = `${userId}@example.test`;
  await pool.query(`insert into users (id, full_name, email, role, password_hash) values
    ($1, 'CI CSRF Admin', $2, 'admin', $5), ($3, 'CI CSRF Employee', $4, 'employee', $5)`,
    [adminId, `${adminId}@example.test`, userId, email, hash]);
  await pool.query("insert into courses (id, title, status, visibility) values ($1, 'CI CSRF Course', 'published', 'open_catalog')", [courseId]);
  await pool.query("insert into modules (id, course_id, title) values ($1, $2, 'CI Module')", [moduleId, courseId]);
  await pool.query("insert into lessons (id, module_id, title) values ($1, $2, 'CI Lesson')", [lessonId, moduleId]);
  await pool.query("insert into assignments (user_id, course_id) values ($1, $2)", [userId, courseId]);
  await pool.query("insert into tests (id, scope, parent_id) values ($1, 'lesson', $2)", [testId, lessonId]);
  await pool.query("insert into questions (id, test_id, text) values ($1, $2, 'CI Question')", [questionId, testId]);
  await pool.query("insert into answers (id, question_id, text, is_correct) values ($1, $2, 'CI Answer', true)", [answerId, questionId]);
  dir = join(process.env.UPLOAD_DIR, "lessons", lessonId); await mkdir(dir, { recursive: true });
  const path = join(dir, `${attachmentId}.pdf`); await writeFile(path, PDF);
  await pool.query("insert into lesson_attachments (id, lesson_id, file_name, file_path) values ($1, $2, 'handbook.pdf', $3)", [attachmentId, lessonId, path]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  userCookies = { [SESSION_COOKIE]: (await createSession(userId)).token };
  invitationToken = (await createInvitation(userId, adminId)).token;
  keys.add(authRateLimitKey("invitation_token", invitationToken)); keys.add(authRateLimitKey("invitation_account", userId));
});
afterEach(async () => {
  await pool.query("delete from tests where id = $1", [testId]);
  await pool.query("delete from courses where id = $1", [courseId]);
  await pool.query("delete from invitations where user_id = any($1::uuid[]) or created_by = any($1::uuid[])", [userIds]);
  await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
  await pool.query("delete from auth_rate_limits where bucket_key = any($1::text[])", [[...keys]]);
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
after(async () => { try { await app.close(); } finally { await pool.end(); await rm(scratch, { recursive: true, force: true }); } });

function call(method, url, payload, cookies = userCookies, source = origin, extra = {}) {
  const remoteAddress = `198.24.${sequence}.${++requests}`;
  keys.add(authRateLimitKey("action_ip", remoteAddress)); keys.add(authRateLimitKey("invitation_lookup_ip", remoteAddress));
  keys.add(authRateLimitKey("login_account", email));
  return app.inject({ method, url, payload, cookies, remoteAddress,
    headers: { ...(source === null ? {} : { origin: source }), ...extra } });
}
function denied(response) {
  assert.equal(response.statusCode, 403, response.body);
  assert.deepEqual(response.json(), { error: "csrf_forbidden" });
  assert.equal(response.cookies.length, 0);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
}
async function sessionIds() { return (await pool.query("select id from sessions where user_id = any($1::uuid[]) order by id", [userIds])).rows; }

test("same-site foreign origin cannot mutate admin data, tests, enrollment, events or push subscriptions", async () => {
  const sessions = await sessionIds();
  for (const [method, url, payload, cookies] of [["PATCH", `/admin/users/${userId}`, { isActive: false }, adminCookies],
    ["DELETE", `/admin/tests/${testId}`, undefined, adminCookies], ["DELETE", `/admin/courses/${courseId}`, undefined, adminCookies],
    ["POST", `/admin/users/${userId}/invitations`, undefined, adminCookies],
    ["PUT", "/admin/settings/analytics", { "risk.days": 99 }, adminCookies],
    ["POST", `/tests/${testId}/attempts`], ["POST", `/courses/${courseId}/enroll`],
    ["POST", "/events", { ownerId: userId, events: [{ eventId: randomUUID(), eventType: "lesson_view_start", entityId: lessonId, occurredAt: new Date().toISOString() }] }],
    ["POST", "/me/push-subscription", { endpoint: "https://push.example.test/SECRET", keys: { auth: "SECRET", p256dh: "SECRET" } }]]) {
    denied(await call(method, url, payload, cookies ?? userCookies, foreign));
  }
  assert.equal((await pool.query("select is_active from users where id = $1", [userId])).rows[0].is_active, true);
  assert.equal((await pool.query("select id from tests where id = $1", [testId])).rowCount, 1);
  assert.equal((await pool.query("select id from courses where id = $1", [courseId])).rowCount, 1);
  assert.equal((await pool.query("select id from test_attempts where user_id = $1", [userId])).rowCount, 0);
  assert.equal((await pool.query("select id from push_subscriptions where user_id = $1", [userId])).rowCount, 0);
  assert.equal((await pool.query("select id from events where user_id = $1 and event_type = 'lesson_view_start'", [userId])).rowCount, 0);
  assert.equal((await pool.query("select id from invitations where user_id = $1", [userId])).rowCount, 1);
  assert.deepEqual(await sessionIds(), sessions);
});

test("missing/null Origin and trusted Referer cannot log in, log out or accept invitations", async () => {
  const sessions = await sessionIds();
  for (const source of [null, "null", foreign]) {
    const headers = { referer: `${origin}/invite`, "sec-fetch-site": "same-site" };
    denied(await call("POST", "/auth/login", { email, password }, {}, source, headers));
    denied(await call("POST", "/auth/logout", undefined, userCookies, source, headers));
    denied(await call("POST", "/auth/invitations/accept", { token: invitationToken, password }, {}, source, headers));
    denied(await call("POST", "/auth/invitations/check", { token: invitationToken }, {}, source, headers));
  }
  assert.deepEqual(await sessionIds(), sessions);
  assert.equal((await pool.query("select used_at from invitations where user_id = $1", [userId])).rows[0].used_at, null);
});

test("allowed Origin keeps login/logout and administrator updates working without Referer", async () => {
  const login = await call("POST", "/auth/login", { email, password }, {});
  assert.equal(login.statusCode, 200, login.body);
  const cookies = { [SESSION_COOKIE]: login.cookies.find(cookie => cookie.name === SESSION_COOKIE).value };
  const patch = await call("PATCH", `/admin/users/${userId}`, { fullName: "CI Updated" }, adminCookies);
  assert.equal(patch.statusCode, 200); assert.equal(patch.json().user.full_name, "CI Updated");
  assert.equal((await call("POST", "/auth/logout", undefined, cookies)).statusCode, 200);
  assert.equal((await call("GET", "/auth/me", undefined, cookies, null)).statusCode, 401);
});

test("allowed invitation check/accept still reset credentials and create a usable session", async () => {
  const check = await call("POST", "/auth/invitations/check", { token: invitationToken }, {});
  assert.equal(check.statusCode, 200); assert.equal(check.json().valid, true);
  const accept = await call("POST", "/auth/invitations/accept", { token: invitationToken, password: "CI-csrf-new-password" }, {});
  assert.equal(accept.statusCode, 200, accept.body);
  const cookies = { [SESSION_COOKIE]: accept.cookies.find(cookie => cookie.name === SESSION_COOKIE).value };
  assert.equal((await call("GET", "/auth/me", undefined, cookies, null)).statusCode, 200);
  assert.equal((await call("GET", "/auth/me", undefined, userCookies, null)).statusCode, 401);
});

test("allowed JSON events/upload and downloads work while foreign multipart cannot create a file", async () => {
  const event = await call("POST", "/events", { ownerId: userId, events: [{ eventId: randomUUID(), eventType: "lesson_view_start", entityId: lessonId,
    occurredAt: new Date().toISOString() }] });
  assert.equal(event.statusCode, 200); assert.equal(event.json().accepted, 1);
  denied(await call("POST", `/admin/lessons/${lessonId}/attachments`, "SECRET-malformed", adminCookies, foreign,
    { "content-type": "multipart/form-data" }));
  assert.equal((await readdir(dir)).length, 1);
  const boundary = "csrf-test-boundary";
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lesson.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    PDF, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const upload = await call("POST", `/admin/lessons/${lessonId}/attachments`, payload, adminCookies, origin,
    { "content-type": `multipart/form-data; boundary=${boundary}` });
  assert.equal(upload.statusCode, 201, upload.body);
  const id = upload.json().attachment.id;
  const stored = (await pool.query("select file_path from lesson_attachments where id = $1", [id])).rows[0];
  assert.deepEqual(await readFile(stored.file_path), PDF);
  const download = await call("GET", `/attachments/${id}/download`, undefined, userCookies, null);
  assert.equal(download.statusCode, 200); assert.deepEqual(download.rawPayload, PDF);
});

test("foreign answers/finish cannot alter an open attempt and allowed requests finish normally", async () => {
  const started = await call("POST", `/tests/${testId}/attempts`);
  assert.equal(started.statusCode, 201); const id = started.json().attempt.id;
  denied(await call("POST", `/attempts/${id}/answers`, { questionId, selectedAnswerIds: [answerId] }, userCookies, foreign));
  denied(await call("POST", `/attempts/${id}/finish`, undefined, userCookies, foreign));
  assert.equal((await pool.query("select id from attempt_answers where attempt_id = $1", [id])).rowCount, 0);
  assert.equal((await pool.query("select status from test_attempts where id = $1", [id])).rows[0].status, "in_progress");
  assert.equal((await call("POST", `/attempts/${id}/answers`, { questionId, selectedAnswerIds: [answerId] })).statusCode, 200);
  const finished = await call("POST", `/attempts/${id}/finish`);
  assert.equal(finished.statusCode, 200); assert.equal(finished.json().score, 100);
});

test("trusted Origin never bypasses session or role checks", async () => {
  const anonymous = await call("PATCH", `/admin/users/${userId}`, { isActive: false }, {});
  assert.equal(anonymous.statusCode, 401);
  const employee = await call("PATCH", `/admin/users/${userId}`, { isActive: false }, userCookies);
  assert.equal(employee.statusCode, 403); assert.deepEqual(employee.json(), { error: "admin_only" });
  assert.equal((await pool.query("select is_active from users where id = $1", [userId])).rows[0].is_active, true);
});

test("forged loopback/proxy/simple requests stop before parsing, auth budgets and private log content", async () => {
  denied(await call("POST", "/auth/login", "SECRET-not-json", {}, foreign,
    { "content-type": "application/json", host: "hr.example.test", "x-forwarded-host": "hr.example.test",
      "x-forwarded-proto": "https", referer: `${origin}/invite#SECRET`, "sec-fetch-site": "same-origin" }));
  assert.equal((await pool.query("select bucket_key from auth_rate_limits where bucket_key = any($1::text[])", [[...keys]])).rowCount, 0);
  assert.ok(!logs.join("").includes("SECRET"));
  assert.ok(!logs.join("").includes(foreign));
});
