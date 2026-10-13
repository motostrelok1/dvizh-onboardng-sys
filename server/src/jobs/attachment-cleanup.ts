import type { PoolClient } from "pg";
import { resolve } from "node:path";
import { jobRunner } from "./runner.js";
import { startSerialScheduler } from "./scheduler.js";
import { removeQueuedAttachmentFile, StoragePathError } from "../storage.js";

export const CLEANUP_BATCH_SIZE = 50;
export const CLEANUP_INTERVAL_MS = 60_000;
type Failure = "filesystem_error" | "unsafe_path" | "still_referenced";
type Remove = (lessonId: string, path: string) => Promise<void>;

export function cleanupRetrySeconds(attempts: number): number {
  return Math.min(3600, 60 * 2 ** Math.min(Math.max(attempts, 0), 6));
}
async function retry(client: PoolClient, id: string, attempts: number, category: Failure) {
  await client.query(`update attachment_file_cleanup set attempts=least(attempts+1,1000000),
    last_error=$2,next_attempt_at=clock_timestamp()+$3*interval '1 second' where id=$1`,
  [id,category,cleanupRetrySeconds(attempts)]);
}

// Runs inside the common runner transaction/advisory lane. Only committed
// DELETE-trigger jobs are visible; nothing scans or recursively removes dirs.
export async function processAttachmentCleanup(client: PoolClient, attachmentId: string | null = null,
  remove: Remove = removeQueuedAttachmentFile) {
  const ready = await client.query(`select id from attachment_file_cleanup
    where next_attempt_at<=clock_timestamp() and ($1::uuid is null or attachment_id=$1) limit 1`, [attachmentId]);
  if (!ready.rowCount) return { completed: 0, deferred: 0 };
  // Briefly exclude metadata writers while checking references/unlinking.
  // NOWAIT avoids waiting behind an upload/cascade holding parent locks.
  await client.query("lock table lesson_attachments in share mode nowait");
  const jobs = (await client.query(`select id,lesson_id,file_path,attempts from attachment_file_cleanup
    where next_attempt_at<=clock_timestamp() and ($1::uuid is null or attachment_id=$1)
    order by next_attempt_at,created_at,id limit $2 for update skip locked`, [attachmentId,CLEANUP_BATCH_SIZE])).rows;
  let completed = 0, deferred = 0;
  for (const job of jobs) {
    const live = (await client.query(`select file_path from lesson_attachments
      where file_path=$1 or lesson_id=$2`, [job.file_path,job.lesson_id])).rows;
    if (live.some(row => resolve(row.file_path) === resolve(job.file_path))) {
      await retry(client,job.id,job.attempts,"still_referenced"); deferred++; continue;
    }
    try { await remove(job.lesson_id,job.file_path); }
    catch (error) {
      await retry(client,job.id,job.attempts,error instanceof StoragePathError ? "unsafe_path" : "filesystem_error");
      deferred++; continue;
    }
    // If SQL/COMMIT fails after unlink, the job survives. ENOENT makes retry
    // idempotent; failed/unsafe jobs are never dropped or stripped of evidence.
    await client.query("delete from attachment_file_cleanup where id=$1", [job.id]);
    completed++;
  }
  return { completed, deferred };
}

export function runAttachmentCleanup(attachmentId: string | null = null) {
  return jobRunner.run("attachment_cleanup", client => processAttachmentCleanup(client,attachmentId));
}
export function startAttachmentCleanupScheduler() {
  return startSerialScheduler(() => runAttachmentCleanup(),CLEANUP_INTERVAL_MS);
}
