'use strict';
// Final live evidence before local activation cleanup. Does not release admission.
const fs=require('fs'),path=require('path');
const {hash}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {retireProduction}=require('./production-retirement');
const {managedRuntimeCommand,validateManagedLaunch}=require('./managed-readiness');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const {processIdentities,returnProviderSource}=require('./worker-processes');
const {selectionStatus}=require('./worker-selection');
const {validateTeardownRecord}=require('./retirement-teardown');
const {providerAbsentCommand}=require('./production-activation');
const {inspectRetirementUnit,inspectManagedUnit}=require('./observer-unit');
function check(ok){if(!ok)throw Error('Managed completion evidence unavailable');}
function absent(p){try{fs.lstatSync(p);throw Error('Unresolved completion entry');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function verifyManagedCompletion({managed,retired,journalDirectory,selectionFile,execute,confirmManaged}){
 managed=JSON.parse(JSON.stringify(managed));retired=JSON.parse(JSON.stringify(retired));
 check(managed.phase==='ready');const {worker_identity,launcher_sha256,unit_started_monotonic,...launch}=managed;validateManagedLaunch({...launch,phase:'submitted'});validateTeardownRecord(retired);
 check(retired.phase==='complete'&&retired.boot_id===managed.boot_id&&typeof execute==='function'&&typeof confirmManaged==='function'&&typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&path.dirname(selectionFile)===journalDirectory);
 check(path.dirname(path.dirname(retired.token_file))===journalDirectory);
 const directory=fs.lstatSync(journalDirectory);check(privateDirectory(directory));
 const saved=path.join(journalDirectory,managed.id+'.managed-restore-input.json'),inputText=privateRead(saved,524288),inputs=JSON.parse(inputText);
 check(returnProviderSource(retired.source,inputs.record)&&retired.manifest_sha256===inputs.record.manifest_sha256&&retired.device===inputs.record.device&&retired.id!==managed.id&&retired.id!==managed.origin_id);
 check([retired.source,retired.provider_identity,managed.source].every(s=>s.worker_id!==worker_identity.worker_id&&Object.values(s.processes).every(p=>!p||p.pid!==worker_identity.processes.worker.pid)));
 const providerFile=path.join(journalDirectory,retired.id+'.retirement.json'),cleanupFile=path.join(journalDirectory,managed.origin_id+'.production-retirement.json'),cleanupText=privateRead(cleanupFile,16384),selected=JSON.stringify(selectionStatus(selectionFile));
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===selected&&privateRead(saved,524288)===inputText&&privateRead(providerFile,16384)===JSON.stringify(retired)&&privateRead(cleanupFile,16384)===cleanupText&&privateRead(path.join(journalDirectory,managed.id+'.managed-launch.json'),16384)===JSON.stringify(managed));
  for(const name of ['retirement-launch.pending',retired.id+'.retirement.json.shutdown.pending',retired.id+'.retirement.json.cleanup.pending',retired.id+'.retirement.json.finish.pending',managed.origin_id+'.production-retirement.json.pending',managed.id+'.managed-launch.json.readiness.pending'])absent(path.join(journalDirectory,name));absent(path.dirname(retired.token_file));};
 const started=process.hrtime(),current=()=>{const t=process.hrtime(started);check(t[0]*1000+t[1]/1000000<30000);owned();};
 const confirm=async()=>{current();const info=await confirmManaged();current();validateReadiness(info,{implementation:'managed',bootId:managed.boot_id,launcherSha256:launcher_sha256});const identity=processIdentities(info,worker_identity.processes.worker.pid),r=validateResourceInventory(info);check(JSON.stringify(identity)===JSON.stringify(worker_identity)&&!r.jobs.length&&!r.helpers.length&&!r.transfers.length);return identity;};
 const run=async(c,t)=>{current();const result=await execute(c,t);current();return result;};
 await confirm();
 const production=await retireProduction({managed,journalDirectory,selectionFile,execute:run,confirmManaged:confirm,verifyOnly:true});current();
 const unit=await inspectRetirementUnit({unit:retired.unit,bootId:managed.boot_id,execute:run,allowMissing:true});
 check(unit.active_state==='inactive'&&unit.sub_state==='dead'&&unit.main_pid===0&&(unit.load_state==='not-found'||unit.started_monotonic===retired.unit_started_monotonic&&unit.exec_code===1&&unit.exec_status===0));
 const result=await run(providerAbsentCommand(retired),5000);check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout==='PROVIDER-ABSENT\n');
 const managedUnit=await inspectManagedUnit({unit:managed.unit,bootId:managed.boot_id,execute:run});
 check(managedUnit.active_state==='active'&&managedUnit.sub_state==='running'&&managedUnit.main_pid===worker_identity.processes.worker.pid&&managedUnit.started_monotonic===unit_started_monotonic&&managedUnit.exec_code===0&&managedUnit.exec_status===0);
 const runtime=await run(managedRuntimeCommand({...launch,phase:'submitted'},worker_identity,inputs,launcher_sha256),25000);check(runtime&&runtime.exit_code===0&&!runtime.timed_out&&!runtime.stderr&&runtime.stdout==='RESTORE-READY\nMANAGED-VERIFIED\n');
 await confirm();check(JSON.stringify(await inspectManagedUnit({unit:managed.unit,bootId:managed.boot_id,execute:run}))===JSON.stringify(managedUnit));current();
 return Object.freeze({schema:1,id:managed.id,phase:'verified',managed_readiness_sha256:hash(JSON.stringify(managed)),production_retirement_sha256:production.receipt_sha256,provider_retirement_sha256:hash(JSON.stringify(retired)),worker_identity});
}
module.exports={verifyManagedCompletion};
