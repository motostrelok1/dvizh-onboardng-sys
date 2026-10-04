import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { createInvitation, revokeInvitation } from "../auth/service.js";

export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/users", async () => {
    const res = await pool.query(
      `select u.id, u.full_name, u.email, u.role, u.department_id, d.name as department_name,
              u.timezone, u.is_active, u.created_at
       from users u
       left join departments d on d.id = u.department_id
       order by u.created_at desc`
    );
    return { users: res.rows };
  });

  app.post<{
    Body: { fullName: string; email: string; departmentId?: string; timezone?: string };
  }>("/admin/users", async (req, reply) => {
    const { fullName, email, departmentId, timezone } = req.body;
    if (!fullName || !email) {
      reply.code(400);
      return { error: "full_name_and_email_required" };
    }
    try {
      const res = await pool.query(
        `insert into users (full_name, email, role, department_id, timezone, is_active)
         values ($1, $2, 'employee', $3, coalesce($4, 'Europe/Moscow'), true)
         returning id, full_name, email, role, department_id, timezone, is_active, created_at`,
        [fullName, email, departmentId ?? null, timezone ?? null]
      );
      reply.code(201);
      return { user: res.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") {
        reply.code(409);
        return { error: "email_taken" };
      }
      throw err;
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { fullName?: string; departmentId?: string | null; timezone?: string; isActive?: boolean };
  }>("/admin/users/:id", async (req) => {
    const { fullName, departmentId, timezone, isActive } = req.body;
    const res = await pool.query(
      `update users set
         full_name = coalesce($2, full_name),
         department_id = coalesce($3, department_id),
         timezone = coalesce($4, timezone),
         is_active = coalesce($5, is_active)
       where id = $1
       returning id, full_name, email, role, department_id, timezone, is_active`,
      [req.params.id, fullName, departmentId, timezone, isActive]
    );
    return { user: res.rows[0] };
  });

  // Выпустить новую ссылку-приглашение сотруднику
  app.post<{ Params: { id: string } }>("/admin/users/:id/invitations", async (req) => {
    const { token, expiresAt } = await createInvitation(req.params.id, req.currentUser!.id);
    return { token, expiresAt, link: `/invite/${token}` };
  });

  app.delete<{ Params: { id: string } }>("/admin/invitations/:id", async (req) => {
    await revokeInvitation(req.params.id);
    return { ok: true };
  });
}
