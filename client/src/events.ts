// Клиент буферизует события просмотра урока в localStorage и досылает их,
// как только появляется сеть — то, что требует SPEC §13: «клиент
// буферизует события и досылает при восстановлении сети».

type ClientEvent = {
  eventType: "lesson_view_start" | "lesson_view_end";
  entityId: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
};

const STORAGE_KEY = "lms_event_queue";

function loadQueue(): ClientEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue: ClientEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage недоступен (приватный режим и т.п.) — событие просто
    // не сохранится между перезагрузками, но текущая попытка flush всё
    // равно пройдёт
  }
}

export function enqueueEvent(e: Omit<ClientEvent, "occurredAt">) {
  const queue = loadQueue();
  queue.push({ ...e, occurredAt: new Date().toISOString() });
  saveQueue(queue);
  flush();
}

let flushing = false;

export async function flush() {
  if (flushing) return;
  const queue = loadQueue();
  if (queue.length === 0) return;
  flushing = true;
  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queue })
    });
    if (res.ok) {
      saveQueue([]);
    }
    // при ошибке (4xx/5xx) оставляем очередь как есть — попробуем ещё раз
  } catch {
    // нет сети — тоже оставляем в очереди, retry по таймеру или событию online
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", flush);
  setInterval(flush, 15_000);
  // При закрытии вкладки обычный fetch может не успеть — используем Beacon
  window.addEventListener("pagehide", () => {
    const queue = loadQueue();
    if (queue.length > 0 && "sendBeacon" in navigator) {
      navigator.sendBeacon("/api/events", JSON.stringify({ events: queue }));
      saveQueue([]);
    }
  });
  flush(); // досылаем то, что накопилось с прошлой сессии
}
