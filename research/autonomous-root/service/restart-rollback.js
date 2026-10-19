'use strict';
// After a service restart or settled live failure, return a forward trial to its
// unchanged managed state. Native never had public admission before commit, so
// the managed job directory remains authoritative. A freshly acquired managed
// worker, held from public admission, is used only to verify that every old
// provider/native/source process is gone; this module never launches, signals
// or deletes remotely. Owned staging and launch markers remain for explicit
// cleanup and continue to block another handoff.
const fs=require('fs'),path=require('path');
const {privateRead,privateDirectory}=require('./private-state');
const {SelectionJournal}=require('./worker-selection');
const {hash,atomic}=require('./policy');
const {providerId}=require('./restart-inventory');
const {validateSnapshot}=require('./retained-install');
const {snapshotManagedJobs,sourceExitGuard}=require('./retained-state');
const {processIdentities,processAbsenceGuard}=require('./worker-processes');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const ID=/^[a-f0-9]{32}$/,BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,INTENT='.restart-rollback.pending',RECEIPT='.restart-rollback.json';
const FORWARD=['prepared','state-ready','trial-ready'],RESUME=['rollback-required','rollback-state-ready'],BLOCKING=['managed-restore.pending','managed-launch.pending'];
// A forward trial never retires its provider before commit; later phases belong to other paths.
const LAUNCHED=['submitting','submitted','unknown','ready'];
function check(ok,detail){if(!ok)throw Object.assign(Error('Restart rollback unavailable'+(detail?': '+detail:'')),{outcome:'rejected'});}
function present(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function readJson(file){return JSON.parse(privateRead(file,262144));}
function identity(p){check(p&&Number.isInteger(p.pid)&&p.pid>1&&typeof p.start_ticks==='string'&&/^[1-9][0-9]{0,19}$/.test(p.start_ticks),'malformed process identity');return {pid:p.pid,start_ticks:p.start_ticks};}
function sync(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
// Returns the transaction this module may reconcile, or null.
function restartRollbackCandidate(selectionFile,managedSha256){
 const directory=path.dirname(selectionFile);
 if(!privateDirectory(fs.lstatSync(directory))||present(selectionFile+'.writer')||BLOCKING.some(n=>present(path.join(directory,n))))return null;
 let state;try{state=new SelectionJournal(selectionFile).read();}catch(_){return null;}
 const p=state&&state.pending;
 if(state&&!p){
  // Only the intent can outlive a committed rollback; finish removing it.
  const h=state.history[state.history.length-1];
  return h&&h.outcome==='rolled-back'&&ID.test(h.id)&&present(path.join(directory,h.id+INTENT))?{id:h.id,phase:'rolled-back',resuming:true}:null;
 }
 if(!p||!ID.test(p.id)||p.from.implementation!=='managed'||p.to.implementation!=='native-prototype'||p.from.manifest_sha256!==managedSha256)return null;
 const intent=present(path.join(directory,p.id+INTENT));
 // Acquire only when the durable evidence binds every recorded identity; a
 // launch without its record stays blocked with the inventory diagnostics.
 if(FORWARD.includes(p.phase)){if(!intent)try{loadEvidence(directory,p.id,p.phase);}catch(_){return null;}return {id:p.id,phase:p.phase,resuming:intent};}
 if(RESUME.includes(p.phase)&&intent)return {id:p.id,phase:p.phase,resuming:true};
 return null;
}
// Durable evidence for one forward transaction. Every file naming the
// transaction or its provider must be one this path understands.
function loadEvidence(directory,id,phase){
 const obs=providerId(id);
 const allowed=new Set([id+'.retained-snapshot.json',id+'.state-install.json',id+'.production.json',id+'.production.json.readiness.pending',obs+'.retirement.json',obs+'.retirement.json.readiness.pending',obs+'.observer.json',id+INTENT,id+RECEIPT,id+'.restart-cleanup.pending',id+'.restart-cleanup.json']);
 for(const name of fs.readdirSync(directory))if(name.includes(id)||name.includes(obs))check(allowed.has(name),'unexpected transaction file '+name);
 for(const [name,owner] of [['retirement-launch.pending',obs],['observer-launch.pending',obs],['state-install.pending',id],['production-launch.pending',id]]){const file=path.join(directory,name);if(present(file))check(privateRead(file,64)===owner+'\n','marker '+name+' names another transaction');}
 const providerFile=path.join(directory,obs+'.retirement.json');check(present(providerFile),'provider record missing; source identity unknown');
 const provider=readJson(providerFile),source=provider&&provider.source;
 check(provider.id===obs&&LAUNCHED.includes(provider.phase)&&provider.unit==='couchroot-retirement-'+obs+'.service'&&BOOT.test(provider.boot_id),'provider record not reconcilable at phase '+String(provider&&provider.phase).slice(0,24));
 sourceExitGuard(source);check(source.boot_id===provider.boot_id,'provider boot differs from source');
 const known=[['source',source.processes.worker]];
 if(provider.phase==='ready'){const p=provider.provider_identity;check(p&&p.boot_id===provider.boot_id&&p.processes&&p.processes.worker,'provider identity missing');for(const k of ['worker','guardian'])if(p.processes[k])known.push(['provider-'+k,identity(p.processes[k])]);}
 let snapshot=null,installation=null,production=null;
 const snapshotFile=path.join(directory,id+'.retained-snapshot.json');
 if(present(snapshotFile)){snapshot=validateSnapshot(readJson(snapshotFile));check(JSON.stringify(snapshot.source)===JSON.stringify(source),'snapshot source differs');}
 const installFile=path.join(directory,id+'.state-install.json');
 if(present(installFile)){installation=readJson(installFile);check(snapshot&&installation.id===id&&['pending','ready'].includes(installation.phase)&&installation.snapshot_sha256===snapshot.sha256&&installation.directory==='/opt/couchroot-worker-'+id,'state installation record inconsistent');}
 const productionFile=path.join(directory,id+'.production.json');
 if(present(productionFile)){
  production=readJson(productionFile);
  check(installation&&production.id===id&&LAUNCHED.includes(production.phase)&&production.unit==='couchroot-worker-'+id+'.service'&&production.boot_id===provider.boot_id&&JSON.stringify(production.source)===JSON.stringify(source),'production record inconsistent');
  if(production.phase==='ready'){const p=production.worker_identity;check(p&&p.boot_id===provider.boot_id&&p.processes&&p.processes.worker,'production identity missing');for(const k of ['worker','guardian'])if(p.processes[k])known.push(['native-'+k,identity(p.processes[k])]);}
 }
 if(['state-ready','trial-ready'].includes(phase))check(snapshot&&installation&&installation.phase==='ready','accepted state lacks its receipt');
 if(phase==='trial-ready')check(production&&production.phase==='ready','trial readiness lacks its production record');
 const units=['couchroot-retirement-'+obs+'.service','couchroot-observer-'+obs+'.service','couchroot-worker-'+id+'.service'];
 return {id,provider_id:obs,boot_id:provider.boot_id,source,snapshot,known,units,provider_phase:provider.phase,production_phase:production?production.phase:null,provider,production,installation};
}
// Read-only: boot, recorded process identities and unit cgroups. It never stops,
// signals or removes; any running remnant fails the command.
function observeCommand(e,{bootId=e.boot_id===undefined?e.source.boot_id:e.boot_id,knownBootId=e.boot_id===undefined?e.source.boot_id:e.boot_id}={}){
 const gone=e.known.map(([,p])=>processAbsenceGuard(p,knownBootId,bootId)).join('');
 return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+sourceExitGuard(e.source,bootId)+gone+
  'for unit in '+e.units.join(' ')+'; do\nstate=$(systemctl show -p LoadState -p ActiveState -p SubState -p MainPID -p ControlGroup "$unit")\n'+
  'cg=$(printf "%s\\n" "$state" | sed -n "s/^ControlGroup=//p")\nprocs=absent\n'+
  'case "$cg" in "") ;; /system.slice/couchroot-*.service) if test -e "/sys/fs/cgroup/systemd$cg/cgroup.procs"; then procs=$(wc -l < "/sys/fs/cgroup/systemd$cg/cgroup.procs"); fi;; *) exit 1;; esac\n'+
  'printf "Unit=%s\\n%s\\nProcs=%s\\n" "$unit" "$state" "$procs"\ndone\n'+gone+sourceExitGuard(e.source,bootId)+'printf "RESTART-ROLLBACK-OBSERVED\\n"\n';
}
function parseObservation(stdout,units){
 check(typeof stdout==='string'&&stdout.length<4096&&stdout.endsWith('RESTART-ROLLBACK-OBSERVED\n'),'remnant observation failed');
 const blocks=stdout.slice(0,-26).split(/^(?=Unit=)/m).filter(Boolean),states={};check(blocks.length===units.length,'unit observation incomplete');
 blocks.forEach((block,i)=>{
  const v=Object.create(null);for(const line of block.trimEnd().split('\n')){const at=line.indexOf('=');check(at>0&&!(line.slice(0,at) in v),'malformed unit observation');v[line.slice(0,at)]=line.slice(at+1);}
  check(Object.keys(v).sort().join('|')==='ActiveState|ControlGroup|LoadState|MainPID|Procs|SubState|Unit'&&v.Unit===units[i],'unit observation incomplete');
  const settled=v.LoadState==='not-found'||v.LoadState==='loaded',idle=['inactive','failed'].includes(v.ActiveState)||(v.ActiveState==='active'&&v.SubState==='exited');
  check(settled&&idle&&v.MainPID==='0'&&['absent','0'].includes(v.Procs),v.Unit+' still has processes or is changing state');
  states[v.Unit]=v.LoadState==='not-found'?'not-found':v.ActiveState+'/'+v.SubState;
 });
 return states;
}
async function reconcileRestartRollback({selectionFile,managedSha256,executor}){
 const directory=path.dirname(selectionFile),candidate=restartRollbackCandidate(selectionFile,managedSha256);
 if(!candidate){
  // Report why a pending forward transition is not reconcilable.
  let p=null;try{p=new SelectionJournal(selectionFile).read().pending;}catch(_){}
  if(p&&FORWARD.includes(p.phase)&&p.from.manifest_sha256===managedSha256)loadEvidence(directory,p.id,p.phase);
  check(false,'no reconcilable transition');
 }check(executor&&typeof executor.status==='function'&&typeof executor.execute==='function'&&Number.isInteger(executor.pid),'held executor required');
 const {id}=candidate,intent=path.join(directory,id+INTENT),receiptFile=path.join(directory,id+RECEIPT),journal=new SelectionJournal(selectionFile);
 if(candidate.phase==='rolled-back'){
  const h=journal.read().history.slice(-1)[0];check(h.id===id&&hash(privateRead(receiptFile,65536))===h.state_sha256&&privateRead(intent,64)===id+'\n','committed rollback evidence changed');
  fs.unlinkSync(intent);sync(directory);return Object.freeze({id,finalized:true});
 }
 let state=journal.read();const begin=JSON.stringify(state);
 const evidence=loadEvidence(directory,id,state.pending.phase);
 // The executor must be a different, freshly authenticated managed worker on the same boot.
 const confirm=async()=>{
  const info=await executor.status();validateReadiness(info,{implementation:'managed',bootId:evidence.boot_id});
  const own=processIdentities(info,executor.pid),r=validateResourceInventory(info);
  check(!r.jobs.length&&!r.transfers.length&&!r.helpers.length,'executor owns resources');
  check(own.worker_id!==evidence.source.worker_id&&!evidence.known.some(([,p])=>p.pid===own.processes.worker.pid&&p.start_ticks===own.processes.worker.start_ticks),'executor is a recorded process');
  return {own,launcher_sha256:info.app_launcher.sha256};
 };
 const first=await confirm();
 const execute=async(command,timeout)=>{const r=await executor.execute(command,timeout);check(JSON.stringify((await confirm()).own)===JSON.stringify(first.own),'executor changed');return r;};
 const observe=async()=>{const r=await execute(observeCommand(evidence),10000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr,'remnant observation failed');return parseObservation(r.stdout,evidence.units);};
 const units=await observe();
 const jobs=await snapshotManagedJobs({source:evidence.source,execute});
 if(evidence.snapshot)check(jobs.sha256===evidence.snapshot.sha256,'managed jobs changed after source stop');
 const receipt={schema:1,id,outcome:'restart-rollback',boot_id:evidence.boot_id,source:evidence.source,provider_id:evidence.provider_id,units:evidence.units,snapshot_sha256:evidence.snapshot?evidence.snapshot.sha256:null,managed_jobs_sha256:jobs.sha256},text=JSON.stringify(receipt);
 check(JSON.stringify(journal.read())===begin,'selection changed during verification');
 if(candidate.resuming)check(privateRead(intent,64)===id+'\n','intent changed');
 else{const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,id+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(directory);}
 try{
  if(FORWARD.includes(state.pending.phase))state=journal.advance(state.revision,id,'rollback-required',hash(JSON.stringify({executor:first.own,units})));
  if(state.pending.phase==='rollback-required'){atomic(receiptFile,receipt);sync(directory);state=journal.advance(state.revision,id,'rollback-state-ready',hash(text));}
  check(state.pending.phase==='rollback-state-ready'&&state.pending.state_sha256===hash(text)&&privateRead(receiptFile,65536)===text,'rollback receipt differs from verified evidence');
  // Observe again immediately before publishing the rollback.
  await observe();const last=await confirm();
  const readiness={schema:1,id,executor:last.own,launcher_sha256:last.launcher_sha256,receipt_sha256:hash(text)};
  state=journal.commitRollback(state.revision,id,hash(JSON.stringify(readiness)));
  fs.unlinkSync(intent);sync(directory);
  return Object.freeze({id,revision:state.revision,receipt_sha256:hash(text),readiness_sha256:hash(JSON.stringify(readiness)),units});
 }catch(cause){throw Object.assign(Error('Restart rollback requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={restartRollbackCandidate,reconcileRestartRollback,loadEvidence,observeCommand,parseObservation};
