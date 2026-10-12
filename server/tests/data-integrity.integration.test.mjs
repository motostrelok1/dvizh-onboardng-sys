import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { installApiErrors } from "../src/api-validation.ts";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installCsrfProtection } from "../src/csrf.ts";
import { PDF } from "./file-fixtures.mjs";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-integrity-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { ensureLessonDir } = await import("../src/storage.ts");
const { adminCourseRoutes } = await import("../src/routes/admin-courses.ts");
const { adminTestRoutes } = await import("../src/routes/admin-tests.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const { adminAssignmentRoutes } = await import("../src/routes/admin-assignments.ts");
const origin = "https://lms.example.test", logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installApiErrors(app); installPrivacyHeaders(app); installCsrfProtection(app, origin);
let adminId, users, departments, groups, courses, modules, lessons, tests, questions, answers, attemptId, attachmentId;
let adminCookies, employeeCookies;
before(async () => {
  await app.register(cookie); await app.register(multipart);
  for (const route of [adminCourseRoutes, adminTestRoutes, adminAttachmentRoutes, adminAssignmentRoutes]) await app.register(route);
  await app.ready();
});
beforeEach(async () => {
  adminId = randomUUID(); users = [randomUUID(), randomUUID()].sort();
  departments = [randomUUID(), randomUUID()]; groups = [randomUUID(), randomUUID(), randomUUID()];
  courses = [randomUUID(), randomUUID()]; modules = [randomUUID(), randomUUID(), randomUUID()];
  lessons = [randomUUID(), randomUUID(), randomUUID()]; tests = [randomUUID(), randomUUID()];
  questions = [randomUUID(), randomUUID(), randomUUID()]; answers = [randomUUID(), randomUUID()];
  attemptId = randomUUID(); attachmentId = randomUUID();
  await pool.query("insert into departments(id,name) values ($1,'CI Department'),($2,'CI Empty')", departments);
  await pool.query(`insert into users(id,full_name,role,department_id) values
    ($1,'CI Integrity Admin','admin',null),($2,'CI First','employee',$4),($3,'CI Second','employee',$4)`,
    [adminId, ...users, departments[0]]);
  await pool.query("insert into groups(id,name) values ($1,'CI First'),($2,'CI Reversed'),($3,'CI Empty')", groups);
  await pool.query(`insert into group_members(group_id,user_id) values ($1,$3),($1,$4),($2,$4),($2,$3)`,
    [groups[0], groups[1], ...users]);
  await pool.query("insert into courses(id,title) values ($1,'CI Integrity Course'),($2,'CI Other')", courses);
  await pool.query(`insert into modules(id,course_id,title,position) values
    ($1,$4,'CI First',0),($2,$4,'CI Second',1),($3,$5,'CI Other',0)`, [...modules, ...courses]);
  await pool.query(`insert into lessons(id,module_id,title,position) values
    ($1,$4,'CI First',0),($2,$4,'CI Second',1),($3,$5,'CI Other',0)`, [...lessons, modules[0], modules[2]]);
  await pool.query("insert into tests(id,scope,parent_id) values ($1,'module',$2),($3,'lesson',$4)",
    [tests[0], modules[0], tests[1], lessons[0]]);
  await pool.query(`insert into questions(id,test_id,text,position) values
    ($1,$4,'CI First',0),($2,$4,'CI Second',1),($3,$5,'CI Lesson',0)`, [...questions, ...tests]);
  await pool.query("insert into answers(id,question_id,text) values ($1,$2,'CI First'),($3,$4,'CI Lesson')",
    [answers[0], questions[0], answers[1], questions[2]]);
  await pool.query("insert into test_attempts(id,test_id,user_id,attempt_number) values ($1,$2,$3,1)",
    [attemptId, tests[1], users[0]]);
  await pool.query("insert into attempt_answers(attempt_id,question_id) values ($1,$2)", [attemptId, questions[2]]);
  const path = join(await ensureLessonDir(lessons[0]), `${attachmentId}.pdf`); await writeFile(path, PDF);
  await pool.query("insert into lesson_attachments(id,lesson_id,file_name,file_path,position) values ($1,$2,'CI.pdf',$3,0)",
    [attachmentId, lessons[0], path]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  employeeCookies = { [SESSION_COOKIE]: (await createSession(users[0])).token };
  logs.length = 0;
});
afterEach(async () => {
  await pool.query("delete from courses where id=any($1::uuid[])", [courses]);
  await pool.query("delete from users where id=any($1::uuid[])", [[adminId, ...users]]);
  await pool.query("delete from groups where id=any($1::uuid[])", [groups]);
  await pool.query("delete from departments where id=any($1::uuid[])", [departments]);
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
after(async () => { try { await app.close(); } finally { await pool.end(); await rm(scratch, { recursive: true, force: true }); } });

function request(method, url, payload, cookies = adminCookies, requestOrigin = origin) {
  return app.inject({ method, url, payload, cookies, headers: { origin: requestOrigin } });
}
function post(url, payload) { return request("POST", url, payload); }
function assign(targetType, targetId, extra = {}) {
  return post("/admin/assignments", { courseId: courses[0], targetType, targetId, ...extra });
}
function upload() {
  const boundary = "lms-integrity-upload";
  return app.inject({ method: "POST", url: `/admin/lessons/${lessons[0]}/attachments`, cookies: adminCookies,
    headers: { origin, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      PDF, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
}
async function ordered(table, parent) {
  const fks = { modules: "course_id", lessons: "module_id", questions: "test_id", lesson_attachments: "lesson_id" };
  assert.ok(Object.hasOwn(fks, table));
  return (await pool.query(`select * from ${table} where ${fks[table]}=$1 order by position,id`, [parent])).rows;
}
async function assignments() {
  return (await pool.query("select * from assignments where course_id=$1 order by user_id", [courses[0]])).rows;
}
async function events() {
  return (await pool.query("select * from events where user_id=any($1::uuid[]) and event_type='assignment_created' order by id", [users])).rows;
}
async function withQueries(intercept, work) {
  const original = pool.connect;
  pool.connect = function (...args) {
    const connected = original.apply(this, args);
    if (typeof args[0] === "function") return connected;
    return connected.then(client => new Proxy(client, { get(target, property) {
      if (property === "query") return (...args) => intercept(String(args[0]), args[1], client);
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } }));
  };
  try { return await work(); } finally { pool.connect = original; }
}
async function eventually(check, message) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(message);
}
async function blockedBy(pid) {
  await eventually(async () => (await pool.query(
    "select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as blocked", [pid]
  )).rows[0].blocked, "second operation did not wait on the first transaction");
}

test("concurrent creation of one test returns one success and one explicit conflict with the same test ID", async () => {
  const responses = await Promise.all([post("/admin/tests", { scope: "module", parentId: modules[1] }),
    post("/admin/tests", { scope: "module", parentId: modules[1] })]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [201, 409]);
  const id = responses.find(r => r.statusCode === 201).json().test.id;
  assert.deepEqual(responses.find(r => r.statusCode === 409).json(), { error: "test_already_exists", testId: id });
  assert.equal((await pool.query("select id from tests where scope='module' and parent_id=$1", [modules[1]])).rowCount, 1);
});

test("test creation rejects absent or wrong-kind parents without adding a test", async () => {
  for (const [scope, parentId] of [["module", randomUUID()], ["lesson", randomUUID()],
    ["module", lessons[0]], ["lesson", modules[0]]]) {
    const response = await post("/admin/tests", { scope, parentId });
    assert.equal(response.statusCode, 404, response.body);
    assert.deepEqual(response.json(), { error: "not_found" });
  }
  assert.equal((await pool.query("select id from tests where parent_id=any($1::uuid[])", [[...modules, ...lessons]])).rowCount, 2);
});

test("database enforces test uniqueness, conditional parent FKs and generated columns independently of API checks", async () => {
  await assert.rejects(pool.query("insert into tests(scope,parent_id) values('module',$1)", [modules[0]]), { code: "23505" });
  await assert.rejects(pool.query("insert into tests(scope,parent_id) values('lesson',$1)", [modules[0]]), { code: "23503" });
  await assert.rejects(pool.query("insert into tests(scope,parent_id) values('module',$1)", [randomUUID()]), { code: "23503" });
  await assert.rejects(pool.query("update tests set module_parent_id=$2 where id=$1", [tests[0], modules[1]]), { code: "428C9" });
  const rows = (await pool.query("select id,module_parent_id,lesson_parent_id from tests where id=any($1::uuid[])", [tests])).rows;
  assert.deepEqual(rows.find(r => r.id === tests[0]), { id: tests[0], module_parent_id: modules[0], lesson_parent_id: null });
  assert.deepEqual(rows.find(r => r.id === tests[1]), { id: tests[1], module_parent_id: null, lesson_parent_id: lessons[0] });
});

test("lesson deletion cascades its test/questions/answers/attempts while retaining other content and event history", async () => {
  await pool.query("insert into events(user_id,event_type,entity_type,entity_id) values($1,'test_attempt_start','attempt',$2)", [users[0], attemptId]);
  assert.equal((await request("DELETE", `/admin/lessons/${lessons[0]}`)).statusCode, 200);
  for (const [table, id] of [["tests", tests[1]], ["questions", questions[2]], ["answers", answers[1]], ["test_attempts", attemptId]]) {
    assert.equal((await pool.query(`select id from ${table} where id=$1`, [id])).rowCount, 0);
  }
  assert.equal((await pool.query("select id from attempt_answers where attempt_id=$1", [attemptId])).rowCount, 0);
  assert.equal((await pool.query("select id from tests where id=$1", [tests[0]])).rowCount, 1);
  assert.equal((await pool.query("select id from events where entity_id=$1", [attemptId])).rowCount, 1);
});

test("module and course deletions cascade both kinds of tests without removing a different course", async () => {
  assert.equal((await request("DELETE", `/admin/modules/${modules[0]}`)).statusCode, 200);
  assert.equal((await pool.query("select id from tests where id=any($1::uuid[])", [tests])).rowCount, 0);
  assert.equal((await post("/admin/tests", { scope: "module", parentId: modules[1] })).statusCode, 201);
  assert.equal((await request("DELETE", `/admin/courses/${courses[0]}`)).statusCode, 200);
  assert.equal((await pool.query("select id from tests where parent_id=any($1::uuid[])", [modules])).rowCount, 0);
  assert.equal((await pool.query("select id from modules where id=$1", [modules[2]])).rowCount, 1);
});

test("database rejects duplicate and negative positions for every ordered content table", async () => {
  for (const [sql, params] of [
    ["insert into modules(course_id,title,position) values($1,'duplicate',$2)", [courses[0]]],
    ["insert into lessons(module_id,title,position) values($1,'duplicate',$2)", [modules[0]]],
    ["insert into questions(test_id,text,position) values($1,'duplicate',$2)", [tests[0]]],
    ["insert into lesson_attachments(lesson_id,file_name,file_path,position) values($1,'duplicate.pdf','not-a-real-file',$2)", [lessons[0]]]
  ]) {
    await assert.rejects(pool.query(sql, [...params, 0]), { code: "23505" });
    await assert.rejects(pool.query(sql, [...params, -1]), { code: "23514" });
  }
});

for (const kind of ["modules", "lessons", "questions"]) {
  test(`parallel ${kind} creation appends six unique positions under one parent`, async () => {
    const url = kind === "modules" ? `/admin/courses/${courses[0]}/modules` : kind === "lessons"
      ? `/admin/modules/${modules[0]}/lessons` : `/admin/tests/${tests[0]}/questions`;
    const parent = kind === "modules" ? courses[0] : kind === "lessons" ? modules[0] : tests[0];
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => post(url,
      kind === "questions" ? { text: `CI ${i}` } : { title: `CI ${i}` })));
    assert.ok(responses.every(r => r.statusCode === 201), responses.map(r => r.body).join("\n"));
    assert.deepEqual((await ordered(kind, parent)).map(r => r.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  });
}

test("parallel attachment uploads keep unique positions and each complete published file", async () => {
  const responses = await Promise.all(Array.from({ length: 3 }, upload));
  assert.ok(responses.every(r => r.statusCode === 201), responses.map(r => r.body).join("\n"));
  const current = await ordered("lesson_attachments", lessons[0]);
  assert.deepEqual(current.map(r => r.position), [0, 1, 2, 3]);
  for (const row of current) assert.deepEqual(await readFile(row.file_path), PDF);
  assert.equal((await readdir(join(process.env.UPLOAD_DIR, "lessons", lessons[0]))).length, 4);
});

for (const kind of ["modules", "lessons"]) {
  test(`${kind} reorder swaps a complete permutation using deferred uniqueness`, async () => {
    const parent = kind === "modules" ? courses[0] : modules[0];
    const ids = kind === "modules" ? modules.slice(0, 2) : lessons.slice(0, 2);
    const before = await ordered(kind, parent);
    const response = await post(`/admin/${kind}/reorder`, { [kind === "modules" ? "courseId" : "moduleId"]: parent,
      orderedIds: [...ids].reverse().map(id => id.toUpperCase()) });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(await ordered(kind, parent), [before[1], before[0]].map((r, position) => ({ ...r, position })));
  });
}

test("foreign, repeated, missing and stale reorder IDs cannot mutate any parent's children", async () => {
  for (const kind of ["modules", "lessons"]) {
    const parent = kind === "modules" ? courses[0] : modules[0], ids = kind === "modules" ? modules : lessons;
    const key = kind === "modules" ? "courseId" : "moduleId";
    const before = (await pool.query(`select * from ${kind} where id=any($1::uuid[]) order by id`, [ids])).rows;
    for (const [orderedIds, status] of [[[ids[0], ids[0]], 400], [[ids[0], ids[0].toUpperCase()], 400],
      [[ids[0], ids[2]], 400], [[randomUUID(), ids[1]], 400], [[ids[0]], 409], [[], 409]]) {
      const response = await post(`/admin/${kind}/reorder`, { [key]: parent, orderedIds });
      assert.equal(response.statusCode, status, response.body);
      assert.deepEqual((await pool.query(`select * from ${kind} where id=any($1::uuid[]) order by id`, [ids])).rows, before);
    }
    assert.equal((await post(`/admin/${kind}/reorder`, { [key]: randomUUID(), orderedIds: [] })).statusCode, 404);
  }
});

test("a late reorder SQL failure rolls back every position and returns a private error", async () => {
  const before = await ordered("modules", courses[0]); let updates = 0, intermediate;
  const response = await withQueries(async (sql, params, client) => {
    if (sql.startsWith("update modules")) {
      if (++updates === 2) {
        intermediate = (await client.query("select position from modules where course_id=$1 order by position", [courses[0]])).rows;
        throw new Error("SECRET reorder fault /srv/private");
      }
    }
    return client.query(sql, params);
  }, () => post("/admin/modules/reorder", { courseId: courses[0], orderedIds: [modules[1], modules[0]] }));
  assert.equal(updates, 2); assert.deepEqual(intermediate.map(r => r.position), [0, 0]);
  assert.equal(response.statusCode, 500); assert.deepEqual(response.json(), { error: "internal_error" });
  assert.ok(!logs.join("").includes("SECRET")); assert.deepEqual(await ordered("modules", courses[0]), before);
});

test("append waits for reorder's parent lock then preserves the completed permutation", { timeout: 15_000 }, async () => {
  let release, pid, first, second; const gate = new Promise(resolve => { release = resolve; });
  try {
    await withQueries(async (sql, params, client) => {
      if (!pid && sql.startsWith("update modules")) {
        pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
        await gate;
      }
      return client.query(sql, params);
    }, async () => {
      first = post("/admin/modules/reorder", { courseId: courses[0], orderedIds: [modules[1], modules[0]] }).then(r => r);
      await eventually(() => Boolean(pid), "reorder never took its parent lock");
      second = post(`/admin/courses/${courses[0]}/modules`, { title: "Concurrent append" }).then(r => r);
      await blockedBy(pid); release();
      assert.equal((await first).statusCode, 200); assert.equal((await second).statusCode, 201);
    });
    const current = await ordered("modules", courses[0]);
    assert.deepEqual(current.map(r => r.position), [0, 1, 2]);
    assert.deepEqual(current.slice(0, 2).map(r => r.id), [modules[1], modules[0]]);
  } finally { release(); await Promise.allSettled([first, second].filter(Boolean)); }
});

test("parallel complete reorders serialize and leave one valid final permutation", async () => {
  const responses = await Promise.all([[modules[1], modules[0]], [modules[0], modules[1]]].map(orderedIds =>
    post("/admin/modules/reorder", { courseId: courses[0], orderedIds })));
  assert.ok(responses.every(r => r.statusCode === 200));
  const current = await ordered("modules", courses[0]);
  assert.deepEqual(current.map(r => r.position), [0, 1]); assert.deepEqual(current.map(r => r.id).sort(), modules.slice(0, 2).sort());
});

test("individual, group and department assignment keep one row per user/course and preserve completed status", async () => {
  assert.equal((await assign("user", users[0])).json().assignedCount, 1);
  const id = (await assignments())[0].id;
  await pool.query("update assignments set status='completed' where id=$1", [id]);
  const grouped = await assign("group", groups[0], { isRequired: false, deadline: "2030-01-02T12:00:00Z" });
  assert.equal(grouped.statusCode, 201, grouped.body); assert.equal(grouped.json().assignedCount, 2);
  assert.ok((await assignments()).every(r => r.source_group_id === groups[0] && r.is_required === false));
  const department = await assign("department", departments[0], { deadline: null });
  assert.equal(department.statusCode, 201, department.body); assert.equal(department.json().assignedCount, 2);
  const current = await assignments(); assert.equal(current.length, 2);
  assert.equal(current[0].id, id); assert.equal(current[0].status, "completed");
  assert.ok(current.every(r => r.source_group_id === null && r.source_department_id === departments[0] && r.deadline === null));
  assert.equal((await events()).length, 5);
});

test("overlapping group assignments wait on a consistent user order without duplicates or deadlocks", { timeout: 15_000 }, async () => {
  let release, pid, first, second; const gate = new Promise(resolve => { release = resolve; }); const order = new Map();
  try {
    await withQueries(async (sql, params, client) => {
      const clientPid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
      if (sql.includes("insert into assignments")) {
        const sequence = order.get(clientPid) ?? []; sequence.push(params[0]); order.set(clientPid, sequence);
        const result = await client.query(sql, params);
        if (!pid && params[3] === groups[0]) { pid = clientPid; await gate; }
        return result;
      }
      return client.query(sql, params);
    }, async () => {
      first = assign("group", groups[0]).then(r => r);
      await eventually(() => Boolean(pid), "first assignment never reached its row lock");
      second = assign("group", groups[1]).then(r => r);
      await blockedBy(pid); release();
      assert.equal((await first).statusCode, 201); assert.equal((await second).statusCode, 201);
    });
    assert.equal(order.size, 2); for (const sequence of order.values()) assert.deepEqual(sequence, users);
    assert.equal((await assignments()).length, 2); assert.equal((await events()).length, 4);
  } finally { release(); await Promise.allSettled([first, second].filter(Boolean)); }
});

test("a real late user FK failure rolls back the whole bulk assignment and its first event", async () => {
  let inserts = 0;
  const response = await withQueries(async (sql, params, client) => {
    if (sql.includes("insert into assignments") && ++inserts === 2) await pool.query("delete from users where id=$1", [users[1]]);
    return client.query(sql, params);
  }, () => assign("group", groups[0]));
  assert.equal(inserts, 2); assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(response.json(), { error: "invalid_reference" }); assert.deepEqual(await assignments(), []); assert.deepEqual(await events(), []);
});

test("a second event failure rolls back new rows and updates to an existing assignment together", async () => {
  assert.equal((await assign("user", users[0])).statusCode, 201);
  const before = await assignments(), previousEvents = await events(); let logged = 0;
  const response = await withQueries(async (sql, params, client) => {
    if (sql.includes("insert into events") && ++logged === 2) throw new Error("SECRET event fault");
    return client.query(sql, params);
  }, () => assign("department", departments[0], { deadline: "2030-02-03T00:00:00Z", isRequired: false }));
  assert.equal(logged, 2); assert.equal(response.statusCode, 500); assert.deepEqual(response.json(), { error: "internal_error" });
  assert.deepEqual(await assignments(), before); assert.deepEqual(await events(), previousEvents); assert.ok(!logs.join("").includes("SECRET"));
});

test("missing or empty targets and denied callers cannot produce assignments or assignment events", async () => {
  for (const type of ["user", "group", "department"]) assert.equal((await assign(type, randomUUID())).statusCode, 404);
  assert.equal((await post("/admin/assignments", { courseId: randomUUID(), targetType: "user", targetId: users[0] })).statusCode, 404);
  for (const [type, id] of [["group", groups[2]], ["department", departments[1]]]) {
    const response = await assign(type, id); assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "no_users_in_target" });
  }
  for (const [cookies, requestOrigin, status] of [[{}, origin, 401], [employeeCookies, origin, 403],
    [adminCookies, "https://foreign.example.test", 403]]) {
    const response = await request("POST", "/admin/assignments", { courseId: courses[0], targetType: "user", targetId: users[0] }, cookies, requestOrigin);
    assert.equal(response.statusCode, status, response.body);
  }
  assert.deepEqual(await assignments(), []); assert.deepEqual(await events(), []);
});
