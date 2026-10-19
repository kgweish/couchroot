'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareProductionExit}=require('../research/autonomous-root/service/production-exit');
const boot='00000000-0000-0000-0000-000000000001',id='a'.repeat(32),sha='b'.repeat(64);
function record(){return {schema:1,id,phase:'ready',device:'s90d',manifest_sha256:sha,state_receipt_sha256:sha,worker_sha256:sha,launcher_sha256:sha,source:{boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}},boot_id:boot,unit:'couchroot-worker-'+id+'.service',directory:'/opt/couchroot-worker-'+id,scope:'/opt/couchroot-worker-'+id+'/state',port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',token_sha256:sha,worker_identity:{boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:87,start_ticks:'300'},guardian:{pid:86,start_ticks:'299'}}},unit_started_monotonic:'123'};}
const stat=(pid,ticks)=>Buffer.from(pid+' (worker (with)\nspaces) S '+Array(18).fill('0').join(' ')+' '+ticks+' 0').toString('base64');
function fixture(){
 const r=record();let states={worker:stat(87,'300'),guardian:stat(86,'299')},unit='running',started='123',calls=[];
 const execute=async c=>{calls.push(c);return {exit_code:0,stderr:'',stdout:c.includes('--property=Id,')?`Id=${r.unit}\nLoadState=loaded\nActiveState=active\nSubState=${unit}\nMainPID=${unit==='running'?86:0}\nExecMainCode=${unit==='running'?0:1}\nExecMainStatus=0\nExecMainStartTimestampMonotonic=${started}\n`:`worker:${states.worker}\nguardian:${states.guardian}\n`};};
 return {r,states,calls,execute,exit:()=>{unit='exited';states.worker='absent';states.guardian='absent';},setUnit:v=>unit=v,setStart:v=>started=v};
}
test('independent exit observation requires both original identities and successful matching unit termination',async()=>{
 const f=fixture(),observer=await prepareProductionExit({record:f.r,execute:f.execute});f.states.worker='absent';
 // Use the bound executor to simulate the guardian finishing after its worker.
 f.states.guardian='absent';f.setUnit('exited');const result=await observer.waitForExit();
 assert.equal(result.record_id,id);assert.equal(result.observation.processes.worker.observation,'absent');assert.equal(result.observation.processes.guardian.observation,'absent');
 await assert.rejects(observer.waitForExit());assert(f.calls.every(c=>!c.includes(' kill ')&&!c.includes('systemctl stop')));
});
test('worker exit alone does not complete observation; reused identities count only after unit exit',async()=>{
 const f=fixture();let observing=false,polls=0;
 const execute=async c=>{if(observing&&!c.includes('--property=Id,')){polls++;if(polls===2){f.states.guardian=stat(86,'999');f.setUnit('exited');}}return f.execute(c);};
 const observer=await prepareProductionExit({record:f.r,execute});observing=true;f.states.worker='absent';
 const result=await observer.waitForExit();assert.equal(polls,2);assert.equal(result.observation.processes.guardian.observation,'reused');
});
test('binding rejects absent or reused workers, malformed output and changed unit identity',async()=>{
 for(const mode of ['absent','reused','unit','malformed','error','stderr','truncated']){
  const f=fixture();if(mode==='absent')f.states.worker='absent';if(mode==='reused')f.states.worker=stat(87,'999');if(mode==='unit')f.setStart('999');
  await assert.rejects(prepareProductionExit({record:f.r,execute:async c=>{const r=await f.execute(c);if(mode==='malformed')r.stdout='worker:!\nguardian:absent\n';if(mode==='error')r.exit_code=1;if(mode==='stderr')r.stderr='permission denied';if(mode==='truncated')r.stdout=r.stdout.slice(0,-1);return r;}}));
 }
});
test('post-shutdown drift or stalled guardian refuses completion and replay',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
 for(const mode of ['unit','failure','deadline']){
  const f=fixture(),file=path.resolve(__dirname,'../research/autonomous-root/service/production-exit.js'),module={exports:{}};let now=0;
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,Buffer,require:createRequire(file),setTimeout:fn=>{now+=11000;fn();},process:{hrtime:previous=>{const value=[Math.floor(now/1000),0];return previous?[value[0]-previous[0],0]:value;}}});
  const observer=await module.exports.prepareProductionExit({record:f.r,execute:f.execute});
  if(mode==='unit')f.setStart('999');if(mode==='failure')f.setUnit('failed');if(mode==='deadline')f.states.worker='absent';
  await assert.rejects(observer.waitForExit());const count=f.calls.length;await assert.rejects(observer.waitForExit());assert.equal(f.calls.length,count);
 }
});

test('exit observation shell preserves process stat bytes and rejects failed boot or process reads',{skip:process.platform!=='linux'},async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 for(const mode of ['ok','boot','read']){
  const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'production-exit-'));
  try{
   fs.writeFileSync(dir+'/boot',mode==='boot'?boot.slice(0,-1)+'2':boot);
   for(const [name,p] of Object.entries(f.r.worker_identity.processes)){fs.mkdirSync(dir+'/'+p.pid);fs.writeFileSync(dir+'/'+p.pid+'/stat',Buffer.from(f.states[name],'base64'));}
   if(mode==='read')fs.unlinkSync(dir+'/87/stat');
   const execute=async c=>{if(c.includes('--property=Id,'))return f.execute(c);const r=spawnSync('/bin/sh',['-c',c.replaceAll('/proc/sys/kernel/random/boot_id',dir+'/boot').replaceAll('/proc/87',dir+'/87').replaceAll('/proc/86',dir+'/86')],{encoding:'utf8'});return {exit_code:r.status,stdout:r.stdout,stderr:r.stderr};};
   if(mode!=='ok')await assert.rejects(prepareProductionExit({record:f.r,execute}));
   else{const observer=await prepareProductionExit({record:f.r,execute});fs.rmSync(dir+'/87',{recursive:true});fs.rmSync(dir+'/86',{recursive:true});f.exit();assert.equal((await observer.waitForExit()).observation.processes.guardian.observation,'absent');}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});


test('process disappearance between existence and stat read still proves absence', {skip:process.platform!=='linux'},async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'production-exit-race-'));let racing=false;
 try{
  fs.writeFileSync(dir+'/boot',boot);
  for(const [name,p] of Object.entries(f.r.worker_identity.processes)){fs.mkdirSync(dir+'/'+p.pid);fs.writeFileSync(dir+'/'+p.pid+'/stat',Buffer.from(f.states[name],'base64'));}
  const execute=async c=>{
   if(c.includes('--property=Id,'))return f.execute(c);
   const hook=racing?'cat() { if test "$1" = "'+dir+'/87/stat"; then rm "$1"; rmdir "'+dir+'/87"; return 1; fi; /bin/cat "$@"; }\n':'';
   const r=spawnSync('/bin/sh',['-c',hook+c.replaceAll('/proc/sys/kernel/random/boot_id',dir+'/boot').replaceAll('/proc/87',dir+'/87').replaceAll('/proc/86',dir+'/86')],{encoding:'utf8'});
   return {exit_code:r.status,stdout:r.stdout,stderr:r.stderr};
  };
  const observer=await prepareProductionExit({record:f.r,execute});racing=true;fs.rmSync(dir+'/86',{recursive:true});f.exit();
  const result=await observer.waitForExit();assert.equal(result.observation.processes.worker.observation,'absent');assert.equal(result.observation.processes.guardian.observation,'absent');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unexpected unit exit details are retained without treating failure as success',async()=>{
 const f=fixture(),observer=await prepareProductionExit({record:f.r,execute:f.execute});f.setUnit('failed');
 await assert.rejects(observer.waitForExit(),/unexpected unit active\/failed pid=0 code=1 status=0/);
});

test('explicit observation recovery retains the original binding and cannot replay completed observation',async()=>{
 const f=fixture();let fail=false;
 const observer=await prepareProductionExit({record:f.r,execute:async c=>{if(fail)throw Error('read transport unavailable');return f.execute(c);}});
 await assert.rejects(observer.resumeExitObservation());
 fail=true;await assert.rejects(observer.waitForExit(),/read transport unavailable/);
 await assert.rejects(observer.waitForExit());
 fail=false;f.exit();const result=await observer.resumeExitObservation();
 assert.deepEqual(result.identity,f.r.worker_identity);
 const count=f.calls.length;await assert.rejects(observer.resumeExitObservation());await assert.rejects(observer.waitForExit());assert.equal(f.calls.length,count);
 assert(f.calls.every(c=>!c.includes(' kill ')&&!c.includes('systemctl stop')));
});

test('resumed observation refuses changed unit identity and overlapping retries',async()=>{
 const f=fixture();let fail=false,release=null,block=false;
 const observer=await prepareProductionExit({record:f.r,execute:async c=>{
  if(fail)throw Error('interrupted');if(block){block=false;await new Promise(resolve=>{release=resolve;});}return f.execute(c);
 }});
 fail=true;await assert.rejects(observer.waitForExit());fail=false;f.exit();f.setStart('999');
 await assert.rejects(observer.resumeExitObservation(),/unit start identity changed/);
 f.setStart('123');block=true;const pending=observer.resumeExitObservation();
 assert.equal(typeof release,'function');const count=f.calls.length;
 await assert.rejects(observer.resumeExitObservation());await assert.rejects(observer.waitForExit());assert.equal(f.calls.length,count);
 release();assert.equal((await pending).record_id,id);
});
