'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hash}=require('../research/autonomous-root/service/policy');
const {loadAcquisition,stageAcquisition,FILES}=require('../research/autonomous-root/service/service-acquisition');
const {validateBootstrap}=require('../research/autonomous-root/service/held-bootstrap');
const {validateReadiness}=require('../research/autonomous-root/service/worker-readiness');
function fixture(run){const d=fs.mkdtempSync(path.join(os.tmpdir(),'service-acquire-'));try{
 const artifacts={},manifest={};for(const n of FILES){const b=Buffer.from(n);fs.writeFileSync(d+'/'+n,b);artifacts[n]={sha256:hash(b),size:b.length};manifest[n]=hash(b);}
 const value={schema:1,kind:'native-service-acquisition',model:'qn90a',framework:'netcoreapp3.1',runtime:'3.1.3',reproducible_builds:2,artifacts};
 const save=()=>{const b=JSON.stringify(value);fs.writeFileSync(d+'/service-acquisition.json',b);manifest['service-acquisition.json']=hash(b);fs.writeFileSync(d+'/manifest.json',JSON.stringify(manifest));};save();run({d,value,manifest,save});
 }finally{fs.rmSync(d,{recursive:true,force:true});}}
test('service acquisition is explicit and snapshots only package-bound bytes',()=>fixture(({d})=>{
 const bundle=loadAcquisition(d,'qn90a'),stage=d+'/stage';fs.mkdirSync(stage);fs.writeFileSync(d+'/libacquire.so','changed');stageAcquisition(stage,bundle);
 assert.equal(fs.readFileSync(stage+'/code/libacquire.so','utf8'),'libacquire.so');assert.throws(()=>stageAcquisition(stage,bundle));assert.throws(()=>loadAcquisition(d,'qn90a'));
}));
test('native acquisition never silently falls back on incomplete or foreign metadata',()=>{
 for(const mode of ['model','runtime','kind','files','digest','missing','symlink'])fixture(f=>{
  if(mode==='model')f.value.model='s90d';if(mode==='runtime')f.value.runtime='6.0.9';if(mode==='kind')f.value.kind='native-acquisition-managed-entry';if(mode==='files')delete f.value.artifacts['libacquire.so'];f.save();
  if(mode==='digest')fs.writeFileSync(f.d+'/NativeEntry.dll','bad');if(mode==='missing')fs.unlinkSync(f.d+'/NativeEntry.dll');if(mode==='symlink'){fs.unlinkSync(f.d+'/NativeEntry.dll');fs.symlinkSync(f.d+'/NativeEntry.deps.json',f.d+'/NativeEntry.dll');}
  assert.throws(()=>loadAcquisition(f.d,'qn90a'),mode);
 });
 fixture(f=>{delete f.manifest['service-acquisition.json'];fs.writeFileSync(f.d+'/manifest.json',JSON.stringify(f.manifest));assert.throws(()=>loadAcquisition(f.d,'qn90a'));fs.unlinkSync(f.d+'/service-acquisition.json');assert.throws(()=>loadAcquisition(f.d,'qn90a'));for(const n of FILES){delete f.manifest[n];fs.unlinkSync(f.d+'/'+n);}fs.writeFileSync(f.d+'/manifest.json',JSON.stringify(f.manifest));assert.equal(loadAcquisition(f.d,'qn90a'),null);});
});
const boot='00000000-0000-0000-0000-000000000001',sha='a'.repeat(64);
function status(){return {implementation:'native-bootstrap',boot_id:boot,uptime_seconds:1,worker_id:'b'.repeat(32),lifetime_mode:'held-bootstrap',lifetime_seconds:300,guardian_pid:20,processes:{worker:{pid:21,start_ticks:'10'},guardian:{pid:20,start_ticks:'9'}},app_launcher:{sha256:sha,independently_staged:true},resources:{schema:1,scope:'worker-owned',jobs:[],helpers:[],transfers:[]},capabilities:['held-bootstrap-v1','resource-inventory-v1','worker-process-identity-v1','guardian-parent-identity-v1']};}
test('held readiness pins boot, guardian, launcher, lifetime and empty resources',()=>{
 const expected={bootId:boot,launcherSha256:sha};validateBootstrap(status(),expected);
 for(const change of [v=>v.boot_id='bad',v=>v.implementation='native-prototype',v=>v.lifetime_mode='production',v=>v.lifetime_seconds=0,v=>v.app_launcher.sha256='c'.repeat(64),v=>v.guardian_pid=21,v=>v.resources.helpers.push('d'.repeat(32)),v=>v.capabilities.push('prototype-jobs-v1')]){const v=status();change(v);assert.throws(()=>validateBootstrap(v,expected));}
 for(const implementation of ['managed','native-prototype'])assert.throws(()=>validateReadiness(status(),{...expected,implementation}));
});
test('bootstrap retirement keeps intent on uncertainty and removes only confirmed owned state',async()=>{
 const {retireBootstrap,cleanupCommand}=require('../research/autonomous-root/service/held-bootstrap');
 for(const failure of ['none','shutdown','cleanup']){
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrap-retire-')),id='e'.repeat(32),scope='/opt/couchroot-bootstrap-'+id;
  const record={schema:1,id,phase:'ready',boot_id:boot,directory:scope,scope:scope+'/state',unit:'couchroot-bootstrap-'+id+'.service',worker_sha256:sha,launcher_sha256:sha,worker_identity:{boot_id:boot,worker_id:'b'.repeat(32),processes:status().processes},unit_started_monotonic:'123',file:d+'/'+id+'.bootstrap.json'};
  const marker=d+'/bootstrap-launch.pending';fs.writeFileSync(record.file,JSON.stringify(record),{mode:0o600});fs.writeFileSync(marker,id+'\n',{mode:0o600});let cleaned=false;
  try{
   const command=cleanupCommand(record);assert.equal(require('node:child_process').spawnSync('/bin/sh',['-n'],{input:command}).status,0);assert.match(command,/stop --no-block/);assert.doesNotMatch(command,/rm -[rf]/);assert.match(command,/ExecMainStartTimestampMonotonic/);assert.match(command,/sha256sum/);
   const owner={shutdown:async()=>{if(failure==='shutdown')throw Error('lost acknowledgement');return {acknowledged:true,disconnected:true};}},next={execute:async c=>{
    if(c.includes('BOOTSTRAP-RETIRED')){cleaned=true;return {exit_code:failure==='cleanup'?1:0,timed_out:false,stdout:failure==='cleanup'?'':'BOOTSTRAP-RETIRED\n',stderr:''};}
    return {exit_code:0,timed_out:false,stderr:'',stdout:'Id='+record.unit+'\nLoadState=loaded\nActiveState=active\nSubState=exited\nMainPID=0\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n'};
   }};
   if(failure==='none'){await retireBootstrap(record,owner,next);assert(!fs.existsSync(marker));assert.equal(JSON.parse(fs.readFileSync(record.file)).phase,'retired');}
   else {await assert.rejects(retireBootstrap(record,owner,next));assert.equal(fs.readFileSync(marker,'utf8'),id+'\n');assert.equal(JSON.parse(fs.readFileSync(record.file)).phase,'ready');}
   assert.equal(cleaned,failure!=='shutdown');
  }finally{fs.rmSync(d,{recursive:true,force:true});}
 }
});
