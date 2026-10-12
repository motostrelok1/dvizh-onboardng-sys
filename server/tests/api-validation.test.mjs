import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installApiErrors, schema, success, adminUserDto } from "../src/api-validation.ts";

// These requests fail validation before auth/SQL. Make any accidental SQL
// impossible: the pool is closed before routes are registered, no DB URL used.
const { pool } = await import("../src/db.ts");
await pool.end();
const { adminUserRoutes } = await import("../src/routes/admin-users.ts");
const { adminTestRoutes } = await import("../src/routes/admin-tests.ts");
const { adminAttachmentRoutes } = await import("../src/routes/admin-attachments.ts");
const id = "ba803038-adb4-4778-8213-c3007e35cc0b";
const logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installPrivacyHeaders(app);
installApiErrors(app);
before(async () => {
  await app.register(cookie);
  await app.register(multipart);
  await app.register(adminUserRoutes);
  await app.register(adminTestRoutes);
  await app.register(adminAttachmentRoutes);
  app.get("/fault", async req => {
    throw Object.assign(new Error("SECRET sql=select password_hash from users /srv/private/file"),
      { code: req.headers["x-code"] ?? "unexpected", statusCode: Number(req.headers["x-status"]) || undefined });
  });
  app.get("/dto", { schema: schema(undefined, undefined, success({ user: adminUserDto })) }, async () => ({
    user: { id, full_name: "Employee", role: "employee", email: null, timezone: "UTC", is_active: true,
      password_hash: "SECRET", token_hash: "SECRET", internal_future_column: "SECRET" }
  }));
  await app.ready();
});
after(() => app.close());

async function invalid(url, payload, method = "POST") {
  const response = await app.inject({ method, url, payload });
  assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
  assert.equal(response.json().error, "invalid_request");
  assert.equal(response.headers["cache-control"], "no-store");
}

test("real employee schemas reject wrong types, blank/long strings, bad email/timezone and unknown fields", async () => {
  const good = { fullName: "Employee", email: "person@example.test", timezone: "UTC" };
  for (const patch of [{ fullName: false }, { fullName: " " }, { fullName: "x".repeat(257) },
    { fullName: "name\u0000secret" }, { email: 7 }, { email: "not-an-email" },
    { email: "x".repeat(255) }, { departmentId: "not-a-uuid" }, { timezone: false },
    { timezone: "Invalid/Nowhere" }, { timezone: "+03:00" }, { role: "admin" }]) {
    await invalid("/admin/users", { ...good, ...patch });
  }
  for (const isActive of ["false", "true", 0, 1, null, [], {}]) {
    await invalid(`/admin/users/${id}`, { isActive }, "PATCH");
  }
  await invalid(`/admin/users/${id}`, {}, "PATCH");
});

test("real test settings require integer bounds and booleans without coercion", async () => {
  for (const maxAttempts of [0, -1, 0.5, 2147483648, "2", false, [], {}]) {
    await invalid(`/admin/tests/${id}`, { maxAttempts }, "PATCH");
  }
  for (const passScore of [-1, 101, 0.5, "70", false, null, [], {}]) {
    await invalid(`/admin/tests/${id}`, { passScore }, "PATCH");
  }
  for (const showCorrectAnswers of ["false", 0, null, []]) {
    await invalid(`/admin/tests/${id}`, { showCorrectAnswers }, "PATCH");
  }
  await invalid(`/admin/tests/${id}`, { unknown: true }, "PATCH");
  await invalid(`/admin/tests/${id}`, {}, "PATCH");
});

test("valid boundary values pass schemas and still require administrator authentication", async () => {
  for (const payload of [{ maxAttempts: 1, passScore: 0, showCorrectAnswers: false },
    { maxAttempts: null, passScore: 100, showCorrectAnswers: true }, { maxAttempts: 2147483647 }]) {
    const response = await app.inject({ method: "PATCH", url: `/admin/tests/${id}`, payload });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "not_authenticated" });
  }
  for (const timezone of ["UTC", "Europe/Moscow", "America/New_York", "Etc/GMT+3"]) {
    const response = await app.inject({ method: "POST", url: "/admin/users",
      payload: { fullName: "Иван Иванов", email: "ivan@example.test", departmentId: null, timezone } });
    assert.equal(response.statusCode, 401);
  }
});

test("real nested editor and attachment schemas reject invalid params, query and payload", async () => {
  await invalid("/admin/tests", { scope: "course", parentId: id });
  await invalid("/admin/tests", { scope: "lesson", parentId: "bad" });
  for (const text of ["", " \n", 42, null, "x".repeat(10001), "x\u0000y"]) {
    await invalid(`/admin/tests/${id}/questions`, { text });
    await invalid(`/admin/questions/${id}/answers`, { text });
  }
  await invalid(`/admin/questions/${id}`, { multiple: "false" }, "PATCH");
  await invalid(`/admin/answers/${id}`, { isCorrect: "false" }, "PATCH");
  await invalid("/admin/users/bad", { isActive: true }, "PATCH");
  for (const url of ["/admin/tests/bad", "/admin/questions/bad", "/admin/answers/bad", "/admin/attachments/bad"]) {
    await invalid(url, undefined, "DELETE");
  }
  await invalid(`/admin/tests/${id}?unknown=SECRET`, undefined, "GET");
  const attachment = await app.inject({ url: "/attachments/bad/download" });
  assert.equal(attachment.statusCode, 400);
  const upload = await app.inject({ method: "POST", url: "/admin/lessons/bad/attachments" });
  assert.deepEqual(upload.json(), { error: "invalid_lesson_id" });
});

test("parser/media errors are stable and cannot echo private request content", async () => {
  for (const [type, payload, status] of [["application/json", '{"SECRET":', 400],
    ["text/plain", "SECRET", 400], ["application/unsupported", "SECRET", 415]]) {
    const response = await app.inject({ method: "PATCH", url: `/admin/tests/${id}`,
      headers: { "content-type": type }, payload });
    assert.equal(response.statusCode, status);
    assert.ok(!response.body.includes("SECRET"));
  }
});

test("root error handler maps known failures and sanitizes unexpected messages, paths and log data", async () => {
  logs.length = 0;
  for (const [headers, status, error] of [[{}, 500, "internal_error"],
    [{ "x-code": "23503" }, 409, "invalid_reference"], [{ "x-code": "22P02" }, 400, "invalid_request"],
    [{ "x-code": "23505" }, 409, "conflict"], [{ "x-code": "__proto__" }, 500, "internal_error"],
    [{ "x-status": "413" }, 413, "payload_too_large"]]) {
    const response = await app.inject({ url: "/fault", headers });
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error });
    assert.equal(response.headers["referrer-policy"], "no-referrer");
  }
  assert.ok(!logs.join("").includes("SECRET"));
  assert.ok(!logs.join("").includes("/srv/private"));
});

test("response DTO drops credential and future internal columns", async () => {
  const response = await app.inject({ url: "/dto" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.id, id);
  assert.equal(response.json().user.email, null);
  assert.ok(!response.body.includes("SECRET"));
  assert.equal(response.json().user.password_hash, undefined);
  assert.equal(response.json().user.internal_future_column, undefined);
});
