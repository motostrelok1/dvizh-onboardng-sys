import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLessonBlocks } from "../src/lesson-blocks.ts";

const paragraph = (text) => [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }];
test("accepts safe BlockNote paragraph content", () => {
  assert.equal(validateLessonBlocks(paragraph("Обычный текст и эмодзи 😀")), true);
  assert.equal(validateLessonBlocks([{ type: "paragraph", content: [] }]), true);
});
test("rejects unknown blocks and unsafe embedded HTML", () => {
  assert.equal(validateLessonBlocks([{ type: "html", content: [] }]), false);
  assert.equal(validateLessonBlocks([{ type: "paragraph", content: [], onclick: "alert(1)" }]), false);
  assert.equal(validateLessonBlocks([{ type: "paragraph", content: [{ type: "text", text: "ok", styles: { script: true } }] }]), false);
});
test("limits blocks and inline length", () => {
  assert.equal(validateLessonBlocks([]), false);
  assert.equal(validateLessonBlocks(Array.from({ length: 501 }, () => ({ type: "paragraph", content: [] }))), false);
  assert.equal(validateLessonBlocks(paragraph("x".repeat(10001))), false);
});
test("does not interpret script markup as HTML", () => {
  assert.equal(validateLessonBlocks(paragraph("<script>alert(1)</script>")), true);
});
