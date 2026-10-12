import { XMLParser, XMLValidator } from "fast-xml-parser";

export function summarizeJUnit(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("invalid_test_report");
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml);
  if (!Object.hasOwn(parsed, "testsuites") && !Object.hasOwn(parsed, "testsuite")) throw new Error("invalid_test_report");
  const counts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
  function visit(container) {
    if (!container || typeof container !== "object") return;
    for (const item of array(container.testcase)) {
      if (!item || typeof item !== "object" || !Object.hasOwn(item, "@_name")) throw new Error("invalid_test_report");
      counts.tests++;
      for (const [element, count] of [["failure", "failures"], ["error", "errors"], ["skipped", "skipped"]]) {
        if (Object.hasOwn(item, element)) counts[count]++;
      }
    }
    for (const child of [...array(container.testsuites), ...array(container.testsuite)]) visit(child);
  }
  visit(parsed);
  return counts;
}
export function requireSuccessfulRun(counts) {
  if (counts.tests === 0 || counts.failures || counts.errors || counts.skipped) throw new Error("incomplete_test_run");
}
