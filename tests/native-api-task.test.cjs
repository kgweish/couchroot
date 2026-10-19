'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Journal}=require('../research/autonomous-root/service/policy'),{createNativeTasks}=require('../research/autonomous-root/service/native-api-task');
const value={id:'native-rehearsal-0001',manifest_sha256:'a'.repeat(64),runtime_sha256:'b'.repeat(64)},tick=()=>new Promise(r=>setImmediate(r));
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-api-task-')),journal=new Journal(dir+'/requests.json');let calls=0,complete,fail;const agent={status:()=>({connected:true,worker_ready:true,selected_implementation:'managed',admission_held:false}),rehearseNative:async(m,r)=>{calls++;assert.equal(m,value.manifest_sha256);assert.equal(r,value.runtime_sha256);assert.equal(journal.rows[0].state,'submitted');return new Promise((yes,no)=>{complete=yes;fail=no;});},resumeManagedActivation:async()=>{calls++;return {selected_implementation:'managed',admission_held:false};}};const tasks=createNativeTasks({agent,journal});try{await fn({tasks,journal,agent,dir,calls:()=>calls,complete:r=>complete(r),fail:e=>fail(e)});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('rehearsal journals before dispatch, returns submission and completes asynchronously',()=>fixture(async f=>{
 assert.equal(f.tasks.rehearse(value).state,'submitted');assert(f.tasks.busy());assert.equal(f.calls(),0);await tick();assert.equal(f.calls(),1);assert.equal(f.tasks.status().state,'submitted');assert.throws(()=>f.tasks.rehearse(value));f.complete({selected_implementation:'managed',admission_held:false});await tick();assert.equal(f.tasks.status().state,'completed');assert.equal(f.journal.rows[0].exit_code,0);assert.equal(f.tasks.busy(),false);assert.throws(()=>f.tasks.rehearse({...value,id:'native-rehearsal-0002'}));
}));
test('unknown result remains submitted and explicit recovery uses a distinct bound request',()=>fixture(async f=>{
 f.tasks.rehearse(value);await tick();f.fail(Error('lost reply'));await tick();assert.equal(f.tasks.status().state,'unknown');assert.equal(f.journal.rows[0].state,'submitted');
 assert.throws(()=>f.tasks.resume({id:value.id,rehearsal_id:value.id}));assert.throws(()=>f.tasks.resume({id:'native-recovery-0001',rehearsal_id:'unrelated-trial-0001'}));
 const recovery={id:'native-recovery-0001',rehearsal_id:value.id};assert.equal(f.tasks.resume(recovery).state,'submitted');await tick();assert.equal(f.calls(),2);assert.equal(f.tasks.status().rehearsal_id,value.id);assert.equal(f.tasks.status().state,'completed');assert.equal(f.journal.rows[0].state,'submitted');assert.equal(f.journal.rows[1].state,'completed');assert.throws(()=>f.tasks.resume(recovery));
}));
test('restart preserves replay protection without reconstructing live recovery handles',()=>fixture(async f=>{
 f.tasks.rehearse(value);await tick();f.fail(Error('lost reply'));await tick();const tasks=createNativeTasks({agent:f.agent,journal:new Journal(f.dir+'/requests.json')});assert.equal(tasks.status(),null);assert.throws(()=>tasks.rehearse(value),/already submitted/);assert.throws(()=>tasks.resume({id:'native-recovery-0001',rehearsal_id:value.id}));assert.equal(f.calls(),1);
}));
test('malformed inputs and unavailable managed readiness refuse dispatch',()=>fixture(async f=>{
 for(const v of [{...value,command:'id'},{...value,id:'short'},{...value,runtime_sha256:'b'.repeat(64)+'\n'}])assert.throws(()=>f.tasks.rehearse(v));
 f.agent.status=()=>({connected:true,worker_ready:false,selected_implementation:'managed'});assert.throws(()=>f.tasks.rehearse(value));assert.equal(f.journal.rows.length,0);assert.equal(f.calls(),0);
}));
test('known refusal is recorded but failed journal completion stays unknown',async()=>{
 for(const mode of ['rejected','journal'])await fixture(async f=>{f.tasks.rehearse(value);await tick();if(mode==='journal'){f.journal.finish=()=>{throw Error('disk failed');};f.complete({});}else f.fail(Object.assign(Error('preflight refused'),{outcome:'rejected'}));await tick();assert.equal(f.tasks.status().state,mode==='journal'?'unknown':'rejected');assert.equal(f.journal.rows[0].state,mode==='journal'?'submitted':'completed');assert.equal(f.tasks.busy(),false);});
});
test('recovery refuses overlap and completed transactions; a failed recovery stays unknown for a new bound request',()=>fixture(async f=>{
 f.tasks.rehearse(value);await tick();f.fail(Error('exit observation interrupted'));await tick();
 let finish;f.agent.resumeManagedActivation=async()=>new Promise((yes,no)=>{finish={yes,no};});
 const first={id:'native-recovery-0001',rehearsal_id:value.id};f.tasks.resume(first);await tick();
 assert.throws(()=>f.tasks.resume({id:'native-recovery-0002',rehearsal_id:value.id}));assert.equal(f.tasks.status().state,'submitted');
 finish.no(Error('still interrupted'));await tick();assert.equal(f.tasks.status().state,'unknown');assert.equal(f.tasks.status().id,first.id);assert.equal(f.journal.rows[1].state,'submitted');
 assert.throws(()=>f.tasks.resume(first),/already submitted/);
 f.agent.resumeManagedActivation=async()=>({selected_implementation:'managed',admission_held:false});
 const second={id:'native-recovery-0002',rehearsal_id:value.id};f.tasks.resume(second);await tick();assert.equal(f.tasks.status().state,'completed');assert.equal(f.journal.rows[2].state,'completed');
 assert.throws(()=>f.tasks.resume({id:'native-recovery-0003',rehearsal_id:value.id}));assert.equal(f.journal.rows.length,3);
 assert.deepEqual(f.journal.rows.map(r=>r.state),['submitted','submitted','completed']);
}));
test('restart cleanup is journaled, validated and permits one later rehearsal only after completion',()=>fixture(async f=>{
 let finish;const seen=[];f.agent.cleanupRestart=async id=>{seen.push(id);assert.equal(f.journal.rows.at(-1).state,'submitted');return new Promise((yes,no)=>{finish={yes,no};});};
 for(const v of [{id:'native-cleanup-0001'},{id:'native-cleanup-0001',transaction_id:'C'.repeat(32)},{id:'short',transaction_id:'c'.repeat(32)},{id:'native-cleanup-0001',transaction_id:'c'.repeat(32),extra:1}])assert.throws(()=>f.tasks.cleanupRestart(v));
 assert.equal(f.journal.rows.length,0);
 const request={id:'native-cleanup-0001',transaction_id:'c'.repeat(32)};assert.equal(f.tasks.cleanupRestart(request).state,'submitted');await tick();assert.deepEqual(seen,['c'.repeat(32)]);
 assert.throws(()=>f.tasks.rehearse(value));finish.no(Error('remote staging did not match'));await tick();assert.equal(f.tasks.status().state,'unknown');assert.throws(()=>f.tasks.rehearse(value));
 assert.throws(()=>f.tasks.cleanupRestart({...request,id:'native-cleanup-0002'}),'an unknown cleanup needs inspection before another submission');
}));
test('a completed restart cleanup leaves the live coordinator free for one rehearsal',()=>fixture(async f=>{
 f.agent.cleanupRestart=async()=>({id:'c'.repeat(32)});f.tasks.cleanupRestart({id:'native-cleanup-0001',transaction_id:'c'.repeat(32)});await tick();await tick();assert.equal(f.tasks.status().state,'completed');assert.equal(f.journal.rows[0].exit_code,0);
 assert.equal(f.tasks.rehearse(value).state,'submitted');
}));
test('native migration is journaled, needs the pinned fallback digest and recovers only its own activation',()=>fixture(async f=>{
 let finish;const seen=[];f.agent.migrateNative=async(m,r)=>{seen.push([m,r]);assert.equal(f.journal.rows.at(-1).state,'submitted');return new Promise((yes,no)=>{finish={yes,no};});};
 f.agent.resumeNativeActivation=async()=>{seen.push('resume');return {selected_implementation:'native-prototype',admission_held:false};};
 for(const v of [{id:value.id,manifest_sha256:value.manifest_sha256},{...value,extra:1},{...value,id:'short'}])assert.throws(()=>f.tasks.migrate(v));assert.equal(f.journal.rows.length,0);
 const accepted=f.tasks.migrate(value);assert.equal(accepted.migration_id,value.id);assert.equal(accepted.rehearsal_id,null);await tick();assert.deepEqual(seen,[[value.manifest_sha256,value.runtime_sha256]]);
 assert.throws(()=>f.tasks.rehearse({...value,id:'native-rehearsal-0002'}));assert.throws(()=>f.tasks.resumeNative({id:'native-recovery-0001',migration_id:value.id}),'a running migration is not recoverable');
 finish.no(Error('activation acknowledgement lost'));await tick();assert.equal(f.tasks.status().state,'unknown');assert.equal(f.journal.rows[0].state,'submitted');
 assert.throws(()=>f.tasks.resume({id:'native-recovery-0001',rehearsal_id:value.id}),'managed recovery is bound to rehearsals');
 assert.throws(()=>f.tasks.resumeNative({id:value.id,migration_id:value.id}));assert.throws(()=>f.tasks.resumeNative({id:'native-recovery-0001',migration_id:'unrelated-trial-0001'}));
 const recovery={id:'native-recovery-0001',migration_id:value.id};assert.equal(f.tasks.resumeNative(recovery).state,'submitted');await tick();await tick();
 assert.deepEqual(seen.slice(1),['resume']);assert.equal(f.tasks.status().kind,'native.resume-native');assert.equal(f.tasks.status().migration_id,value.id);assert.equal(f.tasks.status().state,'completed');assert.equal(f.journal.rows[1].state,'completed');
 assert.throws(()=>f.tasks.resumeNative({id:'native-recovery-0002',migration_id:value.id}));assert.throws(()=>f.tasks.migrate({...value,id:'native-migrate-0002'}));
}));
test('native migration requires ready managed admission',()=>fixture(async f=>{
 f.agent.migrateNative=async()=>{throw Error('must not run');};
 for(const status of [{connected:true,worker_ready:true,selected_implementation:'native-prototype',admission_held:false},{connected:true,worker_ready:true,selected_implementation:'managed',admission_held:true},{connected:false,worker_ready:false,selected_implementation:'managed'}]){f.agent.status=()=>status;assert.throws(()=>f.tasks.migrate(value));}
 assert.equal(f.journal.rows.length,0);
}));
test('managed return follows a completed migration, is journaled and recovers through resume-managed',()=>fixture(async f=>{
 f.agent.migrateNative=async()=>({selected_implementation:'native-prototype',admission_held:false});
 const back={id:'native-return-0001',runtime_sha256:value.runtime_sha256};assert.throws(()=>f.tasks.returnManaged(back),'native must be admitted first');
 f.tasks.migrate(value);await tick();await tick();assert.equal(f.tasks.status().state,'completed');
 let finish;const seen=[];f.agent.returnManaged=async r=>{seen.push(r);assert.equal(f.journal.rows.at(-1).state,'submitted');return new Promise((yes,no)=>{finish={yes,no};});};
 assert.throws(()=>f.tasks.returnManaged(back),'managed selection refuses a return');
 f.agent.status=()=>({connected:true,worker_ready:true,selected_implementation:'native-prototype',admission_held:false,native_runtime:{transaction_id:'c'.repeat(32)}});
 for(const v of [{id:back.id},{...back,extra:1},{...back,runtime_sha256:'B'.repeat(64)}])assert.throws(()=>f.tasks.returnManaged(v));
 assert.equal(f.tasks.returnManaged(back).rehearsal_id,back.id);await tick();assert.deepEqual(seen,[value.runtime_sha256]);assert.throws(()=>f.tasks.returnManaged({...back,id:'native-return-0002'}));
 finish.no(Error('activation acknowledgement lost'));await tick();assert.equal(f.tasks.status().state,'unknown');
 const recovery={id:'native-recovery-0001',rehearsal_id:back.id};assert.equal(f.tasks.resume(recovery).state,'submitted');await tick();await tick();assert.equal(f.tasks.status().state,'completed');assert.equal(f.tasks.status().kind,'native.resume-managed');
 assert.deepEqual(f.journal.rows.map(r=>r.state),['completed','submitted','completed']);
}));

test('restart recovery binds the original journaled return ID without replaying it',()=>fixture(async f=>{
 const original='original-return-0001';f.journal.begin({id:original,command:'native.return-managed',timeout_ms:25000});
 f.agent.canResumeManaged=id=>id===original;let calls=0;f.agent.resumeManagedActivation=async id=>{assert.equal(id,original);calls++;return {selected_implementation:'managed',admission_held:false};};
 assert.throws(()=>f.tasks.resume({id:'restart-recovery-0001',rehearsal_id:'unrelated-return-0001'}));
 f.tasks.resume({id:'restart-recovery-0001',rehearsal_id:original});await tick();await tick();
 assert.equal(calls,1);assert.equal(f.tasks.status().state,'completed');assert.equal(f.journal.rows[0].state,'submitted');assert.equal(f.journal.rows[1].state,'completed');
 assert.throws(()=>f.tasks.resume({id:'restart-recovery-0001',rehearsal_id:original}));
}));

test('completed managed return refuses a second trial before journal mutation until coordinator restart',()=>fixture(async f=>{
 let migrations=0;
 f.agent.migrateNative=async()=>{migrations++;return {};};
 f.agent.returnManaged=async()=>({selected_implementation:'managed',admission_held:false});
 f.tasks.migrate(value);await tick();await tick();
 f.agent.status=()=>({connected:true,worker_ready:true,selected_implementation:'native-prototype',admission_held:false,native_runtime:{transaction_id:'c'.repeat(32)}});
 f.tasks.returnManaged({id:'completed-return-0001',runtime_sha256:value.runtime_sha256});await tick();await tick();
 f.agent.status=()=>({connected:true,worker_ready:true,selected_implementation:'managed',admission_held:false});
 const status=f.tasks.status(),journal=fs.readFileSync(f.dir+'/requests.json');
 assert.equal(status.kind,'native.return-managed');assert.equal(status.state,'completed');
 for(const kind of ['migrate','rehearse'])assert.throws(()=>f.tasks[kind]({...value,id:'next-trial-request-0001'}));
 assert.deepEqual(f.tasks.status(),status);assert.deepEqual(fs.readFileSync(f.dir+'/requests.json'),journal);assert.equal(migrations,1);
 const restarted=createNativeTasks({agent:f.agent,journal:new Journal(f.dir+'/requests.json')});
 assert.throws(()=>restarted.migrate(value),/already submitted/);
 restarted.migrate({...value,id:'fresh-coordinator-0001'});await tick();await tick();
 assert.equal(restarted.status().state,'completed');assert.equal(migrations,2);
}));


test('a return refused before mutation permits a new request after live jobs settle',()=>fixture(async f=>{
 f.agent.status=()=>({connected:true,worker_ready:true,selected_implementation:'native-prototype',admission_held:false,native_runtime:{transaction_id:'c'.repeat(32)}});
 let calls=0;f.agent.returnManaged=async()=>{calls++;if(calls===1)throw Object.assign(Error('live jobs'),{outcome:'rejected'});return {selected_implementation:'managed',admission_held:false};};
 const first={id:'live-return-refused-0001',runtime_sha256:value.runtime_sha256};f.tasks.returnManaged(first);await tick();await tick();assert.equal(f.tasks.status().state,'rejected');
 assert.throws(()=>f.tasks.returnManaged(first),'request IDs remain single use');
 f.tasks.returnManaged({...first,id:'settled-return-next-0001'});await tick();await tick();assert.equal(calls,2);assert.equal(f.tasks.status().state,'completed');assert.deepEqual(f.journal.rows.map(r=>r.exit_code),[1,0]);
}));

for(const kind of ['rehearse','migrate'])test('live rollback cleanup binds the failed '+kind+' to its reconciled transaction',()=>fixture(async f=>{
 const transaction='c'.repeat(32);let recovered=false;
 if(kind==='migrate')f.agent.migrateNative=f.agent.rehearseNative;
 f.agent.canCleanupRestart=id=>recovered&&id===transaction;
 f.agent.cleanupRestart=async id=>({id});
 f.tasks[kind](value);await tick();f.fail(Object.assign(Error('provider disconnected'),{outcome:'unknown',recovery_transaction_id:transaction}));await tick();
 const request={id:'native-cleanup-0001',transaction_id:transaction};
 assert.throws(()=>f.tasks.cleanupRestart(request));assert.equal(f.journal.rows.length,1);
 recovered=true;assert.throws(()=>f.tasks.cleanupRestart({...request,transaction_id:'d'.repeat(32)}));
 assert.equal(f.tasks.cleanupRestart(request).state,'submitted');await tick();await tick();
 assert.equal(f.tasks.status().state,'completed');assert.deepEqual(f.journal.rows.map(r=>r.state),['submitted','completed']);
 assert.throws(()=>f.tasks[kind](value),/already submitted/);
 f.tasks[kind]({...value,id:'native-followup-0001'});await tick();f.complete({});await tick();
}));
test('cleanup cannot bypass an unknown operation without its recovery binding',()=>fixture(async f=>{
 f.agent.canCleanupRestart=()=>true;f.agent.cleanupRestart=async()=>({});
 f.tasks.rehearse(value);await tick();f.fail(Error('unknown activation'));await tick();
 assert.throws(()=>f.tasks.cleanupRestart({id:'native-cleanup-0001',transaction_id:'c'.repeat(32)}));assert.equal(f.journal.rows.length,1);
}));

test('unknown cleanup resumes only under its original request and transaction, preserving uncertainty',()=>fixture(async f=>{
 const transaction='c'.repeat(32),first={id:'native-cleanup-origin-0001',transaction_id:transaction};let fail=true;
 f.agent.cleanupRestart=async()=>{if(fail)throw Error('retirement acknowledgement lost');return {id:transaction};};
 f.tasks.cleanupRestart(first);await tick();assert.equal(f.tasks.status().state,'unknown');
 assert.throws(()=>f.tasks.resume({id:'native-wrong-resume-0001',rehearsal_id:first.id}),'activation recovery cannot displace an unknown cleanup');assert.equal(f.journal.rows.length,1);
 const next={id:'native-cleanup-resume-0001',cleanup_id:first.id,transaction_id:transaction};
 for(const wrong of [{...next,cleanup_id:'unrelated-cleanup-0001'},{...next,transaction_id:'d'.repeat(32)},{...next,id:first.id},{...next,extra:true},{id:next.id,transaction_id:transaction}])assert.throws(()=>f.tasks.cleanupRestart(wrong));
 f.tasks.cleanupRestart(next);assert.throws(()=>f.tasks.cleanupRestart({...next,id:'native-cleanup-resume-0002'}));await tick();assert.equal(f.tasks.status().state,'unknown');
 assert.throws(()=>f.tasks.cleanupRestart({...next,id:'native-cleanup-resume-0002',cleanup_id:next.id}));
 fail=false;f.tasks.cleanupRestart({...next,id:'native-cleanup-resume-0002'});await tick();await tick();assert.equal(f.tasks.status().state,'completed');
 assert.deepEqual(f.journal.rows.map(r=>r.state),['submitted','submitted','completed']);assert.throws(()=>f.tasks.cleanupRestart({...next,id:'native-cleanup-resume-0003'}));
 assert.equal(f.tasks.rehearse(value).state,'submitted');await tick();f.complete({});await tick();
}));
test('automatic forward rollback cannot be displaced by an unrelated activation resume',()=>fixture(async f=>{
 f.agent.migrateNative=f.agent.rehearseNative;f.agent.resumeNativeActivation=async()=>({});f.tasks.migrate(value);await tick();f.fail(Object.assign(Error('lost provider'),{recovery_transaction_id:'c'.repeat(32)}));await tick();
 assert.throws(()=>f.tasks.resumeNative({id:'native-resume-activation-0001',migration_id:value.id}));assert.equal(f.journal.rows.length,1);
}));
