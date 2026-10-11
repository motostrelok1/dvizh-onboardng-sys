import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const { hashPassword } = await import("../src/auth/crypto.ts");
const { createInvitation } = await import("../src/auth/service.ts");
const { authRoutes } = await import("../src/routes/auth.ts");
const { authRateLimitKey, AUTH_IP_MAX, AUTH_ACCOUNT_MAX, INVITATION_LOOKUP_IP_MAX,
  pruneExpiredAuthLimits } = await import("../src/auth/rate-limit.ts");
const password = "CI-test-password";
const logs = [];
const stream = new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done(); } });
const apps = [Fastify({ logger: { stream }, disableRequestLogging: true }), Fastify()];
let passwordHash, userId, email, sequence = 0, keys;

before(async () => {
  passwordHash = await hashPassword(password);
  for (const app of apps) { await app.register(cookie); await app.register(authRoutes); await app.ready(); }
});
beforeEach(async () => {
  sequence++;
  keys = new Set();
  logs.length = 0;
  userId = randomUUID();
  email = `${userId}@example.test`;
  await pool.query("insert into users (id, full_name, email, role, password_hash) values ($1, 'CI Rate Limit', $2, 'employee', $3)",
    [userId, email, passwordHash]);
});
afterEach(async () => {
  await pool.query("delete from invitations where user_id = $1", [userId]);
  await pool.query("delete from users where id = $1", [userId]);
  await pool.query("delete from auth_rate_limits where bucket_key = any($1::text[])", [[...keys]]);
});
after(async () => { try { for (const app of apps) await app.close(); } finally { await pool.end(); } });

const ip = (index = 1) => `198.18.${sequence}.${index}`;
function remember(scope, subject) {
  const key = authRateLimitKey(scope, subject);
  keys.add(key);
  return key;
}
function login({ suppliedEmail = email, suppliedPassword = "wrong-password", remote = ip(), app = apps[0], headers = {} } = {}) {
  remember("action_ip", remote);
  if (typeof suppliedEmail === "string" && suppliedEmail.length <= 254) remember("login_account", suppliedEmail);
  return app.inject({ method: "POST", url: "/auth/login", remoteAddress: remote, headers,
    payload: { email: suppliedEmail, password: suppliedPassword } });
}
async function invitation() {
  const result = await createInvitation(userId, null);
  remember("invitation_token", result.token);
  remember("invitation_account", userId);
  return result.token;
}
function accept(token, suppliedPassword = "short", remote = ip(), app = apps[0]) {
  remember("action_ip", remote);
  remember("invitation_token", token);
  return app.inject({ method: "POST", url: `/auth/invitations/${token}/accept`, remoteAddress: remote,
    payload: { password: suppliedPassword } });
}
function assertLimited(response) {
  assert.equal(response.statusCode, 429, response.body);
  assert.equal(response.json().error, "rate_limited");
  assert.ok(response.json().retryAfterSeconds > 0 && response.json().retryAfterSeconds <= 600);
  assert.equal(response.headers["retry-after"], String(response.json().retryAfterSeconds));
  assert.equal(response.cookies.length, 0);
}
async function stored(scope, subject) {
  return (await pool.query("select * from auth_rate_limits where bucket_key = $1", [remember(scope, subject)])).rows[0];
}

test("account limits survive IP rotation, email case/whitespace and block even the correct password", async () => {
  for (let i = 0; i < AUTH_ACCOUNT_MAX; i++) {
    const response = await login({ suppliedEmail: i % 2 ? ` ${email.toUpperCase()} ` : email, remote: ip(i + 1) });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "invalid_credentials" });
  }
  assertLimited(await login({ suppliedPassword: password, remote: ip(20) }));
  assert.equal((await pool.query("select id from sessions where user_id = $1", [userId])).rowCount, 0);
  assert.equal((await pool.query("select is_active from users where id = $1", [userId])).rows[0].is_active, true);
});

test("IP limits run before body parsing and cannot be bypassed with direct forwarded headers", async () => {
  for (let i = 0; i < AUTH_IP_MAX; i++) {
    const response = await login({ suppliedEmail: 42, headers: { "x-forwarded-for": `203.0.113.${i + 1}` } });
    assert.equal(response.statusCode, 400);
  }
  assertLimited(await login({ suppliedEmail: `${randomUUID()}@example.test`, headers: { "x-forwarded-for": "203.0.113.251" } }));
  const invalidJson = await apps[0].inject({ method: "POST", url: "/auth/login", remoteAddress: ip(),
    headers: { "content-type": "application/json" }, payload: "not-json" });
  assertLimited(invalidJson);
  assert.equal((await login({ remote: ip(2) })).statusCode, 401);
});

test("concurrent requests and independent app instances share one atomic account budget", async () => {
  const missing = `${randomUUID()}@example.test`;
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => login({
    suppliedEmail: missing, remote: ip(i + 1), app: apps[i % 2]
  })));
  assert.equal(responses.filter(r => r.statusCode === 401).length, AUTH_ACCOUNT_MAX);
  assert.equal(responses.filter(r => r.statusCode === 429).length, 20 - AUTH_ACCOUNT_MAX);
  assert.equal((await stored("login_account", missing)).attempts, AUTH_ACCOUNT_MAX + 2);
  const freshApp = Fastify();
  try {
    await freshApp.register(cookie); await freshApp.register(authRoutes);
    assertLimited(await login({ suppliedEmail: missing, app: freshApp, remote: ip(30) }));
  } finally { await freshApp.close(); }
});

test("denied requests do not extend the window and an expired budget allows normal login", async () => {
  for (let i = 0; i < AUTH_ACCOUNT_MAX; i++) assert.equal((await login()).statusCode, 401);
  const original = await stored("login_account", email);
  for (let i = 0; i < 3; i++) assertLimited(await login());
  const denied = await stored("login_account", email);
  assert.equal(denied.expires_at.getTime(), original.expires_at.getTime());
  await pool.query("update auth_rate_limits set expires_at = now() - interval '1 second' where bucket_key = $1", [original.bucket_key]);
  const response = await login({ suppliedPassword: password, app: apps[1] });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.id, userId);
  assert.ok(response.cookies.length > 0);
  assert.equal((await stored("login_account", email)).attempts, 1);
});

test("successful login below the threshold and authenticated APIs continue working", async () => {
  assert.equal((await login()).statusCode, 401);
  const response = await login({ suppliedPassword: password });
  assert.equal(response.statusCode, 200);
  const session = response.cookies[0];
  const me = await apps[0].inject({ url: "/auth/me", cookies: { [session.name]: session.value }, remoteAddress: ip() });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.id, userId);
});

test("invitation attempts have a token budget without consuming the invitation on rejection", async () => {
  const token = await invitation();
  for (let i = 0; i < AUTH_ACCOUNT_MAX; i++) {
    const response = await accept(token, "short", ip(i + 1));
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "password_too_short");
  }
  assertLimited(await accept(token, password, ip(20)));
  assert.equal((await pool.query("select used_at from invitations where user_id = $1", [userId])).rows[0].used_at, null);
  assert.equal((await pool.query("select password_hash from users where id = $1", [userId])).rows[0].password_hash, passwordHash);
});

test("changing valid invitation links and IPs does not reset the invited user's budget", async () => {
  for (let i = 0; i < AUTH_ACCOUNT_MAX; i++) assert.equal((await accept(await invitation(), "short", ip(i + 1))).statusCode, 400);
  assertLimited(await accept(await invitation(), password, ip(20), apps[1]));
  assert.equal((await pool.query("select id from invitations where user_id = $1 and used_at is not null", [userId])).rowCount, 0);
  assert.equal((await pool.query("select id from sessions where user_id = $1", [userId])).rowCount, 0);
});

test("public invitation lookups are IP-limited separately from acceptance", async () => {
  const token = await invitation();
  remember("invitation_lookup_ip", ip());
  const request = () => apps[0].inject({ url: `/auth/invitations/${token}`, remoteAddress: ip() });
  for (let i = 0; i < INVITATION_LOOKUP_IP_MAX; i++) assert.equal((await request()).statusCode, 200);
  assertLimited(await request());
  assert.equal((await accept(token, password)).statusCode, 200);
});

test("wrong input types, oversized email/password/body and malformed tokens create no session", async () => {
  for (const body of [null, [], "body", { email: 42, password }, { email: {}, password },
    { email: "", password }, { email: "a".repeat(255), password },
    ...[42, [], {}, "p".repeat(1025)].map(value => ({ email: `${randomUUID()}@example.test`, password: value }))]) {
    if (typeof body?.email === "string" && body.email.length <= 254) remember("login_account", body.email);
    remember("action_ip", ip());
    const response = await apps[0].inject({ method: "POST", url: "/auth/login", remoteAddress: ip(),
      headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await login({ suppliedPassword: "x".repeat(9000) })).statusCode, 413);
  const token = await invitation();
  assert.equal((await accept(token, {})).statusCode, 400);
  assert.equal((await accept("%21bad-token%21", password)).statusCode, 400);
  assert.equal((await pool.query("select id from sessions where user_id = $1", [userId])).rowCount, 0);
});

test("new passwords respect bcrypt's byte limit while bounded long legacy passwords still log in", async () => {
  const token = await invitation();
  for (const long of ["x".repeat(73), "Ж".repeat(37)]) {
    const response = await accept(token, long);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "password_too_long");
  }
  assert.equal((await accept(token, "Ж".repeat(36))).statusCode, 200);
  const legacy = "a".repeat(80);
  await pool.query("update users set password_hash = $1 where id = $2", [await hashPassword(legacy), userId]);
  assert.equal((await login({ suppliedPassword: legacy })).statusCode, 200);
});

test("rate-limit storage failure blocks authentication and warnings omit private subjects", async () => {
  const original = pool.query;
  try {
    pool.query = function (...args) {
      if (String(args[0]).includes("auth_rate_limits")) throw new Error("CI rate-limit store unavailable");
      return original.apply(this, args);
    };
    assert.equal((await login({ suppliedPassword: password })).statusCode, 500);
  } finally { pool.query = original; }
  assert.equal((await pool.query("select id from sessions where user_id = $1", [userId])).rowCount, 0);
  logs.length = 0;
  for (let i = 0; i < AUTH_ACCOUNT_MAX + 3; i++) await login();
  const warnings = logs.flatMap(line => line.trim().split("\n")).map(line => JSON.parse(line))
    .filter(row => row.event === "auth_rate_limited");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].scope, "login_account");
  assert.ok(!JSON.stringify(warnings).includes(email));
  assert.ok(!JSON.stringify(warnings).includes(password));
  assert.ok(!JSON.stringify(warnings).includes(ip()));
});

test("expired counter cleanup preserves active budgets and fixture cleanup uses only owned keys", async () => {
  const expiredKey = remember("login_account", `${randomUUID()}@example.test`);
  await pool.query("insert into auth_rate_limits (bucket_key, attempts, expires_at) values ($1, 12, now() - interval '1 hour')", [expiredKey]);
  await login();
  const active = await stored("login_account", email);
  await pruneExpiredAuthLimits();
  assert.equal((await pool.query("select * from auth_rate_limits where bucket_key = $1", [expiredKey])).rowCount, 0);
  assert.deepEqual(await stored("login_account", email), active);
});
