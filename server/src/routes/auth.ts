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

function setSessionCookie(reply: any, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

export async function authRoutes(app: FastifyInstance) {
  // Проверить ссылку-приглашение (для экрана «задать пароль»)
  app.get<{ Params: { token: string } }>("/auth/invitations/:token", async (req, reply) => {
    const status = await getInvitationStatus(req.params.token);
    if (!status.valid) {
      reply.code(404);
      return { valid: false, reason: status.reason };
    }
    return { valid: true, fullName: status.fullName, email: status.email };
  });

  // Принять приглашение: задать пароль, сразу войти
  app.post<{ Params: { token: string }; Body: { password: string } }>(
    "/auth/invitations/:token/accept",
    async (req, reply) => {
      if (!req.body?.password || req.body.password.length < 8) {
        reply.code(400);
        return { error: "password_too_short" };
      }
      try {
        const session = await acceptInvitation(req.params.token, req.body.password);
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
  app.post<{ Body: { email: string; password: string } }>("/auth/login", async (req, reply) => {
    try {
      const { session, user } = await login(req.body.email, req.body.password);
      setSessionCookie(reply, session.token);
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
    if (token) await deleteSession(token);
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
