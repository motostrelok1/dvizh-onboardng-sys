import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";
import { authClientIp } from "./client-ip.js";

export const AUTH_WINDOW_MS = 10 * 60 * 1000;
export const AUTH_IP_MAX = 100;
export const AUTH_ACCOUNT_MAX = 10;
export const INVITATION_LOOKUP_IP_MAX = 120;
type Scope = "action_ip" | "invitation_lookup_ip" | "login_account" | "invitation_token" | "invitation_account";

export function authRateLimitKey(scope: Scope, subject: string): string {
  const normalized = scope === "login_account" ? subject.trim().toLowerCase() : subject;
  return createHash("sha256").update(scope).update("\0").update(normalized).digest("hex");
}

export async function consumeAuthAttempt(scope: Scope, subject: string, maximum: number) {
  // PostgreSQL serializes conflicts on the key, including between processes.
  // The first request starts the window. Denied requests never extend it.
  const result = await pool.query<{ attempts: number; retry_seconds: number }>(
    `insert into auth_rate_limits (bucket_key, attempts, expires_at)
     values ($1, 1, statement_timestamp() + $2 * interval '1 millisecond')
     on conflict (bucket_key) do update set
       attempts = case when auth_rate_limits.expires_at <= statement_timestamp() then 1
         else least(auth_rate_limits.attempts + 1, $3 + 2) end,
       expires_at = case when auth_rate_limits.expires_at <= statement_timestamp()
         then statement_timestamp() + $2 * interval '1 millisecond'
         else auth_rate_limits.expires_at end
     returning attempts, greatest(1, ceil(extract(epoch from (expires_at - statement_timestamp()))))::integer as retry_seconds`,
    [authRateLimitKey(scope, subject), AUTH_WINDOW_MS, maximum]
  );
  const row = result.rows[0];
  return { allowed: row.attempts <= maximum, retryAfterSeconds: row.retry_seconds,
    firstDenied: row.attempts === maximum + 1 };
}

export async function pruneExpiredAuthLimits(): Promise<void> {
  // A bounded batch avoids a full delete/long transaction on an auth request.
  await pool.query(`delete from auth_rate_limits where expires_at <= statement_timestamp() and bucket_key in (
    select bucket_key from auth_rate_limits where expires_at <= statement_timestamp()
    order by expires_at limit 1000
  )`);
}

let nextCleanup = 0;
async function maybePruneExpiredLimits() {
  if (Date.now() >= nextCleanup) {
    nextCleanup = Date.now() + 60_000;
    await pruneExpiredAuthLimits();
  }
}
export async function enforceAuthLimit(request: FastifyRequest, reply: FastifyReply,
  scope: Scope, subject: string, maximum: number): Promise<boolean> {
  const result = await consumeAuthAttempt(scope, subject, maximum);
  if (result.allowed) return true;
  if (result.firstDenied) {
    request.server.log.warn({ event: "auth_rate_limited", scope, retryAfterSeconds: result.retryAfterSeconds },
      "Authentication rate limit exceeded");
  }
  reply.header("Retry-After", String(result.retryAfterSeconds)).code(429).send({
    error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds
  });
  return false;
}

export async function limitAuthIp(request: FastifyRequest, reply: FastifyReply) {
  await maybePruneExpiredLimits();
  await enforceAuthLimit(request, reply, "action_ip", authClientIp(request), AUTH_IP_MAX);
}

export async function limitInvitationLookup(request: FastifyRequest, reply: FastifyReply) {
  await maybePruneExpiredLimits();
  await enforceAuthLimit(request, reply, "invitation_lookup_ip", authClientIp(request), INVITATION_LOOKUP_IP_MAX);
}
