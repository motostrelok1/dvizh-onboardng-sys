import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const scratch = await mkdtemp(join(tmpdir(), "lms-staging-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { openStagedAttachment, StoragePathError } = await import("../src/storage.ts");
after(() => rm(scratch, { recursive: true, force: true }));

async function staged() {
  const upload = await openStagedAttachment(randomUUID(), "../../пособие.pdf");
  await upload.handle.writeFile("complete file");
  await upload.handle.close();
  return upload;
}

test("temporary private upload is invisible at the final path until atomic publication", async () => {
  const upload = await staged();
  assert.equal(dirname(upload.temporaryPath), dirname(upload.diskPath));
  assert.match(upload.temporaryPath, /\.upload-[0-9a-f-]{36}\.part$/);
  assert.match(upload.diskPath, /[0-9a-f-]{36}\.pdf$/);
  assert.equal((await lstat(upload.temporaryPath)).mode & 0o777, 0o600);
  await assert.rejects(lstat(upload.diskPath), { code: "ENOENT" });
  await upload.publish();
  await assert.rejects(lstat(upload.temporaryPath), { code: "ENOENT" });
  await upload.cleanup(true);
  assert.equal(await readFile(upload.diskPath, "utf8"), "complete file");
  assert.equal((await lstat(upload.diskPath)).mode & 0o777, 0o600);
});

test("publication never overwrites a final collision and cleanup never deletes the existing file", async () => {
  const upload = await staged();
  await writeFile(upload.diskPath, "existing file");
  await assert.rejects(upload.publish(), { code: "EEXIST" });
  await upload.cleanup();
  await assert.rejects(lstat(upload.temporaryPath), { code: "ENOENT" });
  assert.equal(await readFile(upload.diskPath, "utf8"), "existing file");
});

test("publication rejects destination and source symlinks without changing their targets", async () => {
  const outside = join(scratch, "outside.pdf");
  await writeFile(outside, "keep");
  const destination = await staged();
  await symlink(outside, destination.diskPath);
  await assert.rejects(destination.publish(), { code: "EEXIST" });
  await destination.cleanup();
  assert.ok((await lstat(destination.diskPath)).isSymbolicLink());
  const source = await staged();
  await rm(source.temporaryPath);
  await symlink(outside, source.temporaryPath);
  await assert.rejects(source.publish(), StoragePathError);
  await assert.rejects(source.cleanup(), /upload_cleanup_failed/);
  await assert.rejects(lstat(source.diskPath), { code: "ENOENT" });
  assert.equal(await readFile(outside, "utf8"), "keep");
});

test("cleanup removes unpublished and published uploads and is safe to repeat", async () => {
  for (const publish of [false, true]) {
    const upload = await staged();
    if (publish) await upload.publish();
    await upload.cleanup();
    await upload.cleanup();
    assert.deepEqual(await readdir(dirname(upload.diskPath)), []);
  }
});

test("a failed streaming pipeline leaves neither a partial file nor a final file", async () => {
  const upload = await openStagedAttachment(randomUUID(), "sample.pdf");
  const source = Readable.from((async function* () {
    yield Buffer.from("partial bytes");
    throw new Error("simulated interrupted upload");
  })());
  await assert.rejects(pipeline(source, upload.handle.createWriteStream()), /simulated interrupted upload/);
  await upload.cleanup();
  assert.deepEqual(await readdir(dirname(upload.diskPath)), []);
});

test("a close failure cannot skip temporary or final-file cleanup", async () => {
  for (const publish of [false, true]) {
    const upload = await staged();
    if (publish) await upload.publish();
    upload.handle.close = async () => { throw new Error("simulated close failure"); };
    await assert.rejects(upload.cleanup(), /upload_cleanup_failed/);
    assert.deepEqual(await readdir(dirname(upload.diskPath)), []);
  }
});

test("a temporary unlink failure still removes our published file and reports the failure", async () => {
  const upload = await staged();
  await upload.publish();
  // Corruption by another process with the service UID is outside the threat
  // model; still ensure a failing temporary cleanup does not skip the final one.
  await symlink(join(scratch, "outside"), upload.temporaryPath);
  await assert.rejects(upload.cleanup(), /upload_cleanup_failed/);
  await assert.rejects(lstat(upload.diskPath), { code: "ENOENT" });
  assert.ok((await lstat(upload.temporaryPath)).isSymbolicLink());
});
