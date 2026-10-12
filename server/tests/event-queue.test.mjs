import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createEventQueue, MAX_EVENT_QUEUE } from "../../client/src/event-queue.ts";

function fixture(shared = new Map()) {
  let now = Date.now(), response = async () => { throw new Error('offline'); };
  const calls = [], beacons = [];
  const storage = { get length() { return shared.size; }, key: n => [...shared.keys()][n] ?? null,
    getItem: k => shared.get(k) ?? null, setItem: (k,v) => shared.set(k,v), removeItem: k => shared.delete(k) };
  const queue = createEventQueue({ storage: () => storage, now: () => now, uuid: randomUUID,
    send: async body => { calls.push(JSON.parse(body)); return response(JSON.parse(body)); },
    beacon: body => beacons.push(body) });
  const owner = randomUUID(), lesson = randomUUID();
  const enqueue = () => queue.enqueue({ eventType:'lesson_view_start',entityId:lesson });
  const reply = (ids,rejected=[]) => new Response(JSON.stringify({ acceptedIds:ids,rejected }),{ status:200 });
  return { queue,storage,shared,calls,beacons,owner,lesson,enqueue,reply,
    respond: fn => { response=fn; }, tick: ms => { now+=ms; } };
}

test("queue is idle until an authenticated owner is confirmed, and never adopts a legacy queue", async () => {
  const f=fixture();f.shared.set('lms_event_queue',JSON.stringify([{eventType:'lesson_view_start'}]));
  assert.equal(f.enqueue(),false);await f.queue.flush();f.queue.pagehide();assert.equal(f.calls.length+f.beacons.length,0);
  f.queue.setOwner(f.owner);assert.equal(f.shared.has('lms_event_queue'),false);assert.equal(f.enqueue(),true);
});

test("offline and a lost ACK retain the same event ID across reloads", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();await f.queue.flush();
  const id=f.queue.pending()[0].eventId;
  const reload=fixture(f.shared);reload.queue.setOwner(f.owner);await reload.queue.flush();
  assert.equal(reload.calls[0].events[0].eventId,id);
  reload.respond(body=>reload.reply(body.events.map(e=>e.eventId)));await reload.queue.flush();assert.equal(reload.queue.pending().length,0);
});

test("ACK removes only sent IDs, preserving events queued during an in-flight request", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();let release;
  f.respond(body=>new Promise(r=>{release=()=>r(f.reply(body.events.map(e=>e.eventId)));}));
  const run=f.queue.flush();f.enqueue();await f.queue.flush();assert.equal(f.calls.length,1);
  const later=f.queue.pending().find(e=>e.eventId!==f.calls[0].events[0].eventId).eventId;
  release();await run;assert.deepEqual(f.queue.pending().map(e=>e.eventId),[later]);
});

test("independent event keys preserve other-tab enqueues and ACKs", async () => {
  const a=fixture(),b=fixture(a.shared);a.queue.setOwner(a.owner);b.queue.setOwner(a.owner);
  a.enqueue();let release;a.respond(body=>new Promise(r=>{release=()=>r(a.reply(body.events.map(e=>e.eventId)));}));
  const run=a.queue.flush();b.enqueue();release();await run;
  assert.equal(a.queue.pending().length,1);assert.equal(b.queue.pending().length,1);
  b.respond(body=>b.reply(body.events.map(e=>e.eventId)));await b.queue.flush();assert.equal(a.queue.pending().length,0);
});

test("beacon keeps all IDs for retries regardless of browser queueing outcome", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();const pending=f.queue.pending();
  f.queue.pagehide();f.queue.pagehide();assert.deepEqual(f.queue.pending(),pending);
  for(const blob of f.beacons){assert.equal(blob.type,'application/json');assert.deepEqual(JSON.parse(await blob.text()),{ownerId:f.owner,events:pending});}
});

test("partial ACK drops permanent rejections and keeps unacknowledged events", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();f.enqueue();f.enqueue();
  const ids=f.queue.pending().map(e=>e.eventId);
  f.respond(()=>f.reply([ids[0]],[{eventId:ids[1],error:'deadline_passed'}]));await f.queue.flush();
  assert.deepEqual(f.queue.pending().map(e=>e.eventId),[ids[2]]);
});

test("malformed, numeric-only, foreign and duplicate ACKs never clear events", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();const id=f.queue.pending()[0].eventId;
  for(const ack of [{accepted:1},{acceptedIds:[randomUUID()],rejected:[]},{acceptedIds:[id,id],rejected:[]},
    {acceptedIds:[id],rejected:[{eventId:id,error:'deadline_passed'}]},{acceptedIds:[],rejected:[{eventId:id,error:'new_unknown_error'}]}]) {
    f.respond(()=>new Response(JSON.stringify(ack)));await f.queue.flush();assert.equal(f.queue.pending().length,1);
  }
});

test("queue splits more than 100 events without losing the remainder", async () => {
  const f=fixture();f.queue.setOwner(f.owner);for(let i=0;i<205;i++)f.enqueue();
  f.respond(body=>f.reply(body.events.map(e=>e.eventId)));
  for(const expected of [105,5,0]){await f.queue.flush();assert.equal(f.queue.pending().length,expected);}
  assert.deepEqual(f.calls.map(c=>c.events.length),[100,100,5]);
});

test("429 Retry-After delays normal flush and beacon, while 5xx retain pending data", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();f.respond(()=>new Response('{}',{status:429,headers:{'Retry-After':'60'}}));
  await f.queue.flush();await f.queue.flush();f.queue.pagehide();assert.equal(f.calls.length,1);assert.equal(f.beacons.length,0);
  f.tick(60001);f.respond(()=>new Response('{}',{status:500}));await f.queue.flush();assert.equal(f.queue.pending().length,1);
});

test("logout/user switch clears old queues and late replies cannot alter the new owner's queue", async () => {
  const f=fixture();f.queue.setOwner(f.owner);f.enqueue();let release;
  f.respond(body=>new Promise(r=>{release=()=>r(f.reply(body.events.map(e=>e.eventId)));}));const run=f.queue.flush();
  f.queue.setOwner(null);assert.equal(f.enqueue(),false);const next=randomUUID();f.queue.setOwner(next);f.enqueue();
  release();await run;assert.equal(f.queue.pending().length,1);assert.equal(f.shared.has(`lms_event_v2:${f.owner}:${f.calls[0].events[0].eventId}`),false);
});

test("a stale tab cannot send under a changed owner marker; 401/403 pause retries", async () => {
  const a=fixture(),b=fixture(a.shared);a.queue.setOwner(a.owner);a.enqueue();b.queue.setOwner(b.owner);
  await a.queue.flush();a.queue.pagehide();assert.equal(a.enqueue(),false);assert.equal(a.calls.length+a.beacons.length,0);
  for(const status of [401,403]){b.queue.setOwner(b.owner);b.enqueue();b.respond(()=>new Response('{}',{status}));await b.queue.flush();
    const count=b.calls.length;await b.queue.flush();b.queue.pagehide();assert.equal(b.calls.length,count);}
});

test("storage failures keep an in-memory queue that can still flush", async () => {
  const f=fixture();f.storage.setItem=()=>{throw new Error('quota');};f.queue.setOwner(f.owner);assert.equal(f.enqueue(),true);
  await f.queue.flush();assert.equal(f.queue.pending().length,1);f.respond(body=>f.reply(body.events.map(e=>e.eventId)));
  await f.queue.flush();assert.equal(f.queue.pending().length,0);
});

test("corrupt persisted entries are discarded and a full queue preserves existing IDs", () => {
  const f=fixture();f.queue.setOwner(f.owner);f.shared.set(`lms_event_v2:${f.owner}:${randomUUID()}`,'{broken');assert.equal(f.queue.pending().length,0);
  for(let i=0;i<MAX_EVENT_QUEUE;i++){const eventId=randomUUID();f.shared.set(`lms_event_v2:${f.owner}:${eventId}`,JSON.stringify({eventId,eventType:"lesson_view_start",entityId:f.lesson,occurredAt:new Date().toISOString()}));}
  const ids=f.queue.pending().map(e=>e.eventId);assert.equal(f.enqueue(),false);assert.deepEqual(f.queue.pending().map(e=>e.eventId),ids);
});
