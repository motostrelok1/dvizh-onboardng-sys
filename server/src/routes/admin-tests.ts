import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { installApiValidation, schema, object, text, boolean, uuid, idParams,
  testDto, questionDto, answerDto, okDto, success } from "../api-validation.js";
import { IntegrityError, withTransaction, lockOrderingParent, nextPosition } from "../data-integrity.js";

export async function adminTestRoutes(app: FastifyInstance) {
  installApiValidation(app);
  app.addHook("preHandler", requireAdmin);

  // --- Тесты ---

  app.post<{
    Body: { scope: "module" | "lesson"; parentId: string };
  }>("/admin/tests", { schema: schema(object({ scope: { type: "string", enum: ["module", "lesson"] },
    parentId: uuid }, ["scope", "parentId"]), undefined, success({ test: testDto })) }, async (req, reply) => {
    const { scope, parentId } = req.body;
    if (scope !== "module" && scope !== "lesson") {
      reply.code(400);
      return { error: "invalid_scope" };
    }
    if (!parentId) {
      reply.code(400);
      return { error: "parent_id_required" };
    }

    try {
      const test = await withTransaction(async client => {
        const parent = await client.query(`select id from ${scope === "module" ? "modules" : "lessons"}
          where id = $1 for key share`, [parentId]);
        if (!parent.rows[0]) throw new IntegrityError(404);
        return (await client.query(`insert into tests (scope, parent_id) values ($1, $2) returning *`,
          [scope, parentId])).rows[0];
      });
      reply.code(201);
      return { test };
    } catch (error: any) {
      if (error.code === "23505" && error.constraint === "tests_scope_parent_unique") {
        const existing = await pool.query("select id from tests where scope = $1 and parent_id = $2", [scope, parentId]);
        return reply.code(409).send({ error: "test_already_exists", testId: existing.rows[0]?.id });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/admin/tests/:id", { schema: schema(undefined, idParams(),
    success({ test: testDto, questions: { type: "array", items: questionDto } })) }, async (req, reply) => {
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
  }>("/admin/tests/:id", { schema: schema({ ...object({ maxAttempts: { type: "integer", nullable: true,
    minimum: 1, maximum: 2147483647 }, showCorrectAnswers: boolean,
    passScore: { type: "integer", minimum: 0, maximum: 100 } }), minProperties: 1 },
    idParams(), success({ test: testDto })) }, async (req) => {
    const { maxAttempts, showCorrectAnswers, passScore } = req.body;
    const res = await pool.query(
      `update tests set
         max_attempts = case when $5::boolean then $2::integer else max_attempts end,
         show_correct_answers = coalesce($3, show_correct_answers),
         pass_score = coalesce($4, pass_score)
       where id = $1
       returning *`,
      // Missing maxAttempts preserves the limit; explicit null means unlimited.
      [req.params.id, maxAttempts, showCorrectAnswers, passScore, Object.hasOwn(req.body, "maxAttempts")]
    );
    return { test: res.rows[0] };
  });

  app.delete<{ Params: { id: string } }>("/admin/tests/:id", { schema: schema(undefined, idParams(), { "2xx": okDto }) }, async (req) => {
    await pool.query(`delete from tests where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // --- Вопросы ---

  app.post<{ Params: { testId: string }; Body: { text: string; multiple?: boolean } }>(
    "/admin/tests/:testId/questions",
    { schema: schema(object({ text: text(10000), multiple: boolean }, ["text"]),
      idParams("testId"), success({ question: questionDto })) },
    async (req, reply) => {
      if (!req.body?.text) {
        reply.code(400);
        return { error: "text_required" };
      }
      const question = await withTransaction(async client => {
        await lockOrderingParent(client, "questions", req.params.testId);
        const pos = await nextPosition(client, "questions", req.params.testId);
        return (await client.query(`insert into questions (test_id, text, position, multiple)
          values ($1, $2, $3, $4) returning *`,
          [req.params.testId, req.body.text, pos, req.body.multiple ?? false])).rows[0];
      });
      reply.code(201);
      return { question: { ...question, answers: [] } };
    }
  );

  app.patch<{ Params: { id: string }; Body: { text?: string; multiple?: boolean } }>(
    "/admin/questions/:id",
    { schema: schema({ ...object({ text: text(10000), multiple: boolean }), minProperties: 1 },
      idParams(), success({ question: questionDto })) },
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

  app.delete<{ Params: { id: string } }>("/admin/questions/:id", { schema: schema(undefined, idParams(), { "2xx": okDto }) }, async (req) => {
    await pool.query(`delete from questions where id = $1`, [req.params.id]);
    return { ok: true };
  });

  // --- Варианты ответов ---

  app.post<{ Params: { questionId: string }; Body: { text: string; isCorrect?: boolean } }>(
    "/admin/questions/:questionId/answers",
    { schema: schema(object({ text: text(10000), isCorrect: boolean }, ["text"]),
      idParams("questionId"), success({ answer: answerDto })) },
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
    { schema: schema({ ...object({ text: text(10000), isCorrect: boolean }), minProperties: 1 },
      idParams(), success({ answer: answerDto })) },
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

  app.delete<{ Params: { id: string } }>("/admin/answers/:id", { schema: schema(undefined, idParams(), { "2xx": okDto }) }, async (req) => {
    await pool.query(`delete from answers where id = $1`, [req.params.id]);
    return { ok: true };
  });
}
