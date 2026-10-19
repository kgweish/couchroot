const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {inspectObserverUnit,retireObserverUnit}=require('../research/autonomous-root/service/observer-unit');
const unit='couchroot-observer-'+'a'.repeat(32)+'.service',bootId='00000000-0000-0000-0000-000000000001';
const text=()=>`Id=${unit}\nLoadState=loaded\nActiveState=active\nSubState=exited\nMainPID=0\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`;
const response=stdout=>({exit_code:0,timed_out:false,stdout,stderr:''});
test('unit inspection binds exact identity and parses bounded counters',async()=>{
 const result=await inspectObserverUnit({unit,bootId,sha256:'b'.repeat(64),execute:async(command,timeout)=>{
  assert.equal(timeout,5000);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);return response(text());
 }});
 assert.equal(result.unit,unit);assert.equal(result.boot_id,bootId);assert.equal(result.sub_state,'exited');assert.equal(result.started_monotonic,'123');
 for(const stdout of [text()+'MainPID=0\n',text().replace(unit,'other'),text().replace('LoadState=loaded','LoadState=not-found'),text().replace('MainPID=0','MainPID=999999999999999999'),text().replace('ExecMainCode=1','ExecMainCode=-1')])await assert.rejects(inspectObserverUnit({unit,bootId,sha256:'b'.repeat(64),execute:async()=>response(stdout)}));
 await assert.rejects(inspectObserverUnit({unit:unit+'\n',bootId,execute:()=>{throw Error('must not submit');}}),/Invalid/);
});
test('unit retirement requires fresh successful completion then verified stop',async()=>{
 let calls=0;
 const result=await retireObserverUnit({unit,bootId,sha256:'b'.repeat(64),execute:async command=>{
  calls++;assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);
  if(calls===1)return response(text());assert.match(command,/systemctl stop --no-block/);assert.ok(command.indexOf('ActiveState=inactive')<command.indexOf('rm /opt/'));assert.match(command,/0:1:500/);assert.match(command,/sha256sum/);assert.match(command,/rmdir/);return response('OBSERVER-UNIT-RETIRED\n');
 }});
 assert.deepEqual(result,{unit,boot_id:bootId,retired:true});assert.equal(calls,2);
});
test('running units and lost stop responses are never treated as retired or retried',async()=>{
 let calls=0;
 await assert.rejects(retireObserverUnit({unit,bootId,sha256:'b'.repeat(64),execute:async()=>{calls++;return response(text().replace('SubState=exited','SubState=running'));}}),/termination/);assert.equal(calls,1);
 calls=0;await assert.rejects(retireObserverUnit({unit,bootId,sha256:'b'.repeat(64),execute:async()=>{calls++;if(calls===1)return response(text());throw Error('lost response');}}),/lost response/);assert.equal(calls,2);
});

test('retirement refuses missing digest before touching a unit',async()=>{
 let calls=0;await assert.rejects(retireObserverUnit({unit,bootId,execute:async()=>{calls++;}}),/artifact digest/);assert.equal(calls,0);
});
test('retirement shell checks a single complete stopped-unit snapshot',async()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cr-retire-state-'));
 try{
  fs.writeFileSync(path.join(dir,'boot'),bootId+'\n');
  fs.writeFileSync(path.join(dir,'systemctl'),'#!/bin/sh\nif test "$1" = stop; then exit 0; fi\ncat "'+dir+'/snapshot"\n',{mode:0o700});
  let command,calls=0;
  await retireObserverUnit({unit,bootId,sha256:'b'.repeat(64),execute:async c=>{if(++calls===1)return response(text());command=c;return response('OBSERVER-UNIT-RETIRED\n');}});
  command=command.slice(0,command.indexOf('step=artifact\n'))+'printf "CHECKED\\n"\n';
  command=command.replace('PATH=/usr/bin:/bin','PATH='+dir+':/usr/bin:/bin').replaceAll('/proc/sys/kernel/random/boot_id',path.join(dir,'boot'));
  for(const [snapshot,ok] of [
   ['LoadState=not-found\nActiveState=inactive\nMainPID=0\n',true],
   ['MainPID=0\nLoadState=loaded\nActiveState=inactive\n',true],
   ['LoadState=loaded\nActiveState=active\nMainPID=42\n',false],
   ['LoadState=not-found\nActiveState=inactive\n',false],
   ['LoadState=not-found\nActiveState=inactive\nMainPID=0\nMainPID=42\n',false]
  ]){
   fs.writeFileSync(path.join(dir,'snapshot'),snapshot);
   const r=spawnSync('/bin/sh',[],{input:command,encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);
   if(!ok)assert.match(r.stderr,/OBSERVER-RETIRE-FAILED:state/);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
