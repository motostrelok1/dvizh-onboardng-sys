import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { installPrivacyHeaders } from "../src/privacy.ts";

await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const { randomToken, hashToken, hashPassword, verifyPassword } = await import("../src/auth/crypto.ts");
const { createInvitation, createSession } = await import("../src/auth/service.ts");
const { authRateLimitKey } = await import("../src/auth/rate-limit.ts");
const { authRoutes } = await import("../src/routes/auth.ts");
const { adminUserRoutes } = await import("../src/routes/admin-users.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const apps = [Fastify(), Fastify()];
const oldPassword = "CI-old-password";
const newPassword = "CI-new-password";
let passwordHash, ids, userId, otherId, adminId, email, adminCookies, keys, sequence = 0;

before(async () => {
  passwordHash = await hashPassword(oldPassword);
  for (const app of apps) {
    installPrivacyHeaders(app);
    await app.register(cookie);
    await app.register(authRoutes);
    await app.register(adminUserRoutes);
    await app.ready();
  }
});
beforeEach(async () => {
  sequence++;
  keys = new Set();
  ids = [randomUUID(), randomUUID(), randomUUID()];
  [userId, otherId, adminId] = ids;
  email = `${userId}@example.test`;
  for (const id of ids) {
    await pool.query(`insert into users (id, full_name, email, role, password_hash)
      values ($1, 'CI Recovery', $2, $3, $4)`,
      [id, `${id}@example.test`, id === adminId ? "admin" : "employee", passwordHash]);
    remember("invitation_account", id);
    remember("login_account", `${id}@example.test`);
  }
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
});
afterEach(async () => {
  await pool.query("delete from invitations where user_id = any($1::uuid[]) or created_by = any($1::uuid[])", [ids]);
  await pool.query("delete from users where id = any($1::uuid[])", [ids]);
  await pool.query("delete from auth_rate_limits where bucket_key = any($1::text[])", [[...keys]]);
});
after(async () => { try { for (const app of apps) await app.close(); } finally { await pool.end(); } });

function remember(scope, subject) { keys.add(authRateLimitKey(scope, subject)); }
function request(options, app = apps[0], index = 1) {
  const remoteAddress = `198.21.${sequence}.${index}`;
  remember("action_ip", remoteAddress);
  remember("invitation_lookup_ip", remoteAddress);
  return app.inject({ ...options, remoteAddress });
}
function accept(token, password = newPassword, app = apps[0], index = 1) {
  remember("invitation_token", token);
  return request({ method: "POST", url: "/auth/invitations/accept", payload: { token, password } }, app, index);
}
function check(token) { return request({ method: "POST", url: "/auth/invitations/check", payload: { token } }); }
function issue(id = userId, app = apps[0]) {
  return request({ method: "POST", url: `/admin/users/${id}/invitations`, cookies: adminCookies }, app);
}
function setActive(isActive) {
  return request({ method: "PATCH", url: `/admin/users/${userId}`, cookies: adminCookies, payload: { isActive } });
}
function login(password = oldPassword, app = apps[0]) {
  return request({ method: "POST", url: "/auth/login", payload: { email, password } }, app);
}
function me(token) { return request({ url: "/auth/me", cookies: { [SESSION_COOKIE]: token } }); }
function sessionToken(response) { return response.cookies.find(cookie => cookie.name === SESSION_COOKIE)?.value; }
async function user() { return (await pool.query("select * from users where id = $1", [userId])).rows[0]; }
async function sessions(id = userId) { return (await pool.query("select * from sessions where user_id = $1", [id])).rows; }
async function invitations() { return (await pool.query("select * from invitations where user_id = $1", [userId])).rows; }
async function events() { return (await pool.query("select * from events where user_id = $1", [userId])).rows; }
async function legacyInvite(id = userId) {
  const token = randomToken();
  // Simulate invitations issued by old code without schema migration or mass
  // changes to the database. Only this test's UUID fixtures are touched.
  await pool.query(`insert into invitations (user_id, token_hash, created_by, expires_at)
    values ($1, $2, $3, clock_timestamp() + interval '7 days')`, [id, hashToken(token), adminId]);
  return token;
}

async function eventually(predicate, message) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}
async function blockedBy(pid) {
  await eventually(async () => (await pool.query(
    "select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [pid])).rowCount > 0,
    "second operation never waited for the first operation's PostgreSQL lock");
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Observe/gate or fail a real query on a real transaction client, only inside
// this test process. Pool.query's callback-based connection path is unchanged.
// No schema triggers, mock database, global fixtures or arbitrary sleeps.
async function withQueries(intercept, work) {
  const original = pool.connect;
  pool.connect = function (...args) {
    const connected = original.apply(this, args);
    if (typeof args[0] === "function") return connected;
    return connected.then(client => new Proxy(client, {
      get(target, property) {
        if (property === "query") return async (...queryArgs) => {
          await intercept(String(queryArgs[0]), queryArgs[1], client);
          return client.query(...queryArgs);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }));
  };
  try { return await work(); } finally { pool.connect = original; }
}
async function orderedRace(queryMatches, firstOperation, secondOperation) {
  const reached = deferred(), release = deferred();
  let paused = false, first, second;
  return withQueries(async (sql, params, client) => {
    if (paused || !queryMatches(sql, params)) return;
    paused = true;
    reached.resolve((await client.query("select pg_backend_pid() as pid")).rows[0].pid);
    await release.promise;
  }, async () => {
    try {
      first = Promise.resolve(firstOperation());
      let pid;
      await eventually(async () => {
        if (!paused) return false;
        pid = await reached.promise;
        return true;
      }, "first operation did not reach the gate");
      second = Promise.resolve(secondOperation());
      await blockedBy(pid);
      release.resolve();
      return await Promise.all([first, second]);
    } finally {
      release.resolve();
      await Promise.allSettled([first, second].filter(Boolean));
    }
  });
}

test("new invitation revokes older links while keeping existing access until password reset", async () => {
  const oldSession = (await createSession(userId)).token;
  const otherSession = (await createSession(otherId)).token;
  const otherLink = await legacyInvite(otherId);
  const first = await issue();
  const second = await issue();
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal((await check(first.json().token)).json().reason, "revoked");
  assert.equal((await check(second.json().token)).statusCode, 200);
  assert.equal((await me(oldSession)).statusCode, 200);
  assert.equal((await me(otherSession)).statusCode, 200);
  assert.equal((await check(otherLink)).statusCode, 200);
  assert.equal((await user()).password_hash, passwordHash);
  const rejected = await accept(first.json().token);
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, "invitation_revoked");
});

test("first invitation onboards an active employee without a pre-existing password", async () => {
  await pool.query("update users set password_hash = null where id = $1", [userId]);
  assert.equal((await login()).statusCode, 401);
  const token = (await issue()).json().token;
  assert.equal((await check(token)).statusCode, 200);
  const response = await accept(token);
  assert.equal(response.statusCode, 200);
  const current = await me(sessionToken(response));
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().user.role, "employee");
  assert.equal((await login(newPassword)).statusCode, 200);
});

test("accepting a legacy link revokes every other link/session and preserves other users", async () => {
  const links = await Promise.all([legacyInvite(), legacyInvite(), legacyInvite()]);
  const oldSessions = [(await createSession(userId)).token, (await createSession(userId)).token];
  const otherSession = (await createSession(otherId)).token;
  const response = await accept(links[1]);
  assert.equal(response.statusCode, 200);
  assert.equal((await sessions()).length, 1);
  assert.equal((await sessions())[0].token_hash, hashToken(sessionToken(response)));
  for (const token of oldSessions) assert.equal((await me(token)).statusCode, 401);
  assert.equal((await me(sessionToken(response))).statusCode, 200);
  assert.equal((await me(otherSession)).statusCode, 200);
  for (const token of [links[0], links[2]]) assert.equal((await check(token)).json().reason, "revoked");
  assert.equal((await login()).statusCode, 401);
  assert.equal((await login(newPassword)).statusCode, 200);
  assert.equal((await user()).is_active, true);
});

test("disabled users cannot inspect/accept even an unrevoked legacy link or obtain a new one", async () => {
  const token = await legacyInvite();
  await pool.query("update users set is_active = false where id = $1", [userId]);
  const status = await check(token);
  assert.equal(status.statusCode, 404);
  assert.equal(status.json().reason, "inactive");
  const response = await accept(token);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invitation_inactive");
  const invitation = await issue();
  assert.equal(invitation.statusCode, 409);
  assert.equal(invitation.json().error, "user_inactive");
  assert.equal((await user()).is_active, false);
  assert.equal((await user()).password_hash, passwordHash);
  assert.equal((await invitations())[0].used_at, null);
  assert.equal((await sessions()).length, 0);
});

test("admin deactivation revokes sessions/links permanently across explicit reactivation", async () => {
  const oldSession = (await createSession(userId)).token;
  const token = (await issue()).json().token;
  assert.equal((await setActive(false)).statusCode, 200);
  assert.equal((await sessions()).length, 0);
  assert.equal((await check(token)).json().reason, "revoked");
  assert.equal((await issue()).statusCode, 409);
  assert.equal((await setActive(true)).statusCode, 200);
  assert.equal((await me(oldSession)).statusCode, 401);
  assert.equal((await accept(token)).json().error, "invitation_revoked");
  assert.equal((await accept((await issue()).json().token)).statusCode, 200);
});

test("issuing an invitation for an absent user returns controlled 404", async () => {
  const response = await issue(randomUUID());
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "user_not_found");
});

test("failed invitation insert rolls back revocation of the previous link", async () => {
  const token = await legacyInvite();
  await assert.rejects(createInvitation(userId, randomUUID()), error => error.code === "23503");
  assert.equal((await check(token)).statusCode, 200);
  assert.equal((await invitations()).length, 1);
});

test("failure recording reset event rolls back password, links and session replacement", async () => {
  const links = [await legacyInvite(), await legacyInvite()];
  const oldSession = (await createSession(userId)).token;
  const response = await withQueries(async sql => {
    if (/insert into events/i.test(sql)) throw new Error("CI transactional event failure");
  }, () => accept(links[0]));
  assert.equal(response.statusCode, 500);
  assert.equal(response.cookies.length, 0);
  assert.equal((await user()).password_hash, passwordHash);
  assert.equal((await me(oldSession)).statusCode, 200);
  assert.equal((await sessions()).length, 1);
  for (const link of links) assert.equal((await check(link)).statusCode, 200);
  assert.equal((await events()).length, 0);
});

test("failed deactivation cleanup rolls back user state and deleted sessions", async () => {
  const token = await legacyInvite();
  const oldSession = (await createSession(userId)).token;
  const response = await withQueries(async sql => {
    if (/update invitations set revoked_at/i.test(sql)) throw new Error("CI cleanup failure");
  }, () => setActive(false));
  assert.equal(response.statusCode, 500);
  assert.equal((await user()).is_active, true);
  assert.equal((await me(oldSession)).statusCode, 200);
  assert.equal((await check(token)).statusCode, 200);
});

test("concurrent issuance on independent app instances leaves exactly one usable link", async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => issue(userId, apps[index % 2])));
  assert.ok(responses.every(response => response.statusCode === 200));
  const statuses = await Promise.all(responses.map(response => check(response.json().token)));
  assert.equal(statuses.filter(response => response.statusCode === 200).length, 1);
  assert.equal(statuses.filter(response => response.json().reason === "revoked").length, 5);
  assert.equal((await invitations()).filter(inv => !inv.revoked_at && !inv.used_at).length, 1);
});

test("two admins issuing recovery links to each other do not deadlock on created_by foreign keys", async () => {
  await pool.query("update users set role = 'admin' where id = $1", [otherId]);
  const otherAdmin = { [SESSION_COOKIE]: (await createSession(otherId)).token };
  const release = deferred();
  let arrived = 0;
  const responses = await withQueries(async sql => {
    if (/insert into invitations/i.test(sql)) { arrived++; await release.promise; }
  }, async () => {
    const pending = [
      Promise.resolve(issue(otherId)),
      Promise.resolve(request({ method: "POST", url: `/admin/users/${adminId}/invitations`, cookies: otherAdmin }, apps[1]))
    ];
    try {
      await eventually(async () => arrived === 2, "both admins did not reach their locked user rows");
      release.resolve();
      return await Promise.all(pending);
    } finally {
      release.resolve();
      await Promise.allSettled(pending);
    }
  });
  assert.ok(responses.every(response => response.statusCode === 200));
  for (const response of responses) assert.equal((await check(response.json().token)).statusCode, 200);
});

test("two concurrent legacy links yield one password, one session and one reset event", async () => {
  const tokens = [await legacyInvite(), await legacyInvite()];
  const passwords = ["CI-winner-password-1", "CI-winner-password-2"];
  const responses = await Promise.all(tokens.map((token, index) => accept(token, passwords[index], apps[index], index + 1)));
  const winner = responses.findIndex(response => response.statusCode === 200);
  assert.ok(winner >= 0);
  assert.equal(responses[1 - winner].statusCode, 400);
  assert.equal(responses[1 - winner].json().error, "invitation_revoked");
  assert.equal((await sessions()).length, 1);
  assert.equal((await events()).length, 1);
  assert.ok(await verifyPassword(passwords[winner], (await user()).password_hash));
  assert.ok(!await verifyPassword(passwords[1 - winner], (await user()).password_hash));
  assert.equal((await invitations()).filter(inv => inv.used_at).length, 1);
  assert.equal((await invitations()).filter(inv => inv.revoked_at).length, 1);
});

test("parallel acceptance of the same token creates only one session/event", async () => {
  const token = await legacyInvite();
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => accept(token, newPassword, apps[index % 2], index + 1)));
  assert.equal(responses.filter(response => response.statusCode === 200).length, 1);
  assert.equal(responses.filter(response => response.json().error === "invitation_used").length, 5);
  assert.equal((await sessions()).length, 1);
  assert.equal((await events()).length, 1);
});

test("login verified before reset cannot leave an old-password session afterward", async () => {
  const token = await legacyInvite();
  const [loggedIn, reset] = await orderedRace(sql => /insert into sessions/i.test(sql),
    () => login(), () => accept(token, newPassword, apps[1]));
  assert.equal(loggedIn.statusCode, 200);
  assert.equal(reset.statusCode, 200);
  assert.equal((await me(sessionToken(loggedIn))).statusCode, 401);
  assert.equal((await me(sessionToken(reset))).statusCode, 200);
  assert.equal((await sessions()).length, 1);
});

test("login waiting behind reset verifies the new hash and rejects the old password", async () => {
  const token = await legacyInvite();
  const [reset, loggedIn] = await orderedRace(sql => /update invitations set used_at/i.test(sql),
    () => accept(token), () => login(oldPassword, apps[1]));
  assert.equal(reset.statusCode, 200);
  assert.equal(loggedIn.statusCode, 401);
  assert.equal(loggedIn.cookies.length, 0);
  assert.equal((await sessions()).length, 1);
});

test("replacement committed ahead of acceptance makes the old link unusable", async () => {
  const token = await legacyInvite();
  const [issued, reset] = await orderedRace(sql => /update invitations set revoked_at/i.test(sql),
    () => issue(), () => accept(token, newPassword, apps[1]));
  assert.equal(issued.statusCode, 200);
  assert.equal(reset.statusCode, 400);
  assert.equal(reset.json().error, "invitation_revoked");
  assert.equal((await user()).password_hash, passwordHash);
  assert.equal((await check(issued.json().token)).statusCode, 200);
});

test("issuance behind acceptance becomes the next recovery link without undoing reset", async () => {
  const token = await legacyInvite();
  const [reset, issued] = await orderedRace(sql => /update invitations set used_at/i.test(sql),
    () => accept(token), () => issue(userId, apps[1]));
  assert.equal(reset.statusCode, 200);
  assert.equal(issued.statusCode, 200);
  assert.equal((await me(sessionToken(reset))).statusCode, 200);
  assert.equal((await check(issued.json().token)).statusCode, 200);
  assert.equal((await check(token)).json().reason, "used");
  assert.ok(await verifyPassword(newPassword, (await user()).password_hash));
});

test("deactivation ahead of acceptance prevents a link from reactivating the account", async () => {
  const token = await legacyInvite();
  const [disabled, reset] = await orderedRace(sql => /delete from sessions/i.test(sql),
    () => setActive(false), () => accept(token, newPassword, apps[1]));
  assert.equal(disabled.statusCode, 200);
  assert.equal(reset.statusCode, 400);
  assert.equal((await user()).is_active, false);
  assert.equal((await user()).password_hash, passwordHash);
  assert.equal((await sessions()).length, 0);
});

test("deactivation behind acceptance deletes the new session and keeps the account disabled", async () => {
  const token = await legacyInvite();
  const [reset, disabled] = await orderedRace(sql => /update invitations set used_at/i.test(sql),
    () => accept(token), () => setActive(false));
  assert.equal(reset.statusCode, 200);
  assert.equal(disabled.statusCode, 200);
  assert.equal((await user()).is_active, false);
  assert.equal((await sessions()).length, 0);
  assert.equal((await me(sessionToken(reset))).statusCode, 401);
});

test("invitation expiring while waiting for the user lock is rejected after waiting", async () => {
  const token = await legacyInvite();
  await pool.query("update invitations set expires_at = clock_timestamp() + interval '1 second' where token_hash = $1", [hashToken(token)]);
  const blocker = await pool.connect();
  let pending;
  try {
    await blocker.query("begin");
    await blocker.query("select id from users where id = $1 for update", [userId]);
    const pid = (await blocker.query("select pg_backend_pid() as pid")).rows[0].pid;
    pending = Promise.resolve(accept(token));
    await blockedBy(pid);
    const timing = await pool.query(`select a.xact_start < i.expires_at as started_before_expiry
      from pg_stat_activity a cross join invitations i
      where $1 = any(pg_blocking_pids(a.pid)) and i.token_hash = $2`, [pid, hashToken(token)]);
    assert.ok(timing.rows[0]?.started_before_expiry);
    await eventually(async () => (await pool.query("select expires_at <= clock_timestamp() as expired from invitations where token_hash = $1", [hashToken(token)])).rows[0].expired,
      "test invitation did not expire");
    await blocker.query("commit");
    const response = await pending;
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invitation_expired");
    assert.equal((await user()).password_hash, passwordHash);
    assert.equal((await sessions()).length, 0);
  } finally {
    await blocker.query("rollback");
    blocker.release();
    if (pending) await pending;
  }
});

test("expiration after hashing is rechecked before consuming the invitation", async () => {
  const token = await legacyInvite();
  await pool.query("update invitations set expires_at = clock_timestamp() + interval '2 seconds' where token_hash = $1", [hashToken(token)]);
  let reachedAfterHash = false;
  const response = await withQueries(async sql => {
    if (/update invitations set used_at/i.test(sql)) {
      reachedAfterHash = true;
      await eventually(async () => (await pool.query("select expires_at <= clock_timestamp() as expired from invitations where token_hash = $1", [hashToken(token)])).rows[0].expired,
        "test invitation did not expire after hashing");
    }
  }, () => accept(token));
  assert.ok(reachedAfterHash);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invitation_expired");
  assert.equal((await user()).password_hash, passwordHash);
  assert.equal((await invitations())[0].used_at, null);
  assert.equal((await sessions()).length, 0);
});

test("explicit revocation serializes with acceptance on the same user lock", async () => {
  const token = await legacyInvite();
  const id = (await invitations())[0].id;
  const [revoked, reset] = await orderedRace(sql => /update invitations set revoked_at/i.test(sql),
    () => request({ method: "DELETE", url: `/admin/invitations/${id}`, cookies: adminCookies }),
    () => accept(token, newPassword, apps[1]));
  assert.equal(revoked.statusCode, 200);
  assert.equal(reset.statusCode, 400);
  assert.equal(reset.json().error, "invitation_revoked");
  assert.equal((await sessions()).length, 0);
});
