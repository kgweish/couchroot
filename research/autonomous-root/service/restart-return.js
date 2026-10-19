'use strict';
// Resume a pending native -> managed operation through a fresh held bootstrap.
// Observe old units before restoring; reuse the original state receipt and ID.
const fs=require('fs'),path=require('path');
const {privateRead,privateDirectory}=require('./private-state');
const {hash,atomic}=require('./policy');
const {SelectionJournal,selectionStatus}=require('./worker-selection');
const {readRuntime}=require('./native-runtime');
const {providerId}=require('./restart-inventory');
const {observeCommand,parseObservation}=require('./restart-rollback');
const {cleanupPlan}=require('./restart-cleanup');
const {recoverReturnNative,recoverReturnProvider}=require('./native-return-recovery');
const {restoreManagedJobs,acceptManagedRestore}=require('./managed-restore');
const {planManagedRestore}=require('./managed-restore-plan');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const {processIdentities,bootGuard}=require('./worker-processes');
const {validateManagedLaunch}=require('./managed-readiness');
function check(v){if(!v)throw Error('Restart managed return evidence unavailable');}
function exists(p){try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function json(p,max=524288){return JSON.parse(privateRead(p,max));}
function restartReturnCandidate(selectionFile,managedSha256){
 const s=selectionStatus(selectionFile),p=s.pending,h=s.history&&s.history.slice(-1)[0],directory=path.dirname(selectionFile);
 if(s.phase==='inspection-required')return null;
 if(p&&p.from.implementation==='native-prototype'&&p.to.implementation==='managed'&&p.to.manifest_sha256===managedSha256&&['prepared','state-ready','trial-ready'].includes(p.phase))return {id:p.id,origin_id:h.id,phase:p.phase};
 if(!p&&h&&h.outcome==='committed'&&h.to.implementation==='managed'&&exists(path.join(directory,h.id+'.restart-return.json'))){const r=json(path.join(directory,h.id+'.restart-return.json'));if(r.phase!=='complete')return {id:h.id,origin_id:r.origin_id,phase:'committed'};}
 return null;
}
async function reconcileRestartReturn({selectionFile,managedSha256,executor}){
 const c=restartReturnCandidate(selectionFile,managedSha256);check(c);const directory=path.dirname(selectionFile),journal=new SelectionJournal(selectionFile),{id,origin_id}=c;
 check(privateDirectory(fs.lstatSync(directory)));const binding=readRuntime(directory,origin_id),record=binding.record;
 const h=journal.read().history.find(h=>h.id===origin_id);check(h&&h.outcome==='committed'&&h.readiness_sha256===binding.readiness_sha256&&h.from.manifest_sha256===managedSha256);
 const installation=json(path.join(directory,origin_id+'.state-install.json')),baseline=json(path.join(directory,origin_id+'.retained-snapshot.json'));
 const rid=providerId(id),providerFile=path.join(directory,rid+'.retirement.json'),provider=exists(providerFile)?json(providerFile):null,oldManagedFile=path.join(directory,id+'.managed-launch.json'),oldManaged=exists(oldManagedFile)?json(oldManagedFile):null;
 if(provider)check(provider.id===rid&&provider.boot_id===record.boot_id&&provider.unit==='couchroot-retirement-'+rid+'.service'&&JSON.stringify(provider.source)===JSON.stringify(record.worker_identity)&&provider.manifest_sha256===record.manifest_sha256);
 if(oldManaged){const {worker_identity,unit_started_monotonic,launcher_sha256,...launch}=oldManaged;validateManagedLaunch({...launch,phase:'submitted'});check(oldManaged.id===id&&oldManaged.origin_id===origin_id&&oldManaged.manifest_sha256===managedSha256&&JSON.stringify(oldManaged.source)===JSON.stringify(record.worker_identity));}
 const known=Object.entries(record.worker_identity.processes);for(const r of [provider&&provider.provider_identity,oldManaged&&oldManaged.worker_identity])if(r){check(r.boot_id===record.boot_id);for(const [k,p] of Object.entries(r.processes))if(p)known.push([k,p]);}
 const units=[record.unit,'couchroot-retirement-'+rid+'.service',...(oldManaged?[oldManaged.unit]:[])],e={boot_id:record.boot_id,source:record.source,known,units};
 let bootId=null;
 const confirm=async()=>{const info=await executor.status(),observed=bootId===null?info.boot_id:bootId;bootGuard(observed);validateReadiness(info,{implementation:'managed',bootId:observed});const r=validateResourceInventory(info),own=processIdentities(info,executor.pid);check(!r.jobs.length&&!r.transfers.length&&!r.helpers.length&&(own.boot_id!==record.boot_id||!known.some(([,p])=>p.pid===executor.pid)));return own;};
 const own=await confirm();bootId=own.boot_id;const crossed=bootId!==record.boot_id,observation={bootId,knownBootId:record.boot_id};
 const run=async(command,timeout)=>{check(JSON.stringify(await confirm())===JSON.stringify(own));const result=await executor.execute(command,timeout);check(JSON.stringify(await confirm())===JSON.stringify(own));return result;};
 const verify=async(command,expected)=>{const r=await run(command,25000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout===expected);};
 const observe=async()=>{const r=await run(observeCommand(e,observation),10000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr);const observed=parseObservation(r.stdout,units);if(crossed)check(Object.values(observed).every(v=>v==='not-found'));};await observe();
 if(!provider)await verify('set -eu\ntest ! -e /opt/couchroot-retirement-'+rid+'; test ! -L /opt/couchroot-retirement-'+rid+'\n','');
 const inputFile=path.join(directory,id+'.managed-restore-input.json'),receiptFile=path.join(directory,id+'.restart-return.json');
 if(provider)await recoverReturnProvider({directory,id,provider,execute:run,bootId});
 let inputs;
 if(exists(inputFile)){inputs=json(inputFile);check(JSON.stringify(inputs.record)===JSON.stringify(record)&&JSON.stringify(inputs.installation)===JSON.stringify(installation)&&JSON.stringify(inputs.baseline)===JSON.stringify(baseline));}
 else inputs={record,installation,baseline,snapshot:await recoverReturnNative({directory,id,record,installation,execute:run,bootId})};
 const plan=planManagedRestore(inputs,{bootId});let state=journal.read();
 if(state.pending&&state.pending.phase==='prepared'){
  const restored=await restoreManagedJobs({...inputs,journalDirectory:directory,selectionFile,execute:run,bootId,resume:exists(inputFile)});
  await acceptManagedRestore({transitionId:id,receiptSha256:restored.receipt_sha256,journalDirectory:directory,selectionFile,execute:run,bootId});state=journal.read();
 }
 await verify(plan.verify,'RESTORE-READY\n');
 // The acquired managed worker has no live jobs. Saved job.status reads the
 // restored directory afresh, so it can become the selected worker directly.
 for(const item of inputs.snapshot.records){const saved=JSON.parse(Buffer.from(item.base64,'base64')),actual=await executor.operation({op:'job.status',id:saved.id});check(JSON.stringify(actual.record)===JSON.stringify(saved));}
 const previous=exists(receiptFile)?json(receiptFile):null;if(previous)check(previous.id===id&&previous.origin_id===origin_id&&previous.input_sha256===hash(JSON.stringify(inputs)));
 const readiness={schema:1,id,origin_id,phase:'ready',input_sha256:hash(JSON.stringify(inputs)),worker_identity:await confirm(),managed_sha256:managedSha256};
 // Keep each replacement readiness receipt, including the one bound by commit.
 const readinessFile=path.join(directory,id+'.restart-return-'+own.worker_id+'.json');atomic(readinessFile,readiness);atomic(receiptFile,readiness);
 state=journal.read();
 if(state.pending){check(state.pending.id===id&&state.pending.state_sha256===hash(privateRead(path.join(directory,id+'.managed-restore.json'),16384)));if(state.pending.phase==='state-ready')state=journal.advance(state.revision,id,'trial-ready',hash(JSON.stringify(readiness)));else state=journal.rebindTrial(state.revision,id,state.pending.readiness_sha256,hash(JSON.stringify(readiness)));await observe();await verify(plan.verify,'RESTORE-READY\n');await confirm();state=journal.commit(state.revision,id);}
 check(!state.pending&&state.selected.implementation==='managed'&&state.history.slice(-1)[0].id===id);atomic(receiptFile,{...readiness,phase:'committed'});
 // Cleanup is evidence-driven and resumable: optional entries must match their
 // recorded hashes, and unknown entries prevent removal.
 const p=provider||{directory:'/opt/couchroot-retirement-'+rid,scope:'/opt/couchroot-retirement-'+rid+'/state',worker_sha256:record.worker_sha256,launcher_sha256:record.launcher_sha256,token_sha256:record.token_sha256};
 await observe();await verify(plan.verify,'RESTORE-READY\n');
 await verify(cleanupPlan({...e,id:origin_id,provider_id:rid,provider:p,production:record,installation,snapshot:inputs.snapshot},{...observation,requireAbsentUnits:crossed}),'RESTART-CLEANED\n');
 // Original launch receipts remain audit evidence. Token directories and
 // markers are removed only when their owner and contents match.
 for(const r of [provider,oldManaged].filter(Boolean)){
  const td=path.dirname(r.token_file);check(path.dirname(td)===directory&&/^(retirement|managed)-[A-Za-z0-9]{6}$/.test(path.basename(td)));
  if(exists(td)){check(privateDirectory(fs.lstatSync(td))&&fs.readdirSync(td).every(n=>n==='token'));if(exists(r.token_file)){check(hash(privateRead(r.token_file,64))===r.token_sha256);fs.unlinkSync(r.token_file);}fs.rmdirSync(td);}
 }
 for(const [name,owner] of [['retirement-launch.pending',rid],['managed-restore.pending',id],['managed-launch.pending',id]]){const f=path.join(directory,name);if(exists(f)){check(privateRead(f,64)===owner+'\n');fs.unlinkSync(f);}}
 const result={...readiness,phase:'complete',retained_managed_staging:oldManaged?[oldManaged.directory,oldManaged.stage]:[]};atomic(receiptFile,result);
 return {...result,transaction_id:id,native_origin_id:origin_id,selected_implementation:'managed',admission_held:false};
}
module.exports={restartReturnCandidate,reconcileRestartReturn};
