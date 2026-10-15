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

test("supports headings, links, tables and approved educational callouts", () => {
  const content = [
    {type:"heading",props:{level:2,textAlignment:"left",textColor:"default",backgroundColor:"default"},
      content:[{type:"text",text:"Тема",styles:{bold:true}}],children:[]},
    {type:"paragraph",content:[{type:"link",href:"https://example.org/reference",
      content:[{type:"text",text:"Источник",styles:{}}]}],children:[]},
    {type:"table",props:{textColor:"default"},content:{type:"tableContent",columnWidths:[180,220],
      rows:[{cells:[
        {type:"tableCell",props:{backgroundColor:"default",textColor:"default",textAlignment:"left",colspan:1,rowspan:1},
          content:[{type:"text",text:"Колонка 1",styles:{}}]},
        {type:"tableCell",props:{backgroundColor:"default",textColor:"default",textAlignment:"left",colspan:1,rowspan:1},
          content:[{type:"text",text:"Колонка 2",styles:{}}]}
      ]}]},children:[]},
    {type:"numberedListItem",props:{start:3},content:[{type:"text",text:"Пункт",styles:{}}]},
    {type:"callout",props:{variant:"warning",textAlignment:"left",textColor:"default"},
      content:[{type:"text",text:"Осторожно!",styles:{}}],children:[]}
  ];
  assert.equal(validateLessonBlocks(content),true);
});
test("blocks image injection and unsafe links", () => {
  assert.equal(validateLessonBlocks([{type:"image",props:{url:"https://evil.invalid/img.png"}}]),false);
  assert.equal(validateLessonBlocks([{type:"image",props:{url:"data:image/png;base64,AAAA"}}]),false);
  assert.equal(validateLessonBlocks([{type:"paragraph",content:[{
    type:"link",href:"javascript:alert(1)",content:[{type:"text",text:"click",styles:{}}]
  }]}]),false);
  assert.equal(validateLessonBlocks([{type:"callout",props:{variant:"raw-html"},content:[]}]),false);
});
