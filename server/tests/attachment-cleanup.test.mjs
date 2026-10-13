import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {EventEmitter} from "node:events";
import {mkdtemp,mkdir,rename,rm,writeFile,readFile,lstat,symlink} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {after,beforeEach,test} from "node:test";
const scratch=await mkdtemp(join(tmpdir(),'lms-cleanup-unit-'));
process.env.UPLOAD_DIR=join(scratch,'uploads');
const {UPLOAD_DIR,ensureLessonDir,validateAttachmentDeletion,removeQueuedAttachmentFile,StoragePathError}=await import('../src/storage.ts');
const {cleanupRetrySeconds}=await import('../src/jobs/attachment-cleanup.ts');
const {createJobRunner}=await import('../src/jobs/runner.ts');
const {pool}=await import('../src/db.ts');await pool.end();
let lesson,path;
beforeEach(async()=>{await rm(UPLOAD_DIR,{recursive:true,force:true});lesson=randomUUID();path=join(await ensureLessonDir(lesson),`${randomUUID()}-legacy.pdf`);await writeFile(path,'keep until commit');});
after(()=>rm(scratch,{recursive:true,force:true}));

test("explicit deletion precheck is read-only; queued deletion unlinks only its own regular leaf",async()=>{
  const other=join(await ensureLessonDir(randomUUID()),'other.pdf');await writeFile(other,'other');
  await validateAttachmentDeletion(lesson,path);assert.equal(await readFile(path,'utf8'),'keep until commit');
  await removeQueuedAttachmentFile(lesson,path);await assert.rejects(lstat(path),{code:'ENOENT'});assert.equal(await readFile(other,'utf8'),'other');
});
test("missing leaf and lesson directory are idempotent only under a verified root",async()=>{
  await removeQueuedAttachmentFile(lesson,path);await removeQueuedAttachmentFile(lesson,path);
  await rm(join(UPLOAD_DIR,'lessons',lesson),{recursive:true});await removeQueuedAttachmentFile(lesson,path);
});
test("unavailable upload root retains evidence instead of treating a missing mount as a removed file",async()=>{
  const moved=join(scratch,randomUUID());await rename(UPLOAD_DIR,moved);
  await assert.rejects(removeQueuedAttachmentFile(lesson,path),{code:'ENOENT'});
  await rename(moved,UPLOAD_DIR);assert.equal(await readFile(path,'utf8'),'keep until commit');
});
test("cleanup rejects outside, sibling and nested paths without modifying any target",async()=>{
  const outside=join(scratch,'outside.pdf');await writeFile(outside,'outside');
  for(const target of [outside,join(UPLOAD_DIR,'lessons',randomUUID(),'other.pdf'),join(UPLOAD_DIR,'lessons',lesson,'nested','x.pdf')])await assert.rejects(removeQueuedAttachmentFile(lesson,target),StoragePathError);
  assert.equal(await readFile(outside,'utf8'),'outside');assert.equal(await readFile(path,'utf8'),'keep until commit');
});
test("cleanup refuses a leaf symlink and never unlinks the external target",async()=>{
  const outside=join(scratch,randomUUID());await writeFile(outside,'outside');await rm(path);await symlink(outside,path);
  await assert.rejects(removeQueuedAttachmentFile(lesson,path),StoragePathError);assert.equal(await readFile(outside,'utf8'),'outside');assert.ok((await lstat(path)).isSymbolicLink());
});
test("cleanup refuses lesson/root symlinks and directory leaves",async()=>{
  await rm(path);await mkdir(path);await assert.rejects(removeQueuedAttachmentFile(lesson,path),StoragePathError);
  await rm(join(UPLOAD_DIR,'lessons',lesson),{recursive:true});const outside=join(scratch,randomUUID());await mkdir(outside);await symlink(outside,join(UPLOAD_DIR,'lessons',lesson));
  await assert.rejects(removeQueuedAttachmentFile(lesson,path),StoragePathError);
  await rm(UPLOAD_DIR,{recursive:true});await symlink(outside,UPLOAD_DIR);await assert.rejects(removeQueuedAttachmentFile(lesson,path),StoragePathError);
});
test("retry is bounded exponential backoff and never becomes zero or over an hour",()=>{
  assert.deepEqual([0,1,2,3,4,5,6,1000000].map(cleanupRetrySeconds),[60,120,240,480,960,1920,3600,3600]);
  assert.equal(cleanupRetrySeconds(-1),60);
});
test("cleanup lane uses a separate stable advisory key and participates in drain",async()=>{
  const keys=[],client=new EventEmitter();client.query=async(sql,params)=>{if(sql.includes('pg_try_advisory_lock'))keys.push(params[1]);return {rows:[{locked:true,unlocked:true}]};};client.release=()=>{};
  const runner=createJobRunner({connect:async()=>client},()=>{});
  for(const lane of ['deadlines','reports','notifications','attachment_cleanup'])assert.equal(await runner.run(lane,async()=>7),7);
  assert.deepEqual(keys,[1,2,3,4]);await runner.stop();await assert.rejects(runner.run('attachment_cleanup',async()=>1),{code:'job_stopping'});
});
