import assert from "node:assert/strict";
import Fastify from "fastify";
import { test } from "node:test";
import { authClientIp } from "../src/auth/client-ip.ts";

async function address(remoteAddress, forwarded, options = {}) {
  const app = Fastify(options);
  try {
    app.get("/ip", request => ({ ip: authClientIp(request) }));
    const response = await app.inject({ url: "/ip", remoteAddress,
      headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded } });
    assert.equal(response.statusCode, 200);
    return response.json().ip;
  } finally { await app.close(); }
}

test("a direct client's forwarded headers cannot change the rate-limit IP", async () => {
  assert.equal(await address("198.51.100.8", "203.0.113.99"), "198.51.100.8");
  assert.equal(await address("198.51.100.8", "203.0.113.99", { trustProxy: true }), "198.51.100.8");
});

test("local Nginx's final forwarded address wins over a client-supplied prefix", async () => {
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(await address(peer, "203.0.113.99, 198.51.100.8"), "198.51.100.8");
  }
});

test("malformed or oversized forwarded addresses fall back to the local peer", async () => {
  for (const header of ["not-an-ip", "198.51.100.8, invalid", "198.51.100.8,", "fe80::1%eth0", " ".repeat(1025)]) {
    assert.equal(await address("127.0.0.1", header), "127.0.0.1");
  }
});

test("IPv6 aliases and mapped IPv4 use the same canonical address", async () => {
  assert.equal(await address("2001:0DB8:0000:0000:0000:0000:0000:0008"), "2001:db8::8");
  assert.equal(await address("2001:db8::8"), "2001:db8::8");
  assert.equal(await address("::ffff:198.51.100.8"), "198.51.100.8");
  assert.equal(await address("127.0.0.1", "::ffff:198.51.100.8"), "198.51.100.8");
});
