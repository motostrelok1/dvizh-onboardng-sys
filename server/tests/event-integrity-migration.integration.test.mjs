import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {after,test} from "node:test";
await import('./test-database.mjs');
const {pool}=await import('../src/db.ts');
const migration=createRequire(import.meta.url)('../migrations/1700000016000_client_event_integrity.cjs');
after(()=>pool.end());
const sql=direction=>{let result='';migration[direction]({sql:q=>{result+=q;}});return result;};
async function legacy(work){const client=await pool.connect(),schema=`event_migration_${randomUUID().replaceAll('-','')}`;
  const ids=Array.from({length:3},randomUUID);
  try{await client.query('begin');await client.query(`create schema ${schema};set local search_path to ${schema},public;
    create table users(id uuid primary key);
    create table events(id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,
      event_type text not null,payload jsonb not null default '{}',occurred_at timestamptz not null default now());`);
    await client.query('insert into users(id) values ($1),($2)',ids.slice(0,2));
    await client.query("insert into events(id,user_id,event_type,payload) values ($1,$2,'lesson_view_start','{\"legacy\":true}')",[ids[2],ids[0]]);
    await work(client,ids);
  }finally{await client.query('rollback');client.release();}}

test("event migration preserves legacy history and down/up removes only protocol metadata",async()=>{
  await legacy(async(client,ids)=>{const before=(await client.query('select * from events')).rows;
    await client.query(sql('up'));const current=(await client.query('select * from events')).rows;
    assert.equal(current[0].client_event_id,null);assert.deepEqual(current.map(({client_event_id,...row})=>row),before);
    await client.query(sql('down'));assert.deepEqual((await client.query('select * from events')).rows,before);
    await client.query(sql('up'));assert.equal((await client.query('select count(*)::int as n from events')).rows[0].n,1);
  });
});
test("database dedup permits legacy NULLs and separate owners, and refuses duplicate IDs for one owner",async()=>{
  await legacy(async(client,ids)=>{await client.query(sql('up'));const eventId=randomUUID();
    await client.query("insert into events(user_id,client_event_id,event_type) values ($1,$2,'lesson_view_start'),($3,$2,'lesson_view_start'),($1,null,'session_start'),($1,null,'session_end')",[ids[0],eventId,ids[1]]);
    await client.query('savepoint duplicate');await assert.rejects(client.query("insert into events(user_id,client_event_id,event_type) values ($1,$2,'lesson_view_end')",[ids[0],eventId]),{code:'23505'});
    await client.query('rollback to savepoint duplicate');assert.equal((await client.query('select count(*)::int as n from events')).rows[0].n,5);
  });
});
test("request buckets and events cascade only with their deleted user",async()=>{
  await legacy(async(client,ids)=>{await client.query(sql('up'));await client.query("insert into event_rate_limits(user_id,requests,expires_at) values ($1,1,now()),($2,2,now())",ids.slice(0,2));
    await client.query('delete from users where id=$1',[ids[0]]);assert.equal((await client.query('select * from events')).rowCount,0);
    assert.deepEqual((await client.query('select user_id,requests from event_rate_limits')).rows,[{user_id:ids[1],requests:2}]);
  });
});
