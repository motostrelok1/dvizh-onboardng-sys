exports.up = (pgm) => {
  pgm.createTable("auth_rate_limits", {
    bucket_key: { type: "text", primaryKey: true, check: "bucket_key ~ '^[0-9a-f]{64}$'" },
    attempts: { type: "integer", notNull: true, check: "attempts > 0" },
    expires_at: { type: "timestamptz", notNull: true }
  });
  pgm.createIndex("auth_rate_limits", "expires_at");
};

exports.down = (pgm) => pgm.dropTable("auth_rate_limits");
