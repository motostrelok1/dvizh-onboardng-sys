import type { FastifyInstance, FastifyRequest, FastifyLogFn, FastifyBaseLogger } from "fastify";

// Query strings and legacy invitation paths are never diagnostic data.
export function safeLogUrl(url: unknown): string {
  if (typeof url !== "string") return "[REDACTED]";
  return url.split(/[?#]/, 1)[0]
    .replace(/(\/(?:api\/)?auth\/invitations\/)(?!check(?:\/|$)|accept(?:\/|$))[^/\s]+/gi, "$1[REDACTED]")
    .replace(/(\/invite\/)[^/\s]+/gi, "$1[REDACTED]");
}

export const privateLogger = {
  serializers: {
    req: (req: FastifyRequest) => ({ method: req.method, url: req.routeOptions?.url ?? "[unmatched]" }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    // Error messages/stacks/custom properties can contain SQL parameters,
    // credentials or parser excerpts. Retain only a fixed error category.
    err: () => ({ type: "Error", message: "[REDACTED]", stack: "[REDACTED]" })
  },
  redact: {
    paths: ["body", "headers", "cookies", "password", "passwordHash", "password_hash", "token", "token_hash",
      "authorization", "cookie", "set-cookie", "req.body", "req.headers", "req.cookies",
      "res.headers", "*.password", "*.token", "*.cookie", "*.authorization"],
    remove: true
  },
  hooks: {
    logMethod(this: FastifyBaseLogger, args: Parameters<FastifyLogFn>, method: FastifyLogFn) {
      const first = args[0];
      // Pino otherwise copies err.message to msg BEFORE running serializers.
      if (first instanceof Error) {
        method.call(this, { err: first }, "operation_failed");
      } else if (first && typeof first === "object" && "err" in first) {
        method.call(this, { ...first, msg: "operation_failed" }, "operation_failed");
      } else {
        // Fastify's default 404 message includes the raw requested URL.
        method.apply(this, args.map(value => typeof value === "string"
          ? value.startsWith("Route ") ? "route_not_found" : safeLogUrl(value) : value) as typeof args);
      }
    }
  }
};

export function installPrivacyHeaders(app: FastifyInstance) {
  // Root hooks apply to all registered routes, including parser/auth failures,
  // downloads and unknown routes. onSend overrides any route cache policy.
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    return payload;
  });
}
