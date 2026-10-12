import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
const fallback = 'postgres://fixture:fake@127.0.0.1/production';
function run(url) {
  const env = { ...process.env, DATABASE_URL: fallback };
  if (url === undefined) delete env.TEST_DATABASE_URL; else env.TEST_DATABASE_URL = url;
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    'await import("./tests/test-database.mjs");process.stdout.write(process.env.DATABASE_URL)'],
  { cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 5000 });
}
test("test database guard refuses missing configuration even when DATABASE_URL exists", () => {
  const result = run(); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  assert.match(result.stderr, /Set TEST_DATABASE_URL/);
});
test("test database guard rejects remote hosts, non-test databases and other protocols before importing pg", () => {
  for (const url of ['postgres://fixture:fake@db.example.test/lms_test', 'postgres://fixture:fake@127.0.0.1/lms',
    'postgres://fixture:fake@127.0.0.1/lms_test/extra', 'https://localhost/lms_test', 'not-a-url']) {
    const result = run(url); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  }
});
test("test database guard accepts local test URLs and replaces the unrelated DATABASE_URL", () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `postgresql://fixture:fake@${host}/lms_test`; const result = run(url);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, url);
  }
});
