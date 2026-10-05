import { pool } from "./db.js";
import type { PublicUser } from "./auth/service.js";

export type AccessResult = { ok: true } | { ok: false; reason: "not_found" | "deadline_passed" | "not_enrolled" | "not_assigned" };

// Админ видит всё. Сотрудник — только курсы, которые ему назначены (и срок
// ещё не истёк), либо курсы открытого каталога, на которые он уже записался.
export async function checkCourseAccess(user: PublicUser, courseId: string): Promise<AccessResult> {
  if (user.role === "admin") return { ok: true };

  const courseRes = await pool.query(`select * from courses where id = $1`, [courseId]);
  const course = courseRes.rows[0];
  if (!course || course.status === "archived") return { ok: false, reason: "not_found" };

  const assignRes = await pool.query(
    `select * from assignments where user_id = $1 and course_id = $2`,
    [user.id, courseId]
  );
  const assignment = assignRes.rows[0];

  if (assignment) {
    if (assignment.status === "overdue") return { ok: false, reason: "deadline_passed" };
    return { ok: true };
  }

  if (course.visibility === "open_catalog" && course.status === "published") {
    return { ok: false, reason: "not_enrolled" };
  }
  return { ok: false, reason: "not_assigned" };
}

// Найти курс, которому принадлежит урок (через его модуль) — нужно, чтобы
// проверить доступ при открытии урока или скачивании вложения.
export async function getCourseIdForLesson(lessonId: string): Promise<string | null> {
  const res = await pool.query(
    `select m.course_id from lessons l join modules m on m.id = l.module_id where l.id = $1`,
    [lessonId]
  );
  return res.rows[0]?.course_id ?? null;
}

// Тест привязан либо к модулю, либо к уроку (tests.scope) — курс находим
// в зависимости от того, к чему именно он привязан.
export async function getCourseIdForTest(testId: string): Promise<string | null> {
  const testRes = await pool.query(`select scope, parent_id from tests where id = $1`, [testId]);
  const test = testRes.rows[0];
  if (!test) return null;

  if (test.scope === "module") {
    const res = await pool.query(`select course_id from modules where id = $1`, [test.parent_id]);
    return res.rows[0]?.course_id ?? null;
  }

  const res = await pool.query(
    `select m.course_id from lessons l join modules m on m.id = l.module_id where l.id = $1`,
    [test.parent_id]
  );
  return res.rows[0]?.course_id ?? null;
}

export async function getCourseIdForAttachment(attachmentId: string): Promise<string | null> {
  const res = await pool.query(
    `select m.course_id
     from lesson_attachments la
     join lessons l on l.id = la.lesson_id
     join modules m on m.id = l.module_id
     where la.id = $1`,
    [attachmentId]
  );
  return res.rows[0]?.course_id ?? null;
}
