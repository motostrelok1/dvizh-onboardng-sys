import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import {
  isValidLessonId, openAttachmentForRead, removeAttachmentFile
} from "../storage.js";
import { checkCourseAccess, getCourseIdForAttachment } from "../access.js";
import { logEvent } from "../events.js";
import { attachmentContentType, hasAllowedFileContent } from "../file-content.js";
import { installApiValidation, schema, idParams, attachmentDto, okDto, success } from "../api-validation.js";
import { receiveAttachment, UploadReceiveError } from "../upload-receiver.js";

export async function adminAttachmentRoutes(app: FastifyInstance) {
  installApiValidation(app);
  app.post<{ Params: { lessonId: string } }>(
    "/admin/lessons/:lessonId/attachments",
    { preHandler: requireAdmin, config: { validationError: "invalid_lesson_id" },
      schema: schema(undefined, idParams("lessonId"), success({ attachment: attachmentDto })) },
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

      const cleanupFailed = () => req.log.error({ event: "upload", category: "cleanup_failed" }, "operation_failed");
      let received;
      try {
        received = await receiveAttachment(req.raw, lessonId, cleanupFailed);
      } catch (error) {
        if (error instanceof UploadReceiveError) return reply.code(error.statusCode).send(error.response);
        throw error;
      }
      const { staged, filename, extension, mimetype, bytesWritten } = received;
      let persisted = false, commitAttempted = false;
      try {
        // The multipart MIME is supplied by the client and cannot authorize a
        // format. Inspect the private completed file before inserting its row.
        if (!await hasAllowedFileContent(staged.temporaryPath, extension, mimetype)) {
          reply.code(400);
          return { error: "file_content_not_allowed" };
        }

        const client = await pool.connect();
        let discardClient = false;
        try {
          await client.query("begin isolation level read committed");
          // Do not hold DB locks while receiving/parsing a potentially slow file.
          // Recheck after validation; block a concurrent lesson/cascade deletion
          // until publication and the attachment INSERT commit together.
          const current = await client.query("select id from lessons where id = $1 for key share", [lessonId]);
          if (!current.rows[0]) {
            await client.query("rollback");
            reply.code(404);
            return { error: "lesson_not_found" };
          }
          const posRes = await client.query(
            `select coalesce(max(position), -1) + 1 as next from lesson_attachments where lesson_id = $1`,
            [lessonId]
          );
          await staged.publish();
          const res = await client.query(
            `insert into lesson_attachments (lesson_id, file_name, file_path, size_bytes, position)
             values ($1, $2, $3, $4, $5) returning *`,
            [lessonId, filename, staged.diskPath, bytesWritten, posRes.rows[0].next]
          );
          commitAttempted = true;
          await client.query("commit");
          persisted = true;
          reply.code(201);
          return { attachment: res.rows[0] };
        } catch (error) {
          try { await client.query("rollback"); }
          catch { discardClient = true; }
          // Losing COMMIT's acknowledgement is ambiguous: deleting the file
          // could break a committed DB row. Retain it for later reconciliation.
          if (commitAttempted) req.log.error({ event: "upload", category: "commit_uncertain" }, "operation_failed");
          throw error;
        } finally {
          client.release(discardClient);
        }
      } finally {
        await staged.cleanup(persisted || commitAttempted).catch(cleanupFailed);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/attachments/:id",
    { preHandler: requireAdmin, schema: schema(undefined, idParams(), { "2xx": okDto }) },
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
    { preHandler: requireAuth, schema: schema(undefined, idParams()) },
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
