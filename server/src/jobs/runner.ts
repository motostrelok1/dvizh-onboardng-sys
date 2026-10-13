import type { Pool, PoolClient } from "pg";
import { pool } from "../db.js";

export type JobName = "deadlines" | "reports" | "notifications" | "attachment_cleanup";
const keys: Record<JobName, number> = { deadlines: 1, reports: 2, notifications: 3, attachment_cleanup: 4 };
const namespace = 0x4c4d53;

export class JobUnavailableError extends Error {
  constructor(public readonly code: "job_in_progress" | "job_stopping") {
    super(code);
  }
}

// The dedicated session owns the lock through COMMIT and external delivery.
// Every database operation in work must use this client, never the pool.
export function createJobRunner(
  database: Pick<Pool, "connect"> = pool,
  log: (entry: { event: "job"; job: JobName; status: string; durationMs: number }) => void =
    (entry) => console.info(JSON.stringify(entry))
) {
  const pending = new Set<Promise<unknown>>();
  let stopping = false;
  const report = (job: JobName, status: string, started: number) => {
    try { log({ event: "job", job, status, durationMs: Date.now() - started }); } catch { /* logging cannot retain a lock */ }
  };

  async function execute<T>(job: JobName, work: (client: PoolClient) => Promise<T>, afterCommit?: (result: T, client: PoolClient) => Promise<void>): Promise<T> {
    const started = Date.now();
    let client: PoolClient | undefined;
    let locked = false;
    let inTransaction = false;
    let discard = false;
    let connectionLost = false;
    const onError = () => { connectionLost = true; discard = true; };
    try {
      client = await database.connect();
      client.on("error", onError);
      // If the lock acknowledgement is lost, destroy the session: it may own
      // a lock even though this process never received the result.
      let lock;
      try { lock = await client.query("select pg_try_advisory_lock($1, $2) as locked", [namespace, keys[job]]); }
      catch (error) { discard = true; throw error; }
      if (lock.rows[0]?.locked !== true) throw new JobUnavailableError("job_in_progress");
      locked = true;
      await client.query("begin isolation level read committed");
      inTransaction = true;
      const result = await work(client);
      await client.query("commit");
      inTransaction = false;
      if (connectionLost) throw new Error("job_connection_lost");
      if (afterCommit) await afterCommit(result, client);
      if (connectionLost) throw new Error("job_connection_lost");
      report(job, "succeeded", started);
      return result;
    } catch (error) {
      if (client && inTransaction) {
        try { await client.query("rollback"); } catch { discard = true; }
      }
      report(job, error instanceof JobUnavailableError ? "busy" : "failed", started);
      throw error;
    } finally {
      if (client) {
        if (locked) {
          try {
            const unlock = await client.query("select pg_advisory_unlock($1, $2) as unlocked", [namespace, keys[job]]);
            if (unlock.rows[0]?.unlocked !== true) discard = true;
          } catch { discard = true; }
        }
        if (discard) report(job, "connection_discarded", started);
        client.removeListener("error", onError);
        client.release(discard);
      }
    }
  }

  return {
    run<T>(job: JobName, work: (client: PoolClient) => Promise<T>, afterCommit?: (result: T, client: PoolClient) => Promise<void>): Promise<T> {
      if (stopping) return Promise.reject(new JobUnavailableError("job_stopping"));
      const task = execute(job, work, afterCommit);
      pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    },
    async stop(): Promise<void> {
      stopping = true;
      await Promise.allSettled([...pending]);
    }
  };
}

export const jobRunner = createJobRunner();
