import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installApiErrors } from "../src/api-validation.ts";
import { installCsrfProtection } from "../src/csrf.ts";
import { PDF } from "./file-fixtures.mjs";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-upload-reliability-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
const origin = "https://lms.example.test", boundary = "lms-reliability-boundary";
installPrivacyHeaders(app);
installApiErrors(app);
installCsrfProtection(app, origin);
let adminId, courseId, moduleId, lessonId, adminCookies;

before(async () => {
  await app.register(cookie);
  await app.register(multipart);
  await app.register(adminAttachmentRoutes);
  await app.ready();
});
beforeEach(async () => {
  [adminId, courseId, moduleId, lessonId] = Array.from({ length: 4 }, () => randomUUID());
  await pool.query("insert into users (id, full_name, role) values ($1, 'CI Upload Reliability Admin', 'admin')", [adminId]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  await pool.query("insert into courses (id, title) values ($1, 'CI Upload Reliability Course')", [courseId]);
  await pool.query("insert into modules (id, course_id, title) values ($1, $2, 'CI Module')", [moduleId, courseId]);
  await pool.query("insert into lessons (id, module_id, title) values ($1, $2, 'CI Lesson')", [lessonId, moduleId]);
  logs.length = 0;
});
afterEach(async () => {
  await pool.query("delete from courses where id = $1", [courseId]);
  await pool.query("delete from users where id = $1", [adminId]);
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
after(async () => {
  try { await app.close(); }
  finally { await pool.end(); await rm(scratch, { recursive: true, force: true }); }
});

function upload(complete = true) {
  return app.inject({ method: "POST", url: `/admin/lessons/${lessonId}/attachments`, cookies: adminCookies,
    headers: { origin, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      PDF, ...(complete ? [Buffer.from(`\r\n--${boundary}--\r\n`)] : [])
    ]) });
}
async function files() {
  try { return await readdir(join(process.env.UPLOAD_DIR, "lessons", lessonId)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function rows() {
  return (await pool.query("select * from lesson_attachments where lesson_id = $1", [lessonId])).rows;
}
async function empty() {
  assert.deepEqual(await files(), []);
  assert.deepEqual(await rows(), []);
}
function internal(response) {
  assert.equal(response.statusCode, 500, response.body);
  assert.deepEqual(response.json(), { error: "internal_error" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.ok(!response.body.includes("SECRET"));
  assert.ok(!logs.join("").includes("SECRET"));
}

// Faults/gates affect only this process's explicit upload transaction clients;
// Pool.query keeps its callback path and still talks to a real PostgreSQL.
async function withQueries(intercept, work) {
  const original = pool.connect;
  pool.connect = function (...args) {
    const connected = original.apply(this, args);
    if (typeof args[0] === "function") return connected;
    return connected.then(client => new Proxy(client, {
      get(target, property) {
        if (property === "query") return (...queryArgs) => typeof queryArgs[0] === "string"
          ? intercept(queryArgs[0], queryArgs[1], client) : client.query(...queryArgs);
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }));
  };
  try { return await work(); } finally { pool.connect = original; }
}

test("position query failure observes only a complete temporary file and cleans it before the response", async () => {
  let observed;
  const response = await withQueries(async (sql, params, client) => {
    if (sql.includes("max(position)")) {
      const names = await files();
      observed = { names, bytes: await readFile(join(process.env.UPLOAD_DIR, "lessons", lessonId, names[0])), rows: await rows() };
      throw new Error("SECRET position failure /srv/private");
    }
    return client.query(sql, params);
  }, upload);
  assert.ok(observed); assert.equal(observed.names.length, 1); assert.match(observed.names[0], /\.part$/);
  assert.deepEqual(observed.bytes, PDF); assert.deepEqual(observed.rows, []);
  internal(response); await empty();
});

test("INSERT failure removes the published file and rolls back the attachment row", async () => {
  let observed;
  const response = await withQueries(async (sql, params, client) => {
    if (sql.includes("insert into lesson_attachments")) {
      const names = await files();
      observed = { names, bytes: await readFile(params[2]) };
      throw new Error("SECRET insert failure");
    }
    return client.query(sql, params);
  }, upload);
  assert.ok(observed); assert.equal(observed.names.length, 1); assert.match(observed.names[0], /^[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(observed.bytes, PDF); internal(response); await empty();
});

test("a connection acquisition failure after file validation still cleans the temporary file", async () => {
  const original = pool.connect;
  let connections = 0;
  pool.connect = function (...args) {
    if (typeof args[0] === "function" || ++connections === 1) return original.apply(this, args);
    return Promise.reject(new Error("SECRET connection failure"));
  };
  let response;
  try { response = await upload(); } finally { pool.connect = original; }
  internal(response); await empty();
});

test("lesson deleted during upload is rechecked before publication and leaves no file or row", async () => {
  let reached = false;
  const response = await withQueries(async (sql, params, client) => {
    if (sql.includes("for no key update")) {
      reached = true;
      await pool.query("delete from lessons where id = $1", [lessonId]);
    }
    return client.query(sql, params);
  }, upload);
  assert.ok(reached); assert.equal(response.statusCode, 404, response.body);
  assert.deepEqual(response.json(), { error: "lesson_not_found" }); await empty();
});

test("losing COMMIT acknowledgement preserves the file referenced by a committed row", async () => {
  const response = await withQueries(async (sql, params, client) => {
    const result = await client.query(sql, params);
    if (sql === "commit") throw new Error("SECRET lost commit acknowledgement");
    return result;
  }, upload);
  internal(response);
  const attachments = await rows(); assert.equal(attachments.length, 1);
  assert.deepEqual(await readFile(attachments[0].file_path), PDF);
  assert.equal((await files()).length, 1);
  assert.ok(logs.some(line => line.includes('"category":"commit_uncertain"')));
  const download = await app.inject({ url: `/attachments/${attachments[0].id}/download`, cookies: adminCookies });
  assert.equal(download.statusCode, 200, download.body); assert.deepEqual(download.rawPayload, PDF);
});

test("an ambiguous pre-COMMIT failure retains only the final file for later reconciliation", async () => {
  const response = await withQueries(async (sql, params, client) => {
    if (sql === "commit") throw new Error("SECRET failed commit transport");
    return client.query(sql, params);
  }, upload);
  internal(response); assert.deepEqual(await rows(), []);
  const names = await files(); assert.equal(names.length, 1); assert.match(names[0], /^[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(await readFile(join(process.env.UPLOAD_DIR, "lessons", lessonId, names[0])), PDF);
  assert.ok(logs.some(line => line.includes('"category":"commit_uncertain"')));
});

test("multipart cut off inside the file leaves no final or partial attachment", { timeout: 15_000 }, async () => {
  const response = await upload(false);
  assert.ok([400, 500].includes(response.statusCode), response.body);
  assert.ok(!response.body.includes("Unexpected end"));
  await empty();
});

test("successful publication returns a usable final attachment without a temporary file", async () => {
  const response = await upload(); assert.equal(response.statusCode, 201, response.body);
  const attachment = response.json().attachment;
  assert.equal(attachment.file_path, undefined);
  const current = await rows(); assert.equal(current.length, 1);
  const names = await files(); assert.equal(names.length, 1); assert.match(names[0], /^[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(await readFile(current[0].file_path), PDF);
  assert.equal(Number(current[0].size_bytes), PDF.length);
});

test("a concurrent lesson deletion waits for upload publication and COMMIT", { timeout: 15_000 }, async () => {
  let release, pid, pendingUpload, pendingDelete;
  const gate = new Promise(resolve => { release = resolve; });
  const deleter = await pool.connect();
  await deleter.query("begin");
  try {
    await withQueries(async (sql, params, client) => {
      if (sql.includes("insert into lesson_attachments")) {
        pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
        await gate;
      }
      return client.query(sql, params);
    }, async () => {
      async function eventually(check, message) {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (await check()) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail(message);
      }
      pendingUpload = upload().then(response => response);
      await eventually(() => Boolean(pid), "upload did not reach its locked lesson");
      pendingDelete = deleter.query("delete from lessons where id = $1", [lessonId]);
      await eventually(async () => (await pool.query(
        "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked", [pid]
      )).rows[0].blocked, "lesson deletion was not blocked by upload");
      release();
      const response = await pendingUpload;
      assert.equal(response.statusCode, 201, response.body);
      await pendingDelete;
      await deleter.query("rollback");
    });
    const current = await rows(); assert.equal(current.length, 1);
    assert.deepEqual(await readFile(current[0].file_path), PDF);
    assert.equal((await files()).length, 1);
  } finally {
    release();
    await Promise.allSettled([pendingUpload, pendingDelete].filter(Boolean));
    await deleter.query("rollback");
    deleter.release();
  }
});
