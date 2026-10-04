import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";

export async function adminDepartmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/departments", async () => {
    const res = await pool.query(`select id, name from departments order by name`);
    return { departments: res.rows };
  });

  app.post<{ Body: { name: string } }>("/admin/departments", async (req, reply) => {
    if (!req.body?.name) {
      reply.code(400);
      return { error: "name_required" };
    }
    const res = await pool.query(
      `insert into departments (name) values ($1) returning id, name`,
      [req.body.name]
    );
    reply.code(201);
    return { department: res.rows[0] };
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/admin/departments/:id",
    async (req) => {
      const res = await pool.query(
        `update departments set name = $2 where id = $1 returning id, name`,
        [req.params.id, req.body.name]
      );
      return { department: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/departments/:id", async (req) => {
    await pool.query(`delete from departments where id = $1`, [req.params.id]);
    return { ok: true };
  });
}
