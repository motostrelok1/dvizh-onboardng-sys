import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installCsrfProtection } from "../src/csrf.ts";
import { installApiErrors } from "../src/api-validation.ts";
await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { testAttemptRoutes } = await import("../src/routes/test-attempts.ts");
const { adminTestRoutes } = await import("../src/routes/admin-tests.ts");
const origin = "https://lms.example.test", logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installApiErrors(app); installPrivacyHeaders(app); installCsrfProtection(app, origin);
let employee, other, admin, courses, modules, tests, questions, answers, cookies, otherCookies, adminCookies;
before(async () => {
  await app.register(cookie); await app.register(testAttemptRoutes); await app.register(adminTestRoutes); await app.ready();
});
beforeEach(async () => {
  [employee, other, admin] = Array.from({ length: 3 }, () => randomUUID());
  courses = Array.from({ length: 2 }, () => randomUUID()); modules = Array.from({ length: 2 }, () => randomUUID());
  tests = Array.from({ length: 2 }, () => randomUUID()); questions = Array.from({ length: 3 }, () => randomUUID());
  answers = Array.from({ length: 6 }, () => randomUUID());
  await pool.query(`insert into users(id,full_name,role) values ($1,'CI attempt employee','employee'),
    ($2,'CI attempt other','employee'),($3,'CI attempt admin','admin')`, [employee, other, admin]);
  await pool.query("insert into courses(id,title,status) values ($1,'CI attempt course','published'),($2,'CI foreign course','published')", courses);
  await pool.query("insert into modules(id,course_id,title) values ($1,$3,'CI Module'),($2,$4,'CI Other')", [...modules, ...courses]);
  await pool.query(`insert into tests(id,scope,parent_id,max_attempts,show_correct_answers,pass_score)
    values ($1,'module',$3,2,true,60),($2,'module',$4,null,false,60)`, [...tests, ...modules]);
  await pool.query(`insert into questions(id,test_id,text,multiple,position) values
    ($1,$4,'CI Single',false,0),($2,$4,'CI Multiple',true,1),($3,$5,'CI Foreign',false,0)`, [...questions, ...tests]);
  await pool.query(`insert into answers(id,question_id,text,is_correct) values
    ($1,$7,'CI Yes',true),($2,$7,'CI No',false),($3,$8,'CI First',true),
    ($4,$8,'CI Second',true),($5,$8,'CI Wrong',false),($6,$9,'CI Foreign',true)`, [...answers, ...questions]);
  await pool.query("insert into assignments(user_id,course_id) values ($1,$2),($1,$3)", [employee, ...courses]);
  cookies = { [SESSION_COOKIE]: (await createSession(employee)).token };
  otherCookies = { [SESSION_COOKIE]: (await createSession(other)).token };
  adminCookies = { [SESSION_COOKIE]: (await createSession(admin)).token }; logs.length = 0;
});
afterEach(async () => {
  await pool.query("delete from courses where id=any($1::uuid[])", [courses]);
  await pool.query("delete from users where id=any($1::uuid[])", [[employee, other, admin]]);
});
after(async () => { try { await app.close(); } finally { await pool.end(); } });
function request(method, url, payload, session = cookies, source = origin) {
  return app.inject({ method, url, payload, cookies: session, headers: source ? { origin: source } : {} });
}
const start = (session = cookies, testId = tests[0]) => request("POST", `/tests/${testId}/attempts`, undefined, session);
const answer = (id, q = questions[0], selected = [answers[0]], session = cookies) =>
  request("POST", `/attempts/${id}/answers`, { questionId: q, selectedAnswerIds: selected }, session);
const finish = (id, session = cookies) => request("POST", `/attempts/${id}/finish`, undefined, session);
async function begun() { const r = await start(); assert.equal(r.statusCode, 201, r.body); return r.json().attempt.id; }
async function row(id) { return (await pool.query("select * from test_attempts where id=$1", [id])).rows[0]; }
async function rows() { return (await pool.query("select * from test_attempts where user_id=$1 order by attempt_number", [employee])).rows; }
async function given(id) { return (await pool.query("select * from attempt_answers where attempt_id=$1 order by question_id", [id])).rows; }
async function eventCount(type) { return (await pool.query("select count(*)::int as n from events where user_id=$1 and event_type=$2", [employee, type])).rows[0].n; }
function error(r, status, code) { assert.equal(r.statusCode, status, r.body); assert.equal(r.json().error, code); }
const patch = (url, body) => request("PATCH", url, body, adminCookies);
async function withQueries(intercept, work) {
  const original = pool.connect;
  pool.connect = function (...args) {
    const connected = original.apply(this, args);
    if (typeof args[0] === "function") return connected;
    return connected.then(client => new Proxy(client, {
      get(target, key) {
        if (key === "query") return (...queryArgs) => intercept(String(queryArgs[0]), queryArgs[1], client);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      }
    }));
  };
  try { return await work(); } finally { pool.connect = original; }
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function gateQuery(matches, work) {
  const entered = deferred(), gate = deferred(); let pid, reached = false;
  return withQueries(async (sql, params, client) => {
    if (!reached && matches(sql, params)) {
      reached = true; pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
      entered.resolve(); await gate.promise;
    }
    return client.query(sql, params);
  }, async () => { try { return await work({ entered: entered.promise, release: gate.resolve, pid: () => pid }); }
    finally { gate.resolve(); } });
}
async function blocked(pid) {
  for (let i = 0; i < 300; i++) {
    const r = await pool.query("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as waiting", [pid]);
    if (r.rows[0].waiting) return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail("concurrent operation did not wait on the owning transaction");
}

test("last allowed attempt resumes before limit check and retains selected answers without leaking correctness", async () => {
  await pool.query("update tests set max_attempts=1 where id=$1", [tests[0]]);
  const id = await begun(); assert.equal((await answer(id)).statusCode, 200);
  const resumed = await start(); assert.equal(resumed.statusCode, 201, resumed.body);
  assert.equal(resumed.json().attempt.id, id);
  assert.deepEqual(resumed.json().questions[0].selectedAnswerIds, [answers[0]]);
  assert.doesNotMatch(resumed.body, /is_correct|isCorrect|correctCount|user_id|test_id/);
  assert.equal(await eventCount("test_attempt_start"), 1);
  assert.equal((await finish(id)).statusCode, 200);
  const exhausted = await start(); error(exhausted, 409, "no_attempts_left");
  assert.deepEqual(exhausted.json(), { error: "no_attempts_left", attemptsUsed: 1, maxAttempts: 1 });
});

test("six concurrent starts create one open row, one number and one start event", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => start()));
  for (const r of results) assert.equal(r.statusCode, 201, r.body);
  assert.equal(new Set(results.map(r => r.json().attempt.id)).size, 1);
  assert.equal((await rows()).length, 1); assert.equal(await eventCount("test_attempt_start"), 1);
});

test("numbering uses max history number while limit uses consumed rows; unlimited attempts remain available", async () => {
  await pool.query(`insert into test_attempts(test_id,user_id,attempt_number,status,finished_at,score,passed)
    values ($1,$2,7,'finished',now(),0,false)`, [tests[0], employee]);
  const id = await begun(); assert.equal((await row(id)).attempt_number, 8);
  await finish(id); error(await start(), 409, "no_attempts_left");
  await patch(`/admin/tests/${tests[0]}`, { maxAttempts: null });
  const next = await begun(); assert.equal((await row(next)).attempt_number, 9);
});

test("all-or-nothing answers, unanswered questions and pass threshold produce the server score", async () => {
  const id = await begun();
  assert.equal((await answer(id)).statusCode, 200);
  assert.equal((await answer(id, questions[1], [answers[2]])).statusCode, 200);
  const result = await finish(id); assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().score, 50); assert.equal(result.json().passed, false);
  assert.equal(result.json().review[1].yourCorrect, false);
  const next = await begun();
  await answer(next); await answer(next, questions[1], [answers[3], answers[2]]);
  const correct = await finish(next); assert.equal(correct.json().score, 100); assert.equal(correct.json().passed, true);
});

test("empty selections are wrong and unanswered questions stay in the denominator", async () => {
  const id = await begun(); assert.equal((await answer(id, questions[0], [])).statusCode, 200);
  const result = await finish(id); assert.equal(result.json().score, 0);
  assert.equal(result.json().review.every(q => !q.yourCorrect), true);
});

test("foreign questions/options, duplicate UUID aliases and multi-selection on single choice never write or log", async () => {
  const id = await begun();
  error(await answer(id, questions[2], [answers[5]]), 400, "invalid_question");
  error(await answer(id, randomUUID(), []), 400, "invalid_question");
  for (const selected of [[answers[5]], [answers[2]], [randomUUID()], [answers[0], answers[1]], [answers[0], answers[0].toUpperCase()]]) {
    error(await answer(id, questions[0], selected), 400, "invalid_answer_set");
  }
  assert.deepEqual(await given(id), []); assert.equal(await eventCount("question_answered"), 0);
});

test("normalized UUIDs save successfully and correctness is absent from the save response", async () => {
  const id = await begun(); const result = await answer(id.toUpperCase(), questions[0].toUpperCase(), [answers[0].toUpperCase()]);
  assert.equal(result.statusCode, 200, result.body); assert.deepEqual(result.json(), { ok: true });
  assert.deepEqual((await given(id))[0].selected_answer_ids, [answers[0]]);
});

test("other users cannot resume, answer or finish another employee's attempt", async () => {
  const id = await begun(); error(await start(otherCookies), 403, "not_assigned");
  error(await answer(id, questions[0], [answers[0]], otherCookies), 404, "not_found");
  error(await finish(id, otherCookies), 404, "not_found");
  assert.deepEqual(await given(id), []); assert.equal((await row(id)).status, "in_progress");
});

test("anonymous, inactive, unassigned and expired requests cannot write attempts or answers", async () => {
  const id = await begun(); error(await start({}), 401, "not_authenticated");
  await pool.query("update assignments set deadline=clock_timestamp()-interval '1 microsecond' where user_id=$1", [employee]);
  for (const r of [await start(), await answer(id), await finish(id)]) error(r, 403, "deadline_passed");
  await pool.query("delete from assignments where user_id=$1", [employee]);
  error(await answer(id), 403, "not_assigned");
  await pool.query("update users set is_active=false where id=$1", [employee]);
  error(await finish(id), 401, "not_authenticated");
  assert.deepEqual(await given(id), []); assert.equal((await row(id)).status, "in_progress");
});

test("trusted Origin remains required for every mutation and history stays private", async () => {
  const id = await begun();
  for (const [url, payload] of [[`/tests/${tests[0]}/attempts`], [`/attempts/${id}/answers`, { questionId: questions[0], selectedAnswerIds: [answers[0]] }], [`/attempts/${id}/finish`]]) {
    error(await request("POST", url, payload, cookies, null), 403, "csrf_forbidden");
    error(await request("POST", url, payload, cookies, "https://foreign.example.test"), 403, "csrf_forbidden");
  }
  const history = await request("GET", `/tests/${tests[0]}/attempts`);
  assert.equal(history.statusCode, 200); assert.equal(history.headers["cache-control"], "no-store");
  assert.doesNotMatch(history.body, /is_correct|isCorrect|selected_answer_ids|user_id/);
});

test("two concurrent finishes store one frozen result and exactly one finish event", async () => {
  const id = await begun(); await answer(id);
  const results = await Promise.all([finish(id), finish(id)]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const before = await row(id), saved = await given(id);
  error(await finish(id), 409, "attempt_already_finished");
  error(await answer(id, questions[0], [answers[1]]), 409, "attempt_already_finished");
  assert.deepEqual(await row(id), before); assert.deepEqual(await given(id), saved);
  assert.equal(await eventCount("test_attempt_end"), 1);
});

for (const kind of ["start", "answer", "finish"]) {
  test(`${kind} event failure rolls back the associated state and allows a safe retry`, async () => {
    const id = kind === "start" ? null : await begun();
    if (kind === "finish") await answer(id);
    const before = await rows(), beforeAnswers = id ? await given(id) : [];
    const event = { start: "test_attempt_start", answer: "question_answered", finish: "test_attempt_end" }[kind];
    const run = () => kind === "start" ? start() : kind === "answer" ? answer(id) : finish(id);
    const result = await withQueries(async (sql, params, client) => {
      if (sql.includes("insert into events") && params[1] === event) throw new Error("SECRET event SQL /private");
      return client.query(sql, params);
    }, run);
    error(result, 500, "internal_error"); assert.equal(result.headers["cache-control"], "no-store");
    assert.doesNotMatch(logs.join(""), /SECRET|event SQL|\/private/);
    assert.deepEqual(await rows(), before); if (id) assert.deepEqual(await given(id), beforeAnswers);
    assert.equal((await run()).statusCode, kind === "start" ? 201 : 200);
    assert.equal(await eventCount(event), 1);
  });
}

for (const firstKind of ["finish", "answer"]) {
  test(`${firstKind} wins a controlled answer/finish race without modifying a finished attempt`, async () => {
    const id = await begun(); let first, second, results;
    await gateQuery(sql => sql.includes(firstKind === "finish" ? "update test_attempts set status='finished'" : "insert into attempt_answers"), async gate => {
      first = firstKind === "finish" ? finish(id) : answer(id);
      await gate.entered;
      second = firstKind === "finish" ? answer(id) : finish(id);
      try { await blocked(gate.pid()); } finally { gate.release(); results = await Promise.all([first, second]); }
    });
    assert.equal(results[0].statusCode, 200, results[0].body);
    assert.equal(results[1].statusCode, firstKind === "finish" ? 409 : 200, results[1].body);
    assert.equal((await row(id)).score, firstKind === "finish" ? 0 : 50);
    assert.equal(await eventCount("question_answered"), firstKind === "finish" ? 0 : 1);
    assert.equal(await eventCount("test_attempt_end"), 1);
  });
}

test("finish recalculates cached correctness and ignores a legacy foreign question", async () => {
  const id = await begun(); await answer(id, questions[0], [answers[1]]);
  await pool.query("update attempt_answers set is_correct=true where attempt_id=$1", [id]);
  await pool.query("insert into attempt_answers(attempt_id,question_id,selected_answer_ids,is_correct) values ($1,$2,$3,true)", [id, questions[2], [answers[5]]]);
  const result = await finish(id); assert.equal(result.json().score, 0);
  assert.equal(result.json().review.length, 2); assert.equal((await given(id)).every(a => !a.is_correct), true);
});

test("live edits change open-attempt grading and review policy, while completed results stay frozen", async () => {
  const id = await begun(); await answer(id);
  await patch(`/admin/answers/${answers[0]}`, { isCorrect: false });
  await patch(`/admin/answers/${answers[1]}`, { isCorrect: true });
  await patch(`/admin/tests/${tests[0]}`, { passScore: 0, showCorrectAnswers: false });
  const result = await finish(id); assert.deepEqual(result.json(), { score: 0, passed: true, passScore: 0 });
  assert.equal((await given(id))[0].is_correct, false);
  const completed = await row(id);
  await patch(`/admin/tests/${tests[0]}`, { passScore: 100, showCorrectAnswers: true });
  error(await finish(id), 409, "attempt_already_finished"); assert.deepEqual(await row(id), completed);
});

test("content editing waits for an in-flight finish before changing correct answers", async () => {
  const id = await begun(); await answer(id); let results;
  await gateQuery(sql => sql.includes("update test_attempts set status='finished'"), async gate => {
    const finishing = finish(id); await gate.entered;
    const editing = patch(`/admin/answers/${answers[0]}`, { isCorrect: false });
    try { await blocked(gate.pid()); } finally { gate.release(); results = await Promise.all([finishing, editing]); }
  });
  for (const r of results) assert.equal(r.statusCode, 200, r.body);
  assert.equal(results[0].json().score, 50); assert.equal((await row(id)).score, 50);
});

test("empty or misconfigured tests do not consume an attempt", async () => {
  await pool.query("delete from questions where test_id=$1", [tests[0]]);
  error(await start(), 409, "test_not_ready"); assert.deepEqual(await rows(), []);
  await pool.query("insert into questions(id,test_id,text) values ($1,$2,'CI empty answers')", [questions[0], tests[0]]);
  error(await start(), 409, "test_not_ready");
  await pool.query("insert into answers(question_id,text,is_correct) values ($1,'CI Wrong',false)", [questions[0]]);
  error(await start(), 409, "test_not_ready");
  await pool.query("insert into answers(question_id,text,is_correct) values ($1,'CI First',true),($1,'CI Second',true)", [questions[0]]);
  error(await start(), 409, "test_not_ready");
  assert.equal(await eventCount("test_attempt_start"), 0);
});

test("live question addition/removal affects the denominator and stale selections cannot earn credit", async () => {
  const id = await begun(); await answer(id);
  const newQuestion = (await request("POST", `/admin/tests/${tests[0]}/questions`, { text: "CI Added" }, adminCookies)).json().question.id;
  await request("POST", `/admin/questions/${newQuestion}/answers`, { text: "CI Added correct", isCorrect: true }, adminCookies);
  const result = await finish(id); assert.equal(result.json().score, 33); assert.equal(result.json().review.length, 3);
  const next = await begun(); await answer(next);
  await request("DELETE", `/admin/questions/${questions[0]}`, undefined, adminCookies);
  const deleted = await finish(next); assert.equal(deleted.json().score, 0); assert.equal(deleted.json().review.length, 2);
});

test("database independently enforces one open attempt, unique numbering and valid result states", async () => {
  const id = await begun();
  await assert.rejects(pool.query("insert into test_attempts(test_id,user_id,attempt_number) values ($1,$2,2)", [tests[0], employee]), { code: "23505" });
  await finish(id);
  await assert.rejects(pool.query("insert into test_attempts(test_id,user_id,attempt_number) values ($1,$2,1)", [tests[0], employee]), { code: "23505" });
  for (const [number, status, score, passed, finished] of [[0,"in_progress",null,null,null], [2,"in_progress",50,null,null],
    [2,"finished",101,false,new Date()], [2,"finished",50,null,new Date()], [2,"finished",50,false,null]]) {
    await assert.rejects(pool.query(`insert into test_attempts(test_id,user_id,attempt_number,status,score,passed,finished_at)
      values ($1,$2,$3,$4,$5,$6,$7)`, [tests[0], employee, number, status, score, passed, finished]), { code: "23514" });
  }
});
