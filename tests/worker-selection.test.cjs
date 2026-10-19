'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {SelectionJournal,selectionStatus,managedVersion}=require('../research/autonomous-root/service/worker-selection');
const {createAgent}=require('../research/autonomous-root/service/agent');
const M={implementation:'managed',manifest_sha256:'a'.repeat(64)},N={implementation:'native-prototype',manifest_sha256:'b'.repeat(64)},Q='c'.repeat(64),S='d'.repeat(64),R='e'.repeat(64);
function fixture(){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'worker-selection-')));const file=path.join(dir,'worker-selection.json');return {dir,file,j:new SelectionJournal(file),close:()=>fs.rmSync(dir,{recursive:true,force:true})};}
function advance(j,s,phase,evidence){return j.advance(s.revision,s.pending.id,phase,evidence);}
test('legacy absence remains managed without writing a record',()=>{const f=fixture();try{assert.equal(selectionStatus(f.file).phase,'legacy-managed');assert.equal(selectionStatus(f.file).launch_allowed,true);assert.deepEqual(fs.readdirSync(f.dir),[]);}finally{f.close();}});
test('transition gates preserve versions and receipts across restart',()=>{
 const f=fixture();try{
  let s=f.j.initialize(M);assert.equal(s.revision,1);assert.equal(selectionStatus(f.file).launch_allowed,true);
  s=f.j.begin(s.revision,N,Q);assert.equal(selectionStatus(f.file).launch_allowed,false);
  let j=new SelectionJournal(f.file);s=advance(j,s,'state-ready',S);j=new SelectionJournal(f.file);s=advance(j,s,'trial-ready',R);
  s=j.commit(s.revision,s.pending.id);assert.deepEqual(s.selected,N);assert.deepEqual(s.last_known_good,N);assert.equal(s.pending,null);
  assert.equal(s.history[0].state_sha256,S);assert.deepEqual(s.history[0].from,M);assert.equal(s.history[0].outcome,'committed');
  assert.equal(selectionStatus(f.file).launch_allowed,false);assert.equal(selectionStatus(f.file).reason,'native-runtime-verification-required');
 }finally{f.close();}
});
test('rollback requires new quiescence, state export and readiness receipts',()=>{
 const f=fixture();try{
  let s=f.j.initialize(M);s=f.j.begin(s.revision,N,Q);s=advance(f.j,s,'state-ready',S);s=advance(f.j,s,'trial-ready',R);
  s=advance(f.j,s,'rollback-required','f'.repeat(64));assert.equal(s.pending.state_sha256,null);assert.equal(s.pending.readiness_sha256,null);
  assert.throws(()=>f.j.commitRollback(s.revision,s.pending.id,R));assert.equal(f.j.failed,false);
  s=advance(f.j,s,'rollback-state-ready','1'.repeat(64));s=f.j.commitRollback(s.revision,s.pending.id,'2'.repeat(64));
  assert.deepEqual(s.selected,M);assert.equal(s.history[0].outcome,'rolled-back');assert.equal(s.history[0].state_sha256,'1'.repeat(64));assert.equal(s.history[0].readiness_sha256,'2'.repeat(64));assert.equal(selectionStatus(f.file).launch_allowed,true);
 }finally{f.close();}
});
test('stale revisions wrong transaction ids and skipped phases cannot publish',()=>{
 const f=fixture();try{
  let s=f.j.initialize(M);s=f.j.begin(s.revision,N,Q);const before=fs.readFileSync(f.file);
  for(const action of [()=>f.j.begin(1,N,Q),()=>f.j.commit(s.revision,s.pending.id),()=>f.j.advance(s.revision,'0'.repeat(32),'state-ready',S),()=>f.j.advance(s.revision,s.pending.id,'trial-ready',R)]){
   assert.throws(action);assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(fs.existsSync(f.file+'.writer'),false);
  }
  assert.equal(advance(f.j,s,'state-ready',S).pending.phase,'state-ready');
 }finally{f.close();}
});
test('failed publication retains an inspection marker before or after rename',()=>{
 for(const after of [false,true]){
  const f=fixture();try{
   f.j.initialize(M);
   const source=path.resolve(__dirname,'../research/autonomous-root/service/worker-selection.js'),realRequire=createRequire(source),policy=realRequire('./policy'),module={exports:{}};
   vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,exports:module.exports,process,Buffer,require:name=>name==='./policy'?{...policy,atomic:(...args)=>{if(after)policy.atomic(...args);throw Error('simulated durable write failure');}}:realRequire(name)});
   const j=new module.exports.SelectionJournal(f.file);assert.throws(()=>j.begin(1,N,Q));assert.equal(j.failed,true);
   assert.equal(selectionStatus(f.file).phase,'inspection-required');assert.equal(selectionStatus(f.file).launch_allowed,false);
   assert.equal(new SelectionJournal(f.file).read().revision,after?2:1);assert.throws(()=>new SelectionJournal(f.file).begin(after?2:1,N,Q),/inspection/);
  }finally{f.close();}
 }
});
test('unexpected record shape links permissions and dangling writer markers block launch',()=>{
 for(const kind of ['json','permissions','symlink','writer-link','invalid-phase']){
  const f=fixture();try{
   f.j.initialize(M);
   if(kind==='json')fs.writeFileSync(f.file,'{broken');
   if(kind==='permissions')fs.chmodSync(f.file,0o644);
   if(kind==='symlink'){fs.renameSync(f.file,f.file+'.other');fs.symlinkSync(f.file+'.other',f.file);}
   if(kind==='writer-link')fs.symlinkSync('missing',f.file+'.writer');
   if(kind==='invalid-phase'){const s=f.j.read();s.pending={phase:'ready'};fs.writeFileSync(f.file,JSON.stringify(s));}
   assert.equal(selectionStatus(f.file).launch_allowed,false);
  }finally{f.close();}
 }
});
test('history remains bounded and readable after many complete transitions',()=>{
 const f=fixture();try{
  let s=f.j.initialize(M);
  for(let i=0;i<34;i++){s=f.j.begin(s.revision,i%2?M:N,Q);s=advance(f.j,s,'state-ready',S);s=advance(f.j,s,'trial-ready',R);s=f.j.commit(s.revision,s.pending.id);}
  assert.equal(f.j.read().history.length,32);assert.equal(selectionStatus(f.file).phase,'stable');
 }finally{f.close();}
});
test('managed artifact version binds the six managed package bytes',()=>{
 const f=fixture();try{
  const {hash}=require('../research/autonomous-root/service/policy'),index={};
  for(const name of ['SamsungTvArchiveRoot','SamsungTvRootAgent'])for(const suffix of ['dll','runtimeconfig.json','deps.json']){const file=name+'.'+suffix;fs.writeFileSync(path.join(f.dir,file),file);index[file]=hash(file);}
  fs.writeFileSync(path.join(f.dir,'manifest.json'),JSON.stringify(index));const first=managedVersion(f.dir);assert.match(first,/^[a-f0-9]{64}$/);
  fs.appendFileSync(path.join(f.dir,'SamsungTvRootAgent.dll'),'changed');assert.throws(()=>managedVersion(f.dir));
 }finally{f.close();}
});
test('service does not acquire through submitted pending native or mismatched selection',async()=>{
 // A restarted service abandons only a prepared transition with no submission
 // evidence; a submitted provider launch keeps acquisition blocked.
 for(const kind of ['pending-submitted','native','mismatch','managed','pending-unsubmitted']){
  const f=fixture();let agent,calls=0;try{
   let s=f.j.initialize(M);
   if(kind.startsWith('pending')||kind==='native'){s=f.j.begin(s.revision,N,Q);if(kind==='native'){s=advance(f.j,s,'state-ready',S);s=advance(f.j,s,'trial-ready',R);s=f.j.commit(s.revision,s.pending.id);}}
   if(kind==='pending-submitted')fs.writeFileSync(path.dirname(f.file)+'/retirement-launch.pending','submitted\n',{mode:0o600});
   agent=createAgent({device:'qn90a'},{selectionFile:f.file,managedVersion:()=>kind==='mismatch'?'9'.repeat(64):M.manifest_sha256,verifyFirmware:()=>{calls++;throw Error('fixture-stop');}});
   const acquires=['managed','pending-unsubmitted'].includes(kind);
   agent.start();await new Promise(r=>setImmediate(r));assert.equal(calls,acquires?1:0,kind);assert.equal(agent.status().worker_ready,false);
   if(kind==='pending-unsubmitted'){assert.equal(f.j.read().pending,null);assert.equal(f.j.read().history.at(-1).outcome,'abandoned');}
   if(!acquires){assert.equal(agent.status().phase,'selection-required');assert.equal(agent.status().attempts,0);await assert.rejects(agent.operation({op:'file.commit'}));}
  }finally{if(agent)agent.stop();f.close();}
 }
});
test('retained-record import and rollback exports bind to committed selection receipts',()=>{
 const {execFileSync}=require('node:child_process'),{hash}=require('../research/autonomous-root/service/policy');
 const f=fixture();try{
  const managed=path.join(f.dir,'managed'),native=path.join(f.dir,'native'),rollback=path.join(f.dir,'rollback');
  for(const dir of [managed,native,rollback])fs.mkdirSync(dir,{mode:0o700});
  const record=id=>Buffer.from(JSON.stringify({id,boot_id:'00000000-0000-0000-0000-000000000001',state:'completed',pid:0,process_start:null,exit_code:7}));
  const original=record('managed-retained-0001');fs.writeFileSync(path.join(managed,'managed-retained-0001.json'),original,{mode:0o600});
  function migrate(source,target,direction){execFileSync('python3',['-c','import sys; from tvsetup.native_job_migration import migrate; migrate(sys.argv[1],sys.argv[2],sys.argv[3])',source,target,direction],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'});return hash(fs.readFileSync(path.join(target,'.import-manifest')));}
  let s=f.j.initialize(M);s=f.j.begin(s.revision,N,Q);const imported=migrate(managed,native,'import');s=advance(f.j,s,'state-ready',imported);s=advance(f.j,s,'trial-ready',R);s=f.j.commit(s.revision,s.pending.id);
  const added=record('native-created-0001');fs.writeFileSync(path.join(native,'native-created-0001.json'),added,{mode:0o600});
  s=f.j.begin(s.revision,M,Q);const exported=migrate(native,rollback,'rollback');s=advance(f.j,s,'state-ready',exported);s=advance(f.j,s,'trial-ready',R);s=f.j.commit(s.revision,s.pending.id);
  assert.equal(s.history[0].state_sha256,imported);assert.equal(s.history[1].state_sha256,exported);assert.deepEqual(s.selected,M);
  assert.deepEqual(fs.readFileSync(path.join(managed,'managed-retained-0001.json')),original);
  assert.deepEqual(fs.readFileSync(path.join(rollback,'managed-retained-0001.json')),original);
  assert.deepEqual(fs.readFileSync(path.join(rollback,'native-created-0001.json')),added);
  assert.equal(fs.existsSync(path.join(managed,'native-created-0001.json')),false);
 }finally{f.close();}
});

test('selection cannot disagree with its retained transition history',()=>{
 const f=fixture();try{
  let s=f.j.initialize(M);s=f.j.begin(s.revision,N,Q);s=advance(f.j,s,'state-ready',S);s=advance(f.j,s,'trial-ready',R);s=f.j.commit(s.revision,s.pending.id);
  s.selected=M;s.last_known_good=M;fs.writeFileSync(f.file,JSON.stringify(s));
  assert.equal(selectionStatus(f.file).launch_allowed,false);assert.equal(selectionStatus(f.file).phase,'inspection-required');
 }finally{f.close();}
});
