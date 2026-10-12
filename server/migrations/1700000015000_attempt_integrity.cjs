exports.up = (pgm) => {
  pgm.sql(`
    LOCK TABLE test_attempts IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM test_attempts GROUP BY test_id,user_id,attempt_number HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'attempt_integrity: duplicate attempt numbers; run read-only preflight';
      END IF;
      IF EXISTS (SELECT 1 FROM test_attempts WHERE status='in_progress' GROUP BY test_id,user_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'attempt_integrity: multiple open attempts; run read-only preflight';
      END IF;
    END $$;
    ALTER TABLE test_attempts
      ADD CONSTRAINT test_attempts_number_unique UNIQUE(test_id,user_id,attempt_number),
      ADD CONSTRAINT test_attempts_number_positive CHECK(attempt_number > 0),
      ADD CONSTRAINT test_attempts_score_range CHECK(score IS NULL OR score BETWEEN 0 AND 100),
      ADD CONSTRAINT test_attempts_lifecycle CHECK(
        (status='in_progress' AND finished_at IS NULL AND score IS NULL AND passed IS NULL) OR
        (status='finished' AND finished_at IS NOT NULL AND score IS NOT NULL AND passed IS NOT NULL));
    CREATE UNIQUE INDEX test_attempts_one_open ON test_attempts(test_id,user_id) WHERE status='in_progress';
  `);
};
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX test_attempts_one_open;
    ALTER TABLE test_attempts DROP CONSTRAINT test_attempts_number_unique,
      DROP CONSTRAINT test_attempts_number_positive, DROP CONSTRAINT test_attempts_score_range,
      DROP CONSTRAINT test_attempts_lifecycle;`);
};
