import type { FastifyInstance } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CONFIG_ERROR = "APP_ORIGIN must be a single HTTP(S) origin; production requires an explicit HTTPS origin";

export function configuredOrigin(
  value = process.env.APP_ORIGIN,
  production = process.env.NODE_ENV === "production"
): string {
  if (!value) {
    if (production) throw new Error(CONFIG_ERROR);
    return "http://localhost:5173";
  }
  // Configuration is explicit; never derive trust from request Host/proxy headers.
  if (!/^https?:\/\/[^\s/?#@]+\/?$/.test(value)) throw new Error(CONFIG_ERROR);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(CONFIG_ERROR); }
  if (url.username || url.password || url.hostname.includes("*") ||
      (production && url.protocol !== "https:")) throw new Error(CONFIG_ERROR);
  return url.origin;
}

export function installCsrfProtection(app: FastifyInstance, origin = configuredOrigin()) {
  // Normalize/validate explicit overrides too; freeze the target at startup.
  const expectedOrigin = configuredOrigin(origin);
  app.addHook("onRequest", async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    // Browser Origin is a single serialized origin. Missing, null, multiple,
    // malformed and foreign values fail closed, including unauthenticated login.
    if (typeof req.headers.origin !== "string" || req.headers.origin !== expectedOrigin) {
      return reply.code(403).send({ error: "csrf_forbidden" });
    }
  });
}
