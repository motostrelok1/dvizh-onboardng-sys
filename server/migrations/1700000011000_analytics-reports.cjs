exports.up = (pgm) => {
  pgm.createTable("analytics_settings", {
    key: { type: "text", primaryKey: true },
    value: { type: "jsonb", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("analytics_overrides", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    course_id: { type: "uuid", notNull: true, references: "courses", onDelete: "cascade" },
    key: { type: "text", notNull: true },
    value: { type: "jsonb", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("analytics_overrides", "analytics_overrides_unique", {
    unique: ["course_id", "key"]
  });

  pgm.createTable("settings_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    changed_by: { type: "uuid", references: "users" },
    course_id: { type: "uuid", references: "courses", onDelete: "set null" },
    key: { type: "text", notNull: true },
    old_value: { type: "jsonb" },
    new_value: { type: "jsonb" },
    changed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("daily_reports", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    report_date: { type: "date", notNull: true },
    summary: { type: "jsonb", notNull: true },
    flags: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    generated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    trigger: { type: "text", notNull: true, check: "trigger in ('login','schedule','manual')" }
  });
  pgm.addConstraint("daily_reports", "daily_reports_unique", {
    unique: ["user_id", "report_date"]
  });

  pgm.createIndex("settings_log", "changed_at");
};

exports.down = (pgm) => {
  pgm.dropTable("daily_reports");
  pgm.dropTable("settings_log");
  pgm.dropTable("analytics_overrides");
  pgm.dropTable("analytics_settings");
};
