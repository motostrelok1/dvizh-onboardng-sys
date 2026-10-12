import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { installApiValidation, schema, object, text, uuid, idParams } from "../api-validation.js";
import { withTransaction, lockOrderingParent, nextPosition, reorderChildren } from "../data-integrity.js";

const orderIds = { type: "array", items: uuid, uniqueItems: true, maxItems: 10000 };

export async function adminCourseRoutes(app: FastifyInstance) {
  installApiValidation(app);
  app.addHook("preHandler", requireAdmin);

  // --- Курсы ---

  app.get("/admin/courses", async () => {
    const res = await pool.query(
      `select id, title, description, status, visibility, created_at, updated_at
       from courses order by created_at desc`
    );
    return { courses: res.rows };
  });

  app.post<{ Body: { title: string; description?: string } }>("/admin/courses", async (req, reply) => {
    if (!req.body?.title) {
      reply.code(400);
      return { error: "title_required" };
    }
    const res = await pool.query(
      `insert into courses (title, description) values ($1, $2)
       returning id, title, description, status, visibility, created_at, updated_at`,
      [req.body.title, req.body.description ?? null]
    );
    reply.code(201);
    return { course: res.rows[0] };
  });

  app.patch<{
    Params: { id: string };
    Body: { title?: string; description?: string; status?: string; visibility?: string };
  }>("/admin/courses/:id", async (req) => {
    const { title, description, status, visibility } = req.body;
    const res = await pool.query(
      `update courses set
         title = coalesce($2, title),
         description = coalesce($3, description),
         status = coalesce($4, status),
         visibility = coalesce($5, visibility),
         updated_at = now()
       where id = $1
       returning id, title, description, status, visibility, created_at, updated_at`,
      [req.params.id, title, description, status, visibility]
    );
    return { course: res.rows[0] };
  });

  app.delete<{ Params: { id: string } }>("/admin/courses/:id", async (req) => {
    await pool.query(`delete from courses where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // Полное дерево курса: модули → уроки → вложения. Используется редактором курса.
  app.get<{ Params: { id: string } }>("/admin/courses/:id/tree", async (req, reply) => {
    const courseRes = await pool.query(`select * from courses where id = $1`, [req.params.id]);
    const course = courseRes.rows[0];
    if (!course) {
      reply.code(404);
      return { error: "not_found" };
    }

    const modulesRes = await pool.query(
      `select * from modules where course_id = $1 order by position`,
      [req.params.id]
    );
    const modules = modulesRes.rows;

    const lessonsRes = await pool.query(
      `select * from lessons where module_id = any($1) order by position`,
      [modules.map((m) => m.id)]
    );
    const lessons = lessonsRes.rows;

    const attachmentsRes = await pool.query(
      `select * from lesson_attachments where lesson_id = any($1) order by position`,
      [lessons.map((l) => l.id)]
    );
    const attachments = attachmentsRes.rows;

    // Тесты, привязанные к модулям или к урокам этого курса (не более одного на каждый)
    const testsRes = await pool.query(
      `select * from tests where parent_id = any($1)`,
      [[...modules.map((m) => m.id), ...lessons.map((l) => l.id)]]
    );
    const testByParent = new Map(testsRes.rows.map((t) => [t.parent_id, t]));

    const tree = modules.map((m) => ({
      ...m,
      test: testByParent.get(m.id) ?? null,
      lessons: lessons
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          ...l,
          attachments: attachments.filter((a) => a.lesson_id === l.id),
          test: testByParent.get(l.id) ?? null
        }))
    }));

    return { course, modules: tree };
  });

  // --- Модули ---

  app.post<{ Params: { courseId: string }; Body: { title: string } }>(
    "/admin/courses/:courseId/modules",
    { schema: schema(object({ title: text(1000) }, ["title"]), idParams("courseId")) },
    async (req, reply) => {
      if (!req.body?.title) {
        reply.code(400);
        return { error: "title_required" };
      }
      const module = await withTransaction(async client => {
        await lockOrderingParent(client, "modules", req.params.courseId);
        const position = await nextPosition(client, "modules", req.params.courseId);
        return (await client.query(`insert into modules (course_id, title, position)
          values ($1, $2, $3) returning *`, [req.params.courseId, req.body.title, position])).rows[0];
      });
      reply.code(201);
      return { module };
    }
  );

  app.patch<{ Params: { id: string }; Body: { title: string } }>("/admin/modules/:id", async (req) => {
    const res = await pool.query(`update modules set title = $2 where id = $1 returning *`, [
      req.params.id,
      req.body.title
    ]);
    return { module: res.rows[0] };
  });

  app.delete<{ Params: { id: string } }>("/admin/modules/:id", async (req) => {
    await pool.query(`delete from modules where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // Переставить модули курса в указанном порядке
  app.post<{ Body: { courseId: string; orderedIds: string[] } }>(
    "/admin/modules/reorder",
    { schema: schema(object({ courseId: uuid, orderedIds: orderIds }, ["courseId", "orderedIds"])) },
    async (req) => {
      await reorderChildren("modules", req.body.courseId, req.body.orderedIds);
      return { ok: true };
    }
  );

  // --- Уроки ---

  app.post<{
    Params: { moduleId: string };
    Body: { title: string; textContent?: string | null; videoProvider?: string | null; videoRef?: string | null };
  }>("/admin/modules/:moduleId/lessons", { schema: schema(object({ title: text(1000),
    textContent: { type: "string", nullable: true }, videoProvider: { type: "string", nullable: true },
    videoRef: { type: "string", nullable: true } }, ["title"]), idParams("moduleId")) }, async (req, reply) => {
    if (!req.body?.title) {
      reply.code(400);
      return { error: "title_required" };
    }
    const { title, textContent, videoProvider, videoRef } = req.body;
    const lesson = await withTransaction(async client => {
      await lockOrderingParent(client, "lessons", req.params.moduleId);
      const position = await nextPosition(client, "lessons", req.params.moduleId);
      return (await client.query(`insert into lessons (module_id, title, position, text_content, video_provider, video_ref)
        values ($1, $2, $3, $4, $5, $6) returning *`,
        [req.params.moduleId, title, position, textContent ?? null, videoProvider ?? null, videoRef ?? null])).rows[0];
    });
    reply.code(201);
    return { lesson };
  });

  app.patch<{
    Params: { id: string };
    Body: { title?: string; textContent?: string; videoProvider?: string; videoRef?: string };
  }>("/admin/lessons/:id", async (req) => {
    const { title, textContent, videoProvider, videoRef } = req.body;
    const res = await pool.query(
      `update lessons set
         title = coalesce($2, title),
         text_content = coalesce($3, text_content),
         video_provider = coalesce($4, video_provider),
         video_ref = coalesce($5, video_ref)
       where id = $1
       returning *`,
      [req.params.id, title, textContent, videoProvider, videoRef]
    );
    return { lesson: res.rows[0] };
  });

  app.delete<{ Params: { id: string } }>("/admin/lessons/:id", async (req) => {
    await pool.query(`delete from lessons where id = $1`, [req.params.id]);
    return { ok: true };
  });

  app.post<{ Body: { moduleId: string; orderedIds: string[] } }>(
    "/admin/lessons/reorder",
    { schema: schema(object({ moduleId: uuid, orderedIds: orderIds }, ["moduleId", "orderedIds"])) },
    async (req) => {
      await reorderChildren("lessons", req.body.moduleId, req.body.orderedIds);
      return { ok: true };
    }
  );
}
