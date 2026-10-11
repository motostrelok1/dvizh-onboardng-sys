import assert from "node:assert/strict";

// Never fall back to DATABASE_URL or load a developer's .env.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(testDatabaseUrl, "Set TEST_DATABASE_URL to a migrated local database ending in _test");
const database = new URL(testDatabaseUrl);
assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname), "Test PostgreSQL must be local");
assert.match(database.pathname, /^\/[a-zA-Z0-9_]+_test$/, "Use a separate database ending in _test");
process.env.DATABASE_URL = testDatabaseUrl;

