import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";

await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const { createSession, getUserBySession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { healthRoutes } = await import("../src/routes/health.ts");

const logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installPrivacyHeaders(app);
const userIds = [randomUUID(), randomUUID()];
let employeeCookies, adminCookies;

before(async () => {
  await app.register(cookie);
  await app.register(healthRoutes);
  await app.ready();
  await pool.query(`insert into users (id, full_name, role) values
    ($1, 'CI Health Employee', 'employee'), ($2, 'CI Health Admin', 'admin')`, userIds);
  const employeeSession = await createSession(userIds[0]);
  const adminSession = await createSession(userIds[1]);
  assert.equal((await getUserBySession(employeeSession.token)).role, "employee");
  assert.equal((await getUserBySession(adminSession.token)).role, "admin");
  employeeCookies = { [SESSION_COOKIE]: employeeSession.token };
  adminCookies = { [SESSION_COOKIE]: adminSession.token };
});

after(async () => {
  try { await app.close(); await pool.query("delete from users where id = any($1::uuid[])", [userIds]); }
  finally { await pool.end(); }
});

function privateResponse(response) {
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
}

// Fault injection is local to this isolated test-file process. Restore even
// on assertion failure; no shared DB changes, network outage or schema mocks.
async function withoutDatabase(work) {
  const original = pool.query;
  let queries = 0;
  pool.query = async () => { queries++; throw new Error("HEALTH-DB-SECRET: password=secret host=internal schema=users"); };
  try { return await work(() => queries); }
  finally { pool.query = original; }
}

test("public liveness stays minimal and works without querying the database", async () => {
  await withoutDatabase(async queries => {
    const response = await app.inject({ url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
    privateResponse(response);
    const head = await app.inject({ method: "HEAD", url: "/health" });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    assert.equal(queries(), 0);
  });
});

test("public database readiness uses real PostgreSQL and exposes only the status", async () => {
  const response = await app.inject({ url: "/health/db" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { db: "ok" });
  privateResponse(response);
});

test("database failure returns a minimal error without credentials in response or logs", async () => {
  logs.length = 0;
  await withoutDatabase(async queries => {
    const response = await app.inject({ url: "/health/db" });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { db: "fail" });
    privateResponse(response);
    assert.equal(queries(), 1);
    assert.ok(!logs.join("").includes("HEALTH-DB-SECRET"));
    assert.ok(!logs.join("").includes("host=internal"));
  });
});

test("retired table listing returns 404 for all roles and environments without a DB query", async () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const environment of ["production", "development", "test"]) {
      process.env.NODE_ENV = environment;
      const probe = Fastify();
      installPrivacyHeaders(probe);
      try {
        await probe.register(cookie);
        await probe.register(healthRoutes);
        await probe.ready();
        await withoutDatabase(async queries => {
          for (const cookies of [{}, employeeCookies, adminCookies, { [SESSION_COOKIE]: "unknown-token" }]) {
            for (const method of ["GET", "HEAD"]) {
              const response = await probe.inject({ method, url: "/health/tables", cookies });
              assert.equal(response.statusCode, 404);
              privateResponse(response);
              // Fastify inject can expose the default 404 body for HEAD.
              // Check any returned payload; do not require an empty body.
              if (method === "GET" || response.body) {
                assert.equal(response.json().statusCode, 404);
                assert.equal(response.json().error, "Not Found");
                assert.equal(response.json().tables, undefined);
              }
            }
          }
          assert.equal(queries(), 0);
        });
      } finally { await probe.close(); }
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
