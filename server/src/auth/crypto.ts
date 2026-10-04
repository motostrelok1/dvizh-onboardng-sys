import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";

// Токены (ссылка-приглашение, сессия) — случайная строка, в БД хранится только хеш.
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Пароли — bcrypt, с солью, медленный по дизайну.
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
