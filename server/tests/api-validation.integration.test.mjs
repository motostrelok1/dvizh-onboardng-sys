import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installApiErrors } from "../src/api-validation.ts";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-validation-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { hashPassword } = await import("../src/auth/crypto.ts");
const { createSession, createInvitation } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { authRateLimitKey } = await import("../src/auth/rate-limit.ts");
const { authRoutes } = await import("../src/routes/auth.ts");
const { adminUserRoutes } = await import("../src/routes/admin-users.ts");
const { adminTestRoutes } = await import("../src/routes/admin-tests.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installPrivacyHeaders(app);
installApiErrors(app);
const password = "CI-validation-password";
let hash, adminId, employeeId, courseId, moduleId, lessonId, testId, questionId, answerId;
let adminCookies, employeeCookies, email, userIds, testIds, keys, sequence = 0, requests;

before(async () => {
  hash = await hashPassword(password);
  await app.register(cookie);
  await app.register(multipart);
  for (const route of [authRoutes, adminUserRoutes, adminTestRoutes, adminAttachmentRoutes]) await app.register(route);
  await app.ready();
});
beforeEach(async () => {
  sequence++; requests = 0; keys = new Set(); logs.length = 0;
  [adminId, employeeId, courseId, moduleId, lessonId, testId, questionId, answerId] =
    Array.from({ length: 8 }, () => randomUUID());
  userIds = [adminId, employeeId]; testIds = [testId]; email = `${employeeId}@example.test`;
  await pool.query(`insert into users (id, full_name, email, role, password_hash) values
    ($1, 'CI Validation Admin', $2, 'admin', $5), ($3, 'CI Validation Employee', $4, 'employee', $5)`,
    [adminId, `${adminId}@example.test`, employeeId, email, hash]);
  await pool.query("insert into courses (id, title) values ($1, 'CI Validation Course')", [courseId]);
  await pool.query("insert into modules (id, course_id, title) values ($1, $2, 'CI Module')", [moduleId, courseId]);
  await pool.query("insert into lessons (id, module_id, title) values ($1, $2, 'CI Lesson')", [lessonId, moduleId]);
  await pool.query("insert into tests (id, scope, parent_id, max_attempts) values ($1, 'lesson', $2, 5)", [testId, lessonId]);
  await pool.query("insert into questions (id, test_id, text) values ($1, $2, 'CI Question')", [questionId, testId]);
  await pool.query("insert into answers (id, question_id, text) values ($1, $2, 'CI Answer')", [answerId, questionId]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  employeeCookies = { [SESSION_COOKIE]: (await createSession(employeeId)).token };
});
afterEach(async () => {
  await pool.query("delete from tests where id = any($1::uuid[])", [testIds]);
  await pool.query("delete from courses where id = $1", [courseId]);
  await pool.query("delete from invitations where user_id = any($1::uuid[]) or created_by = any($1::uuid[])", [userIds]);
  await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
  await pool.query("delete from auth_rate_limits where bucket_key = any($1::text[])", [[...keys]]);
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
after(async () => {
  try { await app.close(); }
  finally { await pool.end(); await rm(scratch, { recursive: true, force: true }); }
});

function request(method, url, payload, cookies = adminCookies, headers = {}) {
  const remoteAddress = `198.23.${sequence}.${++requests}`;
  keys.add(authRateLimitKey("action_ip", remoteAddress));
  keys.add(authRateLimitKey("invitation_lookup_ip", remoteAddress));
  keys.add(authRateLimitKey("login_account", email));
  if (payload === null) { headers = { ...headers, "content-type": "application/json" }; payload = "null"; }
  return app.inject({ method, url, payload, cookies, headers, remoteAddress });
}
async function invalid(method, url, payload) {
  const response = await request(method, url, payload);
  assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
  assert.deepEqual(response.json(), { error: "invalid_request" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.ok(!response.body.includes("SECRET"));
}
async function row(table, id) {
  assert.ok(["users", "tests", "questions", "answers"].includes(table));
  return (await pool.query(`select * from ${table} where id = $1`, [id])).rows[0];
}

test("valid employee create/update/list retains UI fields and never returns password hashes", async () => {
  const response = await request("POST", "/admin/users", { fullName: "Иван Иванов", email: `${randomUUID()}@example.test`,
    departmentId: null, timezone: "America/New_York" });
  assert.equal(response.statusCode, 201, response.body);
  const user = response.json().user; userIds.push(user.id);
  assert.equal(user.role, "employee"); assert.equal(user.timezone, "America/New_York");
  assert.equal(user.password_hash, undefined); assert.ok(user.created_at);
  const patched = await request("PATCH", `/admin/users/${user.id}`, { fullName: "Иван Петров", timezone: "UTC", isActive: true });
  assert.equal(patched.statusCode, 200); assert.equal(patched.json().user.full_name, "Иван Петров");
  const list = await request("GET", "/admin/users");
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().users.some(value => value.id === user.id));
  assert.ok(!list.body.includes("password_hash"));
});

test("invalid employee creation is rejected without inserting any fixture email", async () => {
  const newEmail = `${randomUUID()}@example.test`;
  for (const payload of [null, [], {}, { fullName: 42, email: newEmail }, { fullName: " ", email: newEmail },
    { fullName: "x".repeat(257), email: newEmail }, { fullName: "Valid", email: "not-email" },
    { fullName: "Valid", email: newEmail, departmentId: false }, { fullName: "Valid", email: newEmail, timezone: "Invalid/Zone" },
    { fullName: "Valid", email: newEmail, role: "admin" }]) await invalid("POST", "/admin/users", payload);
  assert.equal((await pool.query("select id from users where email = $1", [newEmail])).rowCount, 0);
});

test("invalid employee PATCH cannot coerce activation or mutate the user/sessions", async () => {
  const previous = await row("users", employeeId);
  for (const payload of [null, [], {}, { isActive: "false" }, { isActive: 0 }, { isActive: null },
    { fullName: "" }, { timezone: null }, { timezone: "+05:00" }, { departmentId: "bad" }, { role: "admin" }]) {
    await invalid("PATCH", `/admin/users/${employeeId}`, payload);
  }
  assert.deepEqual(await row("users", employeeId), previous);
  assert.equal((await request("GET", "/auth/me", undefined, employeeCookies)).statusCode, 200);
});

test("invalid UUID/query is rejected for all scoped parameter routes", async () => {
  for (const [method, url, payload] of [["PATCH", "/admin/users/bad", { isActive: true }],
    ["POST", "/admin/users/bad/invitations"], ["DELETE", "/admin/invitations/bad"],
    ["GET", "/admin/tests/bad"], ["PATCH", "/admin/tests/bad", { passScore: 70 }], ["DELETE", "/admin/tests/bad"],
    ["POST", "/admin/tests/bad/questions", { text: "Valid" }], ["PATCH", "/admin/questions/bad", { text: "Valid" }],
    ["DELETE", "/admin/questions/bad"], ["POST", "/admin/questions/bad/answers", { text: "Valid" }],
    ["PATCH", "/admin/answers/bad", { text: "Valid" }], ["DELETE", "/admin/answers/bad"],
    ["DELETE", "/admin/attachments/bad"], ["GET", "/attachments/bad/download"],
    ["GET", `/admin/tests/${testId}?passScore=SECRET`], ["GET", "/admin/users?role=SECRET"]]) await invalid(method, url, payload);
});

test("normal test/question/answer editor round trip and integer boundary settings work", async () => {
  const created = await request("POST", "/admin/tests", { scope: "module", parentId: moduleId });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().test.id; testIds.push(id);
  for (const settings of [{ maxAttempts: 1, showCorrectAnswers: false, passScore: 0 },
    { maxAttempts: null, showCorrectAnswers: true, passScore: 100 }, { maxAttempts: 2147483647, passScore: 70 }]) {
    const response = await request("PATCH", `/admin/tests/${id}`, settings);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().test.max_attempts, settings.maxAttempts);
    assert.equal(response.json().test.pass_score, settings.passScore);
  }
  const question = await request("POST", `/admin/tests/${id}/questions`, { text: "Вопрос", multiple: true });
  assert.equal(question.statusCode, 201); const qid = question.json().question.id;
  const answer = await request("POST", `/admin/questions/${qid}/answers`, { text: "Ответ", isCorrect: true });
  assert.equal(answer.statusCode, 201); const aid = answer.json().answer.id;
  assert.equal((await request("PATCH", `/admin/questions/${qid}`, { text: "Новый вопрос", multiple: false })).statusCode, 200);
  assert.equal((await request("PATCH", `/admin/answers/${aid}`, { text: "Новый ответ", isCorrect: false })).statusCode, 200);
  const detail = await request("GET", `/admin/tests/${id}`);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().questions[0].answers[0].is_correct, false);
  assert.equal((await request("DELETE", `/admin/answers/${aid}`)).statusCode, 200);
  assert.equal((await request("DELETE", `/admin/questions/${qid}`)).statusCode, 200);
  assert.equal((await request("DELETE", `/admin/tests/${id}`)).statusCode, 200);
});

test("invalid test settings cannot write fractions, coerced booleans or out-of-range integers", async () => {
  const previous = await row("tests", testId);
  for (const payload of [{ maxAttempts: 0 }, { maxAttempts: -1 }, { maxAttempts: 1.5 }, { maxAttempts: "3" },
    { maxAttempts: 2147483648 }, { passScore: -1 }, { passScore: 101 }, { passScore: 70.5 }, { passScore: "70" },
    { passScore: null }, { showCorrectAnswers: "false" }, { showCorrectAnswers: 0 }, {}, null, { unknown: true }]) {
    await invalid("PATCH", `/admin/tests/${testId}`, payload);
  }
  assert.deepEqual(await row("tests", testId), previous);
});

test("invalid question/answer types and lengths leave editor records untouched", async () => {
  const question = await row("questions", questionId), answer = await row("answers", answerId);
  for (const text of ["", " \n", false, 7, null, "x".repeat(10001), "SECRET\u0000value"]) {
    await invalid("PATCH", `/admin/questions/${questionId}`, { text });
    await invalid("PATCH", `/admin/answers/${answerId}`, { text });
  }
  await invalid("PATCH", `/admin/questions/${questionId}`, { multiple: "false" });
  await invalid("PATCH", `/admin/answers/${answerId}`, { isCorrect: "false" });
  assert.deepEqual(await row("questions", questionId), question);
  assert.deepEqual(await row("answers", answerId), answer);
});

test("auth schemas reject malformed input and preserve normal login/user DTO behavior", async () => {
  const previous = (await pool.query("select id from sessions where user_id = $1 order by id", [employeeId])).rows;
  for (const payload of [null, [], {}, { email, password: false }, { email: 42, password },
    { email, password, role: "admin" }, { email: " ", password }]) await invalid("POST", "/auth/login", payload);
  assert.deepEqual((await pool.query("select id from sessions where user_id = $1 order by id", [employeeId])).rows, previous);
  const login = await request("POST", "/auth/login", { email, password }, {});
  assert.equal(login.statusCode, 200, login.body);
  assert.deepEqual(Object.keys(login.json().user).sort(), ["email", "fullName", "id", "role", "timezone"]);
  assert.equal(login.json().user.id, employeeId);
});

test("invitation schemas reject malformed token/password without consuming a valid link", async () => {
  const { token } = await createInvitation(employeeId, adminId);
  keys.add(authRateLimitKey("invitation_token", token));
  keys.add(authRateLimitKey("invitation_account", employeeId));
  for (const payload of [{ token: [], password }, { token, password: 42 }, { token: "%SECRET", password },
    { token, password, unknown: true }, null]) await invalid("POST", "/auth/invitations/accept", payload);
  assert.equal((await pool.query("select used_at from invitations where user_id = $1", [employeeId])).rows[0].used_at, null);
  assert.equal((await request("POST", "/auth/invitations/check", { token }, {})).statusCode, 200);
  const accepted = await request("POST", "/auth/invitations/accept", { token, password }, {});
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json(), { ok: true });
});

test("real FK failure and injected internal error return safe errors without SQL or private logs", async () => {
  const newEmail = `${randomUUID()}@example.test`;
  const fk = await request("POST", "/admin/users", { fullName: "Valid", email: newEmail, departmentId: randomUUID() });
  assert.equal(fk.statusCode, 409); assert.deepEqual(fk.json(), { error: "invalid_reference" });
  assert.equal((await pool.query("select id from users where email = $1", [newEmail])).rowCount, 0);
  const original = pool.query;
  try {
    pool.query = function (...args) {
      if (String(args[0]).includes("department_name")) throw new Error("SECRET select password_hash from users /srv/private");
      return original.apply(this, args);
    };
    const response = await request("GET", "/admin/users");
    assert.equal(response.statusCode, 500); assert.deepEqual(response.json(), { error: "internal_error" });
  } finally { pool.query = original; }
  assert.ok(!logs.join("").includes("SECRET"));
  assert.ok(!logs.join("").includes("password_hash"));
});

test("invalid upload ID and malformed multipart cannot create files or expose parser internals", async () => {
  const invalidId = await request("POST", "/admin/lessons/bad/attachments");
  assert.equal(invalidId.statusCode, 400); assert.deepEqual(invalidId.json(), { error: "invalid_lesson_id" });
  const type = await request("POST", `/admin/lessons/${lessonId}/attachments`, { value: "SECRET" });
  assert.equal(type.statusCode, 406); assert.deepEqual(type.json(), { error: "unsupported_media_type" });
  const malformed = await request("POST", `/admin/lessons/${lessonId}/attachments`, "SECRET",
    adminCookies, { "content-type": "multipart/form-data" });
  assert.equal(malformed.statusCode, 400); assert.deepEqual(malformed.json(), { error: "invalid_request" });
  assert.equal((await pool.query("select id from lesson_attachments where lesson_id = $1", [lessonId])).rowCount, 0);
  await assert.rejects(lstat(process.env.UPLOAD_DIR), { code: "ENOENT" });
});
