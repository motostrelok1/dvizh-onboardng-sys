import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-attachment-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const { ensureLessonDir, UPLOAD_DIR } = await import("../src/storage.ts");
const app = Fastify();
let adminId;
let employeeId;
let courseId;
let lessonId;
let adminCookies;
let employeeCookies;

before(async () => {
  await app.register(cookie);
  await app.register(multipart);
  await app.register(adminAttachmentRoutes);
  await app.ready();
});

beforeEach(async () => {
  adminId = randomUUID();
  employeeId = randomUUID();
  courseId = randomUUID();
  lessonId = randomUUID();
  const moduleId = randomUUID();
  await pool.query(
    `insert into users (id, full_name, role) values ($1, 'CI Upload Admin', 'admin'), ($2, 'CI Upload Employee', 'employee')`,
    [adminId, employeeId]
  );
  await pool.query("insert into courses (id, title, status) values ($1, 'CI Upload Course', 'published')", [courseId]);
  await pool.query("insert into modules (id, course_id, title) values ($1, $2, 'CI Module')", [moduleId, courseId]);
  await pool.query("insert into lessons (id, module_id, title) values ($1, $2, 'CI Lesson')", [lessonId, moduleId]);
  adminCookies = { [SESSION_COOKIE]: (await createSession(adminId)).token };
  employeeCookies = { [SESSION_COOKIE]: (await createSession(employeeId)).token };
});

afterEach(async () => {
  await pool.query("delete from courses where id = $1", [courseId]);
  await pool.query("delete from users where id = any($1::uuid[])", [[adminId, employeeId]]);
  await rm(UPLOAD_DIR, { recursive: true, force: true });
});

after(async () => {
  try {
    await app.close();
  } finally {
    await pool.end();
    await rm(scratch, { recursive: true, force: true });
  }
});

function upload({ id = lessonId, filename = "пособие.pdf", content = Buffer.from("%PDF-1.4\nCI file"), cookies = adminCookies } = {}) {
  const boundary = "lms-ci-multipart-boundary";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return app.inject({
    method: "POST",
    url: `/admin/lessons/${id}/attachments`,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
    cookies
  });
}

async function attachmentCount() {
  return (await pool.query("select id from lesson_attachments where lesson_id = $1", [lessonId])).rowCount;
}

async function insertStoredPath(path) {
  const result = await pool.query(
    "insert into lesson_attachments (lesson_id, file_name, file_path) values ($1, 'legacy.pdf', $2) returning id",
    [lessonId, path]
  );
  return result.rows[0].id;
}

test("only an authenticated admin can upload attachments", async () => {
  assert.equal((await upload({ cookies: {} })).statusCode, 401);
  assert.equal((await upload({ cookies: employeeCookies })).statusCode, 403);
  assert.equal(await attachmentCount(), 0);
  await assert.rejects(lstat(UPLOAD_DIR), { code: "ENOENT" });
});

test("invalid and unknown lesson IDs create neither directories nor files", async () => {
  const invalid = await upload({ id: "not-a-uuid" });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: "invalid_lesson_id" });
  const missing = await upload({ id: randomUUID() });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "lesson_not_found" });
  await assert.rejects(lstat(UPLOAD_DIR), { code: "ENOENT" });
  assert.equal(await attachmentCount(), 0);
});

test("upload uses a private UUID filename and preserves the display name", async () => {
  const response = await upload({ id: lessonId.toUpperCase() });
  assert.equal(response.statusCode, 201);
  const attachment = response.json().attachment;
  assert.equal(attachment.file_name, "пособие.pdf");
  assert.match(basename(attachment.file_path), /^[0-9a-f-]{36}\.pdf$/);
  assert.equal(dirname(attachment.file_path), join(UPLOAD_DIR, "lessons", lessonId));
  assert.equal(await readFile(attachment.file_path, "utf8"), "%PDF-1.4\nCI file");
  assert.equal((await lstat(attachment.file_path)).mode & 0o777, 0o600);
  assert.equal(await attachmentCount(), 1);
  const download = await app.inject({ url: `/attachments/${attachment.id}/download`, cookies: adminCookies });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, "%PDF-1.4\nCI file");
  assert.ok(download.headers["content-disposition"].includes(encodeURIComponent("пособие.pdf")));
});

test("the multipart filename cannot redirect storage", async () => {
  for (const filename of ["../../escape.pdf", "..\\..\\escape.pdf", "/tmp/escape.pdf"]) {
    const response = await upload({ filename });
    assert.equal(response.statusCode, 201);
    const attachment = response.json().attachment;
    assert.match(basename(attachment.file_path), /^[0-9a-f-]{36}\.pdf$/);
    assert.equal(dirname(attachment.file_path), join(UPLOAD_DIR, "lessons", lessonId));
  }
  assert.equal(await attachmentCount(), 3);
});

test("a disallowed extension is rejected before creating an upload directory", async () => {
  const response = await upload({ filename: "file.exe" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "file_type_not_allowed");
  await assert.rejects(lstat(UPLOAD_DIR), { code: "ENOENT" });
  assert.equal(await attachmentCount(), 0);
});

test("download requires course access and an assigned employee can download", async () => {
  const uploaded = await upload();
  assert.equal(uploaded.statusCode, 201);
  const id = uploaded.json().attachment.id;
  assert.equal((await app.inject({ url: `/attachments/${id}/download` })).statusCode, 401);
  const denied = await app.inject({ url: `/attachments/${id}/download`, cookies: employeeCookies });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { error: "not_assigned" });
  await pool.query("insert into assignments (user_id, course_id) values ($1, $2)", [employeeId, courseId]);
  const allowed = await app.inject({ url: `/attachments/${id}/download`, cookies: employeeCookies });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body, "%PDF-1.4\nCI file");
});

test("ordinary legacy attachments still download and delete", async () => {
  const dir = await ensureLessonDir(lessonId);
  const path = join(dir, `${randomUUID()}-legacy handbook.pdf`);
  await writeFile(path, "legacy content");
  const id = await insertStoredPath(path);
  const download = await app.inject({ url: `/attachments/${id}/download`, cookies: adminCookies });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, "legacy content");
  const response = await app.inject({ method: "DELETE", url: `/admin/attachments/${id}`, cookies: adminCookies });
  assert.equal(response.statusCode, 200);
  assert.equal(await attachmentCount(), 0);
  await assert.rejects(lstat(path), { code: "ENOENT" });
});

test("a corrupt outside DB path cannot be downloaded or deleted", async () => {
  const path = join(scratch, `${randomUUID()}.pdf`);
  await writeFile(path, "outside content");
  const id = await insertStoredPath(path);
  const read = await app.inject({ url: `/attachments/${id}/download`, cookies: adminCookies });
  assert.equal(read.statusCode, 400);
  const remove = await app.inject({ method: "DELETE", url: `/admin/attachments/${id}`, cookies: adminCookies });
  assert.equal(remove.statusCode, 400);
  assert.equal(await readFile(path, "utf8"), "outside content");
  assert.equal(await attachmentCount(), 1);
});

test("a symlink in the lesson directory prevents upload", async () => {
  await mkdir(join(UPLOAD_DIR, "lessons"), { recursive: true });
  const outside = join(scratch, `${randomUUID()}-outside`);
  await mkdir(outside);
  await symlink(outside, join(UPLOAD_DIR, "lessons", lessonId));
  const response = await upload();
  assert.equal(response.statusCode, 400);
  assert.equal(await attachmentCount(), 0);
  assert.deepEqual(await readdir(outside), []);
});

test("an oversized upload leaves no attachment or partial file", async () => {
  const response = await upload({ content: Buffer.alloc(50 * 1024 * 1024 + 1, "x") });
  assert.ok([400, 413].includes(response.statusCode), response.body);
  assert.equal(await attachmentCount(), 0);
  const files = await readdir(join(UPLOAD_DIR, "lessons", lessonId)).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(files, []);
});
