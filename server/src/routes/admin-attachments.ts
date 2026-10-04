import type { FastifyInstance } from "fastify";
import { createWriteStream, createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { attachmentPath, ensureLessonDir, storedFileName } from "../storage.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ — стартовый лимит, см. SPEC §18
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"];

export async function adminAttachmentRoutes(app: FastifyInstance) {
  app.post<{ Params: { lessonId: string } }>(
    "/admin/lessons/:lessonId/attachments",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
      if (!file) {
        reply.code(400);
        return { error: "file_required" };
      }

      const ext = "." + (file.filename.split(".").pop() ?? "").toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        reply.code(400);
        return { error: "file_type_not_allowed", allowed: ALLOWED_EXTENSIONS };
      }

      const lessonId = req.params.lessonId;
      await ensureLessonDir(lessonId);
      const storedName = storedFileName(file.filename);
      const diskPath = attachmentPath(lessonId, storedName);

      let bytesWritten = 0;
      file.file.on("data", (chunk: Buffer) => (bytesWritten += chunk.length));
      await pipeline(file.file, createWriteStream(diskPath));

      if (file.file.truncated) {
        await unlink(diskPath).catch(() => {});
        reply.code(400);
        return { error: "file_too_large", maxBytes: MAX_FILE_SIZE };
      }

      const posRes = await pool.query(
        `select coalesce(max(position), -1) + 1 as next from lesson_attachments where lesson_id = $1`,
        [lessonId]
      );
      const res = await pool.query(
        `insert into lesson_attachments (lesson_id, file_name, file_path, size_bytes, position)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [lessonId, file.filename, diskPath, bytesWritten, posRes.rows[0].next]
      );

      reply.code(201);
      return { attachment: res.rows[0] };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/attachments/:id",
    { preHandler: requireAdmin },
    async (req) => {
      const res = await pool.query(`delete from lesson_attachments where id = $1 returning file_path`, [
        req.params.id
      ]);
      const row = res.rows[0];
      if (row) await unlink(row.file_path).catch(() => {});
      return { ok: true };
    }
  );

  // Скачивание — пока доступно любому вошедшему пользователю (админу).
  // Проверка доступа сотрудника к курсу добавится в этапе 7 вместе с кабинетом.
  app.get<{ Params: { id: string } }>(
    "/attachments/:id/download",
    { preHandler: requireAuth },
    async (req, reply) => {
      const res = await pool.query(`select * from lesson_attachments where id = $1`, [req.params.id]);
      const row = res.rows[0];
      if (!row) {
        reply.code(404);
        return { error: "not_found" };
      }
      reply.header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(row.file_name)}"`
      );
      return reply.send(createReadStream(row.file_path));
    }
  );
}
