import assert from "node:assert/strict";
import { test } from "node:test";

test("real pagehide transport sends JSON Blob and keeps the queue when the browser rejects the beacon", async context => {
  const names = ["window", "localStorage", "navigator", "setInterval", "fetch"];
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const listeners = new Map(), storage = new Map(), calls = [];
  let accepted = false;
  const replacements = {
    window: { addEventListener: (name, callback) => listeners.set(name, callback) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { sendBeacon: (url, body) => { calls.push({ url, body }); return accepted; } },
    setInterval: () => 0,
    fetch: () => { throw new Error("Unexpected fetch"); }
  };
  for (const [name, value] of Object.entries(replacements)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  await import("../../client/src/events.ts");
  const events = [{ eventType: "lesson_view_start", entityId: "lesson", occurredAt: "2026-10-12T00:00:00Z" }];
  storage.set("lms_event_queue", JSON.stringify(events));
  listeners.get("pagehide")();
  assert.deepEqual(JSON.parse(storage.get("lms_event_queue")), events);
  accepted = true; listeners.get("pagehide")();
  assert.deepEqual(JSON.parse(storage.get("lms_event_queue")), []);
  for (const { url, body } of calls) {
    assert.equal(url, "/api/events"); assert.ok(body instanceof Blob);
    assert.equal(body.type, "application/json");
    assert.deepEqual(JSON.parse(await body.text()), { events });
  }
});
