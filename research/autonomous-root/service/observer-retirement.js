'use strict';
// Narrow adapter over an independently launched, authenticated native instance.
// Launch ownership, artifact staging and provider teardown belong to its caller.
const {processIdentities,returnProviderSource}=require('./worker-processes');
const {validateResourceInventory}=require('./worker-readiness');
const {snapshotManagedJobs}=require('./retained-state');
const {installRetainedState,acceptRetainedState}=require('./retained-install');
const {submitProduction}=require('./production-launch');
const {readyProduction}=require('./production-readiness');
const {snapshotNativeJobs}=require('./native-retained-state');
const {restoreManagedJobs,acceptManagedRestore}=require('./managed-restore');
const {submitManaged}=require('./managed-launch');
const {readyManaged}=require('./managed-readiness');
const {prepareProductionExit}=require('./production-exit');
const {inspectObserverUnit,retireObserverUnit}=require('./observer-unit');
const HEX=/^[a-f0-9]{64}$/,BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CAPS=['prototype-scoped-files-v1','worker-process-identity-v1','guardian-parent-identity-v1','resource-inventory-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1'];
function requireValue(ok,detail){if(!ok)throw Error('Independent observer retirement identity unavailable'+(detail?': '+detail:''));}
function binding(value){
 requireValue(value&&Object.keys(value).sort().join('|')==='bootId|sha256|unit'&&typeof value.unit==='string'&&value.unit.length===59&&/^couchroot-observer-[a-f0-9]{32}\.service$/.test(value.unit)&&typeof value.bootId==='string'&&value.bootId.length===36&&BOOT.test(value.bootId)&&typeof value.sha256==='string'&&value.sha256.length===64&&HEX.test(value.sha256));
 return Object.freeze({unit:value.unit,bootId:value.bootId,sha256:value.sha256});
}
function validateProvider(info,peer,expected,source){
 requireValue(peer&&peer.identity&&Number.isInteger(peer.identity.pid)&&peer.identity.pid>1&&['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)&&peer.identity.smack==='System');
 requireValue(info&&info.implementation==='native-prototype'&&info.boot_id===expected.bootId&&info.boot_id===source.boot_id&&info.worker_id!==source.worker_id&&info.lifetime_mode==='bounded'&&info.lifetime_seconds===300);
 requireValue(Array.isArray(info.capabilities)&&info.capabilities.length<=64&&info.capabilities.every(c=>typeof c==='string'&&c.length<=128)&&new Set(info.capabilities).size===info.capabilities.length&&CAPS.every(c=>info.capabilities.includes(c))&&!info.capabilities.includes('prototype-production-files-v1'));
 requireValue(info.app_launcher&&info.app_launcher.sha256===expected.launcherSha256&&info.app_launcher.independently_staged===true);
 const observed=processIdentities(info,peer.identity.pid),resources=validateResourceInventory(info);
 requireValue(observed.processes.guardian.pid>1);
 requireValue(!resources.jobs.length&&!resources.transfers.length&&!resources.helpers.length);
 const sourcePids=Object.values(source.processes).filter(Boolean).map(p=>p.pid);
 requireValue(Object.values(observed.processes).every(p=>!sourcePids.includes(p.pid)));
 return observed;
}
async function createObserverRetirement({channel,source,bound,launcherSha256}){
 const target=binding(bound);
 requireValue(typeof launcherSha256==='string'&&launcherSha256.length===64&&HEX.test(launcherSha256));
 requireValue(source&&source.processes&&source.processes.worker);
 // Validate the complete source identity as well; malformed exclusions cannot
 // accidentally admit a source worker or its guardian as the independent peer.
 const sourceIdentity=processIdentities({...source,capabilities:['worker-process-identity-v1'],...(source.processes.guardian?{implementation:'native-prototype',guardian_pid:source.processes.guardian.pid}:{})},source.processes.worker.pid);
 requireValue(channel&&typeof channel.operation==='function'&&typeof channel.execute==='function');
 const clock=()=>{const t=process.hrtime();return t[0]*1000+t[1]/1000000;};
 let expires=clock()+5000;
 const peer=channel._conn,expected={bootId:target.bootId,launcherSha256};
 let pinned=null,busy=false,failed=false,exitInterrupted=false,retirementEntered=false,retired=false,snapshotEntered=false,retainedSnapshot=null,installEntered=false,retainedInstallation=null,acceptEntered=false,stateAccepted=false,productionEntered=false,productionRecord=null,readinessEntered=false;
 // Bounded causes reach authenticated status; provider loss stays terminal.
 function current(){requireValue(!failed,'provider previously failed');requireValue(channel._conn===peer&&peer,'provider transport closed or replaced');requireValue(clock()<expires,'provider deadline expired');}
 async function verify(){
  try{current();const info=await channel.operation({op:'status'});current();
  const actual=validateProvider(info,peer,expected,sourceIdentity),serialized=JSON.stringify(actual);
  if(pinned===null)pinned=serialized;else requireValue(pinned===serialized);
  }catch(error){failed=true;throw error;}
 }
 await verify();
 function match(request){const actual=binding(request);requireValue(JSON.stringify(actual)===JSON.stringify(target));}
 async function execute(command,timeout){
  await verify();const remaining=Math.floor(expires-clock());requireValue(remaining>=100);const result=await channel.execute(command,Math.min(timeout,remaining));await verify();return result;
 }
 async function operation(request,mutating){
  match(request);requireValue(!busy&&!failed&&!exitInterrupted&&!retired&&(!mutating||!retirementEntered));
  busy=true;expires=clock()+(mutating?8000:5000);if(mutating)retirementEntered=true;
  try{
   const options={...target,execute};
   const result=await (mutating?retireObserverUnit(options):inspectObserverUnit(options));
   if(mutating)retired=true;
   return result;
  }catch(error){failed=true;throw error;}
  finally{busy=false;}
 }
 let nativeExitEntered=false,nativeExitRecord=null,nativeExited=false,rollbackEntered=false,rollbackInputs=null,restoreEntered=false,restored=null,restoreAccepted=false,restoreAcceptEntered=false,managedEntered=false,managedRecord=null,managedReadyEntered=false;
 async function rollbackOperation(timeout,body){
  requireValue(!busy&&!failed&&!exitInterrupted);busy=true;expires=clock()+timeout;
  try{await verify();const result=await body();await verify();return result;}
  catch(error){failed=true;throw error;}
  finally{busy=false;}
 }
 const copy=value=>JSON.parse(JSON.stringify(value));
 const identity=JSON.parse(pinned);Object.freeze(identity.processes.worker);Object.freeze(identity.processes.guardian);Object.freeze(identity.processes);Object.freeze(identity);
 return Object.freeze({
  identity,
  prepareNativeExit:async record=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!nativeExitEntered&&!rollbackEntered);
   const saved=copy(record);requireValue(saved&&returnProviderSource(sourceIdentity,saved)&&saved.boot_id===target.bootId);
   requireValue(saved.worker_identity&&saved.worker_identity.worker_id!==identity.worker_id&&Object.values(saved.worker_identity.processes).every(p=>p&&Object.values(identity.processes).every(q=>p.pid!==q.pid)));
   nativeExitEntered=true;
   const observer=await rollbackOperation(15000,()=>prepareProductionExit({record:saved,execute}));nativeExitRecord=saved;
   let waited=false;
   async function observeExit(resume){
    requireValue(!busy&&!failed&&!nativeExited&&!rollbackEntered&&(resume?waited&&exitInterrupted:!waited&&!exitInterrupted));
    waited=true;busy=true;expires=clock()+20000;
    try{
     await verify();
     const evidence=await (resume?observer.resumeExitObservation():observer.waitForExit());
     await verify();nativeExited=true;exitInterrupted=false;return evidence;
    }catch(error){exitInterrupted=true;throw error;}
    finally{busy=false;}
   }
   // Only the bound read-only observer may recover an interrupted read. Provider
   // identity failures remain terminal, and all other operations stay blocked.
   return Object.freeze({waitForExit:()=>observeExit(false),resumeExitObservation:()=>observeExit(true)});
  },
  snapshotNativeJobs:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!rollbackEntered);
   const inputs=copy({record:options.record,installation:options.installation,baseline:options.baseline}),record=inputs.record;
   requireValue(record&&record.phase==='ready'&&record.boot_id===target.bootId&&returnProviderSource(sourceIdentity,record));
   if(nativeExitEntered)requireValue(nativeExited&&JSON.stringify(record)===JSON.stringify(nativeExitRecord));
   const native=processIdentities({...record.worker_identity,implementation:'native-prototype',guardian_pid:record.worker_identity.processes.guardian.pid,capabilities:['worker-process-identity-v1']},record.worker_identity.processes.worker.pid);
   requireValue(native.boot_id===target.bootId&&native.worker_id!==identity.worker_id&&Object.values(native.processes).every(p=>Object.values(identity.processes).every(q=>p.pid!==q.pid)));
   if(retainedSnapshot)requireValue(JSON.stringify(inputs.baseline)===JSON.stringify(retainedSnapshot));
   rollbackEntered=true;
   return rollbackOperation(60000,async()=>{const snapshot=await snapshotNativeJobs({...inputs,execute});rollbackInputs=copy({...inputs,snapshot});return snapshot;});
  },
  restoreManagedState:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!restoreEntered&&rollbackInputs);restoreEntered=true;
   return rollbackOperation(120000,async()=>{restored=copy(await restoreManagedJobs({...options,...copy(rollbackInputs),resume:false,execute}));return copy(restored);});
  },
  acceptManagedRestore:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!restoreAcceptEntered&&restored);restoreAcceptEntered=true;
   return rollbackOperation(120000,async()=>{const result=await acceptManagedRestore({...options,transitionId:restored.transition_id,receiptSha256:restored.receipt_sha256,execute});restoreAccepted=true;return result;});
  },
  launchManaged:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!managedEntered&&restoreAccepted&&restored);managedEntered=true;
   return rollbackOperation(120000,async()=>{managedRecord=copy(await submitManaged({...options,transitionId:restored.transition_id,receiptSha256:restored.receipt_sha256,execute}));return copy(managedRecord);});
  },
  verifyManaged:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!managedReadyEntered&&managedRecord);managedReadyEntered=true;
   return rollbackOperation(120000,()=>readyManaged({...options,record:copy(managedRecord),providerIdentity:identity,execute}));
  },
  inspectUnit:request=>operation(request,false),
  retireUnit:request=>operation(request,true),
  snapshotManagedJobs:async()=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!rollbackEntered&&!snapshotEntered);busy=true;snapshotEntered=true;expires=clock()+60000;
   try{const result=await snapshotManagedJobs({source:sourceIdentity,execute});retainedSnapshot=JSON.parse(JSON.stringify(result));return result;}
   catch(error){failed=true;throw error;}
   finally{busy=false;}
  },
  verifyProduction:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!rollbackEntered&&!readinessEntered&&productionRecord);busy=true;readinessEntered=true;expires=clock()+120000;
   try{return await readyProduction({...options,record:productionRecord,providerIdentity:identity,execute});}
   catch(error){failed=true;throw error;}
   finally{busy=false;}
  },
  launchProduction:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!rollbackEntered&&!productionEntered&&stateAccepted&&retainedInstallation);busy=true;productionEntered=true;expires=clock()+30000;
   try{productionRecord=await submitProduction({...options,id:retainedInstallation.id,manifestSha256:retainedInstallation.manifest_sha256,receiptSha256:retainedInstallation.receipt_sha256,execute});return productionRecord;}
   catch(error){failed=true;throw error;}
   finally{busy=false;}
  },
  acceptManagedState:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!rollbackEntered&&!acceptEntered&&retainedInstallation);busy=true;acceptEntered=true;expires=clock()+120000;
   try{const result=await acceptRetainedState({...options,id:retainedInstallation.id,manifestSha256:retainedInstallation.manifest_sha256,receiptSha256:retainedInstallation.receipt_sha256,execute});stateAccepted=true;return result;}
   catch(error){failed=true;throw error;}
   finally{busy=false;}
  },
  installManagedState:async options=>{
   requireValue(!busy&&!failed&&!exitInterrupted&&!rollbackEntered&&!installEntered&&retainedSnapshot);busy=true;installEntered=true;expires=clock()+120000;
   try{retainedInstallation=await installRetainedState({...options,snapshot:retainedSnapshot,execute});return retainedInstallation;}
   catch(error){failed=true;throw error;}
   finally{busy=false;}
  }
 });
}
module.exports={createObserverRetirement,validateProvider};
