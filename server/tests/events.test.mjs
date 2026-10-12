import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after,before,test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {eventTime} from '../src/client-events.ts';
import {eventRoutes} from '../src/routes/events.ts';
import {pool} from '../src/db.ts';
await pool.end();const app=Fastify();
before(async()=>{await app.register(cookie);await app.register(eventRoutes);await app.ready();});after(()=>app.close());
const good={ownerId:randomUUID(),events:[{eventId:randomUUID(),entityId:randomUUID(),eventType:'lesson_view_start',occurredAt:new Date().toISOString()}]};
const send=(payload,url='/events')=>app.inject({method:'POST',url,headers:{'content-type':'application/json'},payload:JSON.stringify(payload)});
test("event schemas reject extra fields, coercion, missing/foreign event types and malformed IDs before SQL",async()=>{
  for(const payload of [null,{},[],{...good,userId:good.ownerId},{...good,ownerId:'bad'},{...good,events:[]},{...good,events:'bad'},
    ...[{}, {...good.events[0],eventId:'bad'}, {...good.events[0],entityId:null}, {...good.events[0],userId:good.ownerId},
      {...good.events[0],eventType:'test_attempt_end'}, {...good.events[0],occurredAt:'2026-10-12'}, {...good.events[0],payload:{durationMs:'1'}},
      {...good.events[0],payload:{durationMs:-1}},{...good.events[0],payload:{durationMs:1.1}},{...good.events[0],payload:{durationMs:2147483648}},
      {...good.events[0],payload:{score:100}},{...good.events[0],payload:null}].map(e=>({...good,events:[e]}))]) {
    const res=await send(payload);assert.equal(res.statusCode,400,res.body);assert.deepEqual(res.json(),{error:'invalid_request'});
  }
});
test("events reject oversized batches/body and query parameters with private responses",async()=>{
  assert.equal((await send({...good,events:Array(101).fill(good.events[0])})).statusCode,400);
  const big=await send({...good,padding:'secret'.repeat(12000)});assert.equal(big.statusCode,413,big.body);assert.deepEqual(big.json(),{error:'payload_too_large'});
  assert.equal((await send(good,'/events?userId='+good.ownerId)).statusCode,400);
});
test("valid batches including boundary durations still require authentication",async()=>{
  for(const events of [good.events,[{...good.events[0],eventType:'lesson_view_end',payload:{durationMs:2147483647}}]]) {
    const res=await send({...good,events});assert.equal(res.statusCode,401,res.body);assert.deepEqual(res.json(),{error:'not_authenticated'});
  }
});
test("event dates preserve UTC offsets and reject impossible calendars",()=>{
  assert.equal(eventTime('2026-01-01T03:00:00+03:00').toISOString(),'2026-01-01T00:00:00.000Z');
  for(const value of ['2026-02-30T00:00:00Z','2026-13-01T00:00:00Z','bad','2026-01-01T25:00:00Z'])assert.equal(eventTime(value),null);
});
