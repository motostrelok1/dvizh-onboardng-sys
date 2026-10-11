import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

function normalizeAddress(address: string): string | null {
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return null;
  // WHATWG URL canonicalizes IPv6 case/compression and IPv4-mapped addresses.
  let canonical: string;
  try { canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1); }
  catch { return null; } // Scoped IPv6 addresses are not valid HTTP forwarded IPs.
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return canonical;
}

export function authClientIp(request: FastifyRequest): string {
  const peer = normalizeAddress(request.raw.socket.remoteAddress ?? "") ?? "unknown";
  // Deployment uses one local Nginx, which appends its actual remote client to
  // X-Forwarded-For. Trust only that final address from an exact loopback peer.
  // Do not enable broad trustProxy or use request.ip supplied by another plugin.
  if (peer !== "127.0.0.1" && peer !== "::1") return peer;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || forwarded.length > 1024) return peer;
  return normalizeAddress(forwarded.split(",").at(-1)!.trim()) ?? peer;
}
