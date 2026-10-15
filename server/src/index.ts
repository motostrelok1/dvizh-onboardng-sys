import "dotenv/config";
import Fastify from "fastify";
import { installPrivacyHeaders, privateLogger } from "./privacy.js";
import { installApiErrors } from "./api-validation.js";
import { installCsrfProtection } from "./csrf.js";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { adminDepartmentRoutes } from "./routes/admin-departments.js";
import { adminGroupRoutes } from "./routes/admin-groups.js";
import { adminCourseRoutes } from "./routes/admin-courses.js";
import { adminAttachmentRoutes } from "./routes/admin-attachments.js";
import { adminTestRoutes } from "./routes/admin-tests.js";
import { adminAssignmentRoutes } from "./routes/admin-assignments.js";
import { meRoutes } from "./routes/me.js";
import { testAttemptRoutes } from "./routes/test-attempts.js";
import { eventRoutes } from "./routes/events.js";
import { adminDashboardRoutes } from "./routes/admin-dashboard.js";
import { adminAnalyticsSettingsRoutes } from "./routes/admin-analytics-settings.js";
import { adminReportRoutes } from "./routes/admin-reports.js";
import { startReportScheduler } from "./jobs/reports.js";
import { adminNotificationRuleRoutes } from "./routes/admin-notification-rules.js";
import { notificationRoutes, publicPushRoutes } from "./routes/notifications.js";
import { startNotificationScheduler } from "./jobs/notifications.js";
import { startDeadlineChecker } from "./jobs/deadlines.js";
import { startAttachmentCleanupScheduler } from "./jobs/attachment-cleanup.js";

import { pool } from "./db.js";
import { jobRunner } from "./jobs/runner.js";
import type { Scheduler } from "./jobs/scheduler.js";
import { drainJobs } from "./jobs/shutdown.js";

const app = Fastify({ logger: privateLogger });
installPrivacyHeaders(app);
installApiErrors(app);
installCsrfProtection(app);

await app.register(cookie);
await app.register(multipart);
await app.register(authRoutes);
await app.register(adminUserRoutes);
await app.register(adminDepartmentRoutes);
await app.register(adminGroupRoutes);
await app.register(adminCourseRoutes);
await app.register(adminAttachmentRoutes);
await app.register(adminTestRoutes);
await app.register(adminAssignmentRoutes);
await app.register(meRoutes);
await app.register(testAttemptRoutes);
await app.register(eventRoutes);
await app.register(adminDashboardRoutes);
await app.register(adminAnalyticsSettingsRoutes);
await app.register(adminReportRoutes);
await app.register(adminNotificationRuleRoutes);
await app.register(publicPushRoutes);
await app.register(notificationRoutes);
await app.register(healthRoutes);

const port = Number(process.env.PORT ?? 3000);

const schedulers: Scheduler[] = [];
app.addHook("onClose", async () => drainJobs(schedulers, jobRunner, pool));
let closing: Promise<void> | undefined;
const close = () => {
  closing ??= app.close().catch(() => {
    app.log.error({ event: "shutdown_failed" }, "shutdown_failed");
    process.exitCode = 1;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);

try {
  await app.listen({ port, host: "127.0.0.1" });
  schedulers.push(startDeadlineChecker(), startReportScheduler(), startNotificationScheduler(), startAttachmentCleanupScheduler());
} catch (err) {
  app.log.error(err);
  process.exitCode = 1;
  await app.close();
}
