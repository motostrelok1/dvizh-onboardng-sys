import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { installPrivacyHeaders } from "../src/privacy.ts";
import { installApiErrors } from "../src/api-validation.ts";
import { installCsrfProtection } from "../src/csrf.ts";

await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const { createSession, createInvitation } = await import("../src/auth/service.ts");
const { hashPassword } = await import("../src/auth/crypto.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { adminUserRoutes } = await import("../src/routes/admin-users.ts");
const { adminTestRoutes } = await import("../src/routes/admin-tests.ts");
const { requireAuth } = await import("../src/auth/middleware.ts");
const origin = "https://lms.example.test";
const app = Fastify();
installPrivacyHeaders(app);
installApiErrors(app);
installCsrfProtection(app, origin);
let hash, adminId, employeeId, departmentId, otherDepartmentId, courseId, moduleId, testId;
let adminCookies, employeeCookies;

before(async () => {
  hash = await hashPassword("CI-patch-password");
  await app.register(cookie);
  await app.register(adminUserRoutes);
  await app.register(adminTestRoutes);
  app.get("/session-check", { preHandler: requireAuth }, async () => ({ ok: true }));
  await app.ready();
});
beforeEach(async () => {
  [adminId, employeeId, departmentId, otherDepartmentId, courseId, moduleId, testId] =
    Array.from({ length: 7 }, () => randomUUID());
  await pool.query("insert into departments (id, name) values ($1, 'CI Department'), ($2, 'CI Other Department')",
    [departmentId, otherDepartmentId]);
  await pool.query(`insert into users (id, full_name, email, role, password_hash, department_id, timezone) values
    ($1, 'CI Patch Admin', $2, 'admin', $5, null, 'UTC'),
    ($3, 'CI Patch Employee', $4, 'employee', $5, $6, 'America/New_York')`,
    [adminId, `${adminId}@example.test`, employeeId, `${employeeId}@example.test`, hash, departmentId]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  employeeCookies = { [SESSION_COOKIE]: (await createSession(employeeId)).token };
  await createInvitation(employeeId, adminId);
  await pool.query("insert into courses (id, title) values ($1, 'CI Patch Course')", [courseId]);
  await pool.query("insert into modules (id, course_id, title) values ($1, $2, 'CI Patch Module')", [moduleId, courseId]);
  await pool.query(`insert into tests (id, scope, parent_id, max_attempts, show_correct_answers, pass_score)
    values ($1, 'module', $2, 5, true, 80)`, [testId, moduleId]);
});
afterEach(async () => {
  await pool.query("delete from tests where id = $1", [testId]);
  await pool.query("delete from courses where id = $1", [courseId]);
  await pool.query("delete from invitations where user_id = any($1::uuid[]) or created_by = any($1::uuid[])",
    [[adminId, employeeId]]);
  await pool.query("delete from users where id = any($1::uuid[])", [[adminId, employeeId]]);
  await pool.query("delete from departments where id = any($1::uuid[])", [[departmentId, otherDepartmentId]]);
});
after(async () => {
  try { await app.close(); }
  finally { await pool.end(); }
});

function patch(url, payload, cookies = adminCookies, requestOrigin = origin) {
  return app.inject({ method: "PATCH", url, payload, cookies,
    headers: requestOrigin === undefined ? {} : { origin: requestOrigin } });
}
async function user() {
  return (await pool.query("select * from users where id = $1", [employeeId])).rows[0];
}
async function settings() {
  return (await pool.query("select * from tests where id = $1", [testId])).rows[0];
}
async function credentials() {
  return {
    sessions: (await pool.query("select * from sessions where user_id = $1 order by id", [employeeId])).rows,
    invitations: (await pool.query("select * from invitations where user_id = $1 order by id", [employeeId])).rows
  };
}
async function expectUser(payload, expected) {
  const response = await patch(`/admin/users/${employeeId}`, payload);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(await user(), expected);
  for (const key of ["id", "full_name", "email", "role", "department_id", "timezone", "is_active"]) {
    assert.deepEqual(response.json().user[key], expected[key], key);
  }
  assert.equal(response.json().user.password_hash, undefined);
}
async function expectSettings(payload, expected) {
  const response = await patch(`/admin/tests/${testId}`, payload);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().test, expected);
  assert.deepEqual(await settings(), expected);
}

test("employee name-only PATCH preserves department, timezone, activation and credentials", async () => {
  const previous = await user(), previousCredentials = await credentials();
  await expectUser({ fullName: "Новое имя" }, { ...previous, full_name: "Новое имя" });
  assert.deepEqual(await credentials(), previousCredentials);
});

test("employee timezone-only PATCH preserves all other employee fields", async () => {
  const previous = await user(), previousCredentials = await credentials();
  await expectUser({ timezone: "UTC" }, { ...previous, timezone: "UTC" });
  assert.deepEqual(await credentials(), previousCredentials);
});

test("explicit department PATCH replaces, clears with null, clears again and restores the department", async () => {
  const previous = await user(), previousCredentials = await credentials();
  for (const id of [otherDepartmentId, null, null, departmentId]) {
    await expectUser({ departmentId: id }, { ...previous, department_id: id });
    assert.deepEqual(await credentials(), previousCredentials);
  }
});

test("department clearing and false activation preserve other fields and revoke credentials atomically", async () => {
  const previous = await user();
  await expectUser({ departmentId: null, isActive: false }, { ...previous, department_id: null, is_active: false });
  const current = await credentials();
  assert.equal(current.sessions.length, 0);
  assert.equal(current.invitations.length, 1);
  assert.ok(current.invitations[0].revoked_at instanceof Date);
  const response = await app.inject({ url: "/session-check", cookies: employeeCookies });
  assert.equal(response.statusCode, 401);
});

test("null in non-nullable employee fields rejects the entire PATCH without credential changes", async () => {
  const previous = await user(), previousCredentials = await credentials();
  for (const field of ["fullName", "timezone", "isActive"]) {
    const response = await patch(`/admin/users/${employeeId}`, { departmentId: null, [field]: null });
    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(response.json(), { error: "invalid_request" });
    assert.deepEqual(await user(), previous);
    assert.deepEqual(await credentials(), previousCredentials);
  }
});

test("invalid department FK rolls back mixed employee PATCH and leaves sessions/invitations intact", async () => {
  const previous = await user(), previousCredentials = await credentials();
  const response = await patch(`/admin/users/${employeeId}`, {
    fullName: "Must roll back", departmentId: randomUUID(), timezone: "UTC", isActive: false
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(response.json(), { error: "invalid_reference" });
  assert.deepEqual(await user(), previous);
  assert.deepEqual(await credentials(), previousCredentials);
});

test("passScore-only PATCH accepts zero and preserves the finite attempt limit and review flag", async () => {
  const previous = await settings();
  await expectSettings({ passScore: 0 }, { ...previous, pass_score: 0 });
});

test("showCorrectAnswers-only PATCH accepts false and preserves the attempt limit and pass score", async () => {
  const previous = await settings();
  await expectSettings({ showCorrectAnswers: false }, { ...previous, show_correct_answers: false });
});

test("explicit attempt limit replaces, clears with null, remains unlimited on omission and restores", async () => {
  const previous = await settings();
  for (const max of [3, null, null]) {
    await expectSettings({ maxAttempts: max }, { ...previous, max_attempts: max });
  }
  await expectSettings({ passScore: 0 }, { ...previous, max_attempts: null, pass_score: 0 });
  await expectSettings({ maxAttempts: 1 }, { ...previous, max_attempts: 1, pass_score: 0 });
});

test("null in non-nullable test settings rejects the entire PATCH without removing the attempt limit", async () => {
  const previous = await settings();
  for (const field of ["showCorrectAnswers", "passScore"]) {
    const response = await patch(`/admin/tests/${testId}`, { maxAttempts: null, [field]: null });
    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(response.json(), { error: "invalid_request" });
    assert.deepEqual(await settings(), previous);
  }
});

test("nullable PATCH still requires trusted Origin, authentication and administrator role", async () => {
  const previousUser = await user(), previousTest = await settings(), previousCredentials = await credentials();
  for (const [url, payload] of [[`/admin/users/${employeeId}`, { departmentId: null }],
    [`/admin/tests/${testId}`, { maxAttempts: null }]]) {
    for (const [cookies, requestOrigin, status, error] of [
      [adminCookies, "https://foreign.example.test", 403, "csrf_forbidden"],
      [{}, origin, 401, "not_authenticated"], [employeeCookies, origin, 403, "admin_only"]
    ]) {
      const response = await patch(url, payload, cookies, requestOrigin);
      assert.equal(response.statusCode, status, response.body);
      assert.deepEqual(response.json(), { error });
      assert.deepEqual(await user(), previousUser);
      assert.deepEqual(await settings(), previousTest);
      assert.deepEqual(await credentials(), previousCredentials);
    }
  }
});
