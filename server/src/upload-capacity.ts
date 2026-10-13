import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { pool } from "./db.js";
import { ensureUploadRoot, checkedUploadRoot, StoragePathError } from "./storage.js";
import { MAX_FILE_SIZE } from "./upload-receiver.js";

export type UploadLimits = { maxConcurrent: number; minFreeBytes: bigint; timeoutMs: number };
export function readUploadLimits(env: NodeJS.ProcessEnv = process.env): UploadLimits {
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name] ?? String(fallback);
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
      throw new Error("invalid_upload_capacity_config");
    }
    return Number(raw);
  }
  return { maxConcurrent: integer("UPLOAD_MAX_CONCURRENT",2,1,8),
    minFreeBytes: BigInt(integer("UPLOAD_MIN_FREE_BYTES",256*1024*1024,0,Number.MAX_SAFE_INTEGER)),
    timeoutMs: integer("UPLOAD_TIMEOUT_MS",120000,1000,600000) };
}
export class UploadCapacityError extends Error {
  constructor(public statusCode: 408 | 429 | 503 | 507,
    public code: "upload_timeout" | "upload_busy" | "upload_unavailable" | "storage_full") { super(code); }
}
export function uploadLockNamespace(root: string): number {
  // A dedicated range, disjoint from jobs. Same canonical server-side root
  // shares a pool of slots across processes; unrelated test/storage roots do not.
  return 0x50000000 | (createHash("sha256").update(root).digest().readUInt32BE(0) & 0x0fffffff);
}
export async function availableUploadBytes(root: string): Promise<bigint> {
  if (await checkedUploadRoot() !== root) throw new StoragePathError();
  const fs = await statfs(root,{bigint:true});
  if (fs.bavail < 0n || fs.bsize <= 0n) throw new Error("invalid_storage_capacity");
  return fs.bavail * fs.bsize; // available to the service, not root-reserved blocks
}
export type UploadControl = { signal: AbortSignal; assertActive(): void; beforeWrite(bytes: number): Promise<void> };
type Options = {
  database?: Pick<Pool,"connect">; limits?: UploadLimits;
  prepare?: () => Promise<string>; available?: (root: string) => Promise<bigint>;
};

export function createUploadCapacity(options: Options = {}) {
  const database = options.database ?? pool, limits = options.limits ?? readUploadLimits();
  const prepare = options.prepare ?? ensureUploadRoot, available = options.available ?? availableUploadBytes;
  const pending = new Set<Promise<unknown>>(), controllers = new Set<AbortController>();
  let stopping = false;
  function capacityError(error: unknown) {
    if (error instanceof UploadCapacityError || error instanceof StoragePathError) return error;
    return new UploadCapacityError(["ENOSPC","EDQUOT"].includes((error as NodeJS.ErrnoException)?.code ?? "") ? 507 : 503,
      ["ENOSPC","EDQUOT"].includes((error as NodeJS.ErrnoException)?.code ?? "") ? "storage_full" : "upload_unavailable");
  }
  async function execute<T>(work: (control: UploadControl) => Promise<T>, source?: AbortSignal) {
    const controller = new AbortController(); controllers.add(controller);
    const abort = () => controller.abort(new UploadCapacityError(408,"upload_timeout"));
    source?.addEventListener("abort",abort,{once:true}); if (source?.aborted) abort();
    const timer = setTimeout(abort,limits.timeoutMs); timer.unref();
    let client: PoolClient | undefined, slot: number | undefined, namespace = 0, discard = false;
    const lost = () => { discard = true; controller.abort(new UploadCapacityError(503,"upload_unavailable")); };
    const assertActive = () => { if (controller.signal.aborted) throw controller.signal.reason; };
    const query = async (text: string, values: unknown[] = []) => {
      const config = {text,values,query_timeout:5000};
      try { return await client!.query(config); }
      catch { discard = true; lost(); throw controller.signal.reason; }
    };
    try {
      assertActive();
      let root;
      try { root = await prepare(); assertActive(); client = await database.connect(); }
      catch (error) { throw capacityError(error); }
      client.on("error",lost); assertActive(); namespace = uploadLockNamespace(root);
      for (let candidate = 1; candidate <= limits.maxConcurrent; candidate++) {
        const result = await query("select pg_try_advisory_lock($1,$2) as locked",[namespace,candidate]);
        if (result.rows[0]?.locked === true) { slot = candidate; break; }
        assertActive();
      }
      if (slot === undefined) throw new UploadCapacityError(429,"upload_busy");
      assertActive();
      const active = await query(`select count(*)::int as active from pg_locks where locktype='advisory'
        and database=(select oid from pg_database where datname=current_database())
        and classid=$1::oid and objid between 1 and $2 and objsubid=2 and granted`,[namespace,limits.maxConcurrent]);
      const slots = Number(active.rows[0]?.active);
      if (!Number.isInteger(slots) || slots < 1) throw new UploadCapacityError(503,"upload_unavailable");
      const check = async (needed: bigint) => {
        assertActive();
        let free;
        try { free = await available(root); } catch (error) { throw capacityError(error); }
        assertActive();
        if (free < limits.minFreeBytes + needed) throw new UploadCapacityError(507,"storage_full");
      };
      // Conservative admission: every occupied slot budgets a full 50 MiB,
      // including bytes it may already have written. No Content-Length trust.
      await check(BigInt(slots)*BigInt(MAX_FILE_SIZE));
      return await work({ signal:controller.signal, assertActive,
        beforeWrite: bytes => check(BigInt(bytes)) });
    } finally {
      clearTimeout(timer); source?.removeEventListener("abort",abort); controllers.delete(controller);
      if (client) {
        if (slot !== undefined && !discard) {
          try { const result = await query("select pg_advisory_unlock($1,$2) as unlocked",[namespace,slot]);
            if (result.rows[0]?.unlocked !== true) discard = true;
          } catch { discard = true; }
        }
        client.removeListener("error",lost); client.release(discard);
      }
    }
  }
  return {
    run<T>(work: (control: UploadControl) => Promise<T>, source?: AbortSignal): Promise<T> {
      if (stopping) return Promise.reject(new UploadCapacityError(503,"upload_unavailable"));
      const task = execute(work,source); pending.add(task);
      void task.then(()=>pending.delete(task),()=>pending.delete(task)); return task;
    },
    async stop() {
      stopping = true;
      for (const controller of controllers) controller.abort(new UploadCapacityError(503,"upload_unavailable"));
      await Promise.allSettled([...pending]);
    }
  };
}
export const uploadCapacity = createUploadCapacity();
