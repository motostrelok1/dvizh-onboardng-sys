exports.up = (pgm) => {
  pgm.sql(`
    -- Stop concurrent writers while validating/backfilling and adding constraints.
    LOCK TABLE courses, modules, lessons, tests, questions, lesson_attachments IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM tests GROUP BY scope, parent_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'content_integrity: duplicate tests; inspect before retrying migration';
      END IF;
      IF EXISTS (SELECT 1 FROM tests t WHERE
        (scope = 'module' AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.id = t.parent_id)) OR
        (scope = 'lesson' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = t.parent_id))) THEN
        RAISE EXCEPTION 'content_integrity: orphan tests; inspect before retrying migration';
      END IF;
    END $$;

    ALTER TABLE tests
      ADD COLUMN module_parent_id uuid GENERATED ALWAYS AS
        (CASE WHEN scope = 'module' THEN parent_id END) STORED,
      ADD COLUMN lesson_parent_id uuid GENERATED ALWAYS AS
        (CASE WHEN scope = 'lesson' THEN parent_id END) STORED,
      ADD CONSTRAINT tests_module_parent_fk FOREIGN KEY (module_parent_id) REFERENCES modules(id) ON DELETE CASCADE,
      ADD CONSTRAINT tests_lesson_parent_fk FOREIGN KEY (lesson_parent_id) REFERENCES lessons(id) ON DELETE CASCADE,
      ADD CONSTRAINT tests_scope_parent_unique UNIQUE (scope, parent_id);
    CREATE INDEX tests_module_parent_idx ON tests(module_parent_id) WHERE module_parent_id IS NOT NULL;
    CREATE INDEX tests_lesson_parent_idx ON tests(lesson_parent_id) WHERE lesson_parent_id IS NOT NULL;
  `);
  // Preserve IDs/content and relative order. Ties are made deterministic by ID;
  // no questions, attempts, assignments or files are discarded.
  for (const [table, parent] of [["modules", "course_id"], ["lessons", "module_id"],
    ["questions", "test_id"], ["lesson_attachments", "lesson_id"]]) {
    pgm.sql(`
      WITH ranked AS (SELECT id, (row_number() OVER (PARTITION BY ${parent} ORDER BY position, id) - 1)::integer AS pos
        FROM ${table})
      UPDATE ${table} t SET position = r.pos FROM ranked r WHERE t.id = r.id;
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_position_nonnegative CHECK (position >= 0),
        ADD CONSTRAINT ${table}_parent_position_unique UNIQUE (${parent}, position) DEFERRABLE INITIALLY IMMEDIATE;
    `);
  }
};

exports.down = (pgm) => {
  for (const table of ["modules", "lessons", "questions", "lesson_attachments"]) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_parent_position_unique,
      DROP CONSTRAINT ${table}_position_nonnegative;`);
  }
  pgm.sql(`ALTER TABLE tests DROP CONSTRAINT tests_scope_parent_unique,
    DROP COLUMN module_parent_id, DROP COLUMN lesson_parent_id;`);
  // Normalized positions remain; old ambiguous ties cannot be reconstructed.
};
