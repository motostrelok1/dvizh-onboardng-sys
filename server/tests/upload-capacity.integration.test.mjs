import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,readdir,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {after,afterEach,before,beforeEach,test} from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
await import('./test-database.mjs');
const scratch=await mkdtemp(join(tmpdir(),'lms-upload-capacity-'));process.env.UPLOAD_DIR=join(scratch,'uploads');
const {pool}=await import('../src/db.ts');
const {createUploadCapacity,uploadLockNamespace,availableUploadBytes}=await import('../src/upload-capacity.ts');
const {ensureUploadRoot,UPLOAD_DIR}=await import('../src/storage.ts');
const {MAX_FILE_SIZE}=await import('../src/upload-receiver.ts');
const {adminAttachmentRoutes}=await import('../src/routes/admin-attachments.ts');
const {createSession}=await import('../src/auth/service.ts');
const {SESSION_COOKIE}=await import('../src/auth/constants.ts');
const {installApiErrors}=await import('../src/api-validation.ts');
const {installPrivacyHeaders,privateLogger}=await import('../src/privacy.ts');
const {installCsrfProtection}=await import('../src/csrf.ts');
const {PDF}=await import('./file-fixtures.mjs');
const floor=256n*1024n*1024n,limits={maxConcurrent:2,minFreeBytes:floor,timeoutMs:10000};
let free=1024n*1024n*1024n,measureFailure,admin,user,course,module,lesson,cookies,userCookies;
const gate=()=>createUploadCapacity({limits,available:async()=>free});
const apiGate=createUploadCapacity({limits,available:async()=>{if(measureFailure)throw measureFailure;return free;}});
const origin='https://lms.example.test',boundary='capacity-test-boundary',logs=[];
const app=Fastify({logger:{...privateLogger,stream:{write:line=>logs.push(String(line))}}});
installApiErrors(app);installPrivacyHeaders(app);installCsrfProtection(app,origin);
before(async()=>{await app.register(cookie);await app.register(multipart);await app.register(adminAttachmentRoutes,{uploadCapacity:apiGate});await app.ready();});
beforeEach(async()=>{
  free=1024n*1024n*1024n;measureFailure=undefined;logs.length=0;
  [admin,user,course,module,lesson]=Array.from({length:5},()=>randomUUID());
  await pool.query("insert into users(id,full_name,role) values ($1,'CI capacity admin','admin'),($2,'CI capacity user','employee')",[admin,user]);
  await pool.query("insert into courses(id,title) values ($1,'CI capacity course')",[course]);
  await pool.query("insert into modules(id,course_id,title) values ($1,$2,'CI capacity module')",[module,course]);
  await pool.query("insert into lessons(id,module_id,title) values ($1,$2,'CI capacity lesson')",[lesson,module]);
  cookies={[SESSION_COOKIE]:(await createSession(admin)).token};userCookies={[SESSION_COOKIE]:(await createSession(user)).token};await ensureUploadRoot();
});
afterEach(async()=>{await pool.query('delete from courses where id=$1',[course]);await pool.query('delete from users where id=any($1::uuid[])',[[admin,user]]);await rm(UPLOAD_DIR,{recursive:true,force:true});});
after(async()=>{try{await app.close();await apiGate.stop();await pool.end();}finally{await rm(scratch,{recursive:true,force:true});}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function upload(session=cookies,source=origin,complete=true){return app.inject({method:'POST',url:`/admin/lessons/${lesson}/attachments`,cookies:session,
  headers:{...(source?{origin:source}:{}),'content-type':`multipart/form-data; boundary=${boundary}`},
  payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),PDF,...(complete?[Buffer.from(`\r\n--${boundary}--\r\n`)]:[])])});}
async function files(){return readdir(join(UPLOAD_DIR,'lessons',lesson)).catch(e=>{if(e.code==='ENOENT')return [];throw e;});}
async function rows(){return (await pool.query('select * from lesson_attachments where lesson_id=$1',[lesson])).rows;}
async function locks(){const namespace=uploadLockNamespace(await ensureUploadRoot());return (await pool.query(`select pid,objid::int as slot from pg_locks
  where locktype='advisory' and database=(select oid from pg_database where datname=current_database())
    and classid=$1::oid and objsubid=2 and objid between 1 and 8 and granted`,[namespace])).rows;}
async function empty(){assert.deepEqual(await rows(),[]);assert.deepEqual(await files(),[]);assert.deepEqual(await locks(),[]);}
function error(res,status,code){assert.equal(res.statusCode,status,res.body);assert.deepEqual(res.json(),{error:code});assert.equal(res.headers['cache-control'],'no-store');}

test("two independent gate instances share slots in PostgreSQL and a third gets busy without work",async()=>{
  const first=gate(),second=gate(),third=gate(),entered=deferred(),release=deferred();let count=0;
  const hold=async()=>{if(++count===2)entered.resolve();await release.promise;return 7;};
  const tasks=[first.run(hold),second.run(hold)];await entered.promise;
  try{assert.equal((await locks()).length,2);await assert.rejects(third.run(()=>assert.fail('third wrote')),{code:'upload_busy'});
    release.resolve();assert.deepEqual(await Promise.all(tasks),[7,7]);assert.equal(await third.run(async()=>9),9);assert.deepEqual(await locks(),[]);
  }finally{release.resolve();await Promise.allSettled(tasks);await Promise.all([first.stop(),second.stop(),third.stop()]);}
});
test("body receive, format validation and COMMIT complete under one permit, returning a private DTO",async()=>{
  const res=await upload();assert.equal(res.statusCode,201,res.body);assert.equal(res.json().attachment.file_path,undefined);
  const stored=await rows();assert.equal(stored.length,1);assert.deepEqual(await readFile(stored[0].file_path),PDF);assert.equal((await files()).length,1);assert.deepEqual(await locks(),[]);
});
test("busy API returns Retry-After without staging and works after existing permits release",async()=>{
  const first=gate(),second=gate(),ready=deferred(),release=deferred();let count=0;const hold=async()=>{if(++count===2)ready.resolve();await release.promise;};
  const tasks=[first.run(hold),second.run(hold)];await ready.promise;
  try{const res=await upload();error(res,429,'upload_busy');assert.equal(res.headers['retry-after'],'5');assert.deepEqual(await files(),[]);assert.deepEqual(await rows(),[]);
    release.resolve();await Promise.all(tasks);assert.equal((await upload()).statusCode,201);
  }finally{release.resolve();await Promise.allSettled(tasks);await first.stop();await second.stop();}
});
test("low available space rejects before staging and a later recovered filesystem accepts uploads",async()=>{
  free=floor+BigInt(MAX_FILE_SIZE)-1n;error(await upload(),507,'storage_full');await empty();
  free=floor+BigInt(MAX_FILE_SIZE)+1024n;assert.equal((await upload()).statusCode,201);assert.deepEqual(await locks(),[]);
});
test("space admission accounts for another occupied slot rather than trusting small client payloads",async()=>{
  const first=gate(),ready=deferred(),release=deferred();const active=first.run(async()=>{ready.resolve();await release.promise;});await ready.promise;
  try{free=floor+BigInt(MAX_FILE_SIZE)+1024n;error(await upload(),507,'storage_full');assert.equal((await locks()).length,1);assert.deepEqual(await files(),[]);
  }finally{release.resolve();await active;await first.stop();}assert.deepEqual(await locks(),[]);
});
test("a real statfs measurement uses nonnegative bigint available bytes in the verified root",async()=>{
  const free=await availableUploadBytes(await ensureUploadRoot());assert.equal(typeof free,'bigint');assert.ok(free>0n);
});
test("measurement errors are fixed private failures and OS quota/full errors map to storage_full",async()=>{
  for(const code of ['EACCES','ENOSPC','EDQUOT']){measureFailure=Object.assign(new Error('SECRET /srv/private mount'),{code});
    const res=await upload();error(res,code==='EACCES'?503:507,code==='EACCES'?'upload_unavailable':'storage_full');await empty();
    assert.doesNotMatch(res.body+logs.join(''),/SECRET|\/srv\/private/);
  }
});
test("failed/truncated multipart releases the permit and removes temporary bytes before retry",async()=>{
  error(await upload(cookies,origin,false),400,'invalid_request');await empty();assert.equal((await upload()).statusCode,201);assert.deepEqual(await locks(),[]);
});
test("anonymous/employee/foreign Origin never enter the capacity gate or probe disk space",async()=>{
  measureFailure=new Error('unexpected filesystem probe');
  for(const [session,source,status,code] of [[{},origin,401,'not_authenticated'],[userCookies,origin,403,'admin_only'],[cookies,null,403,'csrf_forbidden'],[cookies,'https://foreign.example.test',403,'csrf_forbidden']])error(await upload(session,source),status,code);
  await empty();
});
test("terminating a permit's real PostgreSQL session aborts work and automatically releases its slot",async()=>{
  const first=gate(),ready=deferred();
  const active=first.run(async control=>{ready.resolve();await new Promise(r=>control.signal.addEventListener('abort',r,{once:true}));control.assertActive();});
  const rejected=assert.rejects(active,{code:'upload_unavailable'});await ready.promise;
  try{const held=await locks();assert.equal(held.length,1);assert.equal((await pool.query('select pg_terminate_backend($1) as killed',[held[0].pid])).rows[0].killed,true);
    await rejected;assert.deepEqual(await locks(),[]);assert.equal(await first.run(async()=>7),7);
  }finally{await first.stop();}
});
test("timeout and source cancellation drain their PostgreSQL permits before a new admission",async()=>{
  const short=createUploadCapacity({limits:{...limits,timeoutMs:30},available:async()=>free});
  try{await assert.rejects(short.run(async control=>{await new Promise(r=>control.signal.addEventListener('abort',r,{once:true}));control.assertActive();}),{code:'upload_timeout'});
    assert.deepEqual(await locks(),[]);
  }finally{await short.stop();}
  const first=gate(),controller=new AbortController(),ready=deferred();
  const work=first.run(async control=>{ready.resolve();await new Promise(r=>control.signal.addEventListener('abort',r,{once:true}));control.assertActive();},controller.signal);
  const rejected=assert.rejects(work,{code:'upload_timeout'});await ready.promise;controller.abort();await rejected;assert.deepEqual(await locks(),[]);await first.stop();
});
