exports.up = (pgm) => {
  pgm.createTable("assignments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    course_id: { type: "uuid", notNull: true, references: "courses", onDelete: "cascade" },
    assigned_by: { type: "uuid", references: "users" },
    source_group_id: { type: "uuid" }, // FK добавится вместе с таблицей groups
    assigned_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    deadline: { type: "timestamptz" },
    is_required: { type: "boolean", notNull: true, default: true },
    status: {
      type: "text",
      notNull: true,
      default: "assigned",
      check: "status in ('assigned','in_progress','completed','overdue','closed')"
    },
    closed_at: { type: "timestamptz" }
  });

  pgm.createIndex("assignments", "user_id");
  pgm.createIndex("assignments", "course_id");
  pgm.addConstraint("assignments", "assignments_user_course_unique", {
    unique: ["user_id", "course_id"]
  });
};

exports.down = (pgm) => {
  pgm.dropTable("assignments");
};
