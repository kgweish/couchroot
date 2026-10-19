'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {recoverObserver,remotePlan}=require('../research/autonomous-root/service/observer-recovery');
const {hash}=require('../research/autonomous-root/service/policy');
const boot='00000000-0000-0000-0000-000000000001',id='a'.repeat(32),obs='b'.repeat(32),digest='c'.repeat(64);
async function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'observer-recovery-')),nested=dir+'/observer-launches',scope=dir+'/observer-ABC123';fs.mkdirSync(nested,{mode:0o700});fs.mkdirSync(scope,{mode:0o700});
 const file=nested+'/'+obs+'.observer.json',marker=nested+'/observer-launch.pending',checkpoint=nested+'/'+obs+'.recovery.json';
 const source={boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:4100,start_ticks:'900'},guardian:null}};
 const provider={device:'s90d',manifest_sha256:digest,observer_sha256:digest};
 const unit='couchroot-observer-'+obs+'.service',e={id,provider_id:obs,provider,boot_id:boot,source,known:[['source',source.processes.worker]],units:[unit]};
 const record={schema:1,id:obs,phase:'submitted',manifest_sha256:digest,observer_sha256:digest,boot_id:boot,pids:[4100],unit,root:scope,execution_directory:'/opt/couchroot-observer-'+obs,credentials:{uid:5001,gid:100,groups:[100,201],label:'User::Pkg::MiniRoot01'}};
 const receipt={schema:1,boot_id:boot,worker_pid:4100,guardian_pid:null,observer_pid:4200,exit_code:1,signal:null};
 const write=(p,v)=>fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});
 write(file,record);write(marker,obs+'\n');write(scope+'/token','f'.repeat(64));write(scope+'/result',receipt);
 let remote=true,alive=false,listener=false,loseReply=false;const commands=[];
 const observation=()=>`Unit=${unit}\nLoadState=loaded\nActiveState=active\nSubState=${alive?'running':'exited'}\nMainPID=${alive?'4200':'0'}\nControlGroup=\nProcs=absent\nRESTART-ROLLBACK-OBSERVED\nOBSERVER-RECOVERY-QUIET\n`;
 const execute=async command=>{commands.push(command);
  if(command.includes('OBSERVER-RECOVERY-QUIET')){
   if(listener)return {exit_code:1,stdout:'',stderr:'',timed_out:false};
   const stdout=observation();if(command.includes('OBSERVER-RECOVERY-RETIRED')){remote=false;if(loseReply){loseReply=false;throw Error('acknowledgement lost');}return {exit_code:0,stdout:stdout+'OBSERVER-RECOVERY-RETIRED\n',stderr:'',timed_out:false};}
   return {exit_code:0,stdout,stderr:'',timed_out:false};
  }
  assert(command.startsWith('set -eu\ntest ! -e /opt/couchroot-observer-'));return {exit_code:remote?1:0,stdout:'',stderr:'',timed_out:false};
 };
 const f={dir,nested,scope,file,marker,checkpoint,e,record,receipt,commands,write,run:()=>recoverObserver({directory:dir,evidence:e,execute}),setRemote:v=>{remote=v;},setAlive:v=>{alive=v;},setListener:v=>{listener=v;},loseReply:()=>{loseReply=true;}};
 try{await fn(f);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('terminal observer recovery retires exact resources and keeps a completed checkpoint',()=>fixture(async f=>{
 const result=await f.run();assert.equal(result.id,obs);assert(!fs.existsSync(f.scope));assert(!fs.existsSync(f.marker));
 const record=JSON.parse(fs.readFileSync(f.file)),cp=JSON.parse(fs.readFileSync(f.checkpoint));assert.equal(record.phase,'cancelled');assert.deepEqual(record.observer_receipt,f.receipt);assert.equal(cp.phase,'complete');assert.equal(result.receipt_sha256,hash(fs.readFileSync(f.file)));
 const mutations=()=>f.commands.filter(c=>c.includes('OBSERVER-RECOVERY-RETIRED')).length;assert.equal(mutations(),1);assert.deepEqual(await f.run(),result);assert.equal(mutations(),1);
}));
test('lost remote acknowledgement resumes the original checkpoint without relaunching',()=>fixture(async f=>{
 f.loseReply();await assert.rejects(f.run(),/acknowledgement lost/);assert.equal(JSON.parse(fs.readFileSync(f.checkpoint)).phase,'prepared');assert(fs.existsSync(f.scope+'/token'));assert(fs.existsSync(f.marker));
 await f.run();assert.equal(JSON.parse(fs.readFileSync(f.checkpoint)).phase,'complete');assert(f.commands.every(c=>!c.includes('systemd-run')&&!c.includes('kill -')));
}));
for(const mode of ['active-unit','live-listener'])test(mode+' blocks cleanup before checkpoint publication',()=>fixture(async f=>{
 if(mode==='active-unit')f.setAlive(true);else f.setListener(true);await assert.rejects(f.run());assert(!fs.existsSync(f.checkpoint));assert(fs.existsSync(f.scope+'/token'));assert(!f.commands.some(c=>c.includes('OBSERVER-RECOVERY-RETIRED')));
}));
for(const mode of ['foreign-id','wrong-boot','wrong-digest','wrong-source','foreign-marker','bad-token','pending-receipt','extra-file','symlink','permissions'])test('observer recovery refuses '+mode,()=>fixture(async f=>{
 const r={...f.record};
 if(mode==='foreign-id')r.id='e'.repeat(32);if(mode==='wrong-boot')r.boot_id='00000000-0000-0000-0000-000000000002';if(mode==='wrong-digest')r.observer_sha256='e'.repeat(64);if(mode==='wrong-source')r.pids=[9999];f.write(f.file,r);
 if(mode==='foreign-marker')f.write(f.marker,'e'.repeat(32)+'\n');if(mode==='bad-token')f.write(f.scope+'/token','x'.repeat(64));if(mode==='pending-receipt')f.write(f.scope+'/result.next','pending');if(mode==='extra-file')f.write(f.scope+'/unknown','retained');
 if(mode==='symlink'){fs.renameSync(f.scope+'/token',f.dir+'/original-token');fs.symlinkSync(f.dir+'/original-token',f.scope+'/token');}if(mode==='permissions')fs.chmodSync(f.scope+'/token',0o644);
 await assert.rejects(f.run());assert(!fs.existsSync(f.checkpoint));assert(fs.existsSync(f.marker));assert(!f.commands.some(c=>c.includes('OBSERVER-RECOVERY-RETIRED')));
}));
test('changed bytes after a lost acknowledgement preserve the remaining evidence',()=>fixture(async f=>{
 f.loseReply();await assert.rejects(f.run());f.write(f.scope+'/token','e'.repeat(64));await assert.rejects(f.run(),/scope bytes changed/);assert(fs.existsSync(f.scope+'/result'));assert(fs.existsSync(f.marker));
}));
test('a partial local deletion resumes only its verified remaining prefix',()=>fixture(async f=>{
 const unlink=fs.unlinkSync;let removed=false;
 fs.unlinkSync=p=>{if(p.startsWith(f.scope+'/')){if(removed)throw Error('local deletion interrupted');removed=true;}return unlink(p);};
 try{await assert.rejects(f.run(),/local deletion interrupted/);}finally{fs.unlinkSync=unlink;}
 assert.equal(JSON.parse(fs.readFileSync(f.checkpoint)).phase,'remote-retired');assert.equal(fs.readdirSync(f.scope).length,1);assert(fs.existsSync(f.marker));
 f.setRemote(true);await assert.rejects(f.run(),/executable reappeared/);assert.equal(fs.readdirSync(f.scope).length,1);
 f.setRemote(false);await f.run();assert(!fs.existsSync(f.scope));assert(!fs.existsSync(f.marker));
}));
test('observer checkpoint cannot be transplanted to another forward transaction',()=>fixture(async f=>{
 f.loseReply();await assert.rejects(f.run());f.e.id='f'.repeat(32);await assert.rejects(f.run(),/checkpoint binding/);assert(fs.existsSync(f.scope+'/token'));
}));
test('already completed legacy observer with no scope does not create a cleanup checkpoint',()=>fixture(async f=>{
 f.write(f.file,{...f.record,phase:'cancelled'});fs.rmSync(f.scope,{recursive:true});fs.unlinkSync(f.marker);f.setRemote(false);assert.equal(await f.run(),null);assert(!fs.existsSync(f.checkpoint));assert(f.commands.every(c=>!c.includes('OBSERVER-RECOVERY-RETIRED')));
}));
test('remote observer retirement plan is valid shell and guards bytes before removal',()=>fixture(async f=>{
 const command=remotePlan(f.e,f.record,f.receipt);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);assert(command.indexOf('sha256sum')<command.indexOf('rm /opt/'));assert(command.includes('/proc/net/unix'));assert(!command.includes('kill -'));
}));
for(const mode of ['new-main-pid','running-substate','foreign-cgroup'])test('remote retirement refuses '+mode+' after the first observation',()=>fixture(async f=>{
 const ctl=f.dir+'/systemctl',mutated=f.dir+'/unexpected-stop';
 fs.writeFileSync(ctl,`#!/bin/sh
case "$1" in stop|reset-failed) touch '${mutated}'; exit 1;; esac
case "$*" in 'show -p ActiveState '*) printf 'ActiveState=active\\n';;
*) printf 'MainPID=${mode==='new-main-pid'?4200:0}\\nSubState=${mode==='running-substate'?'running':'exited'}\\nControlGroup=${mode==='foreign-cgroup'?'/foreign/unit':''}\\n';; esac
`,{mode:0o700});
 const plan=remotePlan(f.e,f.record,f.receipt),at=plan.indexOf('state=$(systemctl show -p ActiveState ');assert(at>0);
 const result=spawnSync('/bin/sh',[],{input:'set -eu\n'+plan.slice(at).replaceAll('systemctl ',ctl+' ')});
 assert.notEqual(result.status,0);assert(!fs.existsSync(mutated),'a newly live or foreign unit must never be stopped');
}));
