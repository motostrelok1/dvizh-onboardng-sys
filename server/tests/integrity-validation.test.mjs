import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

const { pool } = await import("../src/db.ts");
await pool.end(); // These requests must never need a database connection.
const { adminCourseRoutes } = await import("../src/routes/admin-courses.ts");
const { adminAssignmentRoutes } = await import("../src/routes/admin-assignments.ts");
const id = "b8d2a18a-8c3e-4e09-a12c-d1a5c201d001";
const app = Fastify();
before(async () => {
  await app.register(cookie);
  await app.register(adminCourseRoutes);
  await app.register(adminAssignmentRoutes);
  await app.ready();
});
after(() => app.close());

test("ordered create/reorder and assignment schemas reject malformed IDs, arrays and coerced input before SQL", async () => {
  for (const [url, payload] of [["/admin/courses/bad/modules", { title: "Module" }],
    [`/admin/courses/${id}/modules`, { title: " " }], [`/admin/modules/${id}/lessons`, { title: 4 }],
    ["/admin/modules/reorder", { courseId: id, orderedIds: [id, id] }],
    ["/admin/modules/reorder", { courseId: id, orderedIds: "bad" }],
    ["/admin/lessons/reorder", { moduleId: id, orderedIds: ["bad"] }],
    ["/admin/lessons/reorder", { moduleId: id }],
    ["/admin/assignments", { courseId: id, targetType: "all", targetId: id }],
    ["/admin/assignments", { courseId: "bad", targetType: "user", targetId: id }],
    ["/admin/assignments", { courseId: id, targetType: "user", targetId: id, isRequired: "false" }],
    ["/admin/assignments", { courseId: id, targetType: "user", targetId: id, deadline: false }],
    ["/admin/assignments", { courseId: id, targetType: "user", targetId: id, userIds: [id] }]]) {
    const response = await app.inject({ method: "POST", url, payload });
    assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
    assert.deepEqual(response.json(), { error: "invalid_request" });
  }
});

test("valid ordering and bulk assignment input still requires administrator authentication", async () => {
  for (const [url, payload] of [[`/admin/courses/${id}/modules`, { title: "Module" }],
    [`/admin/modules/${id}/lessons`, { title: "Lesson", videoProvider: null, textContent: "" }],
    ["/admin/modules/reorder", { courseId: id, orderedIds: [] }],
    ["/admin/lessons/reorder", { moduleId: id, orderedIds: [id] }],
    ["/admin/assignments", { courseId: id, targetType: "group", targetId: id, isRequired: false, deadline: null }]]) {
    const response = await app.inject({ method: "POST", url, payload });
    assert.equal(response.statusCode, 401, response.body);
    assert.deepEqual(response.json(), { error: "not_authenticated" });
  }
});
