import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import { request as httpRequest } from "node:http";
import Fastify from "fastify";
import multipart from "@fastify/multipart";

const scratch = await mkdtemp(join(tmpdir(), "lms-receiver-test-"));
process.env.UPLOAD_DIR = join(scratch, "uploads");
const { receiveAttachment, UploadReceiveError } = await import("../src/upload-receiver.ts");
const { UploadCapacityError } = await import("../src/upload-capacity.ts");
const app = Fastify();
const boundary = "lms-receiver-test", bytes = Buffer.alloc(128 * 1024, "x");
let observed, control;
before(async () => {
  await app.register(multipart);
  app.post("/upload/:id", async (req, reply) => {
    try {
      const received = await receiveAttachment(req.raw, req.params.id, undefined, control);
      try {
        observed = { bytes: await readFile(received.staged.temporaryPath),
          filename: received.filename, extension: received.extension, size: received.bytesWritten,
          names: await readdir(join(process.env.UPLOAD_DIR, "lessons", req.params.id)) };
        return { ok: true };
      } finally { await received.staged.cleanup(); }
    } catch (error) {
      if (error instanceof UploadReceiveError) return reply.code(error.statusCode).send(error.response);
      if (error instanceof UploadCapacityError) return reply.code(error.statusCode).send({error:error.code});
      throw error;
    }
  });
  await app.ready();
});

test("space guard refuses the first write and removes the empty private staged file", async () => {
  const controller = new AbortController(); let checked = 0;
  control = {signal:controller.signal,beforeWrite:async()=>{checked++;throw new UploadCapacityError(507,'storage_full');}};
  try { const res=await request(Buffer.concat([part(),end]));assert.equal(res.statusCode,507,res.body);
    assert.deepEqual(res.json(),{error:'storage_full'});assert.ok(checked>0);
  } finally { control=undefined; }
});

test("falling free space during a real chunked HTTP stream removes already written partial bytes", async () => {
  const controller = new AbortController(), id=randomUUID(); let checkedBytes=0,calls=0,partialBytes=0;
  control={signal:controller.signal,beforeWrite:async n=>{calls++;checkedBytes+=n;if(checkedBytes>=32768){
    const dir=join(process.env.UPLOAD_DIR,"lessons",id),names=await readdir(dir);
    partialBytes=(await readFile(join(dir,names[0]))).length;
    throw new UploadCapacityError(507,"storage_full");
  }}};
  await app.listen({host:"127.0.0.1",port:0});
  const port=app.server.address().port;
  let outgoing;
  const response=new Promise((resolve,reject)=>{
    outgoing=httpRequest({host:"127.0.0.1",port,path:`/upload/${id}`,method:"POST",
      headers:{"content-type":`multipart/form-data; boundary=${boundary}`}},res=>{
        const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("error",reject);
        res.on("end",()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
      });outgoing.on("error",reject);
  });
  try{
    outgoing.write(part("sample.pdf",Buffer.alloc(0)));
    for(let i=0;i<3;i++){outgoing.write(Buffer.alloc(8192,"x"));await new Promise(r=>setTimeout(r,20));}
    outgoing.write(Buffer.alloc(8192,"x"));outgoing.end(end);
    const res=await response;assert.equal(res.status,507);assert.ok(calls>1);assert.ok(partialBytes>0);
    assert.deepEqual(res.body,{error:"storage_full"});assert.deepEqual(await readdir(join(process.env.UPLOAD_DIR,"lessons",id)),[]);
  }finally{outgoing.destroy();control=undefined;}
});

test("an aborted capacity lease cancels an active receiver and cleans its staged file", async () => {
  const controller=new AbortController();let entered;const ready=new Promise(r=>{entered=r;});
  control={signal:controller.signal,beforeWrite:async()=>{entered();await new Promise(r=>controller.signal.addEventListener('abort',r,{once:true}));throw controller.signal.reason;}};
  try{const active=request(Buffer.concat([part(),end]));await ready;controller.abort(new UploadCapacityError(408,'upload_timeout'));
    const res=await active;assert.equal(res.statusCode,408,res.body);assert.deepEqual(res.json(),{error:'upload_timeout'});
  }finally{control=undefined;}
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
