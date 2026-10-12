import { createEventQueue, type ClientEvent } from "./event-queue";

const queue = createEventQueue({
  storage: () => localStorage,
  now: () => Date.now(), uuid: () => crypto.randomUUID(),
  send: (body, signal) => fetch("/api/events", { method: "POST", cache: "no-store", signal,
    referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body }),
  beacon: body => { if ("sendBeacon" in navigator) navigator.sendBeacon("/api/events", body); }
});

// Called only after an authenticated API response, never at module load.
export function setEventOwner(id: string | null) { queue.setOwner(id); if (id) void queue.flush(); }
export function pauseEvents() { queue.pause(); }
export function enqueueEvent(event: Omit<ClientEvent, "eventId" | "occurredAt">) {
  if (queue.enqueue(event)) void queue.flush();
}
export const flush = queue.flush;

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush());
  window.addEventListener("storage", event => {
    if (event.key === "lms_event_owner_v2") queue.storageChanged(event.newValue);
    void flush();
  });
  window.addEventListener("pagehide", queue.pagehide);
  setInterval(() => void flush(), 15_000);
}
