'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const source=path.resolve(__dirname,'../research/autonomous-root/service/policy.js'),localRequire=createRequire(source);
function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'journal-sync-timing-')),file=path.join(dir,'requests.json');
 let now=0,fail=0;const calls=[];
 const fakeFs=Object.create(fs);fakeFs.fsyncSync=fd=>{
  const kind=fs.fstatSync(fd).isDirectory()?'directory':'file';calls.push(kind);now+=kind==='file'?7:11;
  if(calls.length===fail)throw Error('injected sync failure');return fs.fsyncSync(fd);
 };
 const context={module:{exports:{}},Buffer,process:{hrtime:start=>{
  const value=[Math.floor(now/1000),(now%1000)*1e6];if(!start)return value;
  const ns=(value[0]-start[0])*1e9+value[1]-start[1];return [Math.floor(ns/1e9),ns%1e9];
 }},require:name=>name==='fs'?fakeFs:localRequire(name)};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),context,{filename:source});
 const {Journal,hash}=context.module.exports;
 const request=n=>({id:'sync-timing-fixture-'+n,command:'true',timeout_ms:1000});
 try{run({Journal,hash,request,file,calls,failAt:n=>{fail=n;}});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const plain=v=>JSON.parse(JSON.stringify(v));
test('sync metrics keep exact file/directory barriers and the unchanged JSON format',()=>fixture(f=>{
 const journal=new f.Journal(f.file),begin={},finish={};journal.begin(f.request(1),begin);journal.finish(f.request(1).id,{exit_code:7,timed_out:false},finish);
 for(const metrics of [begin,finish])assert.deepEqual(plain(metrics),{file_sync:{ms:7,calls:1},directory_sync:{ms:11,calls:1}});
 assert.deepEqual(f.calls,['file','directory','file','directory']);
 const rows=JSON.parse(fs.readFileSync(f.file));assert.equal(rows[0].state,'completed');assert.equal(rows[0].exit_code,7);assert.equal(rows[0].file_sync,undefined);
 const restarted=new f.Journal(f.file);assert.throws(()=>restarted.begin(f.request(1),{}),/already submitted/);
 // The optional collector does not change ordinary callers or their barriers.
 journal.begin(f.request(2));assert.deepEqual(f.calls.slice(-2),['file','directory']);
}));
test('automatic archive aggregates all syncs including archive-parent durability',()=>fixture(f=>{
 const rows=Array.from({length:1000},(_,i)=>({id:f.request(i).id,sha256:f.hash('true'),state:'completed',at:i,exit_code:0,timed_out:false}));
 fs.writeFileSync(f.file,JSON.stringify(rows));const journal=new f.Journal(f.file),timing={};journal.begin(f.request(1000),timing);
 assert.deepEqual(plain(timing),{file_sync:{ms:21,calls:3},directory_sync:{ms:44,calls:4}});
 assert.deepEqual(f.calls,['file','directory','directory','file','directory','file','directory']);
 assert.equal(journal.rows.length,101);assert.equal(fs.readdirSync(f.file+'.archives').length,1);
 const restarted=new f.Journal(f.file);assert.throws(()=>restarted.begin(f.request(0),{}),/already submitted/);
}));
test('failed syncs are measured once, poison the writer and never advance in-memory state',()=>{
 for(const barrier of [1,2])fixture(f=>{
  const journal=new f.Journal(f.file),timing={};f.failAt(barrier);
  assert.throws(()=>journal.begin(f.request(1),timing),/sync failure/);assert.equal(journal.failed,true);assert.equal(journal.rows.length,0);
  assert.deepEqual(plain(timing),barrier===1?{file_sync:{ms:7,calls:1}}:{file_sync:{ms:7,calls:1},directory_sync:{ms:11,calls:1}});
  assert.throws(()=>journal.begin(f.request(2),{}),/storage failed/);assert.equal(f.calls.length,barrier);
  if(barrier===2){const restarted=new f.Journal(f.file);assert.equal(restarted.rows[0].state,'submitted');assert.throws(()=>restarted.begin(f.request(1)),/already submitted/);}
 });
});
test('failed completion keeps replay protection and records only attempted syncs',()=>{
 for(const barrier of [3,4])fixture(f=>{
  const journal=new f.Journal(f.file);journal.begin(f.request(1));f.failAt(barrier);const timing={};
  assert.throws(()=>journal.finish(f.request(1).id,{exit_code:0,timed_out:false},timing),/sync failure/);
  assert.equal(journal.rows[0].state,'submitted');assert.equal(journal.failed,true);
  assert.equal(timing.file_sync.calls,1);assert.equal(timing.directory_sync?.calls,barrier===4?1:undefined);
  assert.equal(f.calls.length,barrier);const restarted=new f.Journal(f.file);assert.throws(()=>restarted.begin(f.request(1)),/already submitted/);
 });
});
