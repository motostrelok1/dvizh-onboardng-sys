import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {after,afterEach,before,test} from "node:test";
const names=['localStorage','fetch','window','setInterval'];
const original=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
const storage=new Map(),calls=[];let respond=()=>new Response('{}',{status:500}),api,events;
before(async()=>{
  const values={window:{addEventListener:()=>{}},setInterval:()=>0,
    localStorage:{get length(){return storage.size;},key:n=>[...storage.keys()][n]??null,getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{calls.push({url,options});return respond(url,options);}};
  for(const [name,value] of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  ({api}=await import('../../client/src/admin/api.ts'));events=await import('../../client/src/events.ts');
});
afterEach(()=>{events.setEventOwner(null);storage.clear();calls.length=0;});
after(()=>{for(const [name,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
const response=user=>new Response(JSON.stringify({user:{id:user,role:'employee'}}));

test("real API confirms queue ownership after login/me and clears it before logout",async()=>{
  const user=randomUUID();respond=url=>url==='/api/events'?new Response('{}',{status:500}):response(user);
  await api.post('/auth/login',{email:'fixture@example.test',password:'fixture'});
  events.enqueueEvent({eventType:'lesson_view_start',entityId:randomUUID()});await events.flush();
  assert.equal(storage.get('lms_event_owner_v2'),user);assert.ok([...storage.keys()].some(k=>k.startsWith('lms_event_v2:')));
  respond=url=>{if(url==='/api/auth/logout')assert.equal(storage.size,0);return new Response('{}');};
  await api.post('/auth/logout');assert.equal(storage.size,0);
});
test("a stale auth/me reply after logout cannot reactivate the previous queue",async()=>{
  let release;const user=randomUUID();respond=url=>url==='/api/auth/me'?new Promise(r=>{release=()=>r(response(user));}):new Response('{}');
  const me=api.get('/auth/me');await api.post('/auth/logout');release();await me;
  assert.equal(storage.get('lms_event_owner_v2'),undefined);const count=calls.length;
  events.enqueueEvent({eventType:'lesson_view_start',entityId:randomUUID()});await events.flush();assert.equal(calls.length,count);
});
test("an old 401 cannot pause a newer login or send events as the previous user",async()=>{
  let release;const next=randomUUID();respond=url=>url==='/api/me/courses'?new Promise(r=>{release=()=>r(new Response('{"error":"not_authenticated"}',{status:401}));}):url==='/api/auth/login'?response(next):new Response('{}',{status:500});
  const old=api.get('/me/courses').catch(e=>e.message);await api.post('/auth/login',{});release();assert.equal(await old,'not_authenticated');
  events.enqueueEvent({eventType:'lesson_view_start',entityId:randomUUID()});await events.flush();
  assert.equal(JSON.parse(calls.find(c=>c.url==='/api/events').options.body).ownerId,next);
});
