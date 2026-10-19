'use strict';
// One background rehearsal per live coordinator. Durable requests are never replayed.
function check(ok){if(!ok)throw Error('Invalid native administration request');}
const id=v=>typeof v==='string'&&v.length>=16&&v.length<=64&&/^[-a-zA-Z0-9]+$/.test(v);
const digest=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]+$/.test(v);
function createNativeTasks({agent,journal}){
 let running=false,task=null;
 const status=()=>task?JSON.parse(JSON.stringify(task)):null;
 function launch(kind,value,run,rehearsalId,migrationId=null,cleanup=null){
  check(!running);journal.begin({id:value.id,command:kind+':'+JSON.stringify(value),timeout_ms:25000});
  const current={id:value.id,rehearsal_id:rehearsalId,migration_id:migrationId,kind,state:'submitted',result:null,detail:null,...(cleanup?{cleanup_id:cleanup.id,cleanup_transaction_id:cleanup.transaction_id}:{})};task=current;running=true;
  Promise.resolve().then(async()=>{
   try{const result=await run();journal.finish(current.id,{exit_code:0,timed_out:false});current.result=result;current.state='completed';}
   catch(error){
    let outcome=['rejected','failed'].includes(error&&error.outcome)?error.outcome:'unknown';
    if(outcome!=='unknown')try{journal.finish(current.id,{exit_code:1,timed_out:false});}catch(_){outcome='unknown';}
    if(outcome==='unknown'&&['native.migrate','native.rehearse'].includes(kind)&&error&&typeof error.recovery_transaction_id==='string'&&/^[a-f0-9]{32}$/.test(error.recovery_transaction_id))current.recovery_transaction_id=error.recovery_transaction_id;
    current.state=outcome;current.detail=String(error&&error.message||error).slice(0,200);
   }finally{running=false;}
  });
  return {id:current.id,rehearsal_id:current.rehearsal_id,migration_id:current.migration_id,state:'submitted',status_url:'/v1/native/status'};
 }
 return Object.freeze({busy:()=>running,status,
  rehearse:value=>{
   check(value&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='id|manifest_sha256|runtime_sha256'&&id(value.id)&&digest(value.manifest_sha256)&&digest(value.runtime_sha256));
   check((!task||task.kind==='native.cleanup-restart'&&task.state==='completed')&&typeof agent.rehearseNative==='function');const s=agent.status();check(s.connected&&s.worker_ready===true&&!s.admission_held&&s.selected_implementation==='managed');
   return launch('native.rehearse',value,()=>agent.rehearseNative(value.manifest_sha256,value.runtime_sha256),value.id);
  },
  // Public native admission: a committed trial stays native. One per coordinator.
  migrate:value=>{
   check(value&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='id|manifest_sha256|runtime_sha256'&&id(value.id)&&digest(value.manifest_sha256)&&digest(value.runtime_sha256));
   check((!task||task.kind==='native.cleanup-restart'&&task.state==='completed')&&typeof agent.migrateNative==='function');const s=agent.status();check(s.connected&&s.worker_ready===true&&!s.admission_held&&s.selected_implementation==='managed');
   return launch('native.migrate',value,()=>agent.migrateNative(value.manifest_sha256,value.runtime_sha256),null,value.id);
  },
  resumeNative:value=>{
   check(value&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='id|migration_id'&&id(value.id)&&id(value.migration_id)&&value.id!==value.migration_id);
   check(task&&task.migration_id===value.migration_id&&task.state==='unknown'&&!task.recovery_transaction_id&&typeof agent.resumeNativeActivation==='function');
   return launch('native.resume-native',value,()=>agent.resumeNativeActivation(),null,value.migration_id);
  },
  // Return an admitted native runtime to managed. Recovery uses resume-managed
  // bound to this request ID.
  returnManaged:value=>{
   check(value&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='id|runtime_sha256'&&id(value.id)&&digest(value.runtime_sha256));
   check((!task||task.state==='completed'&&['native.migrate','native.resume-native'].includes(task.kind)||task.state==='rejected'&&task.kind==='native.return-managed')&&typeof agent.returnManaged==='function');const s=agent.status();check(s.connected&&s.worker_ready===true&&!s.admission_held&&s.selected_implementation==='native-prototype'&&s.native_runtime);
   return launch('native.return-managed',value,()=>agent.returnManaged(value.runtime_sha256,value.id),value.id);
  },
  cleanupRestart:value=>{
   check(value&&!Array.isArray(value));const keys=Object.keys(value).sort().join('|'),resume=keys==='cleanup_id|id|transaction_id';
   check((resume||keys==='id|transaction_id')&&id(value.id)&&typeof value.transaction_id==='string'&&/^[a-f0-9]{32}$/.test(value.transaction_id));
   const recovered=task&&task.state==='unknown'&&['native.migrate','native.rehearse'].includes(task.kind)&&task.recovery_transaction_id===value.transaction_id&&typeof agent.canCleanupRestart==='function'&&agent.canCleanupRestart(value.transaction_id);
   if(resume)check(id(value.cleanup_id)&&value.id!==value.cleanup_id&&task&&task.kind==='native.cleanup-restart'&&task.state==='unknown'&&task.cleanup_id===value.cleanup_id&&task.cleanup_transaction_id===value.transaction_id);
   else check(!task||task.state!=='unknown'||recovered);
   check(typeof agent.cleanupRestart==='function');const s=agent.status();check(s.connected&&s.worker_ready===true&&!s.admission_held&&s.selected_implementation==='managed');
   // Explicit continuation of a verified, idempotent cleanup checkpoint. The
   // old request remains uncertain; a distinct request names its original ID.
   return launch('native.cleanup-restart',value,()=>agent.cleanupRestart(value.transaction_id),value.id,null,{id:resume?value.cleanup_id:value.id,transaction_id:value.transaction_id});
  },
  resume:value=>{
   check(value&&!Array.isArray(value)&&Object.keys(value).sort().join('|')==='id|rehearsal_id'&&id(value.id)&&id(value.rehearsal_id)&&value.id!==value.rehearsal_id);
   check(typeof agent.resumeManagedActivation==='function'&&(task&&task.kind!=='native.cleanup-restart'&&task.rehearsal_id===value.rehearsal_id&&task.state==='unknown'&&!task.recovery_transaction_id||!task&&typeof agent.canResumeManaged==='function'&&agent.canResumeManaged(value.rehearsal_id)&&journal.rows.some(r=>r.id===value.rehearsal_id)));
   return launch('native.resume-managed',value,()=>agent.resumeManagedActivation(value.rehearsal_id),value.rehearsal_id);
  }
 });
}
module.exports={createNativeTasks};
