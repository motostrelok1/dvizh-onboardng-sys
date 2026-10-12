import { JobUnavailableError } from "./runner.js";

export type Scheduler = { stop(): Promise<void> };
export type SchedulerClock = {
  schedule(callback: () => void, delay: number): unknown;
  cancel(timer: unknown): void;
};
const clock: SchedulerClock = {
  schedule(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
  cancel(timer) { clearTimeout(timer as NodeJS.Timeout); }
};

// Schedule from completion, not from start: even a slow run never overlaps.
export function startSerialScheduler(
  run: () => Promise<unknown>,
  intervalMs: number,
  timers: SchedulerClock = clock,
  onFailure: () => void = () => console.error("scheduled_job_failed")
): Scheduler {
  let stopped = false;
  let timer: unknown;
  let active: Promise<void> | undefined;
  const start = () => {
    if (stopped) return;
    active = Promise.resolve().then(async () => {
      if (stopped) return;
      try { await run(); } catch (error) {
        if (!(error instanceof JobUnavailableError)) {
          try { onFailure(); } catch { /* logging cannot break retry or shutdown */ }
        }
      }
    }).finally(() => {
      active = undefined;
      if (!stopped) timer = timers.schedule(start, intervalMs);
    });
  };
  start();
  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) timers.cancel(timer);
      await active;
    }
  };
}
