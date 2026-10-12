import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";

const scratch = await mkdtemp(join(tmpdir(), "lms-receiver-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { receiveAttachment, UploadReceiveError } = await import("../src/upload-receiver.ts");
const app = Fastify();
const boundary = "lms-receiver-test", bytes = Buffer.alloc(128 * 1024, "x");
let observed;
before(async () => {
  await app.register(multipart);
  app.post("/upload/:id", async (req, reply) => {
    try {
      const received = await receiveAttachment(req.raw, req.params.id);
      try {
        observed = { bytes: await readFile(received.staged.temporaryPath),
          filename: received.filename, extension: received.extension, size: received.bytesWritten,
          names: await readdir(join(process.env.UPLOAD_DIR, "lessons", req.params.id)) };
        return { ok: true };
      } finally { await received.staged.cleanup(); }
    } catch (error) {
      if (error instanceof UploadReceiveError) return reply.code(error.statusCode).send(error.response);
      throw error;
    }
  });
  await app.ready();
});
after(async () => { await app.close(); await rm(scratch, { recursive: true, force: true }); });
function part(filename = "sample.pdf", body = bytes) {
  return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`), body]);
}
const end = Buffer.from(`\r\n--${boundary}--\r\n`);
async function request(payload, type = `multipart/form-data; boundary=${boundary}`) {
  const id = randomUUID();
  const response = await app.inject({ method: "POST", url: `/upload/${id}`,
    headers: { "content-type": type }, payload });
  const names = await readdir(join(process.env.UPLOAD_DIR, "lessons", id)).catch(error => {
    if (error.code === "ENOENT") return []; throw error;
  });
  assert.deepEqual(names, []);
  return response;
}

test("actual upload receiver streams complete bytes and returns only a private staged file", async () => {
  const response = await request(Buffer.concat([part(), end]));
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(observed.bytes, bytes); assert.equal(observed.size, bytes.length);
  assert.equal(observed.filename, "sample.pdf"); assert.equal(observed.extension, ".pdf");
  assert.equal(observed.names.length, 1); assert.match(observed.names[0], /\.part$/);
});

test("tiny truncated multipart errors before any async file setup are handled without an uncaught event", async () => {
  for (let i = 0; i < 6; i++) {
    const response = await request(part("sample.pdf", Buffer.from("cut off")));
    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(response.json(), { error: "invalid_request" });
  }
});

test("a completed file followed by an unfinished next part cannot bypass the one-part limit", async () => {
  const response = await request(Buffer.concat([part(), Buffer.from(`\r\n--${boundary}\r\n`)]));
  assert.equal(response.statusCode, 413, response.body);
  assert.deepEqual(response.json(), { error: "payload_too_large" });
});

test("additional files or fields reject the whole upload and clean the first staged file", async () => {
  for (const extra of [part("second.pdf"), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nvalue`)]) {
    const response = await request(Buffer.concat([part(), Buffer.from("\r\n"), extra, end]));
    assert.equal(response.statusCode, 413, response.body);
    assert.deepEqual(response.json(), { error: "payload_too_large" });
  }
});

test("disallowed suffix is rejected without exposing parser details or creating a file", async () => {
  const response = await request(Buffer.concat([part("file.exe"), end]));
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error, "file_type_not_allowed");
});

test("invalid boundary, non-multipart body and empty multipart have fixed safe errors", async () => {
  for (const [payload, type, status, error] of [["SECRET", "multipart/form-data", 400, "invalid_request"],
    ["{}", "application/json", 406, "unsupported_media_type"],
    [`--${boundary}--\r\n`, `multipart/form-data; boundary=${boundary}`, 400, "file_required"]]) {
    const response = await request(payload, type);
    assert.equal(response.statusCode, status, response.body);
    assert.deepEqual(response.json(), { error });
    assert.ok(!response.body.includes("SECRET"));
  }
});
