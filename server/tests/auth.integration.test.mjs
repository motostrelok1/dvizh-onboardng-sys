import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

// Never fall back to DATABASE_URL or load a developer's .env.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(testDatabaseUrl, "Set TEST_DATABASE_URL to a migrated local database ending in _test");
const database = new URL(testDatabaseUrl);
assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname), "Test PostgreSQL must be local");
assert.match(database.pathname, /^\/[a-zA-Z0-9_]+_test$/, "Use a separate database ending in _test");
process.env.DATABASE_URL = testDatabaseUrl;

// Dynamic imports ensure the real application pool uses the test URL.
const { pool } = await import("../src/db.ts");
const { hashPassword, hashToken } = await import("../src/auth/crypto.ts");
const { createSession, createInvitation, revokeInvitation } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { authRoutes } = await import("../src/routes/auth.ts");
const { adminUserRoutes } = await import("../src/routes/admin-users.ts");
const { meRoutes } = await import("../src/routes/me.ts");

const app = Fastify();
const password = "test-password-123";
let passwordHash;
let employee;
let admin;
let userIds = [];
let courseIds = [];

before(async () => {
  const migrationNames = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => name.slice(0, -4))
    .sort();
  const migrated = await pool.query("select name from pgmigrations order by name");
  assert.deepEqual(migrated.rows.map((row) => row.name).sort(), migrationNames);

  passwordHash = await hashPassword(password);
  await app.register(cookie);
  await app.register(authRoutes);
  await app.register(adminUserRoutes);
  await app.register(meRoutes);
  await app.ready();
});

beforeEach(async () => {
  userIds = [randomUUID(), randomUUID()];
  courseIds = [];
  const result = await pool.query(
    `insert into users (id, full_name, email, role, password_hash)
     values ($1, 'CI Employee', $2, 'employee', $5),
            ($3, 'CI Admin', $4, 'admin', $5)
     returning *`,
    [userIds[0], `${userIds[0]}@example.test`, userIds[1], `${userIds[1]}@example.test`, passwordHash]
  );
  employee = result.rows.find((row) => row.role === "employee");
  admin = result.rows.find((row) => row.role === "admin");
});

afterEach(async () => {
  // Delete only this test's UUID fixtures. No TRUNCATE or schema reset.
  await pool.query("delete from courses where id = any($1::uuid[])", [courseIds]);
  await pool.query("delete from invitations where user_id = any($1::uuid[]) or created_by = any($1::uuid[])", [userIds]);
  await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
});

after(async () => {
  try {
    await app.close();
  } finally {
    await pool.end();
  }
});

async function sessionCookies(user = employee) {
  const session = await createSession(user.id);
  return { [SESSION_COOKIE]: session.token };
}

function login(payload = { email: employee.email, password }) {
  return app.inject({ method: "POST", url: "/auth/login", payload });
}

async function invite() {
  return createInvitation(employee.id, admin.id);
}

function accept(token, suppliedPassword = password) {
  return app.inject({
    method: "POST",
    url: `/auth/invitations/${token}/accept`,
    payload: { password: suppliedPassword }
  });
}

test("protected employee and admin APIs reject anonymous requests", async () => {
  for (const url of ["/auth/me", "/me/courses", "/admin/users"]) {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "not_authenticated" });
  }
});

test("an unknown session token does not authenticate", async () => {
  const response = await app.inject({ url: "/auth/me", cookies: { [SESSION_COOKIE]: "unknown-token" } });
  assert.equal(response.statusCode, 401);
});

test("login sets a private cookie and returns no password hash", async () => {
  const response = await login();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.json().user).sort(), ["email", "fullName", "id", "role", "timezone"]);
  const session = response.cookies.find((value) => value.name === SESSION_COOKIE);
  assert.ok(session?.httpOnly);
  assert.equal(session.sameSite, "Lax");
  assert.equal(session.path, "/");
  const stored = await pool.query("select token_hash from sessions where user_id = $1", [employee.id]);
  assert.equal(stored.rows[0].token_hash, hashToken(session.value));
  assert.notEqual(stored.rows[0].token_hash, session.value);
  const me = await app.inject({ url: "/auth/me", cookies: { [SESSION_COOKIE]: session.value } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.id, employee.id);
});

test("production login cookie has Secure (SEC-02)", async (context) => {
  const previous = process.env.NODE_ENV;
  context.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  process.env.NODE_ENV = "production";
  const response = await login();
  assert.equal(response.statusCode, 200);
  assert.equal(response.cookies.find((value) => value.name === SESSION_COOKIE)?.secure, true);
});

test("development login cookie permits local HTTP", async (context) => {
  const previous = process.env.NODE_ENV;
  context.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  process.env.NODE_ENV = "development";
  const response = await login();
  assert.equal(response.statusCode, 200);
  assert.ok(!response.cookies.find((value) => value.name === SESSION_COOKIE)?.secure);
});

test("wrong password and unknown email are rejected without creating sessions", async () => {
  for (const payload of [
    { email: employee.email, password: "wrong-password" },
    { email: "missing@example.test", password }
  ]) {
    const response = await login(payload);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "invalid_credentials" });
    assert.equal(response.cookies.length, 0);
  }
  const sessions = await pool.query("select id from sessions where user_id = $1", [employee.id]);
  assert.equal(sessions.rowCount, 0);
});

test("an employee can use employee APIs but cannot use admin APIs", async () => {
  const cookies = await sessionCookies();
  assert.equal((await app.inject({ url: "/me/courses", cookies })).statusCode, 200);
  const response = await app.inject({ url: "/admin/users", cookies });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: "admin_only" });
});

test("an admin can access the actual admin users route", async () => {
  const response = await app.inject({ url: "/admin/users", cookies: await sessionCookies(admin) });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().users.some((user) => user.id === employee.id));
});

test("deactivation through the admin API blocks an existing employee session (SEC-01)", async () => {
  const cookies = await sessionCookies();
  assert.equal((await app.inject({ url: "/me/courses", cookies })).statusCode, 200);
  const disabled = await app.inject({
    method: "PATCH",
    url: `/admin/users/${employee.id}`,
    cookies: await sessionCookies(admin),
    payload: { isActive: false }
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().user.is_active, false);
  for (const url of ["/auth/me", "/me/courses", "/admin/users"]) {
    assert.equal((await app.inject({ url, cookies })).statusCode, 401);
  }
  assert.equal((await login()).statusCode, 401);
});

test("expired sessions cannot access protected APIs", async () => {
  const cookies = await sessionCookies();
  await pool.query("update sessions set expires_at = now() - interval '1 minute' where user_id = $1", [employee.id]);
  assert.equal((await app.inject({ url: "/auth/me", cookies })).statusCode, 401);
});

test("logout deletes the session and clears the browser cookie", async () => {
  const cookies = await sessionCookies();
  const response = await app.inject({ method: "POST", url: "/auth/logout", cookies });
  assert.equal(response.statusCode, 200);
  assert.equal(response.cookies.find((value) => value.name === SESSION_COOKIE)?.value, "");
  assert.equal((await app.inject({ url: "/auth/me", cookies })).statusCode, 401);
  const sessions = await pool.query("select id from sessions where user_id = $1", [employee.id]);
  assert.equal(sessions.rowCount, 0);
});

test("an invitation can be accepted once and creates a usable session", async () => {
  const { token } = await invite();
  const stored = await pool.query("select token_hash from invitations where user_id = $1", [employee.id]);
  assert.equal(stored.rows[0].token_hash, hashToken(token));
  const status = await app.inject({ url: `/auth/invitations/${token}` });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().valid, true);
  const response = await accept(token);
  assert.equal(response.statusCode, 200);
  const session = response.cookies.find((value) => value.name === SESSION_COOKIE);
  assert.ok(session?.value);
  assert.equal((await app.inject({ url: "/auth/me", cookies: { [SESSION_COOKIE]: session.value } })).statusCode, 200);
  const repeated = await accept(token);
  assert.equal(repeated.statusCode, 400);
  assert.deepEqual(repeated.json(), { error: "invitation_used" });
  assert.equal((await pool.query("select id from sessions where user_id = $1", [employee.id])).rowCount, 1);
});

test("a revoked invitation cannot be accepted", async () => {
  const { token } = await invite();
  const stored = await pool.query("select id from invitations where user_id = $1", [employee.id]);
  await revokeInvitation(stored.rows[0].id);
  const response = await accept(token);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "invitation_revoked" });
  assert.equal((await pool.query("select id from sessions where user_id = $1", [employee.id])).rowCount, 0);
});

test("an expired invitation cannot be accepted", async () => {
  const { token } = await invite();
  await pool.query("update invitations set expires_at = now() - interval '1 minute' where user_id = $1", [employee.id]);
  const response = await accept(token);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "invitation_expired" });
  assert.equal((await pool.query("select id from sessions where user_id = $1", [employee.id])).rowCount, 0);
});

test("a short password does not consume an invitation", async () => {
  const { token } = await invite();
  const response = await accept(token, "short");
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "password_too_short" });
  assert.equal((await pool.query("select id from sessions where user_id = $1", [employee.id])).rowCount, 0);
  assert.equal((await accept(token)).statusCode, 200);
});

test("an employee cannot view another employee's assigned course", async () => {
  const courseId = randomUUID();
  courseIds.push(courseId);
  await pool.query("insert into courses (id, title, status) values ($1, 'CI Private Course', 'published')", [courseId]);
  await pool.query("insert into assignments (user_id, course_id) values ($1, $2)", [admin.id, courseId]);
  const cookies = await sessionCookies();
  const response = await app.inject({ url: `/me/courses/${courseId}`, cookies });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: "not_assigned" });
  const courses = await app.inject({ url: "/me/courses", cookies });
  assert.equal(courses.statusCode, 200);
  assert.ok(!courses.json().assigned.some((course) => course.course_id === courseId));
});
