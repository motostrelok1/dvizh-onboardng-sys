import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { checkCourseAccess } from "../access.js";

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Назначенные курсы + открытый каталог (для самозаписи), без уже назначенных.
  // Прогресс в процентах появится в этапе 9 на основе журнала событий (этап 8);
  // пока отдаём статус назначения и дедлайн — это уже осмысленный сигнал.
  app.get("/me/courses", async (req) => {
    const userId = req.currentUser!.id;

    const assignedRes = await pool.query(
      `select a.id as assignment_id, a.status, a.deadline, a.is_required,
              c.id as course_id, c.title, c.description
       from assignments a
       join courses c on c.id = a.course_id
       where a.user_id = $1 and c.status != 'archived'
       order by a.assigned_at desc`,
      [userId]
    );

    const catalogRes = await pool.query(
      `select c.id as course_id, c.title, c.description
       from courses c
       where c.visibility = 'open_catalog' and c.status = 'published'
         and c.id not in (select course_id from assignments where user_id = $1)
       order by c.title`,
      [userId]
    );

    return { assigned: assignedRes.rows, catalog: catalogRes.rows };
  });

  // Самозапись на курс из открытого каталога
  app.post<{ Params: { id: string } }>("/courses/:id/enroll", async (req, reply) => {
    const courseRes = await pool.query(`select * from courses where id = $1`, [req.params.id]);
    const course = courseRes.rows[0];
    if (!course || course.visibility !== "open_catalog" || course.status !== "published") {
      reply.code(403);
      return { error: "not_open_for_enrollment" };
    }

    await pool.query(
      `insert into assignments (user_id, course_id, assigned_by, is_required)
       values ($1, $2, $1, false)
       on conflict (user_id, course_id) do nothing`,
      [req.currentUser!.id, req.params.id]
    );
    return { ok: true };
  });

  // Структура курса для кабинета сотрудника: метаданные уроков без контента
  // (сам контент — отдельным запросом GET /lessons/:id, этап 7b) и без вопросов
  // теста (вопросы — при старте попытки, этап 7c).
  app.get<{ Params: { id: string } }>("/me/courses/:id", async (req, reply) => {
    const courseId = req.params.id;
    const userId = req.currentUser!.id;

    const courseRes = await pool.query(`select * from courses where id = $1`, [courseId]);
    const course = courseRes.rows[0];
    if (!course || course.status === "archived") {
      reply.code(404);
      return { error: "not_found" };
    }

    const access = await checkCourseAccess(req.currentUser!, courseId);
    if (!access.ok) {
      reply.code(403);
      return { error: access.reason };
    }

    const assignRes = await pool.query(
      `select * from assignments where user_id = $1 and course_id = $2`,
      [userId, courseId]
    );
    const assignment = assignRes.rows[0] ?? null;

    const modulesRes = await pool.query(
      `select id, title, position from modules where course_id = $1 order by position`,
      [courseId]
    );
    const modules = modulesRes.rows;

    const lessonsRes = await pool.query(
      `select id, module_id, title, position,
              (text_content is not null and text_content != '') as has_text,
              (video_provider is not null) as has_video
       from lessons where module_id = any($1) order by position`,
      [modules.map((m) => m.id)]
    );
    const lessons = lessonsRes.rows;

    const attCountRes = await pool.query(
      `select lesson_id, count(*)::int as count from lesson_attachments
       where lesson_id = any($1) group by lesson_id`,
      [lessons.map((l) => l.id)]
    );
    const attCountByLesson = new Map(attCountRes.rows.map((r) => [r.lesson_id, r.count]));

    const testsRes = await pool.query(
      `select id, scope, parent_id, max_attempts, pass_score from tests where parent_id = any($1)`,
      [[...modules.map((m) => m.id), ...lessons.map((l) => l.id)]]
    );
    const testByParent = new Map(testsRes.rows.map((t) => [t.parent_id, t]));

    const tree = modules.map((m) => ({
      id: m.id,
      title: m.title,
      position: m.position,
      test: testByParent.get(m.id) ?? null,
      lessons: lessons
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: l.id,
          title: l.title,
          position: l.position,
          hasText: l.has_text,
          hasVideo: l.has_video,
          attachmentsCount: attCountByLesson.get(l.id) ?? 0,
          test: testByParent.get(l.id) ?? null
        }))
    }));

    return { course, assignment, modules: tree };
  });

  // Содержимое урока: текст, видео, список вложений (без контента файла —
  // файл отдаётся отдельно через /attachments/:id/download).
  app.get<{ Params: { id: string } }>("/lessons/:id", async (req, reply) => {
    const lessonRes = await pool.query(
      `select l.*, m.course_id from lessons l join modules m on m.id = l.module_id where l.id = $1`,
      [req.params.id]
    );
    const lesson = lessonRes.rows[0];
    if (!lesson) {
      reply.code(404);
      return { error: "not_found" };
    }

    const access = await checkCourseAccess(req.currentUser!, lesson.course_id);
    if (!access.ok) {
      reply.code(403);
      return { error: access.reason };
    }

    const attachmentsRes = await pool.query(
      `select id, file_name, size_bytes from lesson_attachments where lesson_id = $1 order by position`,
      [req.params.id]
    );

    return {
      lesson: {
        id: lesson.id,
        title: lesson.title,
        textContent: lesson.text_content,
        videoProvider: lesson.video_provider,
        videoRef: lesson.video_ref
      },
      attachments: attachmentsRes.rows
    };
  });
}
