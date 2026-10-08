exports.up = (pgm) => {
  pgm.createTable("notification_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    course_id: { type: "uuid", references: "courses", onDelete: "cascade" }, // null = для всех курсов
    kind: { type: "text", notNull: true, check: "kind in ('before_deadline','on_deadline','overdue')" },
    offset_days: { type: "integer", notNull: true, default: 0 },
    channel: { type: "text", notNull: true, check: "channel in ('in_app','push')" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("notifications", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    assignment_id: { type: "uuid", references: "assignments", onDelete: "cascade" },
    kind: { type: "text", notNull: true },
    channel: { type: "text", notNull: true, check: "channel in ('in_app','push')" },
    title: { type: "text", notNull: true },
    body: { type: "text" },
    sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    read_at: { type: "timestamptz" }
  });

  pgm.createTable("push_subscriptions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    endpoint: { type: "text", notNull: true, unique: true },
    keys: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createIndex("notifications", ["user_id", "sent_at"]);
  pgm.createIndex("push_subscriptions", "user_id");
};

exports.down = (pgm) => {
  pgm.dropTable("push_subscriptions");
  pgm.dropTable("notifications");
  pgm.dropTable("notification_rules");
};
