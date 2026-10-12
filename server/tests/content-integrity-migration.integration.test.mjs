import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, test } from "node:test";

await import("./test-database.mjs");
const { pool } = await import("../src/db.ts");
const migration = createRequire(import.meta.url)("../migrations/1700000014000_content_integrity.cjs");
after(() => pool.end());
function sql(direction) {
  const queries = [];
  migration[direction]({ sql: query => queries.push(query) });
  return queries.join("\n");
}

// Legacy fixture DDL lives only in a random schema inside a rolled-back
// transaction. It cannot change the application's public tables/migrations.
async function legacy(work) {
  const client = await pool.connect();
  const name = `h15_${randomUUID().replaceAll("-", "")}`;
  const ids = Array.from({ length: 7 }, () => randomUUID()).sort();
  try {
    await client.query("begin");
    await client.query(`create schema ${name}; set local search_path to ${name}, public;
      create table courses (id uuid primary key);
      create table modules (id uuid primary key, course_id uuid, position integer not null);
      create table lessons (id uuid primary key, module_id uuid, position integer not null);
      create table tests (id uuid primary key, scope text not null check(scope in ('module','lesson')), parent_id uuid not null);
      create table questions (id uuid primary key, test_id uuid, position integer not null);
      create table lesson_attachments (id uuid primary key, lesson_id uuid, position integer not null);`);
    await client.query("insert into courses values ($1)", [ids[0]]);
    await client.query("insert into modules values ($1, $3, 9), ($2, $3, 9)", [ids[1], ids[2], ids[0]]);
    await client.query("insert into lessons values ($1, $3, -1), ($2, $3, 4)", [ids[3], ids[4], ids[1]]);
    await client.query("insert into tests values ($1, 'module', $2)", [ids[5], ids[1]]);
    await client.query("insert into questions values ($1, $3, 0), ($2, $3, 0)", [ids[1], ids[2], ids[5]]);
    await client.query("insert into lesson_attachments values ($1, $3, 7), ($2, $3, 7)", [ids[1], ids[2], ids[3]]);
    await work(client, ids);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

test("H15 migration deterministically normalizes legacy positions and adds real constraints without deleting IDs", async () => {
  await legacy(async (client, ids) => {
    await client.query(sql("up"));
    for (const table of ["modules", "lessons", "questions", "lesson_attachments"]) {
      const rows = (await client.query(`select id, position from ${table} order by position`)).rows;
      assert.deepEqual(rows.map(row => row.position), [0, 1]);
      assert.deepEqual(rows.map(row => row.id), table === "lessons" ? [ids[3], ids[4]] : [ids[1], ids[2]]);
    }
    const testRow = (await client.query("select * from tests")).rows[0];
    assert.equal(testRow.id, ids[5]); assert.equal(testRow.module_parent_id, ids[1]);
    assert.equal(testRow.lesson_parent_id, null);
    const names = (await client.query("select conname from pg_constraint where conrelid = 'modules'::regclass")).rows.map(row => row.conname);
    assert.ok(names.includes("modules_parent_position_unique"));
    await client.query(sql("down"));
    assert.deepEqual((await client.query("select id, scope, parent_id from tests")).rows,
      [{ id: ids[5], scope: "module", parent_id: ids[1] }]);
    assert.deepEqual((await client.query("select position from modules order by position")).rows.map(row => row.position), [0, 1]);
    await client.query(sql("up")); // Reapply after down without losing legacy data.
    assert.equal((await client.query("select count(*)::int as n from tests")).rows[0].n, 1);
  });
});

for (const kind of ["duplicate", "orphan"]) {
  test(`H15 migration refuses ${kind} tests and rollback preserves all legacy rows and positions`, async () => {
    await legacy(async (client, ids) => {
      await client.query("insert into tests values ($1, 'module', $2)", [ids[6], kind === "duplicate" ? ids[1] : randomUUID()]);
      const before = (await client.query("select * from modules order by id")).rows;
      await client.query("savepoint before_migration");
      await assert.rejects(client.query(sql("up")), new RegExp(`content_integrity: ${kind}`));
      await client.query("rollback to savepoint before_migration");
      assert.deepEqual((await client.query("select * from modules order by id")).rows, before);
      assert.equal((await client.query("select count(*)::int as n from tests")).rows[0].n, 2);
      assert.deepEqual(Object.keys((await client.query("select * from tests limit 1")).rows[0]).sort(), ["id", "parent_id", "scope"]);
    });
  });
}
