import type { FastifyInstance } from "fastify";
import {
  getInvitationStatus,
  acceptInvitation,
  login,
  deleteSession,
  getUserBySession,
  AuthError
} from "../auth/service.js";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "../auth/constants.js";
import { logEvent } from "../events.js";
import { ensureReportsUpToYesterday } from "../jobs/reports.js";
import { pool } from "../db.js";
import { hashToken } from "../auth/crypto.js";
import { AUTH_ACCOUNT_MAX, enforceAuthLimit, limitAuthIp, limitInvitationLookup } from "../auth/rate-limit.js";

function validToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(token);
}

function bodyObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function setSessionCookie(reply: any, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

export async function authRoutes(app: FastifyInstance) {
  // Проверить ссылку-приглашение (для экрана «задать пароль»)
  app.post<{ Body: unknown }>("/auth/invitations/check", { onRequest: limitInvitationLookup, bodyLimit: 8 * 1024 }, async (req, reply) => {
    const token = bodyObject(req.body)?.token;
    if (typeof token !== "string" || !validToken(token)) return reply.code(400).send({ error: "invalid_request" });
    const status = await getInvitationStatus(token);
    if (!status.valid) {
      reply.code(404);
      return { valid: false, reason: status.reason };
    }
    return { valid: true, fullName: status.fullName, email: status.email };
  });

  // Принять приглашение: задать пароль, сразу войти
  app.post<{ Body: unknown }>(
    "/auth/invitations/accept",
    { onRequest: limitAuthIp, bodyLimit: 8 * 1024 },
    async (req, reply) => {
      const body = bodyObject(req.body);
      const token = body?.token;
      if (typeof token !== "string" || !validToken(token)) return reply.code(400).send({ error: "invalid_request" });
      if (!await enforceAuthLimit(req, reply, "invitation_token", token, AUTH_ACCOUNT_MAX)) return;
      const invitation = await pool.query<{ user_id: string }>(
        `select user_id from invitations where token_hash = $1 and used_at is null
         and revoked_at is null and expires_at > now()`, [hashToken(token)]);
      if (invitation.rows[0] && !await enforceAuthLimit(req, reply, "invitation_account",
        invitation.rows[0].user_id, AUTH_ACCOUNT_MAX)) return;
      if (!body || typeof body.password !== "string") return reply.code(400).send({ error: "invalid_request" });
      if (body.password.length < 8) {
        reply.code(400);
        return { error: "password_too_short" };
      }
      // bcrypt silently truncates at 72 bytes. Reject this for new passwords;
      // login accepts bounded longer legacy passwords without changing hashes.
      if (Buffer.byteLength(body.password, "utf8") > 72) return reply.code(400).send({ error: "password_too_long" });
      try {
        const session = await acceptInvitation(token, body.password);
        setSessionCookie(reply, session.token);
        return { ok: true };
      } catch (err) {
        if (err instanceof AuthError) {
          reply.code(400);
          return { error: err.code };
        }
        throw err;
      }
    }
  );

  // Вход по email/паролю (для тех, кто уже принял приглашение)
  app.post<{ Body: unknown }>("/auth/login", { onRequest: limitAuthIp, bodyLimit: 8 * 1024 }, async (req, reply) => {
    const body = bodyObject(req.body);
    if (!body || typeof body.email !== "string" || !body.email.trim() || body.email.length > 254) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (!await enforceAuthLimit(req, reply, "login_account", body.email, AUTH_ACCOUNT_MAX)) return;
    if (typeof body.password !== "string" || !body.password || body.password.length > 1024 ||
        Buffer.byteLength(body.password, "utf8") > 4096) return reply.code(400).send({ error: "invalid_request" });
    try {
      const { session, user } = await login(body.email, body.password);
      setSessionCookie(reply, session.token);
      if (user.role === "admin") {
        // Подготовка отчёта запускается по входу администратора (SPEC §8);
        // не блокируем ответ — отчёт нужен на дашборде, а не в этом JSON.
        ensureReportsUpToYesterday("login").catch((err) => app.log.error(err));
      }
      return { user };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401);
        return { error: "invalid_credentials" };
      }
      throw err;
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const user = await getUserBySession(token);
      await deleteSession(token);
      if (user) await logEvent(user.id, "session_end", { entityType: "session" });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await getUserBySession(token) : null;
    if (!user) {
      reply.code(401);
      return { error: "not_authenticated" };
    }
    return { user };
  });
}
