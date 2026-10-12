import { readFile, appendFile } from "node:fs/promises";
import { summarizeJUnit, requireSuccessfulRun } from "./test-results.mjs";

try {
  const report = process.argv[2];
  if (!report) throw new Error("report_required");
  const counts = summarizeJUnit(await readFile(report, "utf8"));
  console.log(JSON.stringify({ event: "test_results", ...counts }));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Server tests: ${counts.tests}; failures: ${counts.failures}; errors: ${counts.errors}; skipped/TODO: ${counts.skipped}.\n`);
  requireSuccessfulRun(counts);
} catch {
  console.error("test_report_check_failed: report must exist and contain tests without failures/errors/skips");
  process.exitCode = 1;
}
