import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after,afterEach,before,beforeEach,test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
await import("./test-database.mjs");
const {pool}=await import('../src/db.ts');
const {eventRoutes}=await import('../src/routes/events.ts');
const {createSession}=await import('../src/auth/service.ts');
const {SESSION_COOKIE}=await import('../src/auth/constants.ts');
const {consumeEventRequest,EVENT_REQUEST_MAX}=await import('../src/client-events.ts');
const {installApiErrors}=await import('../src/api-validation.ts');
const {installPrivacyHeaders,privateLogger}=await import('../src/privacy.ts');
const {installCsrfProtection}=await import('../src/csrf.ts');
const origin='https://lms.example.test',logs=[];
const app=Fastify({logger:{...privateLogger,stream:{write:line=>logs.push(String(line))}}});
installApiErrors(app);installPrivacyHeaders(app);installCsrfProtection(app,origin);
let user,other,admin,course,module,lesson,foreignCourse,foreignModule,foreignLesson,cookies,otherCookies,adminCookies;
before(async()=>{await app.register(cookie);await app.register(eventRoutes);await app.ready();});
beforeEach(async()=>{
  [user,other,admin,course,module,lesson,foreignCourse,foreignModule,foreignLesson]=Array.from({length:9},randomUUID);
  await pool.query("insert into users(id,full_name,role) values ($1,'CI event owner','employee'),($2,'CI event other','employee'),($3,'CI event admin','admin')",[user,other,admin]);
  await pool.query("insert into courses(id,title,status) values ($1,'CI own','published'),($2,'CI foreign','published')",[course,foreignCourse]);
  await pool.query("insert into modules(id,course_id,title) values ($1,$2,'CI module'),($3,$4,'CI foreign module')",[module,course,foreignModule,foreignCourse]);
  await pool.query("insert into lessons(id,module_id,title) values ($1,$2,'CI lesson'),($3,$4,'CI foreign lesson')",[lesson,module,foreignLesson,foreignModule]);
  await pool.query("insert into assignments(user_id,course_id,assigned_by,deadline) values ($1,$2,$3,clock_timestamp()+interval '1 day')",[user,course,admin]);
  cookies={[SESSION_COOKIE]:(await createSession(user)).token};otherCookies={[SESSION_COOKIE]:(await createSession(other)).token};adminCookies={[SESSION_COOKIE]:(await createSession(admin)).token};logs.length=0;
});
afterEach(async()=>{await pool.query('delete from courses where id=any($1::uuid[])',[[course,foreignCourse]]);await pool.query('delete from users where id=any($1::uuid[])',[[user,other,admin]]);});
after(async()=>{try{await app.close();}finally{await pool.end();}});
function event(overrides={}){return {eventId:randomUUID(),eventType:'lesson_view_start',entityId:lesson,occurredAt:new Date().toISOString(),...overrides};}
function send(events,ownerId=user,session=cookies,source=origin){return app.inject({method:'POST',url:'/events',cookies:session,headers:source?{origin:source}:{},payload:{ownerId,events}});}
async function rows(){return (await pool.query('select * from events where user_id=any($1::uuid[]) order by client_event_id',[[user,other,admin]])).rows;}
function error(res,status,code){assert.equal(res.statusCode,status,res.body);assert.deepEqual(res.json(),{error:code});}
function ack(res,ids,inserted){assert.equal(res.statusCode,200,res.body);assert.deepEqual(res.json(),{accepted:ids.length,inserted,acceptedIds:ids,rejected:[]});}

test("authorized lesson events are appended with server-derived user/type and separate receipt time",async()=>{
  const events=[event({occurredAt:'2026-01-01T03:00:00+03:00'}),event({eventType:'lesson_view_end',payload:{durationMs:12345}})];
  ack(await send(events),events.map(e=>e.eventId),2);const all=await rows();assert.equal(all.length,2);
  const start=all.find(r=>r.client_event_id===events[0].eventId);assert.equal(start.user_id,user);assert.equal(start.entity_type,'lesson');assert.equal(start.entity_id,lesson);
  assert.equal(start.occurred_at.toISOString(),'2026-01-01T00:00:00.000Z');assert.ok(Date.now()-start.created_at.getTime()<10000);
  assert.equal(all.find(r=>r.client_event_id===events[1].eventId).payload.durationMs,12345);
});

test("concurrent requests and a retried lost reply create one journal row and ACK both",async()=>{
  const e=event();const results=await Promise.all([send([e]),send([e]),send([e])]);
  for(const res of results){assert.equal(res.statusCode,200,res.body);assert.deepEqual(res.json().acceptedIds,[e.eventId]);}
  assert.equal(results.reduce((n,r)=>n+r.json().inserted,0),1);assert.equal((await rows()).length,1);
  const before=await rows();ack(await send([{...e,eventId:e.eventId.toUpperCase(),entityId:lesson.toUpperCase()}]),[e.eventId],0);assert.deepEqual(await rows(),before);
});

test("a committed duplicate remains ACKable after expiry/deletion while new backdated events are refused",async()=>{
  const e=event();ack(await send([e]),[e.eventId],1);
  await pool.query("update assignments set deadline=clock_timestamp()-interval '1 second' where user_id=$1",[user]);
  ack(await send([e]),[e.eventId],0);
  const fresh=event({occurredAt:'2020-01-01T00:00:00Z'});assert.deepEqual((await send([fresh])).json().rejected,[{eventId:fresh.eventId,error:'deadline_passed'}]);
  await pool.query('delete from lessons where id=$1',[lesson]);ack(await send([e]),[e.eventId],0);assert.equal((await rows()).length,1);
});

test("reusing an ID with changed content is rejected without overwriting the first event",async()=>{
  const e=event({eventType:'lesson_view_end',payload:{durationMs:5}});await send([e]);const before=await rows();
  for(const changed of [{...e,payload:{durationMs:6}},{...e,entityId:foreignLesson},{...e,occurredAt:'2020-01-01T00:00:00Z'}]){
    assert.deepEqual((await send([changed])).json().rejected,[{eventId:e.eventId,error:'event_id_conflict'}]);
  }assert.deepEqual(await rows(),before);
});

test("event IDs are scoped per owner and a changed cookie cannot attribute an old queue to another user",async()=>{
  const e=event();await send([e]);error(await send([e],user,otherCookies),403,'event_owner_mismatch');
  await pool.query('insert into assignments(user_id,course_id,assigned_by) values ($1,$2,$3)',[other,course,admin]);
  ack(await send([e],other,otherCookies),[e.eventId],1);assert.equal((await rows()).length,2);
});

test("partial ACK rejects inaccessible/missing lessons without poisoning authorized events",async()=>{
  const good=event(),foreign=event({entityId:foreignLesson}),missing=event({entityId:randomUUID()});
  const result=await send([foreign,good,missing]);assert.equal(result.statusCode,200,result.body);
  assert.deepEqual(result.json(),{accepted:1,inserted:1,acceptedIds:[good.eventId],rejected:[{eventId:foreign.eventId,error:'not_assigned'},{eventId:missing.eventId,error:'not_found'}]});assert.equal((await rows()).length,1);
});

test("catalog events require enrollment, archived/completed-overdue courses deny access",async()=>{
  await pool.query("update courses set visibility='open_catalog' where id=$1",[foreignCourse]);
  let e=event({entityId:foreignLesson});assert.equal((await send([e])).json().rejected[0].error,'not_enrolled');
  await pool.query("update courses set status='archived' where id=$1",[course]);assert.equal((await send([event()])).json().rejected[0].error,'not_found');
  await pool.query("update courses set status='published' where id=$1",[course]);
  for(const status of ['completed','overdue']){await pool.query("update assignments set status=$2,deadline=clock_timestamp()-interval '1 microsecond' where user_id=$1",[user,status]);
    assert.equal((await send([event()])).json().rejected[0].error,'deadline_passed');}assert.deepEqual(await rows(),[]);
});

test("administrator can view existing unassigned lessons but cannot create events for nonexistent lessons",async()=>{
  const e=event({entityId:foreignLesson});ack(await send([e],admin,adminCookies),[e.eventId],1);
  const missing=event({entityId:randomUUID()});assert.equal((await send([missing],admin,adminCookies)).json().rejected[0].error,'not_found');
});

test("invalid calendar dates, future clocks and forged start durations receive permanent rejections",async()=>{
  for(const e of [event({occurredAt:'2026-02-30T00:00:00Z'}),event({occurredAt:new Date(Date.now()+3600000).toISOString()}),event({payload:{durationMs:1}})]) {
    const res=await send([e]);assert.equal(res.statusCode,200,res.body);assert.equal(res.json().accepted,0);assert.equal(res.json().rejected.length,1);
  }assert.deepEqual(await rows(),[]);
});

test("duplicate UUID aliases in a single batch fail atomically",async()=>{
  const e=event();error(await send([e,{...e,eventId:e.eventId.toUpperCase()}]),400,'invalid_request');assert.deepEqual(await rows(),[]);
});

test("anonymous/inactive/expired sessions and foreign/missing Origin cannot write or consume limits",async()=>{
  error(await send([event()],user,{}),401,'not_authenticated');
  for(const source of [null,'https://other.example.test'])error(await send([event()],user,cookies,source),403,'csrf_forbidden');
  await pool.query('update users set is_active=false where id=$1',[user]);error(await send([event()]),401,'not_authenticated');
  await pool.query('update users set is_active=true where id=$1',[user]);await pool.query("update sessions set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[user]);
  error(await send([event()]),401,'not_authenticated');assert.deepEqual(await rows(),[]);assert.equal((await pool.query('select * from event_rate_limits where user_id=$1',[user])).rowCount,0);
});

test("shared request limit returns 429/Retry-After, keeps expiry fixed, and resets by database clock",async()=>{
  const results=await Promise.all(Array.from({length:EVENT_REQUEST_MAX},()=>consumeEventRequest(user)));assert.ok(results.every(r=>r.allowed));
  const before=(await pool.query('select expires_at from event_rate_limits where user_id=$1',[user])).rows[0].expires_at;
  const res=await send([event()]);assert.equal(res.statusCode,429,res.body);assert.equal(res.json().error,'rate_limited');assert.ok(Number(res.headers['retry-after'])>0);
  assert.deepEqual((await pool.query('select expires_at from event_rate_limits where user_id=$1',[user])).rows[0].expires_at,before);assert.deepEqual(await rows(),[]);
  await pool.query("update event_rate_limits set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[user]);const e=event();ack(await send([e]),[e.eventId],1);
});

test("SQL failure midway through a batch rolls back events and returns no partial ACK or private details",async()=>{
  const connect=pool.connect;pool.connect=function(...args){if(args.length)return connect.apply(this,args);return (async()=>{const client=await connect.call(this),query=client.query,release=client.release;let inserts=0;
    client.query=function(...q){if(String(q[0]).startsWith('insert into events')&&++inserts===2)throw new Error('SECRET EVENT SQL /private');return query.apply(this,q);};
    client.release=function(...args){client.query=query;client.release=release;return release.apply(this,args);};return client;})();};
  let result;try{result=await send([event(),event()]);}finally{pool.connect=connect;}
  error(result,500,'internal_error');assert.equal(result.headers['cache-control'],'no-store');assert.doesNotMatch(result.body+logs.join(''),/SECRET EVENT SQL|\/private/);assert.deepEqual(await rows(),[]);
});

test("access is checked after an assignment lock wait, so shortening a deadline cannot be bypassed",async()=>{
  const blocker=await pool.connect();await blocker.query('begin');await blocker.query('select id from assignments where user_id=$1 for update',[user]);
  let pending;
  try{pending=send([event()]).then(r=>r);await until(async()=>(await pool.query("select user_id from event_rate_limits where user_id=$1",[user])).rowCount===1);await blocker.query("update assignments set deadline=clock_timestamp()-interval '1 second' where user_id=$1",[user]);await blocker.query('commit');
    const res=await pending;assert.equal(res.statusCode,200,res.body);assert.equal(res.json().rejected[0].error,'deadline_passed');assert.deepEqual(await rows(),[]);
  }finally{await blocker.query('rollback');blocker.release();if(pending)await pending;}
});

async function until(check){const deadline=Date.now()+5000;while(!await check()){assert.ok(Date.now()<deadline,'request did not reach auth/limit');await new Promise(r=>setTimeout(r,10));}}

test("deactivation while waiting on the owner lock rejects an already authenticated batch",async()=>{
  const blocker=await pool.connect();await blocker.query('begin');await blocker.query('select id from users where id=$1 for no key update',[user]);let pending;
  try{pending=send([event()]).then(r=>r);await until(async()=>(await pool.query('select user_id from event_rate_limits where user_id=$1',[user])).rowCount===1);
    await blocker.query('update users set is_active=false where id=$1',[user]);await blocker.query('commit');error(await pending,401,'not_authenticated');assert.deepEqual(await rows(),[]);
  }finally{await blocker.query('rollback');blocker.release();if(pending)await pending;}
});
