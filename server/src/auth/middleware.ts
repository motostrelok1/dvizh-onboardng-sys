import type { FastifyRequest, FastifyReply } from "fastify";
import { getUserBySession, type PublicUser } from "./service.js";
import { SESSION_COOKIE } from "./constants.js";

// Прикрепляем текущего пользователя к запросу, чтобы обработчики могли
// читать req.currentUser без повторного похода в БД.
declare module "fastify" {
  interface FastifyRequest {
    currentUser?: PublicUser;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  const user = token ? await getUserBySession(token) : null;
  if (!user) {
    reply.code(401).send({ error: "not_authenticated" });
    return reply;
  }
  req.currentUser = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const res = await requireAuth(req, reply);
  if (res) return res; // уже отдан 401
  if (req.currentUser!.role !== "admin") {
    reply.code(403).send({ error: "admin_only" });
    return reply;
  }
}
