import assert from "node:assert/strict";
import {randomUUID,randomInt} from "node:crypto";
import {createRequire} from "node:module";
import {mkdtemp,rm,writeFile,readFile,lstat,rename,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {after,afterEach,before,beforeEach,test} from "node:test";
import {Pool} from "pg";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
await import('./test-database.mjs');
const bootstrap=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const name=`cleanup_test_${randomUUID().replaceAll('-','')}`;
const migration=createRequire(import.meta.url)('../migrations/1700000017000_attachment_file_cleanup.cjs');
const sql=direction=>{let q='';migration[direction]({sql:text=>{q+=text;}});return q;};
// Real migrated columns/indexes/checks plus the production content cascade FKs.
// Dedicated schema/storage/advisory namespace keep parallel CI fixtures private.
const setup=await bootstrap.connect();
try{await setup.query('begin');await setup.query(`create schema ${name};set local search_path to ${name},public`);
  for(const table of ['users','sessions','courses','modules','lessons','lesson_attachments'])await setup.query(`create table ${table}(like public.${table} including all)`);
  await setup.query(`alter table modules add foreign key(course_id) references courses(id) on delete cascade;
    alter table lessons add foreign key(module_id) references modules(id) on delete cascade;
    alter table lesson_attachments add foreign key(lesson_id) references lessons(id) on delete cascade;`);
  await setup.query(sql('up'));await setup.query('commit');
}finally{setup.release();}
const database=new URL(process.env.TEST_DATABASE_URL);database.searchParams.set('options',`-c search_path=${name},public`);process.env.DATABASE_URL=database.href;
const scratch=await mkdtemp(join(tmpdir(),'lms-cleanup-sql-'));process.env.UPLOAD_DIR=join(scratch,'uploads');
const {pool}=await import('../src/db.ts');
const namespace=randomInt(0x10000000,0x70000000);
pool.on('connect',client=>{const query=client.query.bind(client);client.query=function(text,params,...rest){
  if(typeof text==='string'&&/pg_(try_advisory_lock|advisory_unlock)\(/.test(text))params=[namespace,params[1]];
  return query(text,params,...rest);
};});
const {ensureLessonDir,UPLOAD_DIR,removeQueuedAttachmentFile}=await import('../src/storage.ts');
const {processAttachmentCleanup,CLEANUP_BATCH_SIZE}=await import('../src/jobs/attachment-cleanup.ts');
const {createJobRunner,jobRunner}=await import('../src/jobs/runner.ts');
const {adminAttachmentRoutes}=await import('../src/routes/admin-attachments.ts');
const {adminCourseRoutes}=await import('../src/routes/admin-courses.ts');
const {createSession}=await import('../src/auth/service.ts');
const {SESSION_COOKIE}=await import('../src/auth/constants.ts');
const {installApiErrors}=await import('../src/api-validation.ts');
const {installPrivacyHeaders,privateLogger}=await import('../src/privacy.ts');
const {installCsrfProtection}=await import('../src/csrf.ts');
const origin='https://lms.example.test',logs=[];
const app=Fastify({logger:{...privateLogger,stream:{write:line=>logs.push(String(line))}}});
installApiErrors(app);installPrivacyHeaders(app);installCsrfProtection(app,origin);
let admin,user,course,module,lesson,otherCourse,otherModule,otherLesson,cookies,userCookies,own,other;
before(async()=>{await app.register(cookie);await app.register(adminAttachmentRoutes);await app.register(adminCourseRoutes);await app.ready();});
async function attachment(lessonId=lesson,path){const id=randomUUID(),file=path??join(await ensureLessonDir(lessonId),`${id}-legacy.pdf`);
  if(!path)await writeFile(file,`private bytes ${id}`);
  await pool.query(`insert into lesson_attachments(id,lesson_id,file_name,file_path,position)
    values ($1,$2,'CI file.pdf',$3,(select coalesce(max(position),-1)+1 from lesson_attachments where lesson_id=$2))`,[id,lessonId,file]);return {id,path:file,lessonId};}
beforeEach(async()=>{
  [admin,user,course,module,lesson,otherCourse,otherModule,otherLesson]=Array.from({length:8},()=>randomUUID());
  await pool.query("insert into users(id,full_name,role) values ($1,'CI cleanup admin','admin'),($2,'CI cleanup user','employee')",[admin,user]);
  await pool.query("insert into courses(id,title,status) values ($1,'CI own','published'),($2,'CI other','published')",[course,otherCourse]);
  await pool.query("insert into modules(id,course_id,title) values ($1,$2,'CI module'),($3,$4,'CI other module')",[module,course,otherModule,otherCourse]);
  await pool.query("insert into lessons(id,module_id,title) values ($1,$2,'CI lesson'),($3,$4,'CI other lesson')",[lesson,module,otherLesson,otherModule]);
  cookies={[SESSION_COOKIE]:(await createSession(admin)).token};userCookies={[SESSION_COOKIE]:(await createSession(user)).token};
  own=await attachment();other=await attachment(otherLesson);logs.length=0;
});
afterEach(async()=>{
  // This entire schema is owned by this test file, never public fixtures.
  await pool.query('delete from courses');await pool.query('delete from users');await pool.query('delete from attachment_file_cleanup');await rm(UPLOAD_DIR,{recursive:true,force:true});
});
after(async()=>{try{await app.close();await jobRunner.stop();await pool.end();}finally{await bootstrap.query(`drop schema ${name} cascade`);await bootstrap.end();await rm(scratch,{recursive:true,force:true});}});
const queue=async()=> (await pool.query('select * from attachment_file_cleanup order by created_at,id')).rows;
const count=async()=> (await pool.query('select count(*)::int as n from lesson_attachments')).rows[0].n;
const request=(url,session=cookies,source=origin)=>app.inject({method:'DELETE',url,cookies:session,headers:source?{origin:source}:{}});
const due=()=>pool.query("update attachment_file_cleanup set next_attempt_at=clock_timestamp()-interval '1 second'");
async function run(remove,executor){const runner=createJobRunner(pool,()=>{});try{return await runner.run('attachment_cleanup',client=>processAttachmentCleanup(executor?.(client)??client,null,remove));}finally{await runner.stop();}}
const noFile=path=>assert.rejects(lstat(path),{code:'ENOENT'});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(check){const end=Date.now()+5000;while(!await check()){assert.ok(Date.now()<end,'expected database lock');await new Promise(r=>setTimeout(r,10));}}

test("explicit DELETE commits metadata before unlink, is idempotent, and retains another lesson's file",async()=>{
  const result=await request(`/admin/attachments/${own.id}`);assert.equal(result.statusCode,200,result.body);assert.deepEqual(result.json(),{ok:true});
  await noFile(own.path);assert.equal(await count(),1);assert.equal((await queue()).length,0);assert.ok(await readFile(other.path));
  assert.equal((await request(`/admin/attachments/${own.id}`)).statusCode,200);assert.equal((await queue()).length,0);
});
for(const kind of ['lesson','module','course'])test(`${kind} API cascade queues every deleted attachment and leaves other content intact`,async()=>{
  const second=await attachment();const target=kind==='lesson'?lesson:kind==='module'?module:course;
  const result=await request(`/admin/${kind==='lesson'?'lessons':kind==='module'?'modules':'courses'}/${target}`);assert.equal(result.statusCode,200,result.body);
  assert.equal(await count(),1);assert.equal((await queue()).length,2);assert.ok(await readFile(own.path));
  assert.deepEqual(await run(),{completed:2,deferred:0});await noFile(own.path);await noFile(second.path);assert.ok(await readFile(other.path));
});
test("uncommitted/rolled-back cascade is invisible to cleanup and retains rows/files",async()=>{
  const client=await pool.connect();try{await client.query('begin');await client.query('delete from courses where id=$1',[course]);
    assert.equal((await client.query('select * from attachment_file_cleanup')).rowCount,1);assert.equal((await queue()).length,0);
    assert.deepEqual(await run(),{completed:0,deferred:0});await client.query('rollback');assert.equal(await count(),2);assert.ok(await readFile(own.path));
  }finally{await client.query('rollback');client.release();}
});
test("trigger enqueue failure rolls back DELETE and never unlinks or exposes private SQL",async()=>{
  await pool.query(`create function fail_cleanup_fixture() returns trigger language plpgsql as $$ begin raise exception 'SECRET private SQL /path';end $$;
    create trigger fail_cleanup_fixture before insert on attachment_file_cleanup for each row execute function fail_cleanup_fixture();`);
  let result;try{result=await request(`/admin/attachments/${own.id}`);}finally{await pool.query('drop trigger fail_cleanup_fixture on attachment_file_cleanup;drop function fail_cleanup_fixture()');}
  assert.equal(result.statusCode,500,result.body);assert.deepEqual(result.json(),{error:'internal_error'});assert.equal(await count(),2);assert.equal((await queue()).length,0);
  assert.ok(await readFile(own.path));assert.doesNotMatch(result.body+logs.join(''),/SECRET|private SQL|\/path/);
});
test("filesystem failure persists a bounded retry and a new runner completes it after restart",async()=>{
  await pool.query('delete from lessons where id=$1',[lesson]);const result=await run(async()=>{throw new Error('SECRET EACCES /path');});assert.deepEqual(result,{completed:0,deferred:1});
  const pending=(await queue())[0];assert.equal(pending.attempts,1);assert.equal(pending.last_error,'filesystem_error');assert.ok(pending.next_attempt_at.getTime()>Date.now()+50000);
  assert.deepEqual(await run(()=>assert.fail('retry ran early')),{completed:0,deferred:0});assert.ok(await readFile(own.path));
  await due();assert.deepEqual(await run(),{completed:1,deferred:0});await noFile(own.path);assert.equal((await queue()).length,0);assert.ok(await readFile(other.path));
});
test("already missing file is acknowledged idempotently after a crash between unlink and queue completion",async()=>{
  await pool.query('delete from lessons where id=$1',[lesson]);await rm(own.path);assert.deepEqual(await run(),{completed:1,deferred:0});assert.equal((await queue()).length,0);
});
test("failed queue completion SQL rolls back job metadata and a retry tolerates the already unlinked file",async()=>{
  await pool.query('delete from lessons where id=$1',[lesson]);await assert.rejects(run(undefined,client=>({query:async(sql,args)=>{
    if(sql.startsWith('delete from attachment_file_cleanup'))throw new Error('completion lost');return client.query(sql,args);
  }})),/completion lost/);
  await noFile(own.path);assert.equal((await queue()).length,1);assert.deepEqual(await run(),{completed:1,deferred:0});assert.equal((await queue()).length,0);
});
test("SQL-alias shared live path is deferred until its last reference is deleted",async()=>{
  const shared=await attachment(lesson,own.path.replace('/lessons/','/lessons/./'));
  await pool.query('delete from lesson_attachments where id=$1',[own.id]);assert.deepEqual(await run(),{completed:0,deferred:1});assert.equal((await queue())[0].last_error,'still_referenced');assert.ok(await readFile(own.path));
  await pool.query('delete from lesson_attachments where id=$1',[shared.id]);await due();assert.deepEqual(await run(),{completed:2,deferred:0});await noFile(own.path);assert.ok(await readFile(other.path));
});
test("cascade of a corrupt outside path retains an unsafe job without touching outside/other files",async()=>{
  const outside=join(scratch,randomUUID());await writeFile(outside,'outside');await pool.query('update lesson_attachments set file_path=$2 where id=$1',[own.id,outside]);
  await pool.query('delete from lessons where id=$1',[lesson]);assert.deepEqual(await run(),{completed:0,deferred:1});assert.equal((await queue())[0].last_error,'unsafe_path');assert.equal(await readFile(outside,'utf8'),'outside');assert.ok(await readFile(other.path));
});
test("a queued symlink is retained and never follows or unlinks its external target",async()=>{
  const outside=join(scratch,randomUUID());await writeFile(outside,'outside');await rm(own.path);await symlink(outside,own.path);
  await pool.query('delete from lessons where id=$1',[lesson]);assert.deepEqual(await run(),{completed:0,deferred:1});assert.equal((await queue())[0].last_error,'unsafe_path');assert.ok((await lstat(own.path)).isSymbolicLink());assert.equal(await readFile(outside,'utf8'),'outside');
});
test("a missing storage root defers jobs; restoring the same root permits cleanup",async()=>{
  await pool.query('delete from lessons where id=$1',[lesson]);const moved=join(scratch,randomUUID());await rename(UPLOAD_DIR,moved);
  try{assert.deepEqual(await run(),{completed:0,deferred:1});assert.equal((await queue())[0].last_error,'filesystem_error');}finally{await rename(moved,UPLOAD_DIR);}
  assert.ok(await readFile(own.path));await due();assert.deepEqual(await run(),{completed:1,deferred:0});assert.ok(await readFile(other.path));
});
test("multiple workers share the cleanup lane; shutdown waits for unlink and other job lanes remain available",async()=>{
  await pool.query('delete from lessons where id=$1',[lesson]);const first=createJobRunner(pool,()=>{}),second=createJobRunner(pool,()=>{}),entered=deferred(),gate=deferred();
  const active=first.run('attachment_cleanup',client=>processAttachmentCleanup(client,null,async(...args)=>{entered.resolve();await gate.promise;await removeQueuedAttachmentFile(...args);}));
  await entered.promise;let stopped=false;
  try{await assert.rejects(second.run('attachment_cleanup',()=>assert.fail('duplicate work')),{code:'job_in_progress'});assert.equal(await second.run('deadlines',async()=>7),7);
    const stop=first.stop().then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);gate.resolve();assert.deepEqual(await active,{completed:1,deferred:0});await stop;
  }finally{gate.resolve();await active;await first.stop();await second.stop();}
});
test("metadata table fence blocks a new attachment INSERT until cleanup completes",async()=>{
  await pool.query('delete from lesson_attachments where id=$1',[own.id]);const runner=createJobRunner(pool,()=>{}),entered=deferred(),gate=deferred(),writer=await pool.connect();
  const active=runner.run('attachment_cleanup',client=>processAttachmentCleanup(client,null,async(...args)=>{entered.resolve();await gate.promise;await removeQueuedAttachmentFile(...args);}));
  await entered.promise;let insert;
  try{const pid=(await writer.query('select pg_backend_pid() as pid')).rows[0].pid;const id=randomUUID();
    insert=writer.query("insert into lesson_attachments(id,lesson_id,file_name,file_path,position) values ($1,$2,'CI concurrent',$3,1)",[id,otherLesson,other.path]);
    await until(async()=>(await pool.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==='Lock');
    gate.resolve();await active;await insert;assert.equal((await pool.query('select id from lesson_attachments where id=$1',[id])).rowCount,1);assert.ok(await readFile(other.path));
  }finally{gate.resolve();await active;if(insert)await insert;writer.release();await runner.stop();}
});
test("busy attachment metadata returns NOWAIT without unlink and leaves the durable job ready",async()=>{
  await pool.query('delete from lesson_attachments where id=$1',[own.id]);const writer=await pool.connect();
  try{await writer.query('begin');await writer.query('update lesson_attachments set file_name=file_name where id=$1',[other.id]);
    await assert.rejects(run(),{code:'55P03'});assert.ok(await readFile(own.path));assert.equal((await queue()).length,1);await writer.query('commit');assert.deepEqual(await run(),{completed:1,deferred:0});
  }finally{await writer.query('rollback');writer.release();}
});
test("a run processes at most 50 files and retains the remaining committed cascade jobs",async()=>{
  for(let i=1;i<CLEANUP_BATCH_SIZE+3;i++)await attachment();await pool.query('delete from courses where id=$1',[course]);
  assert.equal((await queue()).length,53);assert.deepEqual(await run(),{completed:50,deferred:0});assert.equal((await queue()).length,3);
  assert.deepEqual(await run(),{completed:3,deferred:0});assert.equal((await queue()).length,0);assert.ok(await readFile(other.path));
});
test("one unsafe job does not prevent another ready file from being cleaned",async()=>{
  const outside=join(scratch,randomUUID());await writeFile(outside,'outside');await attachment(lesson,outside);await pool.query('delete from lessons where id=$1',[lesson]);
  assert.deepEqual(await run(),{completed:1,deferred:1});await noFile(own.path);assert.equal((await queue()).length,1);assert.equal(await readFile(outside,'utf8'),'outside');
});
test("anonymous/employee/foreign Origin requests cannot delete attachments or queue files",async()=>{
  for(const [session,source,status] of [[{},origin,401],[userCookies,origin,403],[cookies,null,403],[cookies,'https://foreign.example.test',403]]){
    const result=await request(`/admin/attachments/${own.id}`,session,source);assert.equal(result.statusCode,status,result.body);
  }assert.equal(await count(),2);assert.equal((await queue()).length,0);assert.ok(await readFile(own.path));
});
test("archiving a course retains attachments and does not enqueue file deletion",async()=>{
  await pool.query("update courses set status='archived' where id=$1",[course]);assert.equal(await count(),2);assert.equal((await queue()).length,0);assert.ok(await readFile(own.path));
});
test("migration down refuses pending jobs and empty down/up preserves live legacy metadata",async()=>{
  const before=(await pool.query('select * from lesson_attachments order by id')).rows;
  await pool.query(sql('down'));assert.deepEqual((await pool.query('select * from lesson_attachments order by id')).rows,before);await pool.query(sql('up'));
  await pool.query('delete from lessons where id=$1',[lesson]);const client=await pool.connect();
  try{await client.query('begin');await client.query('savepoint down');await assert.rejects(client.query(sql('down')),/pending_attachment_file_cleanup/);await client.query('rollback to savepoint down');await client.query('commit');}
  finally{client.release();}assert.equal((await queue()).length,1);assert.deepEqual(await run(),{completed:1,deferred:0});
});
