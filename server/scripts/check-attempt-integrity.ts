import { pool } from "../src/db.js";

// Read-only and usable before the migration. Never repair/delete history.
try {
  const duplicateNumbers = (await pool.query(`select test_id,user_id,attempt_number,array_agg(id order by id) as attempt_ids
    from test_attempts group by test_id,user_id,attempt_number having count(*) > 1 order by test_id,user_id,attempt_number`)).rows;
  const multipleOpen = (await pool.query(`select test_id,user_id,array_agg(id order by id) as attempt_ids
    from test_attempts where status='in_progress' group by test_id,user_id having count(*) > 1 order by test_id,user_id`)).rows;
  const invalidState = (await pool.query(`select id from test_attempts where attempt_number<=0 or
    (score is not null and (score<0 or score>100)) or not (
      (status='in_progress' and finished_at is null and score is null and passed is null) or
      (status='finished' and finished_at is not null and score is not null and passed is not null)) order by id`)).rows;
  console.log(JSON.stringify({ duplicateNumbers, multipleOpen, invalidState }, null, 2));
  if (duplicateNumbers.length || multipleOpen.length || invalidState.length) {
    console.error("H17 migration is blocked: reconcile these attempts before retrying. No rows were changed.");
    process.exitCode = 2;
  } else { console.log("H17 attempt preflight passed. No rows were changed."); }
} catch {
  console.error("H17 preflight could not read the database.");
  process.exitCode = 1;
} finally { await pool.end(); }
