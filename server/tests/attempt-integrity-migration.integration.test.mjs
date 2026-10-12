import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, test } from "node:test";
await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const migration = createRequire(import.meta.url)("../migrations/1700000015000_attempt_integrity.cjs");
after(() => pool.end());
function sql(direction) { const queries = []; migration[direction]({ sql: q => queries.push(q) }); return queries.join("\n"); }
async function legacy(work) {
  const client = await pool.connect(), name = `h17_${randomUUID().replaceAll("-", "")}`;
  const ids = Array.from({ length: 4 }, () => randomUUID());
  try {
    await client.query("begin");
    await client.query(`create schema ${name}; set local search_path to ${name},public;
      create table test_attempts(id uuid primary key,test_id uuid not null,user_id uuid not null,
        attempt_number integer not null,status text not null default 'in_progress' check(status in ('in_progress','finished')),
        started_at timestamptz not null default now(),finished_at timestamptz,score integer,passed boolean);`);
    await client.query(`insert into test_attempts(id,test_id,user_id,attempt_number,status,finished_at,score,passed)
      values ($1,$2,$3,1,'finished',now(),67,true)`, ids.slice(0,3));
    await work(client, ids);
  } finally { await client.query("rollback"); client.release(); }
}

test("H17 migration preserves legacy IDs/results and supports down/up without repairing history", async () => {
  await legacy(async (client, ids) => {
    const before = (await client.query("select * from test_attempts")).rows;
    await client.query(sql("up")); assert.deepEqual((await client.query("select * from test_attempts")).rows, before);
    await client.query("savepoint constraint_check");
    await assert.rejects(client.query("insert into test_attempts(id,test_id,user_id,attempt_number) values ($1,$2,$3,1)", [ids[3],ids[1],ids[2]]), { code: "23505" });
    await client.query("rollback to savepoint constraint_check");
    await client.query(sql("down")); assert.deepEqual((await client.query("select * from test_attempts")).rows, before);
    await client.query(sql("up")); assert.deepEqual((await client.query("select * from test_attempts")).rows, before);
  });
});
for (const kind of ["duplicate", "open"]) {
  test(`H17 migration rejects ${kind} conflicts and rollback retains all legacy rows`, async () => {
    await legacy(async (client, ids) => {
      if (kind === "duplicate") await client.query(`insert into test_attempts(id,test_id,user_id,attempt_number,status,finished_at,score,passed)
        values ($1,$2,$3,1,'finished',now(),0,false)`, [ids[3],ids[1],ids[2]]);
      else await client.query(`insert into test_attempts(id,test_id,user_id,attempt_number) values ($1,$2,$3,2),($4,$2,$3,3)`, [ids[3],ids[1],ids[2],randomUUID()]);
      const before = (await client.query("select * from test_attempts order by id")).rows;
      await client.query("savepoint migration");
      await assert.rejects(client.query(sql("up")), new RegExp(kind === "duplicate" ? "duplicate attempt numbers" : "multiple open attempts"));
      await client.query("rollback to savepoint migration");
      assert.deepEqual((await client.query("select * from test_attempts order by id")).rows, before);
      assert.equal((await client.query("select count(*)::int as n from pg_constraint where conrelid='test_attempts'::regclass and conname like 'test_attempts_number%'")).rows[0].n, 0);
    });
  });
}
for (const [kind, number, score, passed, finished] of [["number",0,0,false,new Date()], ["score",2,101,false,new Date()], ["lifecycle",2,50,null,new Date()]]) {
  test(`H17 migration refuses invalid legacy ${kind} without rewriting or deleting it`, async () => {
    await legacy(async (client, ids) => {
      await client.query(`insert into test_attempts(id,test_id,user_id,attempt_number,status,finished_at,score,passed)
        values ($1,$2,$3,$4,'finished',$5,$6,$7)`, [ids[3],ids[1],ids[2],number,finished,score,passed]);
      const before = (await client.query("select * from test_attempts order by id")).rows;
      await client.query("savepoint migration"); await assert.rejects(client.query(sql("up")), { code: "23514" });
      await client.query("rollback to savepoint migration");
      assert.deepEqual((await client.query("select * from test_attempts order by id")).rows, before);
    });
  });
}
