exports.up = (pgm) => {
  pgm.createTable("courses", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    title: { type: "text", notNull: true },
    description: { type: "text" },
    status: { type: "text", notNull: true, default: "draft", check: "status in ('draft','published','archived')" },
    visibility: { type: "text", notNull: true, default: "assigned_only", check: "visibility in ('assigned_only','open_catalog')" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("modules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    course_id: { type: "uuid", notNull: true, references: "courses", onDelete: "cascade" },
    title: { type: "text", notNull: true },
    position: { type: "integer", notNull: true, default: 0 }
  });

  pgm.createTable("lessons", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    module_id: { type: "uuid", notNull: true, references: "modules", onDelete: "cascade" },
    title: { type: "text", notNull: true },
    position: { type: "integer", notNull: true, default: 0 },
    text_content: { type: "text" },
    video_provider: { type: "text" },
    video_ref: { type: "text" }
  });

  pgm.createTable("lesson_attachments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    lesson_id: { type: "uuid", notNull: true, references: "lessons", onDelete: "cascade" },
    file_name: { type: "text", notNull: true },
    file_path: { type: "text", notNull: true },
    size_bytes: { type: "bigint" },
    position: { type: "integer", notNull: true, default: 0 }
  });

  pgm.createIndex("modules", "course_id");
  pgm.createIndex("lessons", "module_id");
  pgm.createIndex("lesson_attachments", "lesson_id");
};

exports.down = (pgm) => {
  pgm.dropTable("lesson_attachments");
  pgm.dropTable("lessons");
  pgm.dropTable("modules");
  pgm.dropTable("courses");
};
