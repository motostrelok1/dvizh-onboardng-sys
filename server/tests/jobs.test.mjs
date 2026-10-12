import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import Fastify from "fastify";
import { createJobRunner, JobUnavailableError } from "../src/jobs/runner.ts";
import { startSerialScheduler } from "../src/jobs/scheduler.ts";
import { drainJobs } from "../src/jobs/shutdown.ts";
import { installApiErrors } from "../src/api-validation.ts";
import { getFlagsForUser } from "../src/analytics/rules.ts";
import { getCourseProgress } from "../src/progress.ts";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function fixture(queryOverride) {
  const calls = [], logs = [];
  const client = new EventEmitter();
  client.query = async (sql, params) => {
    calls.push({ sql, params });
    const override = await queryOverride?.(sql, params, client);
    return override ?? { rows: [{ locked: true, unlocked: true }] };
  };
  client.release = (discard) => calls.push({ release: discard });
  const runner = createJobRunner({ connect: async () => client }, (entry) => logs.push(entry));
  return { client, calls, logs, runner };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("job uses one session, commits before delivery and unlocks after delivery", async () => {
  const f = fixture();
  const result = await f.runner.run("notifications", async (client) => {
    assert.equal(client, f.client);
    await client.query("insert private work");
    return 7;
  }, async (result, client) => {
    assert.equal(result, 7);
    assert.equal(client, f.client);
    assert.equal(f.calls.at(-1).sql, "commit");
    f.calls.push({ sql: "external delivery" });
  });
  assert.equal(result, 7);
  assert.deepEqual(f.calls.map((c) => c.sql ?? c.release), [
    "select pg_try_advisory_lock($1, $2) as locked", "begin isolation level read committed",
    "insert private work", "commit", "external delivery", "select pg_advisory_unlock($1, $2) as unlocked", false
  ]);
  assert.equal(f.client.listenerCount("error"), 0);
});

test("busy lock does not begin, write, deliver or unlock another session's lock", async () => {
  const f = fixture((sql) => sql.includes("try_advisory") ? { rows: [{ locked: false }] } : undefined);
  await assert.rejects(f.runner.run("reports", () => assert.fail("work ran"), () => assert.fail("delivery ran")),
    { code: "job_in_progress" });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.at(-1).release, false);
  assert.equal(f.logs[0].status, "busy");
});

test("failed work rolls back, releases lock and never delivers or logs private error", async () => {
  const f = fixture();
  await assert.rejects(f.runner.run("deadlines", async () => { throw new Error("secret SQL /private token"); },
    () => assert.fail("delivery ran")), /secret/);
  assert.equal(f.calls[2].sql, "rollback");
  assert.equal(f.calls[3].sql, "select pg_advisory_unlock($1, $2) as unlocked");
  assert.doesNotMatch(JSON.stringify(f.logs), /secret|SQL|private|token/);
});

test("failed COMMIT is rolled back and never starts external delivery", async () => {
  const f = fixture((sql) => { if (sql === "commit") throw new Error("ack lost"); });
  await assert.rejects(f.runner.run("notifications", async () => 1, () => assert.fail("delivery ran")), /ack lost/);
  assert.ok(f.calls.some((c) => c.sql === "rollback"));
});

test("post-commit failure retains committed state and still releases the lock", async () => {
  const f = fixture();
  await assert.rejects(f.runner.run("notifications", async () => 1, async () => { throw new Error("delivery failed"); }));
  assert.ok(f.calls.some((c) => c.sql === "commit"));
  assert.ok(!f.calls.some((c) => c.sql === "rollback"));
  assert.equal(f.calls.at(-1).release, false);
});

for (const failure of ["acquire", "rollback", "unlock-error", "unlock-false"]) {
  test(`${failure} discards the session so a pooled connection cannot retain a lock`, async () => {
    const f = fixture((sql) => {
      if (failure === "acquire" && sql.includes("try_advisory")) throw new Error("acquire acknowledgement lost");
      if (failure === "rollback" && sql === "rollback") throw new Error("broken transaction");
      if (failure === "unlock-error" && sql.includes("pg_advisory_unlock")) throw new Error("unlock failed");
      if (failure === "unlock-false" && sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: false }] };
    });
    const task = f.runner.run("reports", async () => {
      if (failure === "rollback") throw new Error("work failed");
      return 1;
    });
    if (failure === "acquire" || failure === "rollback") await assert.rejects(task);
    else assert.equal(await task, 1);
    assert.equal(f.calls.at(-1).release, true);
  });
}

test("connection error during work is handled, skips delivery and discards session", async () => {
  const f = fixture();
  await assert.rejects(f.runner.run("notifications", async (client) => {
    client.emit("error", new Error("private connection URL"));
    return 1;
  }, () => assert.fail("delivery ran")), /job_connection_lost/);
  assert.equal(f.calls.at(-1).release, true);
  assert.doesNotMatch(JSON.stringify(f.logs), /private|URL/);
});

test("stop refuses new work and waits through post-commit delivery and unlock", async () => {
  const f = fixture(), delivering = deferred(), gate = deferred();
  const task = f.runner.run("notifications", async () => 1, async () => {
    delivering.resolve(); await gate.promise;
  });
  await delivering.promise;
  let stopped = false;
  const stop = f.runner.stop().then(() => { stopped = true; });
  await assert.rejects(f.runner.run("reports", () => assert.fail()), { code: "job_stopping" });
  await tick(); assert.equal(stopped, false);
  gate.resolve(); await task; await stop;
  assert.equal(f.calls.at(-1).release, false);
});

test("connection acquisition failure is logged without leaking details", async () => {
  const logs = [];
  const runner = createJobRunner({ connect: async () => { throw new Error("postgres://private-password"); } }, (e) => logs.push(e));
  await assert.rejects(runner.run("reports", () => assert.fail()));
  assert.equal(logs[0].status, "failed");
  assert.doesNotMatch(JSON.stringify(logs), /postgres|password/);
  await runner.stop();
});

test("broken logger cannot prevent transaction cleanup", async () => {
  const f = fixture();
  const runner = createJobRunner({ connect: async () => f.client }, () => { throw new Error("logger failure"); });
  assert.equal(await runner.run("reports", async () => 2), 2);
  assert.equal(f.calls.at(-1).release, false);
});

function fakeClock() {
  const callbacks = new Map(); let next = 0;
  return {
    callbacks,
    schedule(callback, delay) { callbacks.set(++next, { callback, delay }); return next; },
    cancel(timer) { callbacks.delete(timer); },
    fire() { const [id, timer] = callbacks.entries().next().value; callbacks.delete(id); timer.callback(); }
  };
}

test("serial scheduler schedules only after completion and stop drains an active run", async () => {
  const clock = fakeClock(), gate = deferred(); let runs = 0;
  const scheduler = startSerialScheduler(async () => { runs++; await gate.promise; }, 100, clock);
  await tick(); assert.equal(runs, 1); assert.equal(clock.callbacks.size, 0);
  gate.resolve(); await tick(); assert.equal(clock.callbacks.size, 1);
  assert.equal([...clock.callbacks.values()][0].delay, 100);
  clock.fire(); await tick(); assert.equal(runs, 2);
  await scheduler.stop(); assert.equal(clock.callbacks.size, 0);
});

test("failed and busy scheduler runs retry; logging failure cannot disable retry", async () => {
  const clock = fakeClock(); let runs = 0, failures = 0;
  const scheduler = startSerialScheduler(async () => {
    runs++;
    if (runs === 1) throw new Error("failure");
    if (runs === 2) throw new JobUnavailableError("job_in_progress");
  }, 10, clock, () => { failures++; throw new Error("logger broke"); });
  await tick(); clock.fire(); await tick(); clock.fire(); await tick();
  assert.equal(runs, 3); assert.equal(failures, 1);
  await scheduler.stop(); assert.equal(clock.callbacks.size, 0);
});

test("stop before the initial microtask prevents a scheduler run", async () => {
  const clock = fakeClock();
  const scheduler = startSerialScheduler(() => assert.fail("unexpected run"), 10, clock);
  await scheduler.stop(); assert.equal(clock.callbacks.size, 0);
});

test("stopping a scheduler waits for an unfinished run without scheduling another", async () => {
  const clock = fakeClock(), gate = deferred(); let stopped = false;
  const scheduler = startSerialScheduler(async () => { await gate.promise; }, 10, clock);
  await tick();
  const stopping = scheduler.stop().then(() => { stopped = true; });
  await tick(); assert.equal(stopped, false);
  gate.resolve(); await stopping;
  assert.equal(clock.callbacks.size, 0);
});

test("shutdown waits for timer work and runner work before closing database", async () => {
  const gate = deferred(), calls = [];
  const closing = drainJobs([{ stop: async () => { calls.push("timer-stop"); await gate.promise; } }],
    { stop: async () => { calls.push("runner-stop"); await gate.promise; } },
    { end: async () => { calls.push("db-end"); } });
  await tick(); assert.deepEqual(calls, ["runner-stop", "timer-stop"]);
  gate.resolve(); await closing; assert.equal(calls.at(-1), "db-end");
});

test("job errors expose only fixed 409/503 API codes", async () => {
  const app = Fastify(); installApiErrors(app);
  app.post("/busy", async () => { throw new JobUnavailableError("job_in_progress"); });
  app.post("/stopping", async () => { throw new JobUnavailableError("job_stopping"); });
  try {
    for (const [url, statusCode, error] of [["/busy", 409, "job_in_progress"], ["/stopping", 503, "job_stopping"]]) {
      const result = await app.inject({ method: "POST", url });
      assert.equal(result.statusCode, statusCode); assert.deepEqual(result.json(), { error });
    }
  } finally { await app.close(); }
});

test("transaction analytics stop issuing queries after a failure", async () => {
  const calls = [];
  const executor = { query: async (sql) => { calls.push(sql); throw new Error("controlled read failure"); } };
  await assert.rejects(getFlagsForUser("test-user", executor), /controlled read failure/);
  await tick(); assert.equal(calls.length, 1);
});

test("transaction progress does not leave a parallel query behind after failure", async () => {
  const calls = [];
  const executor = { query: async (sql) => { calls.push(sql); throw new Error("controlled read failure"); } };
  await assert.rejects(getCourseProgress("test-user", "test-course", executor), /controlled read failure/);
  await tick(); assert.equal(calls.length, 1);
});
