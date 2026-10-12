import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { correctSelection, validSelection } from "../src/test-attempts.ts";
const { pool } = await import("../src/db.ts");
await pool.end(); // Validation and authentication must not reach PostgreSQL.
const { testAttemptRoutes } = await import("../src/routes/test-attempts.ts");
const id = "bc1d9ec7-a9ce-4ff6-9a8d-a43ee401ab12";
const second = "ca1d9ec7-a9ce-4ff6-9a8d-a43ee401ab12";
const third = "da1d9ec7-a9ce-4ff6-9a8d-a43ee401ab12";
const q = { id, text: "Question", multiple: true, answers: [
  { id, text: "First", isCorrect: true }, { id: second, text: "Second", isCorrect: true },
  { id: third, text: "Wrong", isCorrect: false }
] };
const app = Fastify();
before(async () => { await app.register(cookie); await app.register(testAttemptRoutes); await app.ready(); });
after(() => app.close());

test("multiple-choice grading is all-or-nothing, unordered and case normalized", () => {
  assert.equal(correctSelection(q, [second.toUpperCase(), id.toUpperCase()]), true);
  for (const ids of [[], [id], [third], [id, third], [id, second, third]]) assert.equal(correctSelection(q, ids), false);
});
test("unknown options, duplicate UUID aliases and multiple single-choice selections are invalid", () => {
  for (const ids of [["foreign"], [id, id], [id, id.toUpperCase()]]) assert.equal(validSelection(q, ids), false);
  assert.equal(validSelection({ ...q, multiple: false }, [id, second]), false);
  assert.equal(validSelection({ ...q, multiple: false }, []), true);
});
test("an empty correct set cannot award a point for an empty answer", () => {
  assert.equal(correctSelection({ ...q, answers: [] }, []), false);
  assert.equal(correctSelection({ ...q, answers: q.answers.map(a => ({ ...a, isCorrect: false })) }, []), false);
});
test("attempt schemas reject malformed params and query before authentication/SQL", async () => {
  for (const [method, url] of [["GET", "/tests/bad/attempts"], ["POST", "/tests/bad/attempts"],
    ["POST", "/attempts/bad/finish"], ["POST", "/attempts/bad/answers"], ["GET", `/tests/${id}/attempts?userId=${second}`]]) {
    const response = await app.inject({ method, url, ...(url.endsWith("answers") ? { payload: { questionId: id, selectedAnswerIds: [] } } : {}) });
    assert.equal(response.statusCode, 400, response.body); assert.deepEqual(response.json(), { error: "invalid_request" });
  }
});
test("answer schemas reject coercion, missing fields, duplicates, unbounded arrays and forged grading fields", async () => {
  const good = { questionId: id, selectedAnswerIds: [] };
  for (const payload of [null, {}, { ...good, questionId: "bad" }, { ...good, selectedAnswerIds: "bad" },
    { ...good, selectedAnswerIds: null }, { ...good, selectedAnswerIds: [false] },
    { ...good, selectedAnswerIds: [id, id] }, { ...good, isCorrect: true }, { ...good, score: 100 },
    { ...good, selectedAnswerIds: Array(10001).fill(id) }]) {
    const response = await app.inject({ method: "POST", url: `/attempts/${id}/answers`, payload });
    assert.equal(response.statusCode, 400, response.body); assert.deepEqual(response.json(), { error: "invalid_request" });
  }
});
test("start/finish reject supplied unknown grading fields", async () => {
  for (const url of [`/tests/${id}/attempts`, `/attempts/${id}/finish`]) {
    for (const payload of [{ userId: second }, { score: 100 }, { passed: true }, [], "body"]) {
      const response = await app.inject({ method: "POST", url, headers: { "content-type": "application/json" },
        payload: JSON.stringify(payload) });
      assert.equal(response.statusCode, 400, response.body); assert.deepEqual(response.json(), { error: "invalid_request" });
    }
  }
});
test("valid empty POST, history and answer payload still require a session", async () => {
  for (const [method, url, payload] of [["GET", `/tests/${id}/attempts`], ["POST", `/tests/${id}/attempts`],
    ["POST", `/attempts/${id}/finish`], ["POST", `/attempts/${id}/answers`, { questionId: id, selectedAnswerIds: [] }]]) {
    const response = await app.inject({ method, url, payload });
    assert.equal(response.statusCode, 401, response.body); assert.deepEqual(response.json(), { error: "not_authenticated" });
  }
});
