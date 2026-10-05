import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { checkCourseAccess, getCourseIdForTest } from "../access.js";
import { logEvent } from "../events.js";

export async function testAttemptRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Проверить доступ к курсу, которому принадлежит тест. Общая часть для
  // всех трёх маршрутов ниже.
  async function requireTestAccess(req: any, reply: any, testId: string) {
    const courseId = await getCourseIdForTest(testId);
    if (!courseId) {
      reply.code(404).send({ error: "not_found" });
      return null;
    }
    const access = await checkCourseAccess(req.currentUser, courseId);
    if (!access.ok) {
      reply.code(403).send({ error: access.reason });
      return null;
    }
    return courseId;
  }

  // Мои попытки по этому тесту — чтобы клиент знал, сколько осталось и был
  // ли тест уже сдан.
  app.get<{ Params: { testId: string } }>("/tests/:testId/attempts", async (req, reply) => {
    const ok = await requireTestAccess(req, reply, req.params.testId);
    if (!ok) return;

    const res = await pool.query(
      `select id, attempt_number, status, started_at, finished_at, score, passed
       from test_attempts where test_id = $1 and user_id = $2 order by attempt_number`,
      [req.params.testId, req.currentUser!.id]
    );
    return { attempts: res.rows };
  });

  // Начать новую попытку: проверить лимит, отдать вопросы без correct-флагов.
  app.post<{ Params: { testId: string } }>("/tests/:testId/attempts", async (req, reply) => {
    const ok = await requireTestAccess(req, reply, req.params.testId);
    if (!ok) return;

    const testRes = await pool.query(`select * from tests where id = $1`, [req.params.testId]);
    const test = testRes.rows[0];
    if (!test) {
      reply.code(404);
      return { error: "not_found" };
    }

    const countRes = await pool.query(
      `select count(*)::int as n from test_attempts where test_id = $1 and user_id = $2`,
      [req.params.testId, req.currentUser!.id]
    );
    const attemptsUsed = countRes.rows[0].n;
    if (test.max_attempts !== null && attemptsUsed >= test.max_attempts) {
      reply.code(409);
      return { error: "no_attempts_left", attemptsUsed, maxAttempts: test.max_attempts };
    }

    // Если прошлая попытка осталась незавершённой — продолжаем её, а не
    // плодим новые при повторных заходах на экран теста.
    const openRes = await pool.query(
      `select * from test_attempts where test_id = $1 and user_id = $2 and status = 'in_progress'`,
      [req.params.testId, req.currentUser!.id]
    );
    let attempt = openRes.rows[0];
    if (!attempt) {
      const insertRes = await pool.query(
        `insert into test_attempts (test_id, user_id, attempt_number) values ($1, $2, $3) returning *`,
        [req.params.testId, req.currentUser!.id, attemptsUsed + 1]
      );
      attempt = insertRes.rows[0];
      await logEvent(req.currentUser!.id, "test_attempt_start", {
        entityType: "test",
        entityId: req.params.testId,
        payload: { attemptId: attempt.id, attemptNumber: attempt.attempt_number }
      });
    }

    const questionsRes = await pool.query(
      `select id, text, position, multiple from questions where test_id = $1 order by position`,
      [req.params.testId]
    );
    const questions = questionsRes.rows;

    const answersRes = await pool.query(
      `select id, question_id, text from answers where question_id = any($1)`,
      [questions.map((q) => q.id)]
    );
    const answers = answersRes.rows;

    // Уже выбранные варианты в этой попытке (если сотрудник вернулся на экран)
    const givenRes = await pool.query(
      `select question_id, selected_answer_ids from attempt_answers where attempt_id = $1`,
      [attempt.id]
    );
    const givenByQuestion = new Map(givenRes.rows.map((r) => [r.question_id, r.selected_answer_ids]));

    reply.code(201);
    return {
      attempt,
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        multiple: q.multiple,
        answers: answers.filter((a) => a.question_id === q.id).map((a) => ({ id: a.id, text: a.text })),
        selectedAnswerIds: givenByQuestion.get(q.id) ?? []
      }))
    };
  });

  // Сохранить ответ на один вопрос. Правильность не возвращается —
  // сотрудник не должен узнавать её до завершения попытки.
  app.post<{ Params: { attemptId: string }; Body: { questionId: string; selectedAnswerIds: string[] } }>(
    "/attempts/:attemptId/answers",
    async (req, reply) => {
      const attemptRes = await pool.query(`select * from test_attempts where id = $1`, [req.params.attemptId]);
      const attempt = attemptRes.rows[0];
      if (!attempt || attempt.user_id !== req.currentUser!.id) {
        reply.code(404);
        return { error: "not_found" };
      }
      if (attempt.status !== "in_progress") {
        reply.code(409);
        return { error: "attempt_already_finished" };
      }

      const { questionId, selectedAnswerIds } = req.body;
      const correctRes = await pool.query(
        `select id from answers where question_id = $1 and is_correct = true`,
        [questionId]
      );
      const correctIds = new Set(correctRes.rows.map((r) => r.id));
      const selectedSet = new Set(selectedAnswerIds);
      const isCorrect =
        correctIds.size === selectedSet.size && [...correctIds].every((id) => selectedSet.has(id));

      await pool.query(
        `insert into attempt_answers (attempt_id, question_id, selected_answer_ids, is_correct)
         values ($1, $2, $3, $4)
         on conflict (attempt_id, question_id) do update set
           selected_answer_ids = excluded.selected_answer_ids,
           is_correct = excluded.is_correct,
           answered_at = now()`,
        [req.params.attemptId, questionId, selectedAnswerIds, isCorrect]
      );

      await logEvent(req.currentUser!.id, "question_answered", {
        entityType: "question",
        entityId: questionId,
        payload: { attemptId: req.params.attemptId, isCorrect, selectedAnswerIds }
      });

      return { ok: true };
    }
  );

  // Завершить попытку: посчитать балл, сравнить с проходным, по настройке
  // теста решить, показывать ли разбор по каждому вопросу.
  app.post<{ Params: { attemptId: string } }>("/attempts/:attemptId/finish", async (req, reply) => {
    const attemptRes = await pool.query(`select * from test_attempts where id = $1`, [req.params.attemptId]);
    const attempt = attemptRes.rows[0];
    if (!attempt || attempt.user_id !== req.currentUser!.id) {
      reply.code(404);
      return { error: "not_found" };
    }
    if (attempt.status !== "in_progress") {
      reply.code(409);
      return { error: "attempt_already_finished" };
    }

    const testRes = await pool.query(`select * from tests where id = $1`, [attempt.test_id]);
    const test = testRes.rows[0];

    const totalRes = await pool.query(`select count(*)::int as n from questions where test_id = $1`, [
      attempt.test_id
    ]);
    const total = totalRes.rows[0].n;

    const correctCountRes = await pool.query(
      `select count(*)::int as n from attempt_answers where attempt_id = $1 and is_correct = true`,
      [req.params.attemptId]
    );
    const correctCount = correctCountRes.rows[0].n;

    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed = score >= test.pass_score;

    await pool.query(
      `update test_attempts set status = 'finished', finished_at = now(), score = $2, passed = $3
       where id = $1`,
      [req.params.attemptId, score, passed]
    );

    await logEvent(req.currentUser!.id, "test_attempt_end", {
      entityType: "test",
      entityId: attempt.test_id,
      payload: { attemptId: attempt.id, score, passed }
    });

    const result: any = { score, passed, passScore: test.pass_score };

    if (test.show_correct_answers) {
      const questionsRes = await pool.query(
        `select id, text from questions where test_id = $1 order by position`,
        [attempt.test_id]
      );
      const answersRes = await pool.query(
        `select id, question_id, text, is_correct from answers where question_id = any($1)`,
        [questionsRes.rows.map((q) => q.id)]
      );
      const givenRes = await pool.query(
        `select question_id, selected_answer_ids, is_correct from attempt_answers where attempt_id = $1`,
        [req.params.attemptId]
      );
      const givenByQuestion = new Map(givenRes.rows.map((r) => [r.question_id, r]));

      result.review = questionsRes.rows.map((q) => {
        const given = givenByQuestion.get(q.id);
        return {
          questionId: q.id,
          text: q.text,
          yourCorrect: given?.is_correct ?? false,
          answers: answersRes.rows
            .filter((a) => a.question_id === q.id)
            .map((a) => ({
              id: a.id,
              text: a.text,
              isCorrect: a.is_correct,
              wasSelected: given?.selected_answer_ids?.includes(a.id) ?? false
            }))
        };
      });
    }

    return result;
  });
}
