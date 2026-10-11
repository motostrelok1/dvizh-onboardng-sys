import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { installPrivacyHeaders, privateLogger, safeLogUrl } from "../src/privacy.ts";
import { readInviteToken } from "../../client/src/shared/invitation-location.ts";

function loggedApp(context) {
  const lines = [];
  const app = Fastify({ logger: { ...privateLogger, stream: { write: line => lines.push(String(line)) } } });
  installPrivacyHeaders(app);
  context.after(() => app.close());
  return { app, lines };
}

test("request/error/404 logging excludes credentials even from encoded unknown URLs", async context => {
  const { app, lines } = loggedApp(context);
  const secret = "SECRET-cannot-appear";
  app.post("/auth/invitations/accept", async req => {
    req.log.info({ req, body: req.body, token: secret, password: secret, cookies: { session: secret }, headers: req.headers });
    throw new Error(`database/parser failure ${secret}`);
  });
  const failed = await app.inject({ method: "POST", url: `/auth/invitations/accept?token=${secret}`,
    headers: { cookie: `session=${secret}`, authorization: `Bearer ${secret}`, referer: `/invite/${secret}` },
    payload: { token: secret, password: secret } });
  assert.equal(failed.statusCode, 500);
  for (const url of [`/auth/invitations/${secret}`, `/invite/${secret}`, `/auth/%69nvitations/${secret}`]) {
    assert.equal((await app.inject({ url })).statusCode, 404);
  }
  const output = lines.join("");
  assert.ok(output.includes("incoming request") && output.includes("request completed") && output.includes("operation_failed"));
  assert.ok(!output.includes(secret), output);
});

test("direct and nested errors cannot copy message, stack or custom properties into logs", async context => {
  const { app, lines } = loggedApp(context);
  const secret = "ERROR-SECRET";
  const err = Object.assign(new Error(secret), { token: secret, detail: secret, cause: new Error(secret) });
  app.log.error(err);
  app.log.error({ err, msg: secret }, secret);
  app.log.error({ err });
  assert.equal(lines.length, 3);
  assert.ok(!lines.join("").includes(secret));
});

test("successful and parser/error/not-found responses enforce no-store and no-referrer", async context => {
  const { app } = loggedApp(context);
  app.get("/private", async (_req, reply) => reply.header("Cache-Control", "public, max-age=99").send({ private: true }));
  app.post("/parse", async () => ({ ok: true }));
  app.get("/denied", async (_req, reply) => reply.code(403).send({ error: "denied" }));
  for (const [request, code] of [
    [{ url: "/private" }, 200], [{ url: "/denied" }, 403], [{ url: "/missing" }, 404],
    [{ method: "POST", url: "/parse", headers: { "content-type": "application/json" }, payload: "malformed" }, 400]
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, code);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
  }
});

test("URL masking removes query strings and both legacy invitation segments", () => {
  for (const url of ["/invite/SECRET?token=SECRET", "/api/auth/invitations/SECRET/accept?password=SECRET", "/auth/invitations/SECRET"]) {
    assert.ok(!safeLogUrl(url).includes("SECRET"));
  }
});

test("fragment and legacy links consume the token and immediately clean the current URL", () => {
  for (const [pathname, hash] of [["/invite", "#TOKEN"], ["/invite/", "#TOKEN"], ["/invite/TOKEN", ""]]) {
    const replacements = [];
    assert.equal(readInviteToken({ pathname, hash }, { replaceState: (...args) => replacements.push(args) }), "TOKEN");
    assert.deepEqual(replacements, [[null, "", "/invite"]]);
  }
});

test("malformed or empty invitations do not throw and ordinary navigation is unchanged", () => {
  const replacements = [];
  const history = { replaceState: (...args) => replacements.push(args) };
  assert.equal(readInviteToken({ pathname: "/invite", hash: "#%XX" }, history), "invalid-invitation");
  assert.equal(readInviteToken({ pathname: "/invite", hash: "" }, history), "invalid-invitation");
  assert.equal(readInviteToken({ pathname: "/", hash: "#ordinary" }, history), null);
  assert.equal(replacements.length, 2);
});
