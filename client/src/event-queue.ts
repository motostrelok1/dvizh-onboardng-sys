export type ClientEvent = {
  eventId: string; eventType: "lesson_view_start" | "lesson_view_end";
  entityId: string; occurredAt: string; payload?: { durationMs?: number };
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Environment = {
  storage: () => StorageLike; now: () => number; uuid: () => string;
  send: (body: string, signal: AbortSignal) => Promise<Response>; beacon: (body: Blob) => void;
};
const PREFIX = "lms_event_v2:", OWNER = "lms_event_owner_v2";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_EVENT_QUEUE = 2000, EVENT_BATCH_SIZE = 100;

function valid(value: unknown): value is ClientEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as ClientEvent;
  if (Object.keys(e).some(k => !["eventId", "eventType", "entityId", "occurredAt", "payload"].includes(k)) ||
    !UUID.test(e.eventId) || !UUID.test(e.entityId) ||
    !["lesson_view_start", "lesson_view_end"].includes(e.eventType) ||
    typeof e.occurredAt !== "string" || e.occurredAt.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.occurredAt) ||
    !Number.isFinite(Date.parse(e.occurredAt))) return false;
  if (e.payload !== undefined && (e.payload === null || typeof e.payload !== "object" || Array.isArray(e.payload) ||
    Object.keys(e.payload).some(k => k !== "durationMs") ||
    (e.payload.durationMs !== undefined && (!Number.isInteger(e.payload.durationMs) || e.payload.durationMs < 0 || e.payload.durationMs > 2147483647)) ||
    (e.eventType === "lesson_view_start" && Object.keys(e.payload).length > 0))) return false;
  return true;
}

export function createEventQueue(env: Environment) {
  let owner: string | null = null, lastOwner: string | null = null, epoch = 0, sending = false, retryAt = 0, shared = true;
  // Used only when persistence fails; successful writes live in independent
  // event keys, so another tab cannot overwrite an entire array/ACK snapshot.
  const memory = new Map<string, ClientEvent>();
  const key = (id: string) => `${PREFIX}${owner}:${id}`;
  function remove(k: string) { memory.delete(k); try { env.storage().removeItem(k); } catch { /* private mode */ } }
  function sharedOwner() { if (!shared) return owner; try { return env.storage().getItem(OWNER); } catch { return owner; } }
  function keys() {
    try { const storage = env.storage(); return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => !!k); }
    catch { return []; }
  }
  function setOwner(id: string | null) {
    if (id && !UUID.test(id)) throw new Error("invalid_event_owner");
    id = id?.toLowerCase() ?? null;
    if (id !== owner) { epoch++; retryAt = 0; }
    if (id !== lastOwner || !id) memory.clear();
    lastOwner = id;
    owner = id;
    // Unattributed old queues cannot safely be assigned to a later login.
    remove("lms_event_queue");
    for (const k of keys()) if (k.startsWith(PREFIX) && (!id || !k.startsWith(`${PREFIX}${id}:`))) remove(k);
    try { if (id) env.storage().setItem(OWNER, id); else env.storage().removeItem(OWNER); shared = true; } catch { shared = false; }
  }
  function pause() { owner = null; epoch++; }
  function current() { return owner !== null && sharedOwner() === owner; }
  function pending() {
    if (!current()) return [];
    const all = new Map(memory);
    for (const k of keys()) {
      if (!k.startsWith(`${PREFIX}${owner}:`)) continue;
      try {
        const e: unknown = JSON.parse(env.storage().getItem(k) ?? "null");
        if (valid(e) && key(e.eventId) === k) all.set(k, e); else remove(k);
      } catch { remove(k); }
    }
    return [...all.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  }
  function enqueue(input: Omit<ClientEvent, "eventId" | "occurredAt">) {
    if (!current() || pending().length >= MAX_EVENT_QUEUE) return false;
    const e = { ...input, eventId: env.uuid().toLowerCase(), occurredAt: new Date(env.now()).toISOString() };
    if (!valid(e)) return false;
    const k = key(e.eventId);
    try { env.storage().setItem(k, JSON.stringify(e)); } catch { memory.set(k, e); }
    return true;
  }
  async function flush() {
    if (sending || !current() || env.now() < retryAt) return;
    const batch = pending().slice(0, EVENT_BATCH_SIZE);
    if (!batch.length) return;
    const session = owner, generation = epoch;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    sending = true;
    try {
      const res = await env.send(JSON.stringify({ ownerId: session, events: batch }), abort.signal);
      if (owner !== session || epoch !== generation || !current()) return;
      if (res.status === 401 || res.status === 403) { pause(); return; }
      if (res.status === 429) {
        const seconds = Number(res.headers.get("Retry-After"));
        retryAt = env.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60) * 1000;
        return;
      }
      if (!res.ok) return;
      const ack = await res.json();
      // Do not treat an old {accepted:n}, malformed, or unrelated ACK as proof.
      if (!Array.isArray(ack.acceptedIds) || !Array.isArray(ack.rejected)) return;
      const sent = new Set(batch.map(e => e.eventId));
      const permanent = new Set(["not_found", "not_assigned", "not_enrolled", "deadline_passed", "invalid_event", "invalid_event_time", "event_id_conflict"]);
      const done: string[] = [...ack.acceptedIds];
      for (const item of ack.rejected) {
        if (!item || typeof item.eventId !== "string" || !permanent.has(item.error)) return;
        done.push(item.eventId);
      }
      if (done.some(id => typeof id !== "string" || !sent.has(id)) || new Set(done).size !== done.length) return;
      // Recheck after reading an asynchronous response body (logout race).
      if (owner !== session || epoch !== generation || !current()) return;
      for (const id of done) remove(key(id));
    } catch { /* Keep stable IDs on offline, timeout, 5xx, or a lost ACK. */ }
    finally { clearTimeout(timer); sending = false; }
  }
  function pagehide() {
    if (!current() || env.now() < retryAt) return;
    const events = pending().slice(0, EVENT_BATCH_SIZE);
    if (!events.length) return;
    try { env.beacon(new Blob([JSON.stringify({ ownerId: owner, events })], { type: "application/json" })); }
    catch { /* Sending/queueing a beacon is never a server ACK. */ }
  }
  return { setOwner, pause, enqueue, pending, flush, pagehide };
}
