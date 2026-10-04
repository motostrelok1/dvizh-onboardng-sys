exports.up = (pgm) => {
  pgm.createTable("invitations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    token_hash: { type: "text", notNull: true, unique: true },
    created_by: { type: "uuid", references: "users" },
    expires_at: { type: "timestamptz", notNull: true },
    used_at: { type: "timestamptz" },
    revoked_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("sessions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    token_hash: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    expires_at: { type: "timestamptz", notNull: true }
  });

  pgm.createIndex("invitations", "user_id");
  pgm.createIndex("sessions", "user_id");
};

exports.down = (pgm) => {
  pgm.dropTable("sessions");
  pgm.dropTable("invitations");
};
