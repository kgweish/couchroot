'use strict';
// Return an adopted native trial to its original managed version under one hold.
const fs=require('fs'),path=require('path');
const {hash}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {runtimeRead,nativeReadiness}=require('./native-runtime');
const {SelectionJournal,managedVersion}=require('./worker-selection');
const {validateRuntimeLaunch}=require('./production-readiness');
const {openManagedSession}=require('./managed-session');
const {planNativeSnapshot}=require('./native-retained-state');
const {validateSnapshot}=require('./retained-install');
function check(ok){if(!ok)throw Error('Managed return prerequisites unavailable');}
// Without a live provider (native already active), openRetirement launches one
// through the native worker only after the return transition is journaled.
function createManagedReturn({hold,retirement,openRetirement,record,payload,selectionFile,runtimeSha256,requestId}){
 record=JSON.parse(JSON.stringify(record));
 let entered=false,closed=false,begun=false,phase='idle',failedPhase=null,id=null,session=null,resuming=false,continueReturn=null;
 const status=()=>({phase,failed_phase:failedPhase,transaction_id:id,origin_id:record.id});
 const move=next=>{check(!closed);phase=next;};
 const ownsProvider=!retirement,usable=r=>!!r&&!!r.provider&&['snapshotNativeJobs','restoreManagedState','acceptManagedRestore','launchManaged','verifyManaged'].every(k=>typeof r.provider[k]==='function');
 const closeTransport=()=>{closed=true;if(session)session.closeTransport();if(ownsProvider&&retirement)retirement.closeTransport();};
 async function run(){
  check(!entered);entered=true;
  try{
   move('preflight');check(typeof runtimeSha256==='string'&&/^[a-f0-9]{64}$/.test(runtimeSha256)&&typeof selectionFile==='string'&&path.isAbsolute(selectionFile));
   check(hold&&['snapshotNative','shutdownNative','adoptManaged','completeManaged'].every(k=>typeof hold[k]==='function')&&(ownsProvider?typeof openRetirement==='function':usable(retirement)));
   const {worker_identity,unit_started_monotonic,...launch}=record;check(record.phase==='ready'&&worker_identity&&unit_started_monotonic);validateRuntimeLaunch({...launch,phase:'submitted'});
   const directory=path.dirname(selectionFile),st=fs.lstatSync(directory);check(privateDirectory(st));
   for(const name of ['managed-restore.pending','managed-launch.pending'])try{fs.lstatSync(path.join(directory,name));throw Error('Managed return requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}
   const journal=new SelectionJournal(selectionFile),initial=journal.read(),h=initial&&initial.history[initial.history.length-1],managed=managedVersion(payload);
   check(initial&&!initial.pending&&initial.selected.implementation==='native-prototype'&&initial.selected.manifest_sha256===record.manifest_sha256&&h&&h.id===record.id&&h.outcome==='committed'&&h.from.implementation==='managed'&&h.from.manifest_sha256===managed&&h.readiness_sha256===nativeReadiness(directory,record)&&h.state_sha256===record.state_receipt_sha256);
   const inputs={record,installation:JSON.parse(privateRead(path.join(directory,record.id+'.state-install.json'),262144)),baseline:JSON.parse(privateRead(path.join(directory,record.id+'.retained-snapshot.json'),262144))};
   planNativeSnapshot(record,inputs.installation);validateSnapshot(inputs.baseline);check(inputs.baseline.sha256===inputs.installation.snapshot_sha256&&JSON.stringify(inputs.baseline.source)===JSON.stringify(record.source));
   const saved=[[record.id+'.production.json',JSON.stringify(record)],[record.id+'.state-install.json',JSON.stringify(inputs.installation)],[record.id+'.retained-snapshot.json',JSON.stringify(inputs.baseline)]];
   const owned=()=>{check(!closed);for(const [name,text] of saved)check(runtimeRead(path.join(directory,name),262144)===text);};owned();
   move('draining');const inventory=await hold.snapshotNative();owned();
   check(JSON.stringify({boot_id:inventory.boot_id,worker_id:inventory.worker_id,processes:inventory.processes})===JSON.stringify(worker_identity));
   const r=inventory.resources;check(r&&!r.transfers.length&&!r.helpers.length&&r.jobs.every(j=>j.monitor_finished&&['completed','cancelled','timed_out','interrupted'].includes(j.state)));
   check(JSON.stringify(journal.read())===JSON.stringify(initial));begun=true;
   const transition=journal.begin(initial.revision,{implementation:'managed',manifest_sha256:managed},hash(JSON.stringify(inventory)));id=transition.pending.id;
   if(requestId){check(/^[-a-zA-Z0-9]{16,64}$/.test(requestId));require('./policy').atomic(path.join(directory,id+'.return-request.json'),{schema:1,id,origin_id:record.id,request_id:requestId,runtime_sha256:runtimeSha256});}
   continueReturn=async stopped=>{owned();check(stopped.phase==='stopped'&&stopped.id===id&&stopped.origin_id===record.id&&stopped.inventory_sha256===transition.pending.quiescence_sha256);
   const provider=retirement.provider;move('restoring-state');await provider.snapshotNativeJobs(inputs);owned();const restored=await provider.restoreManagedState({journalDirectory:directory,selectionFile});owned();check(restored.phase==='restored'&&restored.transition_id===id&&restored.id===record.id);
   const accepted=await provider.acceptManagedRestore({journalDirectory:directory,selectionFile});owned();check(accepted.pending&&accepted.pending.id===id&&accepted.pending.phase==='state-ready'&&accepted.pending.state_sha256===restored.receipt_sha256);
   move('managed-session');session=await openManagedSession({id,payload,journalDirectory:directory,selectionFile,provider,managedSha256:managed,runtimeSha256});owned();
   const trial=journal.read();check(trial.pending&&trial.pending.id===id&&trial.pending.phase==='trial-ready'&&trial.pending.readiness_sha256===session.readiness_sha256&&trial.pending.state_sha256===restored.receipt_sha256);
   move('committing');journal.commit(trial.revision,id);
   move('adopting');await hold.adoptManaged(session);owned();
   move('activating');const active=await hold.completeManaged(retirement);check(active.transaction_id===id&&active.admission_held===false);
   move('active');return {...active,selected_implementation:'managed',native_origin_id:record.id};
   };
   if(ownsProvider){move('provider');retirement=await openRetirement(id);owned();check(usable(retirement));}
   move('stopping-native');return await continueReturn(await hold.shutdownNative(id,retirement));
  }catch(cause){if(closed)closeTransport();failedPhase=phase;phase=begun?'reconciliation-required':'rejected';throw Object.assign(Error('Managed return requires reconciliation'),{outcome:begun?'unknown':'rejected',transition_started:begun,cause});}
 }
 async function resumeActivation(){
  check(!closed&&!resuming&&phase==='reconciliation-required'&&((failedPhase==='activating'&&session)||(failedPhase==='stopping-native'&&continueReturn&&typeof hold.resumeNativeExit==='function')));resuming=true;
  try{
   if(failedPhase==='stopping-native'){move('stopping-native');return await continueReturn(await hold.resumeNativeExit(id,retirement));}
   move('resuming-activation');const active=await hold.completeManaged(retirement,{resume:true});check(active.transaction_id===id&&active.admission_held===false);move('active');return {...active,selected_implementation:'managed',native_origin_id:record.id};}
  catch(cause){if(phase!=='resuming-activation')failedPhase=phase;phase='reconciliation-required';throw Object.assign(Error('Managed return recovery requires reconciliation'),{outcome:'unknown',cause});}
  finally{resuming=false;}
 }
 return Object.freeze({run,resumeActivation,status,closeTransport});
}
module.exports={createManagedReturn};
