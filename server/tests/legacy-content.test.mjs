import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyTextToBlocks, legacyBlocksToText } from "../../client/src/editor/legacy-content.ts";

test("BlockNote legacy bridge preserves all lines and empty paragraphs", () => {
  const examples = [
    "Обычный урок",
    "Заголовок\nАбзац\n\nЗаключение",
    "\nНачало\n",
    "  отступы\tи пробелы  ",
    "<script>alert('text')</script> — это текст, не HTML",
    "😀 Тема урока\n⚠️ Внимание",
    "Строка 1\r\nСтрока 2\r\n",
    ""
  ];
  for (const original of examples) {
    const blocks = legacyTextToBlocks(original);
    assert.equal(blocks[0].type, "paragraph");
    assert.equal(legacyBlocksToText(blocks), original.replace(/\r\n?/g, "\n"));
    assert.ok(blocks.every((b) => b.content.every((n) => n.type === "text" && n.styles != null)));
  }
});

test("BlockNote legacy bridge treats missing text as an empty document", () => {
  assert.deepEqual(legacyTextToBlocks(null), [{ type: "paragraph", content: [] }]);
  assert.deepEqual(legacyTextToBlocks(undefined), [{ type: "paragraph", content: [] }]);
});

test("BlockNote legacy bridge does not interpret markup", () => {
  const text = "<h1>Тема</h1>\n<img src=x onerror=alert(1)>";
  const blocks = legacyTextToBlocks(text);
  assert.equal(blocks[0].content[0].text, "<h1>Тема</h1>");
  assert.equal(blocks[1].content[0].text, "<img src=x onerror=alert(1)>");
});
