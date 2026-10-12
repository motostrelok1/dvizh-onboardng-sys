import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("real pagehide uses JSON Blob and retains IDs even when the browser accepts the beacon", async context => {
  const names = ["window", "localStorage", "navigator", "setInterval", "fetch"];
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => { for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } });
  const listeners = new Map(), storage = new Map(), calls = [];let accepted=false;
  const replacements = {
    window: { addEventListener: (name, callback) => listeners.set(name, callback) },
    localStorage: { get length(){return storage.size;},key:n=>[...storage.keys()][n]??null,
      getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key) },
    navigator: { sendBeacon: (url,body)=>{calls.push({url,body});return accepted;} },
    setInterval:()=>0,fetch:async()=>new Response('{}',{status:500})
  };
  for(const [name,value] of Object.entries(replacements)) Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  const {setEventOwner,enqueueEvent,flush}=await import("../../client/src/events.ts");
  const owner=randomUUID();setEventOwner(owner);enqueueEvent({eventType:"lesson_view_start",entityId:randomUUID()});await flush();
  const before=[...storage.entries()];listeners.get('pagehide')();assert.deepEqual([...storage.entries()],before);
  accepted=true;listeners.get('pagehide')();assert.deepEqual([...storage.entries()],before);
  for(const {url,body} of calls){assert.equal(url,'/api/events');assert.ok(body instanceof Blob);assert.equal(body.type,'application/json');
    const data=JSON.parse(await body.text());assert.equal(data.ownerId,owner);assert.equal(data.events.length,1);assert.match(data.events[0].eventId,/^[0-9a-f-]{36}$/);}
});
