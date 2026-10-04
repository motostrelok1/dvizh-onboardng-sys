exports.up = (pgm) => {
  pgm.createTable("departments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true }
  });

  pgm.createTable("groups", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true }
  });

  pgm.createTable("group_members", {
    group_id: { type: "uuid", notNull: true, references: "groups", onDelete: "cascade" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" }
  });
  pgm.addConstraint("group_members", "group_members_pk", {
    primaryKey: ["group_id", "user_id"]
  });

  // Теперь, когда таблицы существуют, связываем ранее созданные колонки
  pgm.addConstraint("users", "users_department_fk", {
    foreignKeys: { columns: "department_id", references: "departments(id)", onDelete: "set null" }
  });
  pgm.addConstraint("assignments", "assignments_source_group_fk", {
    foreignKeys: { columns: "source_group_id", references: "groups(id)", onDelete: "set null" }
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("assignments", "assignments_source_group_fk");
  pgm.dropConstraint("users", "users_department_fk");
  pgm.dropTable("group_members");
  pgm.dropTable("groups");
  pgm.dropTable("departments");
};
