import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeJUnit, requireSuccessfulRun } from "../scripts/test-results.mjs";
const wrap = cases => `<testsuites>${cases}</testsuites>`;

test("JUnit summary counts direct and nested suites, regardless of claimed totals", () => {
  const counts = summarizeJUnit(wrap('<testcase name="first"/><testsuite tests="999"><testcase name="second"/></testsuite>'));
  assert.deepEqual(counts, { tests: 2, failures: 0, errors: 0, skipped: 0 });
  assert.doesNotThrow(() => requireSuccessfulRun(counts));
});
test("JUnit gate rejects failed, errored, cancelled and skipped/TODO cases", () => {
  for (const child of ['<failure/>', '<error/>', '<failure type="cancelledByParent"/>', '<skipped/>', '<skipped type="todo"/>']) {
    const counts = summarizeJUnit(wrap(`<testcase name="case">${child}</testcase>`));
    assert.throws(() => requireSuccessfulRun(counts), /incomplete_test_run/);
  }
});
test("JUnit gate refuses zero tests, malformed XML, unrelated reports and DTD", () => {
  assert.throws(() => requireSuccessfulRun(summarizeJUnit(wrap(''))), /incomplete_test_run/);
  for (const xml of ['<testsuites>', '<fake tests="99"/>', wrap('<testcase/>'), '<!DOCTYPE testsuites><testsuites/>']) {
    assert.throws(() => summarizeJUnit(xml), /invalid_test_report/);
  }
});
test("real checker writes the GitHub summary, rejects skipped/missing reports and never prints XML error content", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lms-ci-report-')), report = join(dir, 'results.xml'), summary = join(dir, 'summary.md');
  const run = file => spawnSync(process.execPath, ['scripts/check-test-results.mjs', file], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8', timeout: 5000
  });
  try {
    await writeFile(report, wrap('<testcase name="ok"/>'));
    assert.equal(run(report).status, 0); assert.match(await readFile(summary, 'utf8'), /Server tests: 1/);
    await writeFile(report, wrap('<testcase name="skip"><skipped/></testcase>')); assert.equal(run(report).status, 1);
    assert.equal(run(join(dir, 'missing.xml')).status, 1);
    await writeFile(report, wrap('<testcase name="broken"><failure>SECRET SQL /private/path</failure></testcase>'));
    const failed = run(report); assert.equal(failed.status, 1); assert.doesNotMatch(failed.stdout + failed.stderr, /SECRET|SQL|private\/path/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("actual Node reporter exposes skips and TODO even when the runner exits successfully", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lms-ci-runner-')), report = join(dir, 'results.xml'), fixture = join(dir, 'case.mjs');
  try {
    await writeFile(fixture, 'import {test} from "node:test";test("pass",()=>{});test.skip("skip",()=>{});test.todo("todo");');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // Start a top-level runner, not this test's child context.
    const child = spawnSync(process.execPath, ['--test', '--test-reporter=junit', `--test-reporter-destination=${report}`, fixture],
      { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
    const counts = summarizeJUnit(await readFile(report, 'utf8'));
    assert.deepEqual(counts, { tests: 3, failures: 0, errors: 0, skipped: 2 });
    assert.throws(() => requireSuccessfulRun(counts), /incomplete_test_run/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
