import { pool } from "../db.js";
import { randomToken, hashToken, hashPassword, verifyPassword } from "./crypto.js";
import { logEvent } from "../events.js";
import type { PoolClient } from "pg";

const INVITATION_TTL_DAYS = 7;
const SESSION_TTL_DAYS = 30;

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level read committed");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// All credential operations lock the user BEFORE invitations/sessions.
// Different links, login and administrative deactivation share this lock.
async function lockUser(client: PoolClient, userId: string) {
  // Credentials never change the user's primary key. NO KEY UPDATE still
  // serializes them, while allowing FK checks (e.g. two admins inviting each
  // other) to take KEY SHARE without a cross-user deadlock.
  return (await client.query("select id, is_active from users where id = $1 for no key update", [userId])).rows[0];
}

async function revokeUnusedInvitations(client: PoolClient, userId: string) {
  await client.query(`update invitations set revoked_at = clock_timestamp()
    where user_id = $1 and used_at is null and revoked_at is null`, [userId]);
}

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
  return inTransaction(async client => {
    const user = await lockUser(client, userId);
    if (!user) throw new AuthError("user_not_found");
    if (!user.is_active) throw new AuthError("user_inactive");
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await revokeUnusedInvitations(client, userId);
    await client.query(
      `insert into invitations (user_id, token_hash, created_by, expires_at)
       values ($1, $2, $3, $4)`, [userId, hashToken(token), createdBy, expiresAt]);
    return { token, expiresAt };
  });
}

export async function getInvitationStatus(token: string) {
  const tokenHash = hashToken(token);
  const res = await pool.query(
    `select i.*, u.full_name, u.email, u.is_active, i.expires_at <= clock_timestamp() as expired
     from invitations i join users u on u.id = i.user_id
     where i.token_hash = $1`,
    [tokenHash]
  );
  const inv = res.rows[0];
  if (!inv) return { valid: false as const, reason: "not_found" as const };
  if (inv.revoked_at) return { valid: false as const, reason: "revoked" as const };
  if (inv.used_at) return { valid: false as const, reason: "used" as const };
  if (inv.expired) return { valid: false as const, reason: "expired" as const };
  if (!inv.is_active) return { valid: false as const, reason: "inactive" as const };

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
  return inTransaction(async client => {
    // Find the owner without taking an invitation lock: locking separate links
    // first would deadlock when both transactions revoke the other's link.
    const owner = (await client.query("select user_id from invitations where token_hash = $1", [tokenHash])).rows[0];
    if (!owner) throw new AuthError("invitation_not_found");
    const user = await lockUser(client, owner.user_id);
    if (!user) throw new AuthError("invitation_not_found");
    const res = await client.query(
      `select *, expires_at <= clock_timestamp() as expired from invitations where token_hash = $1 for update`,
      [tokenHash]
    );
    const inv = res.rows[0];
    if (!inv) throw new AuthError("invitation_not_found");
    if (inv.revoked_at) throw new AuthError("invitation_revoked");
    if (inv.used_at) throw new AuthError("invitation_used");
    if (inv.expired) throw new AuthError("invitation_expired");
    if (!user.is_active) throw new AuthError("invitation_inactive");

    const passwordHash = await hashPassword(password);
    // Recheck real database time after bcrypt; now() freezes at BEGIN and
    // could accept a link that expired while waiting for another operation.
    const consumed = await client.query(`update invitations set used_at = clock_timestamp()
      where id = $1 and expires_at > clock_timestamp() returning id`, [inv.id]);
    if (!consumed.rowCount) throw new AuthError("invitation_expired");
    await client.query(`update users set password_hash = $1 where id = $2`, [passwordHash, inv.user_id]);
    await revokeUnusedInvitations(client, inv.user_id);
    await client.query("delete from sessions where user_id = $1", [inv.user_id]);
    const session = await createSessionWithClient(client, inv.user_id);
    await logEvent(inv.user_id, "session_start", { entityType: "session", payload: { method: "invitation" } }, client);
    return session;
  });
}

export async function revokeInvitation(id: string) {
  await inTransaction(async client => {
    const owner = (await client.query("select user_id from invitations where id = $1", [id])).rows[0];
    if (!owner) return;
    await lockUser(client, owner.user_id);
    await client.query(`update invitations set revoked_at = clock_timestamp()
      where id = $1 and used_at is null and revoked_at is null`, [id]);
  });
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
  return inTransaction(async client => {
    const user = await lockUser(client, userId);
    if (!user?.is_active) throw new AuthError("invalid_credentials");
    return createSessionWithClient(client, userId);
  });
}

export async function getUserBySession(token: string): Promise<PublicUser | null> {
  const tokenHash = hashToken(token);
  const res = await pool.query(
    `select u.* from sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and u.is_active = true`,
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
  return inTransaction(async client => {
    const res = await client.query(
      `select * from users where email = $1 and is_active = true for no key update`, [email]);
    const user = res.rows[0];
    if (!user || !user.password_hash) throw new AuthError("invalid_credentials");
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw new AuthError("invalid_credentials");
    // Keep the user lock through session creation: a concurrent password reset
    // either deletes this session afterward or login verifies the new hash.
    const session = await createSessionWithClient(client, user.id);
    await logEvent(user.id, "session_start", { entityType: "session", payload: { method: "password" } }, client);
    return { session, user: toPublicUser(user) };
  });
}

export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
