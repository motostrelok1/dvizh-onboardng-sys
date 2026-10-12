import type { Scheduler } from "./scheduler.js";

export async function drainJobs(
  schedulers: Scheduler[],
  runner: { stop(): Promise<void> },
  database: { end(): Promise<void> }
) {
  // Mark the runner stopped immediately, including jobs started by login.
  const draining = runner.stop();
  await Promise.all(schedulers.map((scheduler) => scheduler.stop()));
  await draining;
  await database.end();
}
