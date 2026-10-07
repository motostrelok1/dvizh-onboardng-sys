import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/middleware.js";
import {
  getGeneralSettings,
  getEffectiveSettings,
  setGeneralSetting,
  resetGeneralSettings,
  setCourseOverride,
  resetCourseOverrides,
  getSettingsLog,
  isCourseOverridable
} from "../analytics/settings.js";
import { getProblemQuestions } from "../analytics/rules.js";
import { pool } from "../db.js";

export async function adminAnalyticsSettingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/settings/analytics", async () => {
    return { settings: await getGeneralSettings() };
  });

  app.put<{ Body: Record<string, unknown> }>("/admin/settings/analytics", async (req) => {
    for (const [key, value] of Object.entries(req.body)) {
      await setGeneralSetting(key, value, req.currentUser!.id);
    }
    return { settings: await getGeneralSettings() };
  });

  app.post("/admin/settings/analytics/reset", async (req) => {
    await resetGeneralSettings(req.currentUser!.id);
    return { settings: await getGeneralSettings() };
  });

  app.get<{ Params: { id: string } }>("/admin/courses/:id/analytics-settings", async (req) => {
    const overridesRes = await pool.query(
      `select key, value from analytics_overrides where course_id = $1`,
      [req.params.id]
    );
    return {
      effective: await getEffectiveSettings(req.params.id),
      overrides: Object.fromEntries(overridesRes.rows.map((r) => [r.key, r.value]))
    };
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/admin/courses/:id/analytics-settings",
    async (req, reply) => {
      for (const key of Object.keys(req.body)) {
        if (!isCourseOverridable(key)) {
          reply.code(400);
          return { error: "key_not_course_overridable", key };
        }
      }
      for (const [key, value] of Object.entries(req.body)) {
        await setCourseOverride(req.params.id, key, value, req.currentUser!.id);
      }
      return { effective: await getEffectiveSettings(req.params.id) };
    }
  );

  app.post<{ Params: { id: string } }>("/admin/courses/:id/analytics-settings/reset", async (req) => {
    await resetCourseOverrides(req.params.id, req.currentUser!.id);
    return { effective: await getEffectiveSettings(req.params.id) };
  });

  app.get("/admin/settings/log", async () => {
    return { log: await getSettingsLog() };
  });

  app.get("/admin/analytics/problem-questions", async () => {
    return { questions: await getProblemQuestions() };
  });
}
