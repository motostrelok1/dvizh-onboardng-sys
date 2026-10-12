import type { PoolClient } from "pg";
import type { PublicUser } from "./auth/service.js";
import { checkCourseAccess, getCourseIdForTest } from "./access.js";
import { withTransaction } from "./data-integrity.js";
import { logEvent } from "./events.js";

type ErrorCode = "not_found" | "not_authenticated" | "deadline_passed" | "not_assigned" | "not_enrolled" |
  "no_attempts_left" | "attempt_already_finished" | "invalid_question" | "invalid_answer_set" | "test_not_ready";
export class AttemptError extends Error {
  constructor(public readonly statusCode: 400 | 401 | 403 | 404 | 409, public readonly code: ErrorCode,
    public readonly details: Record<string, number> = {}) { super(code); }
}
export type TestQuestion = {
  id: string; text: string; multiple: boolean;
  answers: Array<{ id: string; text: string; isCorrect: boolean }>;
};
type TestSettings = { id: string; max_attempts: number | null; pass_score: number; show_correct_answers: boolean };

export function validSelection(question: TestQuestion, selected: string[]): boolean {
  const ids = selected.map(id => id.toLowerCase());
  return new Set(ids).size === ids.length && (question.multiple || ids.length <= 1) &&
    ids.every(id => question.answers.some(answer => answer.id === id));
}
export function correctSelection(question: TestQuestion, selected: string[]): boolean {
  if (!validSelection(question, selected)) return false;
  const correct = question.answers.filter(answer => answer.isCorrect).map(answer => answer.id);
  const ids = new Set(selected.map(id => id.toLowerCase()));
  return correct.length > 0 && correct.length === ids.size && correct.every(id => ids.has(id));
}

async function lockUser(client: PoolClient, userId: string) {
  // Same user lock as credential reset/deactivation; always before test/attempt.
  const user = (await client.query("select id, is_active from users where id = $1 for no key update", [userId])).rows[0];
  if (!user?.is_active) throw new AttemptError(401, "not_authenticated");
}
async function lockTest(client: PoolClient, testId: string): Promise<TestSettings> {
  // SHARE allows different employees to take a test concurrently, while
  // excluding editor changes/deletion until this short request commits.
  const test = (await client.query("select * from tests where id = $1 for share", [testId])).rows[0];
  if (!test) throw new AttemptError(404, "not_found");
  return test;
}
async function requireAccess(client: PoolClient, user: PublicUser, testId: string) {
  const courseId = await getCourseIdForTest(testId, client);
  if (!courseId) throw new AttemptError(404, "not_found");
  const access = await checkCourseAccess(user, courseId, client);
  if (!access.ok) throw new AttemptError(403, access.reason);
}
async function questionsForTest(client: PoolClient, test: TestSettings): Promise<TestQuestion[]> {
  const questions = (await client.query(`select q.id, q.text, q.multiple,
    coalesce(jsonb_agg(jsonb_build_object('id',a.id,'text',a.text,'isCorrect',a.is_correct) order by a.id)
      filter (where a.id is not null), '[]'::jsonb) as answers
    from questions q left join answers a on a.question_id=q.id where q.test_id=$1
    group by q.id order by q.position,q.id`, [test.id])).rows as TestQuestion[];
  if (!questions.length || !Number.isInteger(test.pass_score) || test.pass_score < 0 || test.pass_score > 100 ||
    (test.max_attempts !== null && (!Number.isInteger(test.max_attempts) || test.max_attempts < 1)) ||
    questions.some(q => {
      const correct = q.answers.filter(a => a.isCorrect).length;
      return correct === 0 || (!q.multiple && correct !== 1);
    })) throw new AttemptError(409, "test_not_ready");
  return questions;
}
async function lockOwnedAttempt(client: PoolClient, user: PublicUser, attemptId: string) {
  await lockUser(client, user.id);
  const existing = (await client.query("select test_id from test_attempts where id=$1 and user_id=$2", [attemptId, user.id])).rows[0];
  if (!existing) throw new AttemptError(404, "not_found");
  const test = await lockTest(client, existing.test_id);
  const attempt = (await client.query("select * from test_attempts where id=$1 and user_id=$2 for no key update", [attemptId, user.id])).rows[0];
  if (!attempt) throw new AttemptError(404, "not_found");
  if (attempt.status !== "in_progress") throw new AttemptError(409, "attempt_already_finished");
  await requireAccess(client, user, test.id);
  return { test, attempt };
}

export async function listAttempts(user: PublicUser, testId: string) {
  return withTransaction(async client => {
    await lockUser(client, user.id); await lockTest(client, testId);
    await requireAccess(client, user, testId);
    return { attempts: (await client.query(`select id,attempt_number,status,started_at,finished_at,score,passed
      from test_attempts where test_id=$1 and user_id=$2 order by attempt_number`, [testId, user.id])).rows };
  });
}

export async function startAttempt(user: PublicUser, testId: string) {
  return withTransaction(async client => {
    await lockUser(client, user.id);
    const test = await lockTest(client, testId);
    await requireAccess(client, user, testId);
    const questions = await questionsForTest(client, test);
    // Access is checked after waiting for locks, immediately before writes.
    await requireAccess(client, user, testId);
    let attempt = (await client.query(`select * from test_attempts where test_id=$1 and user_id=$2
      and status='in_progress' for no key update`, [testId, user.id])).rows[0];
    if (!attempt) {
      const history = (await client.query(`select count(*)::int as n,coalesce(max(attempt_number),0) as last
        from test_attempts where test_id=$1 and user_id=$2`, [testId, user.id])).rows[0];
      if (test.max_attempts !== null && history.n >= test.max_attempts) {
        throw new AttemptError(409, "no_attempts_left", { attemptsUsed: history.n, maxAttempts: test.max_attempts });
      }
      attempt = (await client.query(`insert into test_attempts(test_id,user_id,attempt_number)
        values ($1,$2,$3) returning *`, [testId, user.id, history.last + 1])).rows[0];
      await logEvent(user.id, "test_attempt_start", { entityType: "test", entityId: testId,
        payload: { attemptId: attempt.id, attemptNumber: attempt.attempt_number } }, client);
    }
    const given = (await client.query("select question_id,selected_answer_ids from attempt_answers where attempt_id=$1", [attempt.id])).rows;
    const byQuestion = new Map(given.map(row => [row.question_id, row.selected_answer_ids as string[]]));
    return { attempt, questions: questions.map(q => ({ id: q.id, text: q.text, multiple: q.multiple,
      answers: q.answers.map(a => ({ id: a.id, text: a.text })),
      selectedAnswerIds: (byQuestion.get(q.id) ?? []).filter(id => q.answers.some(a => a.id === id)) })) };
  });
}

export async function saveAttemptAnswer(user: PublicUser, attemptId: string, questionId: string, selected: string[]) {
  return withTransaction(async client => {
    const { test } = await lockOwnedAttempt(client, user, attemptId);
    const questions = await questionsForTest(client, test);
    const question = questions.find(q => q.id === questionId.toLowerCase());
    if (!question) throw new AttemptError(400, "invalid_question");
    if (!validSelection(question, selected)) throw new AttemptError(400, "invalid_answer_set");
    const ids = selected.map(id => id.toLowerCase());
    const isCorrect = correctSelection(question, ids);
    await requireAccess(client, user, test.id);
    await client.query(`insert into attempt_answers(attempt_id,question_id,selected_answer_ids,is_correct)
      values ($1,$2,$3,$4) on conflict(attempt_id,question_id) do update set
      selected_answer_ids=excluded.selected_answer_ids,is_correct=excluded.is_correct,answered_at=now()`,
    [attemptId, question.id, ids, isCorrect]);
    await logEvent(user.id, "question_answered", { entityType: "question", entityId: question.id,
      payload: { attemptId, isCorrect, selectedAnswerIds: ids } }, client);
    return { ok: true };
  });
}

export async function finishAttempt(user: PublicUser, attemptId: string) {
  return withTransaction(async client => {
    const { test, attempt } = await lockOwnedAttempt(client, user, attemptId);
    const questions = await questionsForTest(client, test);
    const given = (await client.query("select question_id,selected_answer_ids from attempt_answers where attempt_id=$1", [attemptId])).rows;
    const byQuestion = new Map(given.map(row => [row.question_id, row.selected_answer_ids as string[]]));
    const evaluated = questions.map(q => ({ question: q, selected: byQuestion.get(q.id) ?? [],
      correct: correctSelection(q, byQuestion.get(q.id) ?? []) }));
    const correctCount = evaluated.filter(row => row.correct).length;
    const score = Math.round(correctCount / questions.length * 100);
    const passed = score >= test.pass_score;
    await requireAccess(client, user, test.id);
    // Re-evaluate live content, never trust a cached flag or a foreign question.
    await client.query("update attempt_answers set is_correct=false where attempt_id=$1", [attemptId]);
    for (const row of evaluated) {
      if (byQuestion.has(row.question.id)) await client.query(`update attempt_answers set is_correct=$3
        where attempt_id=$1 and question_id=$2`, [attemptId, row.question.id, row.correct]);
    }
    await client.query(`update test_attempts set status='finished',finished_at=now(),score=$2,passed=$3
      where id=$1`, [attemptId, score, passed]);
    await logEvent(user.id, "test_attempt_end", { entityType: "test", entityId: test.id,
      payload: { attemptId, attemptNumber: attempt.attempt_number, score, passed,
        passScore: test.pass_score, totalQuestions: questions.length, correctCount } }, client);
    return { score, passed, passScore: test.pass_score,
      ...(test.show_correct_answers ? { review: evaluated.map(({ question: q, selected, correct }) => ({
        questionId: q.id, text: q.text, yourCorrect: correct,
        answers: q.answers.map(a => ({ id: a.id, text: a.text, isCorrect: a.isCorrect, wasSelected: selected.includes(a.id) }))
      })) } : {}) };
  });
}
