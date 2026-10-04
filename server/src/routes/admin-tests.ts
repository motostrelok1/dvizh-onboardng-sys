import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";

export async function adminTestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  // --- Тесты ---

  app.post<{
    Body: { scope: "module" | "lesson"; parentId: string };
  }>("/admin/tests", async (req, reply) => {
    const { scope, parentId } = req.body;
    if (scope !== "module" && scope !== "lesson") {
      reply.code(400);
      return { error: "invalid_scope" };
    }
    if (!parentId) {
      reply.code(400);
      return { error: "parent_id_required" };
    }

    const existing = await pool.query(
      `select id from tests where scope = $1 and parent_id = $2`,
      [scope, parentId]
    );
    if (existing.rows[0]) {
      reply.code(409);
      return { error: "test_already_exists", testId: existing.rows[0].id };
    }

    const res = await pool.query(
      `insert into tests (scope, parent_id) values ($1, $2) returning *`,
      [scope, parentId]
    );
    reply.code(201);
    return { test: res.rows[0] };
  });

  app.get<{ Params: { id: string } }>("/admin/tests/:id", async (req, reply) => {
    const testRes = await pool.query(`select * from tests where id = $1`, [req.params.id]);
    const test = testRes.rows[0];
    if (!test) {
      reply.code(404);
      return { error: "not_found" };
    }

    const questionsRes = await pool.query(
      `select * from questions where test_id = $1 order by position`,
      [req.params.id]
    );
    const questions = questionsRes.rows;

    const answersRes = await pool.query(
      `select * from answers where question_id = any($1)`,
      [questions.map((q) => q.id)]
    );
    const answers = answersRes.rows;

    return {
      test,
      questions: questions.map((q) => ({
        ...q,
        answers: answers.filter((a) => a.question_id === q.id)
      }))
    };
  });

  app.patch<{
    Params: { id: string };
    Body: { maxAttempts?: number | null; showCorrectAnswers?: boolean; passScore?: number };
  }>("/admin/tests/:id", async (req) => {
    const { maxAttempts, showCorrectAnswers, passScore } = req.body;
    const res = await pool.query(
      `update tests set
         max_attempts = $2,
         show_correct_answers = coalesce($3, show_correct_answers),
         pass_score = coalesce($4, pass_score)
       where id = $1
       returning *`,
      [req.params.id, maxAttempts === undefined ? null : maxAttempts, showCorrectAnswers, passScore]
    );
    return { test: res.rows[0] };
  });

  app.delete<{ Params: { id: string } }>("/admin/tests/:id", async (req) => {
    await pool.query(`delete from tests where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // --- Вопросы ---

  app.post<{ Params: { testId: string }; Body: { text: string; multiple?: boolean } }>(
    "/admin/tests/:testId/questions",
    async (req, reply) => {
      if (!req.body?.text) {
        reply.code(400);
        return { error: "text_required" };
      }
      const posRes = await pool.query(
        `select coalesce(max(position), -1) + 1 as next from questions where test_id = $1`,
        [req.params.testId]
      );
      const res = await pool.query(
        `insert into questions (test_id, text, position, multiple) values ($1, $2, $3, $4)
         returning *`,
        [req.params.testId, req.body.text, posRes.rows[0].next, req.body.multiple ?? false]
      );
      reply.code(201);
      return { question: { ...res.rows[0], answers: [] } };
    }
  );

  app.patch<{ Params: { id: string }; Body: { text?: string; multiple?: boolean } }>(
    "/admin/questions/:id",
    async (req) => {
      const { text, multiple } = req.body;
      const res = await pool.query(
        `update questions set text = coalesce($2, text), multiple = coalesce($3, multiple)
         where id = $1 returning *`,
        [req.params.id, text, multiple]
      );
      return { question: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/questions/:id", async (req) => {
    await pool.query(`delete from questions where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // --- Варианты ответов ---

  app.post<{ Params: { questionId: string }; Body: { text: string; isCorrect?: boolean } }>(
    "/admin/questions/:questionId/answers",
    async (req, reply) => {
      if (!req.body?.text) {
        reply.code(400);
        return { error: "text_required" };
      }
      const res = await pool.query(
        `insert into answers (question_id, text, is_correct) values ($1, $2, $3) returning *`,
        [req.params.questionId, req.body.text, req.body.isCorrect ?? false]
      );
      reply.code(201);
      return { answer: res.rows[0] };
    }
  );

  app.patch<{ Params: { id: string }; Body: { text?: string; isCorrect?: boolean } }>(
    "/admin/answers/:id",
    async (req) => {
      const { text, isCorrect } = req.body;
      const res = await pool.query(
        `update answers set text = coalesce($2, text), is_correct = coalesce($3, is_correct)
         where id = $1 returning *`,
        [req.params.id, text, isCorrect]
      );
      return { answer: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/answers/:id", async (req) => {
    await pool.query(`delete from answers where id = $1`, [req.params.id]);
    return { ok: true };
  });
}
