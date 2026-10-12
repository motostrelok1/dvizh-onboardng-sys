import type { PoolClient } from "pg";
import { pool } from "./db.js";

export class IntegrityError extends Error {
  constructor(public statusCode: 400 | 404 | 409) { super("integrity_request_failed"); }
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("begin isolation level read committed");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

const ORDERED = {
  modules: { parent: "courses", fk: "course_id" },
  lessons: { parent: "modules", fk: "module_id" },
  questions: { parent: "tests", fk: "test_id" },
  lesson_attachments: { parent: "lessons", fk: "lesson_id" }
} as const;
type OrderedTable = keyof typeof ORDERED;

export async function lockOrderingParent(client: PoolClient, table: OrderedTable, parentId: string) {
  const res = await client.query(`select id from ${ORDERED[table].parent} where id = $1 for no key update`, [parentId]);
  if (!res.rows[0]) throw new IntegrityError(404);
}

// Caller must hold the parent lock until COMMIT. Identifiers come only from
// the closed table map, never from an HTTP request.
export async function nextPosition(client: PoolClient, table: OrderedTable, parentId: string): Promise<number> {
  return (await client.query(`select coalesce(max(position), -1) + 1 as next from ${table}
    where ${ORDERED[table].fk} = $1`, [parentId])).rows[0].next;
}

export async function reorderChildren(table: "modules" | "lessons", parentId: string, requestedIds: string[]) {
  const ids = requestedIds.map(id => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new IntegrityError(400);
  await withTransaction(async client => {
    await lockOrderingParent(client, table, parentId);
    const rows = (await client.query(`select id from ${table} where ${ORDERED[table].fk} = $1
      order by position, id for update`, [parentId])).rows;
    const current = new Set(rows.map(row => row.id));
    if (ids.some(id => !current.has(id))) throw new IntegrityError(400);
    if (ids.length !== rows.length) throw new IntegrityError(409);
    // Swapping two positions temporarily duplicates them, but the final
    // complete permutation must satisfy the database constraint at COMMIT.
    await client.query(`set constraints ${table}_parent_position_unique deferred`);
    for (let i = 0; i < ids.length; i++) {
      await client.query(`update ${table} set position = $3 where id = $1 and ${ORDERED[table].fk} = $2`,
        [ids[i], parentId, i]);
    }
  });
}
