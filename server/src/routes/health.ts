import type { FastifyInstance } from "fastify";
import { checkDb } from "../db.js";

// Public probes expose only liveness/readiness, never schema or DB details.
// /health/tables is deliberately not registered in any environment (SEC-10).
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));

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
}
