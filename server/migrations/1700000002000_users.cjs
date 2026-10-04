exports.up = (pgm) => {
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    full_name: { type: "text", notNull: true },
    email: { type: "text", unique: true },
    password_hash: { type: "text" },
    role: { type: "text", notNull: true, check: "role in ('admin','employee')" },
    department_id: { type: "uuid" }, // FK добавится при создании таблицы departments
    timezone: { type: "text", notNull: true, default: "Europe/Moscow" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
};

exports.down = (pgm) => {
  pgm.dropTable("users");
};
