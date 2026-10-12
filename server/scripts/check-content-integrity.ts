import { pool } from "../src/db.js";

// Read-only preflight, usable on both the legacy and migrated schema.
try {
  const duplicates = (await pool.query(`select scope, parent_id, array_agg(id order by id) as test_ids
    from tests group by scope,parent_id having count(*) > 1 order by scope,parent_id`)).rows;
  const orphans = (await pool.query(`select t.id,t.scope,t.parent_id from tests t where
    (scope='module' and not exists(select 1 from modules m where m.id=t.parent_id)) or
    (scope='lesson' and not exists(select 1 from lessons l where l.id=t.parent_id)) order by t.id`)).rows;
  console.log(JSON.stringify({ duplicateTests: duplicates, orphanTests: orphans }, null, 2));
  if (duplicates.length || orphans.length) {
    console.error("H15 migration is blocked: reconcile these tests before retrying. No rows were changed.");
    process.exitCode = 2;
  } else { console.log("H15 test-parent preflight passed. No rows were changed."); }
} catch {
  console.error("H15 preflight could not read the database.");
  process.exitCode = 1;
} finally { await pool.end(); }
