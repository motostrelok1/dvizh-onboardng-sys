import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin } from "../auth/middleware.js";

export async function adminGroupRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/groups", async () => {
    const res = await pool.query(
      `select g.id, g.name, count(gm.user_id)::int as member_count
       from groups g
       left join group_members gm on gm.group_id = g.id
       group by g.id, g.name
       order by g.name`
    );
    return { groups: res.rows };
  });

  app.post<{ Body: { name: string } }>("/admin/groups", async (req, reply) => {
    if (!req.body?.name) {
      reply.code(400);
      return { error: "name_required" };
    }
    const res = await pool.query(`insert into groups (name) values ($1) returning id, name`, [
      req.body.name
    ]);
    reply.code(201);
    return { group: res.rows[0] };
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/admin/groups/:id",
    async (req) => {
      const res = await pool.query(`update groups set name = $2 where id = $1 returning id, name`, [
        req.params.id,
        req.body.name
      ]);
      return { group: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/groups/:id", async (req) => {
    await pool.query(`delete from groups where id = $1`, [req.params.id]);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/admin/groups/:id/members", async (req) => {
    const res = await pool.query(
      `select u.id, u.full_name, u.email
       from group_members gm join users u on u.id = gm.user_id
       where gm.group_id = $1
       order by u.full_name`,
      [req.params.id]
    );
    return { members: res.rows };
  });

  // Полная замена состава группы указанным списком сотрудников
  app.put<{ Params: { id: string }; Body: { userIds: string[] } }>(
    "/admin/groups/:id/members",
    async (req) => {
      const groupId = req.params.id;
      const userIds = req.body.userIds ?? [];
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(`delete from group_members where group_id = $1`, [groupId]);
        for (const userId of userIds) {
          await client.query(
            `insert into group_members (group_id, user_id) values ($1, $2)`,
            [groupId, userId]
          );
        }
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
      return { ok: true };
    }
  );
}
