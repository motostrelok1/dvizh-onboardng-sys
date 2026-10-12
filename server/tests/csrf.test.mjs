import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { installCsrfProtection, configuredOrigin } from "../src/csrf.ts";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
const origin = "https://edu.example.test";

function appFor(context, target = origin) {
  const logs = [], handled = [];
  const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
  installPrivacyHeaders(app);
  installCsrfProtection(app, target);
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    app.route({ method, url: "/probe", handler: async req => { handled.push(req.method); return { ok: true }; } });
  }
  context.after(() => app.close());
  return { app, logs, handled };
}

test("production origin is required and configuration rejects paths, credentials, wildcards and unsafe schemes", () => {
  for (const value of [undefined, "", "http://edu.example.test", "//edu.example.test", "https://edu.example.test/api",
    "https://edu.example.test?secret=SECRET", "https://edu.example.test#SECRET", "https://user:SECRET@edu.example.test",
    "https://*.example.test", "https:////edu.example.test", "ftp://edu.example.test", "null"]) {
    assert.throws(() => configuredOrigin(value ?? "", true), error => {
      assert.ok(!error.message.includes("SECRET")); return true;
    });
  }
});

test("canonical configuration normalizes host/default port and has only the development fallback", () => {
  assert.equal(configuredOrigin("https://EDU.example.test:443/", true), origin);
  assert.equal(configuredOrigin("", false), "http://localhost:5173");
  assert.equal(configuredOrigin("http://127.0.0.1:5173", false), "http://127.0.0.1:5173");
});

test("every unsafe method rejects missing/null/foreign/multiple/malformed Origin before a handler", async context => {
  const { app, handled } = appFor(context);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const value of [undefined, "null", "", "https://evil.example.test", "http://edu.example.test",
      "https://edu.example.test:444", "https://edu.example.test.evil.test", `${origin}/path`,
      `${origin}, https://evil.test`, [origin, origin]]) {
      const response = await app.inject({ method, url: "/probe", headers: value === undefined ? {} : { origin: value } });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { error: "csrf_forbidden" });
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["referrer-policy"], "no-referrer");
    }
  }
  assert.deepEqual(handled, []);
});

test("same-origin unsafe requests need no Referer and keep normal handler behavior", async context => {
  const { app, handled } = appFor(context);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await app.inject({ method, url: "/probe", headers: { origin } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  }
  assert.deepEqual(handled, ["POST", "PUT", "PATCH", "DELETE"]);
});

test("Host/forwarded headers, valid Referer and Fetch Metadata cannot grant a foreign or missing origin", async context => {
  const { app, handled } = appFor(context);
  for (const supplied of [undefined, "https://other.example.test"]) {
    const response = await app.inject({ method: "POST", url: "/probe", remoteAddress: "127.0.0.1", headers: {
      ...(supplied ? { origin: supplied } : {}), host: "other.example.test", "x-forwarded-host": "other.example.test",
      "x-forwarded-proto": "https", referer: `${origin}/invite#SECRET`, "sec-fetch-site": "same-origin"
    } });
    assert.equal(response.statusCode, 403);
  }
  assert.deepEqual(handled, []);
});

test("foreign simple forms/multipart/text are stopped before parsing and private headers are not logged", async context => {
  const { app, logs, handled } = appFor(context);
  for (const contentType of ["application/json", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const response = await app.inject({ method: "POST", url: "/probe", headers: { origin: "https://SECRET.evil.test",
      "content-type": contentType, cookie: "session=SECRET", referer: "https://SECRET.evil.test/" }, payload: "SECRET-malformed" });
    assert.equal(response.statusCode, 403);
    assert.ok(!response.body.includes("SECRET"));
  }
  assert.deepEqual(handled, []);
  assert.ok(!logs.join("").includes("SECRET"));
});

test("safe methods remain available without Origin and foreign preflight does not enable CORS", async context => {
  const { app } = appFor(context);
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const response = await app.inject({ method, url: "/probe", headers: { origin: "https://evil.test" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers["access-control-allow-credentials"], undefined);
  }
});

test("root protection covers nested and future plugins, before their onRequest hooks", async context => {
  const { app } = appFor(context);
  let calls = 0;
  await app.register(async child => {
    child.addHook("onRequest", async () => { calls++; });
    await child.register(async inner => { inner.post("/nested", async () => ({ ok: true })); });
  });
  assert.equal((await app.inject({ method: "POST", url: "/nested" })).statusCode, 403);
  assert.equal(calls, 0);
  assert.equal((await app.inject({ method: "POST", url: "/nested", headers: { origin } })).statusCode, 200);
  assert.equal(calls, 1);
});
