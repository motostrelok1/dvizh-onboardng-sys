exports.up = (pgm) => {
  pgm.createTable("test_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    test_id: { type: "uuid", notNull: true, references: "tests", onDelete: "cascade" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    attempt_number: { type: "integer", notNull: true },
    status: { type: "text", notNull: true, default: "in_progress", check: "status in ('in_progress','finished')" },
    started_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    finished_at: { type: "timestamptz" },
    score: { type: "integer" }, // процент верных ответов, заполняется при finish
    passed: { type: "boolean" }
  });

  pgm.createTable("attempt_answers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    attempt_id: { type: "uuid", notNull: true, references: "test_attempts", onDelete: "cascade" },
    question_id: { type: "uuid", notNull: true, references: "questions", onDelete: "cascade" },
    selected_answer_ids: { type: "uuid[]", notNull: true, default: pgm.func("'{}'::uuid[]") },
    is_correct: { type: "boolean", notNull: true, default: false },
    answered_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.addConstraint("attempt_answers", "attempt_answers_unique", {
    unique: ["attempt_id", "question_id"]
  });

  pgm.createIndex("test_attempts", ["test_id", "user_id"]);
  pgm.createIndex("attempt_answers", "attempt_id");
};

exports.down = (pgm) => {
  pgm.dropTable("attempt_answers");
  pgm.dropTable("test_attempts");
};
