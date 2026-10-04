import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";

export async function adminCourseRoutes(app: FastifyInstance) {
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
    async (req, reply) => {
      if (!req.body?.title) {
        reply.code(400);
        return { error: "title_required" };
      }
      const posRes = await pool.query(
        `select coalesce(max(position), -1) + 1 as next from modules where course_id = $1`,
        [req.params.courseId]
      );
      const res = await pool.query(
        `insert into modules (course_id, title, position) values ($1, $2, $3)
         returning *`,
        [req.params.courseId, req.body.title, posRes.rows[0].next]
      );
      reply.code(201);
      return { module: res.rows[0] };
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
    async (req) => {
      await reorder("modules", req.body.orderedIds);
      return { ok: true };
    }
  );

  // --- Уроки ---

  app.post<{
    Params: { moduleId: string };
    Body: { title: string; textContent?: string; videoProvider?: string; videoRef?: string };
  }>("/admin/modules/:moduleId/lessons", async (req, reply) => {
    if (!req.body?.title) {
      reply.code(400);
      return { error: "title_required" };
    }
    const posRes = await pool.query(
      `select coalesce(max(position), -1) + 1 as next from lessons where module_id = $1`,
      [req.params.moduleId]
    );
    const { title, textContent, videoProvider, videoRef } = req.body;
    const res = await pool.query(
      `insert into lessons (module_id, title, position, text_content, video_provider, video_ref)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [req.params.moduleId, title, posRes.rows[0].next, textContent ?? null, videoProvider ?? null, videoRef ?? null]
    );
    reply.code(201);
    return { lesson: res.rows[0] };
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
    async (req) => {
      await reorder("lessons", req.body.orderedIds);
      return { ok: true };
    }
  );
}

// Проставить position = индекс в массиве orderedIds для указанной таблицы
async function reorder(table: "modules" | "lessons", orderedIds: string[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`update ${table} set position = $2 where id = $1`, [orderedIds[i], i]);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
