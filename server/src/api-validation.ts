import type { FastifyInstance, FastifySchema } from "fastify";
import { Ajv, type AnySchema } from "ajv";
import addFormats from "ajv-formats";

export const uuid = { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" };
export const boolean = { type: "boolean" };
export const nullableUuid = { ...uuid, nullable: true };
export const email = { type: "string", minLength: 1, maxLength: 254, format: "email" };
export const timezone = { type: "string", minLength: 1, maxLength: 100, format: "iana-timezone" };
export const token = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" };
export function text(maxLength: number) {
  return { type: "string", minLength: 1, maxLength, pattern: "\\S", not: { pattern: "\\u0000" } };
}
export function object(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", additionalProperties: false, properties, required };
}
export function idParams(name = "id") { return object({ [name]: uuid }, [name]); }
export const noQuery = object({});

// JSON response allow-lists also exclude future columns from SELECT */RETURNING *.
export const okDto = object({ ok: boolean }, ["ok"]);
export const publicUserDto = object({ id: uuid, fullName: { type: "string" },
  email: { type: ["string", "null"] }, role: { type: "string" }, timezone: { type: "string" } });
export const adminUserDto = object({ id: uuid, full_name: { type: "string" },
  email: { type: ["string", "null"] }, role: { type: "string" }, department_id: nullableUuid,
  department_name: { type: ["string", "null"] }, timezone: { type: "string" }, is_active: boolean,
  created_at: { type: "string" } });
export const testDto = object({ id: uuid, scope: { type: "string" }, parent_id: uuid,
  max_attempts: { type: ["integer", "null"] }, show_correct_answers: boolean, pass_score: { type: "integer" } });
export const answerDto = object({ id: uuid, question_id: uuid, text: { type: "string" }, is_correct: boolean });
export const questionDto = object({ id: uuid, test_id: uuid, text: { type: "string" },
  position: { type: "integer" }, multiple: boolean, answers: { type: "array", items: answerDto } });
export const attachmentDto = object({ id: uuid, lesson_id: uuid, file_name: { type: "string" },
  size_bytes: { type: ["string", "integer", "null"] }, position: { type: "integer" } });
export function success(properties: Record<string, unknown>) { return { "2xx": object(properties) }; }

export function installApiErrors(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      const custom = req.routeOptions.config.validationError;
      return reply.code(400).send({ error: custom === "invalid_lesson_id" && err.validationContext === "params"
        ? custom : "invalid_request" });
    }
    // Never copy err.message/detail/stack, SQL or driver paths into the response.
    // Application domain errors sent by handlers keep their existing contracts.
    const sqlErrors: Record<string, [number, string]> = {
      "23505": [409, "conflict"], "23503": [409, "invalid_reference"],
      "22P02": [400, "invalid_request"], "22001": [400, "invalid_request"],
      "22007": [400, "invalid_request"], "22008": [400, "invalid_request"],
      "23514": [400, "invalid_request"]
    };
    const sql = Object.hasOwn(sqlErrors, err.code) ? sqlErrors[err.code] : undefined;
    if (sql) return reply.code(sql[0]).send({ error: sql[1] });
    if (err.code === "unsafe_storage_path") return reply.code(400).send({ error: "unsafe_storage_path" });
    const status = err.statusCode;
    const clientErrors: Record<number, string> = { 400: "invalid_request", 401: "not_authenticated",
      403: "forbidden", 404: "not_found", 406: "unsupported_media_type", 409: "conflict", 413: "payload_too_large",
      415: "unsupported_media_type", 429: "rate_limited" };
    if (status && Number.isInteger(status) && Object.hasOwn(clientErrors, status)) {
      return reply.code(status).send({ error: clientErrors[status] });
    }
    req.log.error({ event: "api_error", category: "internal" }, "operation_failed");
    return reply.code(500).send({ error: "internal_error" });
  });
}

export function installApiValidation(app: FastifyInstance) {
  const ajv = new Ajv({ coerceTypes: false, removeAdditional: false,
    useDefaults: false, allErrors: false, strict: true });
  addFormats.default(ajv, ["email"]);
  ajv.addFormat("iana-timezone", (value: string) => {
    if (!/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(value)) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
    catch { return false; }
  });
  app.setValidatorCompiler(({ schema }) => ajv.compile(schema as AnySchema));
  installApiErrors(app);
}

export function schema(body?: unknown, params?: unknown, response?: unknown): FastifySchema {
  return { ...(body ? { body } : {}), ...(params ? { params } : {}),
    querystring: noQuery, ...(response ? { response } : {}) };
}

declare module "fastify" {
  interface FastifyContextConfig { validationError?: string }
}
