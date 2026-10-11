import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import { hasAllowedFileContent } from "../src/file-content.ts";
import { DOC, DOCX, JPEG, PDF, PNG, XLS, XLSX, officeParts, zip } from "./file-fixtures.mjs";

const scratch = await mkdtemp(join(tmpdir(), "lms-content-test-"));
let sequence = 0;
after(() => rm(scratch, { recursive: true, force: true }));
async function inspect(buffer, extension) {
  const path = join(scratch, `${sequence++}${extension}`);
  await writeFile(path, buffer);
  return hasAllowedFileContent(path, extension);
}

test("all allowed formats, including the JPEG alias and binary Office, are recognized", async () => {
  for (const [extension, buffer] of Object.entries({ ".pdf": PDF, ".png": PNG, ".jpg": JPEG, ".jpeg": JPEG,
    ".doc": DOC, ".xls": XLS, ".docx": DOCX, ".xlsx": XLSX })) {
    assert.equal(await inspect(buffer, extension), true, extension);
  }
});

test("empty, HTML and executable bytes cannot become documents by renaming", async () => {
  for (const extension of [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".xls", ".docx", ".xlsx"]) {
    for (const buffer of [Buffer.alloc(0), Buffer.from('<html><script>alert(1)</script></html>'), Buffer.from('MZ executable')]) {
      assert.equal(await inspect(buffer, extension), false, extension);
    }
  }
});

test("an actual allowed format under a different extension is rejected", async () => {
  for (const [buffer, extension] of [[PNG, ".pdf"], [PDF, ".png"], [JPEG, ".png"], [DOC, ".xls"],
    [XLS, ".doc"], [DOCX, ".xlsx"], [XLSX, ".docx"]]) {
    assert.equal(await inspect(buffer, extension), false, extension);
  }
});

test("truncated files and fake PDF delimiters are rejected", async () => {
  for (const [buffer, extension] of [[PDF, ".pdf"], [PNG, ".png"], [JPEG, ".jpg"], [DOC, ".doc"], [DOCX, ".docx"]]) {
    assert.equal(await inspect(buffer.subarray(0, 24), extension), false, extension);
  }
  assert.equal(await inspect(Buffer.from('%PDF-1.4\nnot a document\nstartxref\n0\n%%EOF'), ".pdf"), false);
});

test("PNG chunk corruption is rejected even with a correct signature", async () => {
  const corrupt = Buffer.from(PNG);
  corrupt[25] ^= 1;
  assert.equal(await inspect(corrupt, ".png"), false);
});

test("ZIP folders alone, missing parts and malformed OOXML cannot stand in for Office", async () => {
  assert.equal(await inspect(zip({ "word/fake.xml": "not Office" }), ".docx"), false);
  for (const kind of ["docx", "xlsx"]) {
    const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
    const missing = officeParts(kind);
    delete missing[main];
    assert.equal(await inspect(zip(missing), `.${kind}`), false);
    const malformed = officeParts(kind);
    malformed[main] = "<document><broken>";
    assert.equal(await inspect(zip(malformed), `.${kind}`), false);
    const wrongNamespace = officeParts(kind);
    wrongNamespace[main] = kind === "docx" ? "<document/>" : "<workbook/>";
    assert.equal(await inspect(zip(wrongNamespace), `.${kind}`), false);
    const wrongTarget = officeParts(kind);
    wrongTarget["_rels/.rels"] = wrongTarget["_rels/.rels"].replace(`Target="${main}"`, 'Target="other.xml"');
    assert.equal(await inspect(zip(wrongTarget), `.${kind}`), false);
  }
});

test("OOXML entity expansion and oversized compressed metadata are rejected", async () => {
  const entity = officeParts();
  entity["word/document.xml"] = '<!DOCTYPE document [<!ENTITY payload "expanded">]><document>&payload;</document>';
  assert.equal(await inspect(zip(entity), ".docx"), false);
  const large = officeParts();
  large["[Content_Types].xml"] = " ".repeat(1024 * 1024 + 1);
  assert.equal(await inspect(zip(large), ".docx"), false);
});

test("an arbitrary compound file and an out-of-bounds directory sector are rejected", async () => {
  const wrong = Buffer.from(DOC);
  wrong.writeUInt32LE(0xfffffffd, 48);
  assert.equal(await inspect(wrong, ".doc"), false);
  const generic = Buffer.from(DOC);
  const name = Buffer.from("WordDocument", "utf16le");
  const offset = generic.indexOf(name);
  assert.ok(offset > 0);
  generic.fill(0, offset, offset + name.length);
  assert.equal(await inspect(generic, ".doc"), false);
});

test("missing input and a disallowed extension fail closed", async () => {
  assert.equal(await hasAllowedFileContent(join(scratch, "missing.pdf"), ".pdf"), false);
  assert.equal(await inspect(PDF, ".exe"), false);
});

test("a cyclic compound-file sector chain fails closed without blocking the request thread", async () => {
  const cyclic = Buffer.from(DOC);
  const fat = cyclic.readUInt32LE(76);
  const directory = cyclic.readUInt32LE(48);
  cyclic.writeUInt32LE(directory, (fat + 1) * 512 + directory * 4);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  const started = Date.now();
  try {
    assert.equal(await inspect(cyclic, ".doc"), false);
    assert.ok(ticks > 0, "main event loop must stay responsive");
    assert.ok(Date.now() - started < 10_000, "worker must be stopped by its deadline/resource limit");
  } finally { clearInterval(timer); }
});
