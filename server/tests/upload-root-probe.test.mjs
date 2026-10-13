import assert from "node:assert/strict";
import {mkdtemp,mkdir,symlink,lstat,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {after,test} from "node:test";
const scratch=await mkdtemp(join(tmpdir(),'lms-root-probe-')),physical=join(scratch,'physical'),alias=join(scratch,'alias');
await mkdir(physical);await symlink(physical,alias);
process.env.UPLOAD_DIR=join(alias,'new','uploads');
const {UPLOAD_DIR,inspectUploadRoot,ensureUploadRoot,StoragePathError}=await import('../src/storage.ts');
const {availableUploadBytes,uploadLockNamespace}=await import('../src/upload-capacity.ts');
after(()=>rm(scratch,{recursive:true,force:true}));
test("readonly capacity probe uses the existing parent without creating directories, preserving canonical slots after mkdir",async()=>{
  const before=await inspectUploadRoot();assert.equal(before.probe,physical);assert.equal(before.root,join(physical,'new','uploads'));
  assert.equal(typeof await availableUploadBytes(before.root),'bigint');await assert.rejects(lstat(UPLOAD_DIR),{code:'ENOENT'});
  const root=await ensureUploadRoot();assert.equal(root,before.root);const after=await inspectUploadRoot();assert.equal(after.probe,root);
  assert.equal(uploadLockNamespace(before.root),uploadLockNamespace(after.root));
});
test("an existing root symlink or regular-file root is refused by the capacity probe",async()=>{
  await rm(UPLOAD_DIR,{recursive:true});await symlink(physical,UPLOAD_DIR);await assert.rejects(inspectUploadRoot(),StoragePathError);
  await rm(UPLOAD_DIR);await writeFile(UPLOAD_DIR,"not a directory");await assert.rejects(inspectUploadRoot(),StoragePathError);
});
