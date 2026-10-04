import { pool } from "../db.js";
import { randomToken, hashToken, hashPassword, verifyPassword } from "./crypto.js";

const INVITATION_TTL_DAYS = 7;
const SESSION_TTL_DAYS = 30;

export type PublicUser = {
  id: string;
  fullName: string;
  email: string | null;
  role: "admin" | "employee";
  timezone: string;
};

function toPublicUser(row: any): PublicUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    timezone: row.timezone
  };
}

// --- Приглашения ---

// Выпустить новую ссылку-приглашение для сотрудника. Возвращает сырой токен —
// он отдаётся пользователю один раз и нигде, кроме этого ответа, не хранится.
export async function createInvitation(userId: string, createdBy: string | null) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `insert into invitations (user_id, token_hash, created_by, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, tokenHash, createdBy, expiresAt]
  );

  return { token, expiresAt };
}

export async function getInvitationStatus(token: string) {
  const tokenHash = hashToken(token);
  const res = await pool.query(
    `select i.*, u.full_name, u.email
     from invitations i join users u on u.id = i.user_id
     where i.token_hash = $1`,
    [tokenHash]
  );
  const inv = res.rows[0];
  if (!inv) return { valid: false as const, reason: "not_found" as const };
  if (inv.revoked_at) return { valid: false as const, reason: "revoked" as const };
  if (inv.used_at) return { valid: false as const, reason: "used" as const };
  if (new Date(inv.expires_at) < new Date()) return { valid: false as const, reason: "expired" as const };

  return {
    valid: true as const,
    fullName: inv.full_name as string,
    email: inv.email as string | null
  };
}

// Принять приглашение: задать пароль, пометить приглашение использованным,
// создать сессию. Атомарно в одной транзакции.
export async function acceptInvitation(token: string, password: string) {
  const tokenHash = hashToken(token);
  const client = await pool.connect();
  try {
    await client.query("begin");

    const res = await client.query(
      `select * from invitations where token_hash = $1 for update`,
      [tokenHash]
    );
    const inv = res.rows[0];
    if (!inv) throw new AuthError("invitation_not_found");
    if (inv.revoked_at) throw new AuthError("invitation_revoked");
    if (inv.used_at) throw new AuthError("invitation_used");
    if (new Date(inv.expires_at) < new Date()) throw new AuthError("invitation_expired");

    const passwordHash = await hashPassword(password);
    await client.query(
      `update users set password_hash = $1, is_active = true where id = $2`,
      [passwordHash, inv.user_id]
    );
    await client.query(`update invitations set used_at = now() where id = $1`, [inv.id]);

    const session = await createSessionWithClient(client, inv.user_id);

    await client.query("commit");
    return session;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeInvitation(id: string) {
  await pool.query(`update invitations set revoked_at = now() where id = $1`, [id]);
}

// --- Сессии ---

async function createSessionWithClient(client: { query: typeof pool.query }, userId: string) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await client.query(
    `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function createSession(userId: string) {
  return createSessionWithClient(pool, userId);
}

export async function getUserBySession(token: string): Promise<PublicUser | null> {
  const tokenHash = hashToken(token);
  const res = await pool.query(
    `select u.* from sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash]
  );
  const row = res.rows[0];
  return row ? toPublicUser(row) : null;
}

export async function deleteSession(token: string) {
  const tokenHash = hashToken(token);
  await pool.query(`delete from sessions where token_hash = $1`, [tokenHash]);
}

// --- Вход по паролю (для сотрудников, уже принявших приглашение) ---

export async function login(email: string, password: string) {
  const res = await pool.query(
    `select * from users where email = $1 and is_active = true`,
    [email]
  );
  const user = res.rows[0];
  if (!user || !user.password_hash) throw new AuthError("invalid_credentials");

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AuthError("invalid_credentials");

  const session = await createSession(user.id);
  return { session, user: toPublicUser(user) };
}

export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
