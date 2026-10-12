import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { installPrivacyHeaders, privateLogger } from "../src/privacy.ts";
import { installCsrfProtection } from "../src/csrf.ts";
import { installApiErrors } from "../src/api-validation.ts";
await import("./test-database.mjs");
// No outbound delivery: these tests exercise actual subscription/notification API and SQL.
process.env.VAPID_PUBLIC_KEY = ''; process.env.VAPID_PRIVATE_KEY = '';
const { pool } = await import("../src/db.ts");
const { createSession } = await import("../src/auth/service.ts");
const { SESSION_COOKIE } = await import("../src/auth/constants.ts");
const { notificationRoutes, publicPushRoutes } = await import("../src/routes/notifications.ts");
const origin = "https://lms.example.test", logs = [];
const app = Fastify({ logger: { ...privateLogger, stream: { write: line => logs.push(String(line)) } } });
installApiErrors(app); installPrivacyHeaders(app); installCsrfProtection(app, origin);
let user, other, id, otherId, cookies, otherCookies, endpoint, otherEndpoint;
before(async () => { await app.register(cookie); await app.register(publicPushRoutes); await app.register(notificationRoutes); await app.ready(); });
beforeEach(async () => {
  [user, other, id, otherId] = Array.from({ length: 4 }, () => randomUUID());
  endpoint = `https://example.invalid/push/${user}`; otherEndpoint = `https://example.invalid/push/${other}`;
  await pool.query("insert into users(id,full_name,role) values ($1,'CI notification owner','employee'),($2,'CI notification other','employee')", [user, other]);
  await pool.query(`insert into notifications(id,user_id,kind,channel,title,body) values
    ($1,$2,'overdue','in_app','CI Own','CI Body'),($3,$4,'overdue','in_app','SECRET_OTHER_TITLE','SECRET_OTHER_BODY')`, [id,user,otherId,other]);
  cookies = { [SESSION_COOKIE]: (await createSession(user)).token };
  otherCookies = { [SESSION_COOKIE]: (await createSession(other)).token }; logs.length = 0;
});
afterEach(async () => { await pool.query("delete from users where id=any($1::uuid[])", [[user,other]]); });
after(async () => { try { await app.close(); } finally { await pool.end(); } });
function request(method, url, payload, session = cookies, source = origin) {
  return app.inject({ method, url, payload, cookies: session, headers: source ? { origin: source } : {} });
}
const keys = { p256dh: 'fixture-p256dh', auth: 'fixture-auth' };
const subscribe = (url = endpoint, k = keys, session = cookies) => request('POST','/me/push-subscription',{ endpoint: url, keys: k }, session);
async function note(noteId) { return (await pool.query("select read_at from notifications where id=$1", [noteId])).rows[0]; }
async function subscriptions() { return (await pool.query("select user_id,endpoint,keys from push_subscriptions where user_id=any($1::uuid[]) order by endpoint", [[user,other]])).rows; }
function error(result, status, code) { assert.equal(result.statusCode,status,result.body); assert.deepEqual(result.json(),{ error: code }); }

test("public VAPID config remains anonymous while every personal notification/subscription route requires a session", async () => {
  const config = await request('GET','/push/vapid-public-key',undefined,{});
  assert.equal(config.statusCode,200); assert.deepEqual(config.json(), { publicKey: '', configured: false });
  assert.equal(config.headers['cache-control'],'no-store');
  for (const [method,url,payload] of [['GET','/me/notifications'],['POST',`/me/notifications/${id}/read`],
    ['POST','/me/push-subscription',{endpoint,keys}],['DELETE','/me/push-subscription',{endpoint}]]) {
    error(await request(method,url,payload,{}),401,'not_authenticated');
  }
  assert.equal((await note(id)).read_at,null); assert.deepEqual(await subscriptions(),[]);
});

test("notification list returns only this user's latest 50 while unreadCount includes older unread items", async () => {
  await pool.query("delete from notifications where user_id=$1", [user]);
  for (let n=0;n<55;n++) await pool.query(`insert into notifications(user_id,kind,channel,title,sent_at,read_at)
    values ($1,'overdue','in_app',$2,$3,$4)`, [user,`CI Own ${n}`,new Date(Date.UTC(2020,0,1,0,n)),n>=53?new Date('2020-02-01T00:00:00Z'):null]);
  const result = await request('GET','/me/notifications'); assert.equal(result.statusCode,200,result.body);
  const body = result.json(); assert.equal(body.notifications.length,50); assert.equal(body.unreadCount,53);
  assert.equal(body.notifications[0].title,'CI Own 54'); assert.equal(body.notifications.at(-1).title,'CI Own 5');
  assert.doesNotMatch(result.body,/SECRET_OTHER|user_id|assignment_id|endpoint|p256dh/);
  assert.equal(result.headers['cache-control'],'no-store'); assert.equal(result.headers['referrer-policy'],'no-referrer');
});

test("mark-read is scoped to the owner and repeated requests keep the original timestamp", async () => {
  assert.equal((await request('POST',`/me/notifications/${id}/read`)).statusCode,200);
  const first = await note(id); assert.ok(first.read_at);
  await request('POST',`/me/notifications/${id}/read`); assert.deepEqual(await note(id),first);
  assert.equal((await request('POST',`/me/notifications/${otherId}/read`)).statusCode,200);
  assert.equal((await note(otherId)).read_at,null);
  assert.equal((await request('GET','/me/notifications')).json().unreadCount,0);
  assert.equal((await request('GET','/me/notifications',undefined,otherCookies)).json().unreadCount,1);
});

test("subscription upsert updates one owned endpoint and deletion cannot remove another user's endpoint", async () => {
  assert.equal((await subscribe()).statusCode,200);
  const changed = { p256dh:'replacement-key',auth:'replacement-auth' };
  assert.equal((await subscribe(endpoint,changed)).statusCode,200);
  assert.equal((await subscribe(otherEndpoint,keys,otherCookies)).statusCode,200);
  const all = await subscriptions(); assert.equal(all.length,2);
  assert.deepEqual(all.find(s=>s.endpoint===endpoint),{user_id:user,endpoint,keys:changed});
  assert.equal((await request('DELETE','/me/push-subscription',{endpoint:otherEndpoint})).statusCode,200);
  assert.equal((await subscriptions()).length,2);
  await request('DELETE','/me/push-subscription',{endpoint});
  assert.deepEqual(await subscriptions(),[{user_id:other,endpoint:otherEndpoint,keys}]);
});

test("missing subscription fields are rejected without creating a row", async () => {
  for (const payload of [{},{endpoint},{keys}]) error(await request('POST','/me/push-subscription',payload),400,'endpoint_and_keys_required');
  assert.deepEqual(await subscriptions(),[]);
});

test("inactive and expired sessions cannot read or mutate notifications/subscriptions", async () => {
  for (const mode of ['inactive','expired']) {
    if (mode==='inactive') await pool.query("update users set is_active=false where id=$1",[user]);
    else { await pool.query("update users set is_active=true where id=$1",[user]); await pool.query("update sessions set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",[user]); }
    for (const [method,url,payload] of [['GET','/me/notifications'],['POST',`/me/notifications/${id}/read`],['POST','/me/push-subscription',{endpoint,keys}]]) {
      error(await request(method,url,payload),401,'not_authenticated');
    }
  }
  assert.equal((await note(id)).read_at,null); assert.deepEqual(await subscriptions(),[]);
});

test("foreign/missing Origin cannot mark a notification read or change push subscriptions", async () => {
  for (const source of [null,'https://foreign.example.test']) {
    error(await request('POST',`/me/notifications/${id}/read`,undefined,cookies,source),403,'csrf_forbidden');
    error(await request('POST','/me/push-subscription',{endpoint,keys},cookies,source),403,'csrf_forbidden');
  }
  assert.equal((await note(id)).read_at,null); assert.deepEqual(await subscriptions(),[]);
});

test("notification SQL failure returns a private fixed response without logging driver details", async () => {
  const query = pool.query;
  pool.query = function (...args) {
    if (String(args[0]).includes('from notifications') && args[1]?.[0]===user) return Promise.reject(new Error('SECRET SQL /private credentials'));
    return query.apply(this,args);
  };
  let result; try { result=await request('GET','/me/notifications'); } finally { pool.query=query; }
  error(result,500,'internal_error'); assert.equal(result.headers['cache-control'],'no-store');
  assert.doesNotMatch(result.body+logs.join(''),/SECRET SQL|private credentials/);
});
