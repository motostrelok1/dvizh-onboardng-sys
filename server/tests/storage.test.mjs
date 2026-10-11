import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";

const scratch = await mkdtemp(join(tmpdir(), "lms-storage-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const storage = await import("../src/storage.ts");
const { UPLOAD_DIR, StoragePathError, attachmentPath, ensureLessonDir, storedFileName,
  openNewAttachment, openAttachmentForRead, removeAttachmentFile } = storage;
const lessonId = randomUUID();
after(() => rm(scratch, { recursive: true, force: true }));

async function writeAttachment(id, name, content) {
  await ensureLessonDir(id);
  const { handle, diskPath } = await openNewAttachment(id, name);
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
  return diskPath;
}

test("original paths and names cannot influence the stored leaf name", () => {
  for (const original of ["../../secret.pdf", "..\\..\\secret.PDF", "/etc/secret.pdf", "C:\\temp\\secret.pdf", "пособие.pdf"]) {
    const name = storedFileName(original);
    assert.match(name, /^[0-9a-f-]{36}\.pdf$/);
    assert.equal(basename(name), name);
    assert.equal(dirname(attachmentPath(lessonId, name)), join(UPLOAD_DIR, "lessons", lessonId));
  }
  assert.notEqual(storedFileName("same.pdf"), storedFileName("same.pdf"));
});

test("unsupported and missing extensions are rejected", () => {
  for (const name of ["file.exe", "file", "file.pdf.exe", "file.pdf/", "file.pdf/evil"]) {
    assert.throws(() => storedFileName(name), StoragePathError);
  }
});

test("invalid lesson identifiers are rejected before creating directories", async () => {
  const existing = await readdir(scratch);
  for (const id of ["../escape", "..\\escape", "/tmp/escape", "not-a-uuid", ""]) {
    await assert.rejects(ensureLessonDir(id), StoragePathError);
    assert.throws(() => attachmentPath(id, "file.pdf"), StoragePathError);
  }
  assert.deepEqual(await readdir(scratch), existing);
});

test("traversal, absolute and Windows stored names are rejected", () => {
  for (const name of ["../secret.pdf", "..\\secret.pdf", "/secret.pdf", "C:\\secret.pdf", ".", "..", "x\0.pdf"]) {
    assert.throws(() => attachmentPath(lessonId, name), StoragePathError);
  }
});

test("exclusive creation never overwrites an existing file", async () => {
  const name = storedFileName("file.pdf");
  const path = await writeAttachment(lessonId, name, "original");
  await assert.rejects(openNewAttachment(lessonId, name), { code: "EEXIST" });
  assert.equal(await readFile(path, "utf8"), "original");
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(dirname(path))).mode & 0o777, 0o700);
});

test("a legacy UUID-original filename remains readable and removable", async () => {
  const path = await writeAttachment(lessonId, `${randomUUID()}-старое пособие.pdf`, "legacy");
  const handle = await openAttachmentForRead(lessonId, path);
  try {
    assert.equal(await handle.readFile("utf8"), "legacy");
  } finally {
    await handle.close();
  }
  await removeAttachmentFile(lessonId, path);
  await assert.rejects(lstat(path), { code: "ENOENT" });
});

test("an uppercase UUID resolves to the same lesson directory", async () => {
  assert.equal(await ensureLessonDir(lessonId.toUpperCase()), await ensureLessonDir(lessonId));
});

test("read and delete reject outside, sibling and nested DB paths", async () => {
  const outside = join(scratch, "outside.pdf");
  await writeFile(outside, "keep");
  for (const path of [outside, join(UPLOAD_DIR, "lessons", randomUUID(), "x.pdf"), join(UPLOAD_DIR, "lessons", lessonId, "nested", "x.pdf")]) {
    await assert.rejects(openAttachmentForRead(lessonId, path), StoragePathError);
    await assert.rejects(removeAttachmentFile(lessonId, path), StoragePathError);
  }
  assert.equal(await readFile(outside, "utf8"), "keep");
});

test("a lesson directory symlink cannot redirect writes", async () => {
  const id = randomUUID();
  const outsideDir = join(scratch, "outside-dir");
  await mkdir(outsideDir);
  await symlink(outsideDir, join(UPLOAD_DIR, "lessons", id));
  await assert.rejects(ensureLessonDir(id), StoragePathError);
  await assert.rejects(openNewAttachment(id, storedFileName("file.pdf")), StoragePathError);
  assert.deepEqual(await readdir(outsideDir), []);
});

test("a leaf symlink cannot redirect reads, writes or deletes", async () => {
  const outside = join(scratch, "symlink-target.pdf");
  await writeFile(outside, "keep");
  const name = storedFileName("file.pdf");
  const path = attachmentPath(lessonId, name);
  await symlink(outside, path);
  await assert.rejects(openNewAttachment(lessonId, name), { code: "EEXIST" });
  await assert.rejects(openAttachmentForRead(lessonId, path), StoragePathError);
  await assert.rejects(removeAttachmentFile(lessonId, path), StoragePathError);
  assert.equal(await readFile(outside, "utf8"), "keep");
  assert.ok((await lstat(path)).isSymbolicLink());
});

test("the lessons directory and upload root cannot be symlinks", async () => {
  // This last test swaps only its own temporary directories.
  await rm(UPLOAD_DIR, { recursive: true, force: true });
  await mkdir(UPLOAD_DIR);
  const outside = join(scratch, "linked-root");
  await mkdir(outside);
  await symlink(outside, join(UPLOAD_DIR, "lessons"));
  await assert.rejects(ensureLessonDir(randomUUID()), StoragePathError);
  assert.deepEqual(await readdir(outside), []);
  await rm(UPLOAD_DIR, { recursive: true, force: true });
  await symlink(outside, UPLOAD_DIR);
  await assert.rejects(ensureLessonDir(randomUUID()), StoragePathError);
  assert.deepEqual(await readdir(outside), []);
});
