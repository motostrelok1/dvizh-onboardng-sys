import type { FastifyInstance } from "fastify";
import { pipeline } from "node:stream/promises";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import {
  ALLOWED_EXTENSIONS, allowedExtension, ensureLessonDir, isValidLessonId,
  openAttachmentForRead, openNewAttachment, removeAttachmentFile, storedFileName
} from "../storage.js";
import { checkCourseAccess, getCourseIdForAttachment } from "../access.js";
import { logEvent } from "../events.js";
import { attachmentContentType, hasAllowedFileContent } from "../file-content.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ — стартовый лимит, см. SPEC §18

export async function adminAttachmentRoutes(app: FastifyInstance) {
  app.post<{ Params: { lessonId: string } }>(
    "/admin/lessons/:lessonId/attachments",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const lessonId = req.params.lessonId.toLowerCase();
      if (!isValidLessonId(lessonId)) {
        reply.code(400);
        return { error: "invalid_lesson_id" };
      }
      const lesson = await pool.query("select id from lessons where id = $1", [lessonId]);
      if (!lesson.rows[0]) {
        reply.code(404);
        return { error: "lesson_not_found" };
      }

      const file = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
      if (!file) {
        reply.code(400);
        return { error: "file_required" };
      }

      const extension = allowedExtension(file.filename);
      if (!extension) {
        reply.code(400);
        return { error: "file_type_not_allowed", allowed: ALLOWED_EXTENSIONS };
      }

      await ensureLessonDir(lessonId);
      const { diskPath, handle } = await openNewAttachment(lessonId, storedFileName(file.filename));
      let persisted = false;
      try {
        let bytesWritten = 0;
        file.file.on("data", (chunk: Buffer) => (bytesWritten += chunk.length));
        await pipeline(file.file, handle.createWriteStream());

        if (file.file.truncated) {
          reply.code(400);
          return { error: "file_too_large", maxBytes: MAX_FILE_SIZE };
        }

        // The multipart MIME is supplied by the client and cannot authorize a
        // format. Inspect the private completed file before inserting its row.
        if (!await hasAllowedFileContent(diskPath, extension, file.mimetype)) {
          reply.code(400);
          return { error: "file_content_not_allowed" };
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
        persisted = true;
        reply.code(201);
        return { attachment: res.rows[0] };
      } finally {
        await handle.close();
        if (!persisted) {
          await removeAttachmentFile(lessonId, diskPath).catch((error) => app.log.error(error));
        }
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/attachments/:id",
    { preHandler: requireAdmin },
    async (req) => {
      const res = await pool.query(`select lesson_id, file_path from lesson_attachments where id = $1`, [req.params.id]);
      const row = res.rows[0];
      if (row) {
        await removeAttachmentFile(row.lesson_id, row.file_path);
        await pool.query(`delete from lesson_attachments where id = $1`, [req.params.id]);
      }
      return { ok: true };
    }
  );

  // Скачивание — только вошедшему пользователю с доступом к курсу этого урока
  // (админ — всегда; сотрудник — если курс назначен и не просрочен, либо он
  // записан на курс из открытого каталога).
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

      const courseId = await getCourseIdForAttachment(req.params.id);
      const access = courseId ? await checkCourseAccess(req.currentUser!, courseId) : { ok: false as const, reason: "not_found" as const };
      if (!access.ok) {
        reply.code(403);
        return { error: access.reason };
      }

      const handle = await openAttachmentForRead(row.lesson_id, row.file_path);
      try {
        await logEvent(req.currentUser!.id, "attachment_download", {
          entityType: "attachment",
          entityId: row.id,
          payload: { lessonId: row.lesson_id, fileName: row.file_name }
        });

        reply.header(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(row.file_name)}"`
        );
        reply.type(attachmentContentType(row.file_path));
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.send(handle.createReadStream());
      } catch (error) {
        await handle.close();
        throw error;
      }
    }
  );
}
