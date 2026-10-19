'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection'),{providerId,inventoryRestart}=require('../research/autonomous-root/service/restart-inventory');
const {restartRollbackCandidate,reconcileRestartRollback}=require('../research/autonomous-root/service/restart-rollback');
const {snapshotManagedJobs}=require('../research/autonomous-root/service/retained-state');
const {cleanupRestartRollback,cleanupPlan}=require('../research/autonomous-root/service/restart-cleanup');
const {loadEvidence}=require('../research/autonomous-root/service/restart-rollback');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),d=c=>c.repeat(64);
const managed={implementation:'managed',manifest_sha256:d('a')},native={implementation:'native-prototype',manifest_sha256:d('b')};
const boot='00000000-0000-0000-0000-000000000001',source={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:4100,start_ticks:'900'},guardian:null}};
const CAPS=['file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1','worker-process-identity-v1','resource-inventory-v1'];
// Mutating verbs must never reach the held executor before the rollback is committed.
const MUTATION=/(^|[\s;|&(])(rm|rmdir|mv|mkdir|cp|ln|chmod|chown|kill|pkill|touch|truncate|dd|systemd-run|sqlite3)\s|systemctl (stop|start|kill|restart)|>(?!\s*&)\s*\/|set -C/m;
function record(id,state='completed',exit=7){return Buffer.from(JSON.stringify({id,state,boot_id:boot,pid:4200,exit_code:exit}));}
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restart-rollback-'));fs.chmodSync(dir,0o700);const file=dir+'/worker-selection.json',journal=new SelectionJournal(file);journal.initialize(managed);
 const write=(name,value)=>fs.writeFileSync(dir+'/'+name,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
 const listing=()=>fs.readdirSync(dir).sort().map(n=>[n,fs.statSync(dir+'/'+n).isDirectory()?'dir:'+fs.readdirSync(dir+'/'+n).join(','):fs.readFileSync(dir+'/'+n,'utf8')]);
 const jobs=new Map([['retained-keep-0001.json',record('retained-keep-0001')]]);
 const units=new Map(),commands=[];let executorWorker={pid:5100,start_ticks:'1200'},statusBoot=boot,failObserveAfter=Infinity,observed=0;
 const executor={pid:5100,status:async()=>({boot_id:statusBoot,uptime_seconds:5,worker_id:'e'.repeat(32),capabilities:CAPS,app_launcher:{sha256:d('f'),implementation:'native'},processes:{worker:executorWorker,guardian:null},resources:{schema:1,scope:'worker-owned',transfers:[],jobs:[],helpers:[]}}),
  execute:async command=>{
   commands.push(command);
   if(command.includes('RESTART-ROLLBACK-OBSERVED')){
    if(++observed>failObserveAfter)return {exit_code:1,stdout:'',stderr:'',timed_out:false};
    const names=[...command.matchAll(/for unit in ([^;]+); do/g)][0][1].trim().split(' ');
    const out=names.map(u=>{const v=units.get(u)||{LoadState:'not-found',ActiveState:'inactive',SubState:'dead',MainPID:'0',ControlGroup:'',Procs:'absent'};return 'Unit='+u+'\n'+['LoadState','ActiveState','SubState','MainPID','ControlGroup'].map(k=>k+'='+v[k]).join('\n')+'\nProcs='+v.Procs+'\n';}).join('');
    return {exit_code:0,stdout:out+'RESTART-ROLLBACK-OBSERVED\n',stderr:'',timed_out:false};
   }
   if(command.includes('RESTART-CLEANED'))return f.cleanupResult?f.cleanupResult(command):{exit_code:0,stdout:'RESTART-CLEANED\n',stderr:'',timed_out:false};
   if(command.includes('SNAPSHOT-END'))return {exit_code:0,stdout:[...jobs].sort().map(([n,b])=>n+' '+b.length+' '+sha(b)+'\n').join('')+'SNAPSHOT-END\n',stderr:'',timed_out:false};
   const m=command.match(/base64 \/opt\/couchroot-agent\/jobs\/([A-Za-z0-9-]+\.json)\n/);if(m)return {exit_code:0,stdout:jobs.get(m[1]).toString('base64')+'\n',stderr:'',timed_out:false};
   throw Error('unexpected executor command');
  }};
 const f={dir,file,journal,write,listing,jobs,units,commands,executor,
  setWorker:w=>{executorWorker=w;},setBoot:b=>{statusBoot=b;},failObserve:n=>{failObserveAfter=n;observed=0;},
  snapshot:async()=>snapshotManagedJobs({source,execute:executor.execute}),
  run:()=>reconcileRestartRollback({selectionFile:file,managedSha256:managed.manifest_sha256,executor}),
  cleanup:id=>cleanupRestartRollback({selectionFile:file,id,executor}),cleanupResult:null,
  token:(name,value)=>{fs.mkdirSync(dir+'/'+name,{mode:0o700});fs.writeFileSync(dir+'/'+name+'/token',value,{mode:0o600});return {token_file:dir+'/'+name+'/token',token_sha256:sha(value)};}};
 const done=()=>fs.rmSync(dir,{recursive:true,force:true});
 return Promise.resolve().then(()=>fn(f)).finally(done);
}
const provider=(id,phase='ready',token={token_file:'/x/retirement-AAAAAA/token',token_sha256:d('1')})=>({schema:1,id:providerId(id),phase,device:'qn90a',boot_id:boot,source,unit:'couchroot-retirement-'+providerId(id)+'.service',directory:'/opt/couchroot-retirement-'+providerId(id),scope:'/opt/couchroot-retirement-'+providerId(id)+'/state',worker_sha256:d('2'),launcher_sha256:d('3'),...token,...(phase==='ready'?{provider_identity:{boot_id:boot,worker_id:'9'.repeat(32),processes:{worker:{pid:4300,start_ticks:'950'},guardian:{pid:4301,start_ticks:'951'}}}}:{})});
// Advance a forward trial to the requested boundary with the durable records each step writes.
async function trial(f,boundary){
 const id=f.journal.begin(1,native,d('c')).pending.id,obs=providerId(id);
 f.write('retirement-launch.pending',obs+'\n');f.write(obs+'.retirement.json',provider(id,boundary==='provider-submitted'?'submitted':'ready',f.token('retirement-Pr0v1d','p'.repeat(44))));
 if(['provider-submitted','provider-ready'].includes(boundary))return id;
 const snapshot=await f.snapshot();f.write(id+'.retained-snapshot.json',snapshot);
 if(boundary==='source-stopped')return id;
 f.write('state-install.pending',id+'\n');f.write(id+'.state-install.json',{schema:1,id,phase:'ready',snapshot_sha256:snapshot.sha256,installed_manifest_sha256:d('4'),directory:'/opt/couchroot-worker-'+id,scope:'/opt/couchroot-worker-'+id+'/state'});
 f.journal.advance(2,id,'state-ready',d('d'));
 if(boundary==='state-ready')return id;
 f.write('production-launch.pending',id+'\n');f.write(id+'.production.json',{schema:1,id,phase:'ready',boot_id:boot,source,unit:'couchroot-worker-'+id+'.service',directory:'/opt/couchroot-worker-'+id,scope:'/opt/couchroot-worker-'+id+'/state',worker_sha256:d('5'),launcher_sha256:d('6'),...f.token('production-Pr0duc','q'.repeat(44)),worker_identity:{boot_id:boot,worker_id:'8'.repeat(32),processes:{worker:{pid:4400,start_ticks:'960'},guardian:{pid:4401,start_ticks:'961'}}}});
 f.journal.advance(3,id,'trial-ready',d('e'));return id;
}
for(const boundary of ['provider-submitted','provider-ready','source-stopped','state-ready','trial-ready'])test('restart rollback of an uncommitted forward trial at '+boundary,()=>fixture(async f=>{
 const id=await trial(f,boundary),obs=providerId(id);
 f.units.set('couchroot-retirement-'+obs+'.service',{LoadState:'loaded',ActiveState:'active',SubState:'exited',MainPID:'0',ControlGroup:'/system.slice/couchroot-retirement-'+obs+'.service',Procs:'0'});
 if(boundary==='trial-ready')f.units.set('couchroot-worker-'+id+'.service',{LoadState:'loaded',ActiveState:'failed',SubState:'failed',MainPID:'0',ControlGroup:'',Procs:'absent'});
 const owned=f.listing();assert.deepEqual(restartRollbackCandidate(f.file,managed.manifest_sha256),{id,phase:boundary==='state-ready'?'state-ready':boundary==='trial-ready'?'trial-ready':'prepared',resuming:false});
 const result=await f.run();assert.equal(result.id,id);
 const s=f.journal.read(),h=s.history[s.history.length-1];assert.equal(s.pending,null);assert.deepEqual(s.selected,managed);assert.equal(h.id,id);assert.equal(h.outcome,'rolled-back');assert.deepEqual(h.from,managed);assert.deepEqual(h.to,native);
 assert.equal(h.state_sha256,result.receipt_sha256);assert.equal(h.readiness_sha256,result.readiness_sha256);
 const receipt=JSON.parse(fs.readFileSync(f.dir+'/'+id+'.restart-rollback.json'));assert.equal(sha(JSON.stringify(receipt)),h.state_sha256);assert.equal(receipt.managed_jobs_sha256,(await f.snapshot()).sha256);
 assert(!fs.existsSync(f.dir+'/'+id+'.restart-rollback.pending'));
 // Every pre-existing record and marker is retained byte for byte for explicit cleanup.
 const after=new Map(f.listing());for(const [n,v] of owned)if(n!=='worker-selection.json')assert.equal(after.get(n),v,n);
 for(const c of f.commands)assert(!MUTATION.test(c),'executor received a mutating command: '+c.slice(0,200));
 assert.equal(restartRollbackCandidate(f.file,managed.manifest_sha256),null);await assert.rejects(f.run(),/no reconcilable transition/);
 const r=inventoryRestart(f.file);assert.equal(r.selection_phase,'stable');assert.equal(r.action,'pending-reconciliation');assert(r.markers.includes('retirement-launch.pending'));
}));
test('running or changing remnants, changed jobs and foreign evidence leave the journal untouched',()=>fixture(async f=>{
 const id=await trial(f,'trial-ready'),obs=providerId(id),before=f.listing();
 const refuse=async pattern=>{await assert.rejects(f.run(),e=>e.outcome==='rejected'&&pattern.test(e.message));assert.deepEqual(f.listing(),before);};
 for(const v of [{MainPID:'4400',ActiveState:'active',SubState:'running',Procs:'2'},{MainPID:'0',ActiveState:'active',SubState:'exited',Procs:'1'},{MainPID:'0',ActiveState:'deactivating',SubState:'stop-sigterm',Procs:'0'}]){
  f.units.set('couchroot-worker-'+id+'.service',{LoadState:'loaded',ControlGroup:'/system.slice/couchroot-worker-'+id+'.service',...v});await refuse(/still has processes or is changing state/);
 }
 f.units.clear();f.jobs.set('native-wrote-0001.json',record('native-wrote-0001'));await refuse(/managed jobs changed after source stop/);f.jobs.delete('native-wrote-0001.json');
 f.write(id+'.native-stop.json',{phase:'submitting'});await assert.rejects(f.run(),/unexpected transaction file/);fs.unlinkSync(f.dir+'/'+id+'.native-stop.json');
 fs.writeFileSync(f.dir+'/production-launch.pending','f'.repeat(32)+'\n');await assert.rejects(f.run(),/names another transaction/);fs.writeFileSync(f.dir+'/production-launch.pending',id+'\n');
 f.setWorker(source.processes.worker);await assert.rejects(f.run(),/executor is a recorded process|Worker process identity/);f.setWorker({pid:5100,start_ticks:'1200'});
 f.setBoot('00000000-0000-0000-0000-000000000002');await assert.rejects(f.run(),/boot or identity mismatch/);f.setBoot(boot);
 f.write(obs+'.retirement.json',{...provider(id),phase:'staging-retired'});await assert.rejects(f.run(),/not reconcilable at phase staging-retired/);
 assert.equal(f.journal.read().pending.phase,'trial-ready');
}));
test('missing provider record, writer locks, return transitions and other packages are not candidates',()=>fixture(async f=>{
 const id=f.journal.begin(1,native,d('c')).pending.id;f.write('retirement-launch.pending',providerId(id)+'\n');
 await assert.rejects(f.run(),/provider record missing/);
 assert.equal(restartRollbackCandidate(f.file,d('9')),null,'a different installed managed package is not the rollback target');
 f.write('managed-restore.pending',id+'\n');assert.equal(restartRollbackCandidate(f.file,managed.manifest_sha256),null);fs.unlinkSync(f.dir+'/managed-restore.pending');
 f.write('worker-selection.json.writer','w');assert.equal(restartRollbackCandidate(f.file,managed.manifest_sha256),null);
}));
test('an interrupted restart rollback resumes from each durable step without repeating publication',()=>fixture(async f=>{
 const id=await trial(f,'state-ready');
 // First attempt stops after rollback-required and the receipt are published, before the final observation.
 f.failObserve(1);await assert.rejects(f.run(),e=>e.outcome==='unknown');
 let s=f.journal.read();assert.equal(s.pending.phase,'rollback-state-ready');assert(fs.existsSync(f.dir+'/'+id+'.restart-rollback.pending'));
 assert.deepEqual(restartRollbackCandidate(f.file,managed.manifest_sha256),{id,phase:'rollback-state-ready',resuming:true});
 const receipt=fs.readFileSync(f.dir+'/'+id+'.restart-rollback.json','utf8');
 // A later managed worker resumes; the receipt must match the fresh verification exactly.
 f.failObserve(Infinity);f.setWorker({pid:5100,start_ticks:'1300'});const result=await f.run();
 assert.equal(fs.readFileSync(f.dir+'/'+id+'.restart-rollback.json','utf8'),receipt);s=f.journal.read();assert.equal(s.history.slice(-1)[0].outcome,'rolled-back');assert.equal(s.history.slice(-1)[0].state_sha256,result.receipt_sha256);
 // A crash after commit leaves only the intent, which the next acquisition removes.
 f.write(id+'.restart-rollback.pending',id+'\n');assert.deepEqual(restartRollbackCandidate(f.file,managed.manifest_sha256),{id,phase:'rolled-back',resuming:true});
 assert.deepEqual(await f.run(),{id,finalized:true});assert(!fs.existsSync(f.dir+'/'+id+'.restart-rollback.pending'));assert.equal(restartRollbackCandidate(f.file,managed.manifest_sha256),null);
 // A rollback-required transition without this path's intent belongs to another controller.
 const other=f.journal.begin(f.journal.read().revision,native,d('7')).pending.id;f.journal.advance(f.journal.read().revision,other,'rollback-required',d('6'));
 assert.equal(restartRollbackCandidate(f.file,managed.manifest_sha256),null);
}));

for(const boundary of ['provider-ready','state-ready','trial-ready'])test('restart cleanup removes only verified staging and owned local state at '+boundary,()=>fixture(async f=>{
 const id=await trial(f,boundary),obs=providerId(id);
 await assert.rejects(f.cleanup(id),/no committed restart rollback/);
 await f.run();const records=f.listing().filter(([n])=>n.endsWith('.json')&&n!=='worker-selection.json');
 let command=null;f.cleanupResult=c=>{command=c;return {exit_code:0,stdout:'RESTART-CLEANED\n',stderr:'',timed_out:false};};
 const result=await f.cleanup(id);assert.equal(result.id,id);
 // The remote plan names only recorded staging; units are stopped only after an idle, empty-cgroup check.
 const removed=[...command.matchAll(/for file in ([^;]+); do/g)].flatMap(m=>m[1].split(' '));
 assert(removed.every(p=>p.startsWith('/opt/couchroot-retirement-'+obs+'/')||p.startsWith('/opt/couchroot-worker-'+id+'/')),removed.join(' '));
 assert(!/rm -r|rm -f|kill /.test(command));assert.equal(boundary==='provider-ready',!command.includes('/opt/couchroot-worker-'+id+'/state/.jobs'));
 for(const n of ['retirement-launch.pending','state-install.pending','production-launch.pending','retirement-Pr0v1d','production-Pr0duc',id+'.restart-cleanup.pending'])assert(!fs.existsSync(f.dir+'/'+n),n);
 const after=new Map(f.listing());for(const [n,v] of records)assert.equal(after.get(n),v,'record retained: '+n);
 const r=inventoryRestart(f.file);assert.equal(r.action,'none',JSON.stringify(r));assert.equal(r.boundary,'settled');
 assert.deepEqual({...await f.cleanup(id)},{id,already_clean:true,receipt_sha256:result.receipt_sha256});
}));
test('incomplete or unsupported restart cleanup keeps its intent and every ownership marker',()=>fixture(async f=>{
 const id=await trial(f,'trial-ready'),obs=providerId(id);await f.run();
 f.write(obs+'.observer.json',{schema:1});await assert.rejects(f.cleanup(id),e=>e.outcome==='rejected'&&/external observer remnants/.test(e.message));fs.unlinkSync(f.dir+'/'+obs+'.observer.json');
 f.units.set('couchroot-worker-'+id+'.service',{LoadState:'loaded',ActiveState:'active',SubState:'running',MainPID:'4400',ControlGroup:'/system.slice/couchroot-worker-'+id+'.service',Procs:'1'});
 await assert.rejects(f.cleanup(id),/still has processes/);assert(!fs.existsSync(f.dir+'/'+id+'.restart-cleanup.pending'));f.units.clear();
 f.cleanupResult=()=>({exit_code:1,stdout:'',stderr:'',timed_out:false});
 await assert.rejects(f.cleanup(id),e=>e.outcome==='unknown'&&/did not match its records \(exit 1/.test(e.cause.message));
 for(const n of [id+'.restart-cleanup.pending','retirement-launch.pending','production-launch.pending','retirement-Pr0v1d'])assert(fs.existsSync(f.dir+'/'+n),n);
 assert.equal(inventoryRestart(f.file).action,'pending-reconciliation');
 f.cleanupResult=null;await f.cleanup(id);assert(!fs.existsSync(f.dir+'/'+id+'.restart-cleanup.pending'));assert.equal(inventoryRestart(f.file).action,'none');
}));
test('generated cleanup plans are valid shell for every evidence shape',{skip:process.platform==='win32'},()=>fixture(async f=>{
 const {execFileSync}=require('node:child_process');
 for(const boundary of ['provider-submitted','source-stopped','state-ready','trial-ready']){
  const id=await trial(f,boundary),command=cleanupPlan(loadEvidence(f.dir,id,null));
  execFileSync('/bin/sh',['-n'],{input:command});
  for(const n of fs.readdirSync(f.dir))if(n!=='worker-selection.json')fs.rmSync(f.dir+'/'+n,{recursive:true});
  fs.rmSync(f.file);f.journal.initialize(managed);
 }
}));
