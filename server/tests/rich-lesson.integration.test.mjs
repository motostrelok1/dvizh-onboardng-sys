import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, after, afterEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { PNG } from "./file-fixtures.mjs";

await import("./test-database.mjs");
const scratch = await mkdtemp(join(tmpdir(), "lms-rich-lesson-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { adminCourseRoutes } = await import("../src/routes/admin-courses.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const { meRoutes } = await import("../src/routes/me.ts");
const { installApiErrors } = await import("../src/api-validation.ts");
const { installPrivacyHeaders } = await import("../src/privacy.ts");
const { installCsrfProtection } = await import("../src/csrf.ts");
const { UPLOAD_DIR } = await import("../src/storage.ts");
const origin = "https://lms.example.test";
const app = Fastify();
installPrivacyHeaders(app);
installApiErrors(app);
installCsrfProtection(app, origin);
let admin, employee, course, moduleId, lesson, otherLesson, adminCookie, employeeCookie;

before(async () => {
  await app.register(cookie);
  await app.register(multipart);
  await app.register(adminCourseRoutes);
  await app.register(adminAttachmentRoutes);
  await app.register(meRoutes);
  await app.ready();
});
beforeEach(async () => {
  [admin, employee, course, moduleId, lesson, otherLesson] =
    Array.from({ length: 6 }, () => randomUUID());
  await pool.query("insert into users (id, full_name, role) values ($1,'BN Admin','admin'),($2,'BN Employee','employee')",
    [admin, employee]);
  adminCookie = { [SESSION_COOKIE]: (await createSession(admin)).token };
  employeeCookie = { [SESSION_COOKIE]: (await createSession(employee)).token };
  await pool.query("insert into courses (id,title,status) values ($1,'BN course','published')", [course]);
  await pool.query("insert into modules (id,course_id,title) values ($1,$2,'BN Module')",
    [moduleId, course]);
  await pool.query("insert into lessons (id,module_id,title,text_content,position) values ($1,$2,'BN Lesson','Legacy text',0),($3,$2,'Other','Other text',1)",
    [lesson, moduleId, otherLesson]);
  await pool.query("insert into assignments (user_id,course_id,assigned_by) values ($1,$2,$3)",
    [employee, course, admin]);
});
afterEach(async () => {
  await pool.query("delete from courses where id = $1", [course]);
  await pool.query("delete from users where id = any($1::uuid[])", [[admin, employee]]);
  await rm(UPLOAD_DIR, { recursive: true, force: true });
});
after(async () => {
  try { await app.close(); }
  finally { await pool.end(); await rm(scratch, { recursive:true, force:true }); }
});
function patch(document, revision=0, cookies=adminCookie) {
  return app.inject({ method:"PATCH",url:`/admin/lessons/${lesson}/blocks`,
    cookies, headers:{origin},payload:{contentBlocks:document,expectedRevision:revision} });
}
const paragraph = (text) => [{type:"paragraph",content:[{type:"text",text,styles:{bold:true}}]}];

test("legacy text is intact and rich documents use optimistic revisions", async () => {
  const tree = await app.inject({url:`/admin/courses/${course}/tree`,cookies:adminCookie});
  assert.equal(tree.statusCode,200,tree.body);
  const before = tree.json().modules[0].lessons[0];
  assert.equal(before.text_content,"Legacy text");
  assert.equal(before.content_blocks,null);
  assert.equal(before.content_revision,0);
  const result = await patch(paragraph("Сохраняем ✨"));
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().contentRevision,1);
  assert.equal((await patch(paragraph("Перетёрли"),0)).statusCode,409);
  const saved = (await pool.query("select text_content,content_blocks,content_revision from lessons where id=$1",[lesson])).rows[0];
  assert.equal(saved.text_content,"Legacy text");
  assert.equal(saved.content_revision,1);
  assert.equal(saved.content_blocks[0].content[0].text,"Сохраняем ✨");
});
test("rejects invalid blocks and unauthorized writes", async () => {
  assert.equal((await patch([{type:"html",content:[]}])).statusCode,400);
  assert.equal((await patch([{type:"paragraph",onload:"evil"}])).statusCode,400);
  assert.equal((await patch(paragraph("hi"),0,employeeCookie)).statusCode,403);
  const response=await app.inject({url:`/lessons/${lesson}`,cookies:employeeCookie});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().lesson.textContent,"Legacy text");
});
test("inline PNG uses authorized streaming, not attachment_download telemetry", async () => {
  const boundary="bn-integration-boundary";
  const payload=Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="figure.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG, Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const up=await app.inject({method:"POST",url:`/admin/lessons/${lesson}/attachments`,
    cookies:adminCookie,headers:{origin,"content-type":`multipart/form-data; boundary=${boundary}`},payload});
  assert.equal(up.statusCode,201,up.body);
  const id=up.json().attachment.id;
  const image=[{type:"image",props:{url:`/api/attachments/${id}/inline`,caption:"Рисунок",name:"figure.png"},children:[]}];
  assert.equal((await patch(image)).statusCode,200);
  const file=await app.inject({url:`/attachments/${id}/inline`,cookies:employeeCookie});
  assert.equal(file.statusCode,200,file.body);
  assert.equal(file.headers["content-type"],"image/png");
  assert.equal(file.headers["content-disposition"],"inline");
  assert.deepEqual(file.rawPayload,PNG);
  const events=await pool.query("select id from events where user_id=$1 and event_type='attachment_download'",[employee]);
  assert.equal(events.rowCount,0);
  await pool.query("delete from assignments where user_id=$1 and course_id=$2",[employee,course]);
  const denied=await app.inject({url:`/attachments/${id}/inline`,cookies:employeeCookie});
  assert.equal(denied.statusCode,403);
});
test("images from another lesson cannot be embedded", async () => {
  const id=randomUUID();
  await pool.query("insert into lesson_attachments (id,lesson_id,file_name,file_path) values ($1,$2,'other.png','/tmp/other.png')",
    [id,otherLesson]);
  const res=await patch([{type:"image",props:{url:`/api/attachments/${id}/inline`},children:[]}]);
  assert.equal(res.statusCode,400,res.body);
});
