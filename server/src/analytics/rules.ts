import { pool } from "../db.js";
import { getEffectiveSettings } from "./settings.js";
import { getCourseIdForLesson, getCourseIdForTest } from "../access.js";
import { getCourseProgress } from "../progress.js";

export type Flag = {
  rule: "skipped_lesson" | "needs_help" | "guessing" | "stuck" | "deadline_risk";
  message: string;
  courseId: string | null;
  courseTitle?: string;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// «Пролистал, не читая»: суммарное время сотрудника на уроке сильно ниже
// медианы по этому уроку среди всех, кто его смотрел.
async function skippedLessonFlags(userId: string): Promise<Flag[]> {
  const res = await pool.query(
    `select entity_id as lesson_id, user_id, sum((payload->>'durationMs')::bigint) as total_ms
     from events where event_type = 'lesson_view_end' and entity_id is not null
     group by entity_id, user_id`
  );
  const byLesson = new Map<string, { userId: string; ms: number }[]>();
  for (const r of res.rows) {
    const arr = byLesson.get(r.lesson_id) ?? [];
    arr.push({ userId: r.user_id, ms: Number(r.total_ms) });
    byLesson.set(r.lesson_id, arr);
  }

  const flags: Flag[] = [];
  for (const [lessonId, rows] of byLesson) {
    const mine = rows.find((r) => r.userId === userId);
    if (!mine || rows.length < 2) continue; // нужна медиана хотя бы по паре человек

    const courseId = await getCourseIdForLesson(lessonId);
    const settings = await getEffectiveSettings(courseId);
    if (!settings["skipped_lesson.enabled"]) continue;

    const med = median(rows.map((r) => r.ms));
    const threshold = (med * Number(settings["skipped_lesson.max_percent_of_median"])) / 100;
    if (mine.ms < threshold) {
      const lessonRes = await pool.query(`select title from lessons where id = $1`, [lessonId]);
      flags.push({
        rule: "skipped_lesson",
        message: `Возможно пролистал урок «${lessonRes.rows[0]?.title ?? lessonId}», не читая`,
        courseId
      });
    }
  }
  return flags;
}

// «Нужна помощь»: N последних завершённых попыток подряд без роста балла.
async function needsHelpFlags(userId: string): Promise<Flag[]> {
  const res = await pool.query(
    `select test_id, attempt_number, score from test_attempts
     where user_id = $1 and status = 'finished' order by test_id, attempt_number`,
    [userId]
  );
  const byTest = new Map<string, number[]>();
  for (const r of res.rows) {
    const arr = byTest.get(r.test_id) ?? [];
    arr.push(r.score);
    byTest.set(r.test_id, arr);
  }

  const flags: Flag[] = [];
  for (const [testId, scores] of byTest) {
    const courseId = await getCourseIdForTest(testId);
    const settings = await getEffectiveSettings(courseId);
    if (!settings["needs_help.enabled"]) continue;

    const n = Number(settings["needs_help.attempts_without_improvement"]);
    if (scores.length < n) continue;
    const last = scores.slice(-n);
    const noImprovement = last.every((s, i) => i === 0 || s <= last[i - 1]);
    if (noImprovement) {
      flags.push({
        rule: "needs_help",
        message: `${n} попытки теста подряд без роста результата — возможно, нужна помощь`,
        courseId
      });
    }
  }
  return flags;
}

// «Угадывание»: мало времени в среднем на вопрос и результат ниже проходного.
async function guessingFlags(userId: string): Promise<Flag[]> {
  const res = await pool.query(
    `select ta.*, t.pass_score,
            extract(epoch from (ta.finished_at - ta.started_at)) as seconds,
            (select count(*) from questions where test_id = ta.test_id) as question_count
     from test_attempts ta join tests t on t.id = ta.test_id
     where ta.user_id = $1 and ta.status = 'finished'`,
    [userId]
  );

  const flags: Flag[] = [];
  for (const a of res.rows) {
    if (a.question_count === 0) continue;
    const courseId = await getCourseIdForTest(a.test_id);
    const settings = await getEffectiveSettings(courseId);
    if (!settings["guessing.enabled"]) continue;

    const avgSeconds = Number(a.seconds) / Number(a.question_count);
    if (avgSeconds < Number(settings["guessing.max_seconds_per_question"]) && a.score < a.pass_score) {
      flags.push({
        rule: "guessing",
        message: `Похоже на угадывание: в среднем ${avgSeconds.toFixed(1)} с на вопрос, результат ${a.score}%`,
        courseId
      });
    }
  }
  return flags;
}

// «Застрял / не начал»: нет активности по курсу N дней, курс ещё не завершён.
async function stuckFlags(userId: string): Promise<Flag[]> {
  const res = await pool.query(
    `select a.id, a.course_id, a.assigned_at, c.title as course_title
     from assignments a join courses c on c.id = a.course_id
     where a.user_id = $1 and a.status in ('assigned', 'in_progress')`,
    [userId]
  );

  const flags: Flag[] = [];
  for (const a of res.rows) {
    const settings = await getEffectiveSettings(a.course_id);
    if (!settings["stuck.enabled"]) continue;

    const lastActivityRes = await pool.query(
      `select max(e.occurred_at) as last from events e
       left join lessons l on l.id = e.entity_id and e.event_type like 'lesson_view%'
       left join modules lm on lm.id = l.module_id
       left join tests t on t.id = e.entity_id and e.event_type like 'test_attempt%'
       left join modules tm on tm.id = t.parent_id and t.scope = 'module'
       where e.user_id = $1 and (lm.course_id = $2 or tm.course_id = $2)`,
      [userId, a.course_id]
    );
    const lastActivity = lastActivityRes.rows[0].last ? new Date(lastActivityRes.rows[0].last) : new Date(a.assigned_at);
    const daysInactive = (Date.now() - lastActivity.getTime()) / (24 * 60 * 60 * 1000);
    const threshold = Number(settings["stuck.inactive_days"]);

    if (daysInactive >= threshold) {
      flags.push({
        rule: "stuck",
        message:
          lastActivity.getTime() === new Date(a.assigned_at).getTime()
            ? `Не начал курс «${a.course_title}» ${Math.floor(daysInactive)} дн.`
            : `Нет активности по курсу «${a.course_title}» ${Math.floor(daysInactive)} дн.`,
        courseId: a.course_id,
        courseTitle: a.course_title
      });
    }
  }
  return flags;
}

// «Риск просрочки»: дедлайн близко, прогресс низкий.
async function deadlineRiskFlags(userId: string): Promise<Flag[]> {
  const res = await pool.query(
    `select a.id, a.course_id, a.deadline, c.title as course_title
     from assignments a join courses c on c.id = a.course_id
     where a.user_id = $1 and a.status in ('assigned', 'in_progress') and a.deadline is not null`,
    [userId]
  );

  const flags: Flag[] = [];
  for (const a of res.rows) {
    const settings = await getEffectiveSettings(a.course_id);
    if (!settings["deadline_risk.enabled"]) continue;

    const daysLeft = (new Date(a.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysLeft < 0 || daysLeft > Number(settings["deadline_risk.days_before"])) continue;

    const progress = await getCourseProgress(userId, a.course_id);
    if (progress.percent < Number(settings["deadline_risk.max_progress_percent"])) {
      flags.push({
        rule: "deadline_risk",
        message: `Дедлайн по курсу «${a.course_title}» через ${Math.ceil(daysLeft)} дн., прогресс ${progress.percent}%`,
        courseId: a.course_id,
        courseTitle: a.course_title
      });
    }
  }
  return flags;
}

export async function getFlagsForUser(userId: string): Promise<Flag[]> {
  const [a, b, c, d, e] = await Promise.all([
    skippedLessonFlags(userId),
    needsHelpFlags(userId),
    guessingFlags(userId),
    stuckFlags(userId),
    deadlineRiskFlags(userId)
  ]);
  return [...a, ...b, ...c, ...d, ...e];
}

// «Проблемный вопрос» — не привязан к конкретному сотруднику, это свойство
// самого вопроса. Используется отдельно в админке, не в карточке сотрудника.
export type ProblemQuestion = {
  questionId: string;
  text: string;
  testId: string;
  courseId: string | null;
  courseTitle: string | null;
  totalAnswers: number;
  correctPercent: number;
};

export async function getProblemQuestions(): Promise<ProblemQuestion[]> {
  const res = await pool.query(
    `select q.id as question_id, q.text, t.id as test_id,
            count(*)::int as total, count(*) filter (where aa.is_correct)::int as correct
     from attempt_answers aa
     join questions q on q.id = aa.question_id
     join tests t on t.id = q.test_id
     group by q.id, q.text, t.id`
  );

  const result: ProblemQuestion[] = [];
  for (const r of res.rows) {
    const courseId = await getCourseIdForTest(r.test_id);
    const settings = await getEffectiveSettings(courseId);
    if (!settings["problem_question.enabled"]) continue;
    if (r.total < Number(settings["problem_question.min_answers"])) continue;

    const correctPercent = Math.round((r.correct / r.total) * 100);
    if (correctPercent < Number(settings["problem_question.min_correct_percent"])) {
      const courseRes = courseId ? await pool.query(`select title from courses where id = $1`, [courseId]) : null;
      result.push({
        questionId: r.question_id,
        text: r.text,
        testId: r.test_id,
        courseId,
        courseTitle: courseRes?.rows[0]?.title ?? null,
        totalAnswers: r.total,
        correctPercent
      });
    }
  }
  return result;
}
