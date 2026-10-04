exports.up = (pgm) => {
  pgm.createTable("tests", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    scope: { type: "text", notNull: true, check: "scope in ('module','lesson')" },
    parent_id: { type: "uuid", notNull: true }, // id модуля или урока, в зависимости от scope
    max_attempts: { type: "integer" }, // null = безлимит
    show_correct_answers: { type: "boolean", notNull: true, default: false },
    pass_score: { type: "integer", notNull: true, default: 70 }
  });

  pgm.createTable("questions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    test_id: { type: "uuid", notNull: true, references: "tests", onDelete: "cascade" },
    text: { type: "text", notNull: true },
    position: { type: "integer", notNull: true, default: 0 },
    multiple: { type: "boolean", notNull: true, default: false }
  });

  pgm.createTable("answers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    question_id: { type: "uuid", notNull: true, references: "questions", onDelete: "cascade" },
    text: { type: "text", notNull: true },
    is_correct: { type: "boolean", notNull: true, default: false }
  });

  pgm.createIndex("tests", "parent_id");
  pgm.createIndex("questions", "test_id");
  pgm.createIndex("answers", "question_id");
};

exports.down = (pgm) => {
  pgm.dropTable("answers");
  pgm.dropTable("questions");
  pgm.dropTable("tests");
};
