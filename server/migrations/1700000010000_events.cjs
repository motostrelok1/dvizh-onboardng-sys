exports.up = (pgm) => {
  pgm.createTable("events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "cascade" },
    event_type: { type: "text", notNull: true },
    entity_type: { type: "text" },
    entity_id: { type: "uuid" },
    payload: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    session_id: { type: "uuid" },
    occurred_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createIndex("events", ["user_id", "occurred_at"]);
  pgm.createIndex("events", ["event_type", "entity_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("events");
};
