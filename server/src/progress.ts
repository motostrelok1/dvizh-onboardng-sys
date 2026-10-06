import { pool } from "./db.js";

// Прогресс считается из журнала событий (этап 8), а не хранится отдельно:
// «пройден» урок = по нему есть хотя бы одно событие lesson_view_start.
// Это грубая метрика (не учитывает тесты и глубину просмотра видео), но она
// честная и не требует отдельного поля, которое могло бы разойтись с логом.

export async function getCourseLessonCount(courseId: string): Promise<number> {
  const res = await pool.query(
    `select count(*)::int as n from lessons l join modules m on m.id = l.module_id where m.course_id = $1`,
    [courseId]
  );
  return res.rows[0].n;
}

export async function getViewedLessonCount(userId: string, courseId: string): Promise<number> {
  const res = await pool.query(
    `select count(distinct e.entity_id)::int as n
     from events e
     join lessons l on l.id = e.entity_id
     join modules m on m.id = l.module_id
     where e.user_id = $1 and e.event_type = 'lesson_view_start' and m.course_id = $2`,
    [userId, courseId]
  );
  return res.rows[0].n;
}

export async function getCourseProgress(userId: string, courseId: string) {
  const [total, viewed] = await Promise.all([
    getCourseLessonCount(courseId),
    getViewedLessonCount(userId, courseId)
  ]);
  const percent = total > 0 ? Math.round((viewed / total) * 100) : 0;
  return { totalLessons: total, viewedLessons: viewed, percent };
}
