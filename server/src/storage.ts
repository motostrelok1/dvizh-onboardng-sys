import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");

export function attachmentPath(lessonId: string, storedName: string): string {
  return join(UPLOAD_DIR, "lessons", lessonId, storedName);
}

export async function ensureLessonDir(lessonId: string): Promise<string> {
  const dir = join(UPLOAD_DIR, "lessons", lessonId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function storedFileName(originalName: string): string {
  return `${randomUUID()}-${originalName}`;
}
