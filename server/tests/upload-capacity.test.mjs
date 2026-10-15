import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createUploadCapacity, readUploadLimits, uploadLockNamespace } from "../src/upload-capacity.ts";
import { MAX_FILE_SIZE } from "../src/upload-receiver.ts";
const root='/private/test-upload-root',floor=256n*1024n*1024n;
function fixture({locked=true,active=1,free=1024n*1024n*1024n,query,limits={maxConcurrent:2,minFreeBytes:floor,timeoutMs:1000}}={}) {
  const calls=[],client=new EventEmitter();
  client.query=async config=>{calls.push(config);const custom=await query?.(config,client);if(custom)return custom;
    return {rows:[config.text.includes('try_advisory')?{locked}:config.text.includes('pg_locks')?{active}:{unlocked:true}]};};
  client.release=discard=>calls.push({release:discard});
  const gate=createUploadCapacity({database:{connect:async()=>client},limits,prepare:async()=>root,available:async()=>free});
  return {client,calls,gate};
}
test("upload resource config has bounded integer defaults and rejects malformed overrides without echoing values",()=>{
  assert.deepEqual(readUploadLimits({}),{maxConcurrent:2,minFreeBytes:floor,timeoutMs:120000});
  for(const env of [{UPLOAD_MAX_CONCURRENT:'0'},{UPLOAD_MAX_CONCURRENT:'9'},{UPLOAD_MAX_CONCURRENT:'2.5'},
    {UPLOAD_MAX_CONCURRENT:'SECRET'},{UPLOAD_MIN_FREE_BYTES:'-1'},{UPLOAD_MIN_FREE_BYTES:'1e9'},
    {UPLOAD_MIN_FREE_BYTES:'9007199254740992'},{UPLOAD_TIMEOUT_MS:'999'},{UPLOAD_TIMEOUT_MS:'600001'}])assert.throws(()=>readUploadLimits(env),{message:'invalid_upload_capacity_config'});
  assert.equal(readUploadLimits({UPLOAD_MIN_FREE_BYTES:'0',UPLOAD_MAX_CONCURRENT:'8'}).minFreeBytes,0n);
});
test("lock namespace is stable for the canonical root and separate from background jobs",()=>{
  const namespace=uploadLockNamespace(root);assert.equal(uploadLockNamespace(root),namespace);
  assert.notEqual(uploadLockNamespace('/other'),namespace);assert.ok(namespace>=0x50000000&&namespace<=0x5fffffff);assert.notEqual(namespace,0x4c4d53);
});
test("admission reserves a full maximum file per occupied slot, including simultaneous reservations",async()=>{
  const f=fixture({active:2,free:floor+BigInt(MAX_FILE_SIZE)*2n-1n});
  await assert.rejects(f.gate.run(()=>assert.fail('write started')),{code:'storage_full',statusCode:507});
  assert.ok(f.calls.some(c=>c.text?.includes('pg_advisory_unlock')));assert.equal(f.calls.at(-1).release,false);await f.gate.stop();
});
test("capacity slot survives body processing/cleanup and is released after success or rejection",async()=>{
  for(const fail of [false,true]){const f=fixture();let handled=false;
    const work=f.gate.run(async control=>{await control.beforeWrite(1024);assert.ok(!f.calls.some(c=>c.text?.includes('pg_advisory_unlock')));handled=true;
      if(fail)throw new Error('body failed');return 7;});
    if(fail)await assert.rejects(work,/body failed/);else assert.equal(await work,7);
    assert.equal(handled,true);assert.equal(f.calls.at(-1).release,false);assert.ok(f.calls.some(c=>c.text?.includes('pg_advisory_unlock')));await f.gate.stop();
  }
});
test("busy slots reject without reading the body or releasing another client's lock",async()=>{
  const f=fixture({locked:false});await assert.rejects(f.gate.run(()=>assert.fail('body started')),{code:'upload_busy',statusCode:429});
  assert.equal(f.calls.filter(c=>c.text?.includes('try_advisory')).length,2);assert.ok(!f.calls.some(c=>c.text?.includes('pg_advisory_unlock')));await f.gate.stop();
});
test("a lost acquisition acknowledgement destroys the session rather than retaining an unknown lock",async()=>{
  const f=fixture({query:async config=>{if(config.text.includes('try_advisory'))throw new Error('SECRET PG password');}});
  await assert.rejects(f.gate.run(()=>assert.fail('body started')),error=>error.code==='upload_unavailable'&&!error.message.includes('SECRET'));
  assert.equal(f.calls.at(-1).release,true);await f.gate.stop();
});
test("unlock failure destroys the session after a completed upload without changing committed success",async()=>{
  const f=fixture({query:async config=>{if(config.text.includes('pg_advisory_unlock'))throw new Error('unlock lost');}});
  assert.equal(await f.gate.run(async()=>7),7);assert.equal(f.calls.at(-1).release,true);await f.gate.stop();
});
test("storage measurement failure fails closed, while OS ENOSPC/EDQUOT get fixed disk-full errors",async()=>{
  for(const code of ['EACCES','ENOSPC','EDQUOT']){const f=fixture();const gate=createUploadCapacity({database:{connect:async()=>f.client},limits:readUploadLimits({}),prepare:async()=>root,
    available:async()=>{throw Object.assign(new Error('SECRET /path'),{code});}});
    await assert.rejects(gate.run(()=>assert.fail('body started')),{code:code==='EACCES'?'upload_unavailable':'storage_full'});assert.equal(f.calls.at(-1).release,false);await gate.stop();}
});
test("connection loss aborts cooperative streaming and discards its capacity connection",async()=>{
  const f=fixture();await assert.rejects(f.gate.run(async control=>{f.client.emit('error',new Error('SECRET database URL'));assert.equal(control.signal.aborted,true);control.assertActive();}),{code:'upload_unavailable'});
  assert.equal(f.calls.at(-1).release,true);await f.gate.stop();
});
test("timeout bounds a slow upload, releases the permit only after work ends, and allows another request",async()=>{
  const f=fixture({limits:{maxConcurrent:2,minFreeBytes:floor,timeoutMs:20}});
  // Keep the unit test alive; production deadline timers deliberately unref.
  const alive=setTimeout(()=>{},1000);
  try{await assert.rejects(f.gate.run(async control=>{await new Promise(r=>control.signal.addEventListener('abort',r,{once:true}));control.assertActive();}),{code:'upload_timeout',statusCode:408});
    assert.equal(f.calls.at(-1).release,false);assert.equal(await f.gate.run(async()=>7),7);
  }finally{clearTimeout(alive);await f.gate.stop();}
});
test("shutdown refuses new admissions and aborts/drains active uploads before returning",async()=>{
  const f=fixture();let entered;const ready=new Promise(r=>{entered=r;});
  const work=f.gate.run(async control=>{entered();await new Promise(r=>control.signal.addEventListener('abort',r,{once:true}));control.assertActive();});
  await ready;const rejected=assert.rejects(work,{code:'upload_unavailable'});await f.gate.stop();await rejected;
  await assert.rejects(f.gate.run(()=>assert.fail('body started')),{code:'upload_unavailable'});assert.equal(f.calls.at(-1).release,false);
});
