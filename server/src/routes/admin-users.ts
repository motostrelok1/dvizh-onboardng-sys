import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";
import { createInvitation, revokeInvitation, AuthError } from "../auth/service.js";
import { installApiValidation, schema, object, text, email, timezone, nullableUuid,
  boolean, idParams, adminUserDto, okDto, success } from "../api-validation.js";

export async function adminUserRoutes(app: FastifyInstance) {
  installApiValidation(app);
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/users", { schema: schema(undefined, undefined,
    success({ users: { type: "array", items: adminUserDto } })) }, async () => {
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
  }>("/admin/users", { schema: schema(object({ fullName: text(256), email, departmentId: nullableUuid, timezone },
    ["fullName", "email"]), undefined, success({ user: adminUserDto })) }, async (req, reply) => {
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
  }>("/admin/users/:id", { schema: schema({ ...object({ fullName: text(256), departmentId: nullableUuid,
    timezone, isActive: boolean }), minProperties: 1 }, idParams(), success({ user: adminUserDto })) }, async (req) => {
    const { fullName, departmentId, timezone, isActive } = req.body;
    const client = await pool.connect();
    try {
      await client.query("begin isolation level read committed");
      // UPDATE takes the same user lock used by login/invitation transactions.
      const res = await client.query(
        `update users set
           full_name = coalesce($2, full_name),
           department_id = case when $6::boolean then $3::uuid else department_id end,
           timezone = coalesce($4, timezone),
           is_active = coalesce($5, is_active)
         where id = $1
         returning id, full_name, email, role, department_id, timezone, is_active`,
        // Only an explicit departmentId (including null) changes the department.
        [req.params.id, fullName, departmentId, timezone, isActive, Object.hasOwn(req.body, "departmentId")]
      );
      if (res.rows[0]?.is_active === false) {
        await client.query("delete from sessions where user_id = $1", [req.params.id]);
        await client.query(`update invitations set revoked_at = clock_timestamp()
          where user_id = $1 and used_at is null and revoked_at is null`, [req.params.id]);
      }
      await client.query("commit");
      return { user: res.rows[0] };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  // Выпустить новую ссылку-приглашение сотруднику
  app.post<{ Params: { id: string } }>("/admin/users/:id/invitations", { schema: schema(undefined, idParams(),
    success({ token: { type: "string" }, expiresAt: { type: "string" }, link: { type: "string" } })) }, async (req, reply) => {
    try {
      const { token, expiresAt } = await createInvitation(req.params.id, req.currentUser!.id);
      return { token, expiresAt, link: `/invite#${token}` };
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.code === "user_not_found" ? 404 : 409).send({ error: err.code });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/admin/invitations/:id", {
    schema: schema(undefined, idParams(), { "2xx": okDto }) }, async (req) => {
    await revokeInvitation(req.params.id);
    return { ok: true };
  });
}
