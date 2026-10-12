import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { installApiValidation, schema, object, uuid, idParams, boolean, okDto, success } from "../api-validation.js";
import { AttemptError, listAttempts, startAttempt, saveAttemptAnswer, finishAttempt } from "../test-attempts.js";

const attemptDto = object({ id: uuid, attempt_number: { type: "integer" }, status: { type: "string" },
  started_at: { type: "string" }, finished_at: { type: ["string", "null"] },
  score: { type: ["integer", "null"] }, passed: { type: ["boolean", "null"] } });
const publicQuestion = object({ id: uuid, text: { type: "string" }, multiple: boolean,
  answers: { type: "array", items: object({ id: uuid, text: { type: "string" } }) },
  selectedAnswerIds: { type: "array", items: uuid } });
const reviewQuestion = object({ questionId: uuid, text: { type: "string" }, yourCorrect: boolean,
  answers: { type: "array", items: object({ id: uuid, text: { type: "string" }, isCorrect: boolean, wasSelected: boolean }) } });
// Existing clients send an empty POST without JSON. Validate it as {}.
const emptyPost = async (req: { body: unknown }) => { if (req.body === undefined) req.body = {}; };
async function respond(reply: FastifyReply, action: () => Promise<unknown>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof AttemptError) return reply.code(error.statusCode).send({ error: error.code, ...error.details });
    throw error;
  }
}

export async function testAttemptRoutes(app: FastifyInstance) {
  installApiValidation(app);
  app.addHook("preHandler", requireAuth);
  app.get<{ Params: { testId: string } }>("/tests/:testId/attempts",
    { schema: schema(undefined, idParams("testId"), success({ attempts: { type: "array", items: attemptDto } })) },
    (req, reply) => respond(reply, () => listAttempts(req.currentUser!, req.params.testId)));
  app.post<{ Params: { testId: string } }>("/tests/:testId/attempts", { preValidation: emptyPost,
    schema: schema(object({}), idParams("testId"), success({ attempt: attemptDto, questions: { type: "array", items: publicQuestion } })) },
    (req, reply) => { reply.code(201); return respond(reply, () => startAttempt(req.currentUser!, req.params.testId)); });
  app.post<{ Params: { attemptId: string }; Body: { questionId: string; selectedAnswerIds: string[] } }>(
    "/attempts/:attemptId/answers", { schema: schema(object({ questionId: uuid,
      selectedAnswerIds: { type: "array", items: uuid, uniqueItems: true, maxItems: 10000 } }, ["questionId", "selectedAnswerIds"]),
      idParams("attemptId"), { "2xx": okDto }) },
    (req, reply) => respond(reply, () => saveAttemptAnswer(req.currentUser!, req.params.attemptId, req.body.questionId, req.body.selectedAnswerIds)));
  app.post<{ Params: { attemptId: string } }>("/attempts/:attemptId/finish", { preValidation: emptyPost,
    schema: schema(object({}), idParams("attemptId"), success({ score: { type: "integer" }, passed: boolean,
      passScore: { type: "integer" }, review: { type: "array", items: reviewQuestion } })) },
    (req, reply) => respond(reply, () => finishAttempt(req.currentUser!, req.params.attemptId)));
}
