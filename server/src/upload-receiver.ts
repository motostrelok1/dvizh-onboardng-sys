import { Busboy } from "@fastify/busboy";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ALLOWED_EXTENSIONS, allowedExtension, openStagedAttachment } from "./storage.js";

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export class UploadReceiveError extends Error {
  constructor(public statusCode: number, public response: {
    error: string; allowed?: string[]; maxBytes?: number
  }) { super(response.error); }
}

// Attach listeners synchronously in Busboy's file event. The async req.file()
// interface can expose a part only AFTER a nextTick error has already fired.
export async function receiveAttachment(raw: IncomingMessage, lessonId: string,
  cleanupFailed: () => void = () => {}, control?: { signal: AbortSignal; beforeWrite(bytes: number): Promise<void> }) {
  const contentType = raw.headers["content-type"];
  if (!contentType || !/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new UploadReceiveError(406, { error: "unsupported_media_type" });
  }
  let parser;
  try {
    parser = new Busboy({ headers: { ...raw.headers, "content-type": contentType },
      limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0, parts: 1 } });
  } catch { throw new UploadReceiveError(400, { error: "invalid_request" }); }

  let staged: Awaited<ReturnType<typeof openStagedAttachment>> | undefined;
  let fileTask: Promise<void> | undefined, source: Readable | undefined;
  let filename = "", mimetype = "", extension = "", bytesWritten = 0;
  let failure: unknown, transferred = false;
  let done!: () => void;
  const parsed = new Promise<void>(resolve => { done = resolve; });
  const fail = (error: unknown) => {
    failure ??= error;
    raw.unpipe(parser);
    source?.destroy();
    parser.destroy();
    raw.resume(); // discard the remaining request; never leave parser backpressure
    done();
  };
  const invalid = () => fail(new UploadReceiveError(400, { error: "invalid_request" }));
  const limit = () => fail(new UploadReceiveError(413, { error: "payload_too_large" }));
  const aborted = () => { if (!raw.complete) invalid(); };
  parser.on("error", invalid);
  parser.on("finish", done);
  parser.on("filesLimit", limit);
  parser.on("fieldsLimit", limit);
  parser.on("partsLimit", limit);
  parser.on("file", (_field, stream, name, _encoding, mime) => {
    source = stream;
    stream.on("error", (error: NodeJS.ErrnoException) => fail(error.code ? error :
      new UploadReceiveError(400, { error: "invalid_request" }))); // before filesystem work
    stream.on("limit", () => fail(new UploadReceiveError(400,
      { error: "file_too_large", maxBytes: MAX_FILE_SIZE })));
    filename = typeof name === "string" ? name : ""; mimetype = mime;
    fileTask = (async () => {
      const allowed = allowedExtension(filename);
      if (!allowed) throw new UploadReceiveError(400,
        { error: "file_type_not_allowed", allowed: ALLOWED_EXTENSIONS });
      extension = allowed;
      if (failure) throw failure;
      staged = await openStagedAttachment(lessonId, filename);
      if (failure) throw failure;
      stream.on("data", (chunk: Buffer) => { bytesWritten += chunk.length; });
      const guard = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        Promise.resolve(control?.beforeWrite(chunk.length)).then(()=>callback(null,chunk),callback);
      } });
      await pipeline(stream,guard,staged.handle.createWriteStream(),{signal:control?.signal});
      if (stream.truncated) throw new UploadReceiveError(400,
        { error: "file_too_large", maxBytes: MAX_FILE_SIZE });
    })().catch(error => fail(control?.signal.aborted ? control.signal.reason : error));
  });
  raw.on("aborted", invalid);
  raw.on("error", invalid);
  raw.on("close", aborted);
  const cancelled = () => fail(control!.signal.reason);
  control?.signal.addEventListener("abort",cancelled,{once:true});
  try {
    if (control?.signal.aborted) cancelled(); else raw.pipe(parser);
    await parsed;
    await fileTask;
    if (failure) throw failure;
    if (!staged) throw new UploadReceiveError(400, { error: "file_required" });
    transferred = true;
    return { staged, filename, mimetype, extension, bytesWritten };
  } finally {
    raw.unpipe(parser);
    raw.removeListener("aborted", invalid);
    raw.removeListener("error", invalid);
    raw.removeListener("close", aborted);
    control?.signal.removeEventListener("abort",cancelled);
    if (staged && !transferred) await staged.cleanup().catch(cleanupFailed);
  }
}
