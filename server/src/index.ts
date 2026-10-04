import "dotenv/config";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { checkDb, pool } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { adminDepartmentRoutes } from "./routes/admin-departments.js";
import { adminGroupRoutes } from "./routes/admin-groups.js";
import { adminCourseRoutes } from "./routes/admin-courses.js";
import { adminAttachmentRoutes } from "./routes/admin-attachments.js";
import { adminTestRoutes } from "./routes/admin-tests.js";

const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(multipart);
await app.register(authRoutes);
await app.register(adminUserRoutes);
await app.register(adminDepartmentRoutes);
await app.register(adminGroupRoutes);
await app.register(adminCourseRoutes);
await app.register(adminAttachmentRoutes);
await app.register(adminTestRoutes);

app.get("/health", async () => {
  return { status: "ok" };
});

app.get("/health/db", async (_req, reply) => {
  try {
    const ok = await checkDb();
    return { db: ok ? "ok" : "fail" };
  } catch (err) {
    app.log.error(err);
    reply.code(500);
    return { db: "fail" };
  }
});

app.get("/health/tables", async (_req, reply) => {
  try {
    const res = await pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
    );
    return { tables: res.rows.map((r) => r.table_name) };
  } catch (err) {
    app.log.error(err);
    reply.code(500);
    return { tables: [] };
  }
});

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
