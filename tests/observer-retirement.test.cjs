const {test}=require('node:test'),assert=require('node:assert/strict');
const {createObserverRetirement,validateProvider}=require('../research/autonomous-root/service/observer-retirement');
const boot='00000000-0000-0000-0000-000000000001',sha='a'.repeat(64),unit='couchroot-observer-'+'b'.repeat(32)+'.service';
const bound={unit,bootId:boot,sha256:sha};
const source={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}};
function status(){return {implementation:'native-prototype',boot_id:boot,worker_id:'d'.repeat(32),lifetime_mode:'bounded',lifetime_seconds:300,guardian_pid:76,processes:{worker:{pid:77,start_ticks:'200'},guardian:{pid:76,start_ticks:'199'}},capabilities:['prototype-scoped-files-v1','worker-process-identity-v1','guardian-parent-identity-v1','resource-inventory-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1'],app_launcher:{sha256:sha,independently_staged:true},resources:{schema:1,scope:'worker-owned',jobs:[],transfers:[],helpers:[]}};}
function fixture(){
 let info=status(),calls=[];
 const peer={identity:{pid:77,uid:0,euid:0,gid:0,egid:0,smack:'System'}};
 const channel={_conn:peer,operation:async()=>structuredClone(info),execute:async(command,timeout)=>{
  calls.push({command,timeout});
  return {exit_code:0,stdout:command.includes('systemctl stop')?'OBSERVER-UNIT-RETIRED\n':`Id=${unit}\nLoadState=loaded\nActiveState=active\nSubState=exited\nMainPID=0\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`};
 }};
 return {channel,peer,calls,info,create:()=>createObserverRetirement({channel,source,bound,launcherSha256:sha})};
}
test('retirement uses a distinct native identity and exposes no general executor',async()=>{
 const f=fixture(),provider=await f.create();assert.equal(provider.execute,undefined);
 const got=await provider.inspectUnit(bound);assert.equal(got.main_pid,0);
 const done=await provider.retireUnit(bound);assert.equal(done.retired,true);assert.equal(f.calls.length,3);
 assert.match(f.calls[2].command,/systemctl stop --no-block/);
 await assert.rejects(provider.retireUnit(bound));assert.equal(f.calls.length,3);
});
test('retirement rejects source overlap, broad lifetime, active resources and wrong profile',async()=>{
 const mutations=[v=>v.worker_id=source.worker_id,v=>v.boot_id=boot.slice(0,-1)+'2',v=>v.lifetime_mode='production',v=>v.lifetime_seconds=0,v=>v.lifetime_seconds=301,v=>v.guardian_pid=42,v=>{v.processes.guardian.pid=42;v.guardian_pid=42;},v=>v.resources.jobs.push({id:'retained-job-identity',state:'completed',monitor_finished:true}),v=>v.capabilities.push('prototype-production-files-v1'),v=>v.app_launcher.sha256='b'.repeat(64),v=>v.app_launcher.independently_staged=false,v=>v.capabilities.pop()];
 for(const mutate of mutations){const f=fixture();mutate(f.info);await assert.rejects(f.create());assert.equal(f.calls.length,0);}
 const f=fixture();f.peer.identity.smack='User';await assert.rejects(f.create());
});
test('binding mismatches are rejected without issuing commands',async()=>{
 const f=fixture(),p=await f.create();
 for(const patch of [{unit:unit+'\n'},{sha256:'f'.repeat(64)},{bootId:boot.slice(0,-1)+'2'},{execute:()=>{}}])await assert.rejects(p.retireUnit({...bound,...patch}));
 assert.equal(f.calls.length,0);assert.equal((await p.inspectUnit(bound)).unit,unit);
});
test('connection replacement, status drift, and uncertain results poison the provider without retry',async()=>{
 for(const mode of ['replacement','before','after','lost']){
  const f=fixture(),p=await f.create();
  if(mode==='replacement')f.channel._conn={...f.peer};
  if(mode==='before')f.info.worker_id='e'.repeat(32);
  if(mode==='after'||mode==='lost'){const old=f.channel.execute;f.channel.execute=async(...args)=>{const r=await old(...args);if(mode==='lost')throw Error('reply lost');f.info.processes.worker.start_ticks='999';return r;};}
  await assert.rejects(p.retireUnit(bound));const count=f.calls.length;await assert.rejects(p.retireUnit(bound));await assert.rejects(p.inspectUnit(bound));assert.equal(f.calls.length,count);
 }
});
test('parallel requests cannot overlap retirement',async()=>{
 const f=fixture(),p=await f.create();let release;const old=f.channel.operation;
 f.channel.operation=()=>new Promise(resolve=>{release=()=>old().then(resolve);});
 const pending=p.inspectUnit(bound);await assert.rejects(p.retireUnit(bound));f.channel.operation=old;release();await pending;
 assert.equal(f.calls.length,1);
});
test('late readiness cannot issue a retirement command after its deadline',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
 const file=path.resolve(__dirname,'../research/autonomous-root/service/observer-retirement.js'),module={exports:{}},real=createRequire(file);let now=0;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:real,process:{hrtime:()=>[Math.floor(now/1000),(now%1000)*1000000]}});
 const f=fixture(),p=await module.exports.createObserverRetirement({channel:f.channel,source,bound,launcherSha256:sha});
 f.channel.operation=async()=>{now=9000;return f.info;};
 await assert.rejects(p.retireUnit(bound));assert.equal(f.calls.length,0);await assert.rejects(p.retireUnit(bound));
});
test('provider can snapshot retained managed jobs after observer retirement without exposing execution',async()=>{
 const f=fixture(),p=await f.create();await p.retireUnit(bound);f.channel.execute=async command=>{f.calls.push({command});return {exit_code:0,stdout:'SNAPSHOT-END\n'};};
 const result=await p.snapshotManagedJobs();assert.equal(result.implementation,'managed');assert.equal(result.records.length,0);assert.equal(result.source.worker_id,source.worker_id);assert.equal(f.calls.length,4);
 assert.ok(f.calls.slice(2).every(c=>c.command.includes('/proc/42/stat')&&c.command.includes('/opt/couchroot-agent/jobs')));
 await assert.rejects(p.snapshotManagedJobs());assert.equal(f.calls.length,4);assert.equal(p.execute,undefined);
});
test('failed source-exit check cannot be retried or followed by mutation',async()=>{
 const f=fixture(),p=await f.create();let calls=0;f.channel.execute=async()=>{calls++;return {exit_code:1,stdout:''};};
 await assert.rejects(p.snapshotManagedJobs());await assert.rejects(p.snapshotManagedJobs());await assert.rejects(p.retireUnit(bound));assert.equal(calls,1);
});

function rollbackFixture(failure){
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
 const file=path.resolve(__dirname,'../research/autonomous-root/service/observer-retirement.js'),module={exports:{}},real=createRequire(file),f=fixture(),events=[];
 const native={boot_id:boot,worker_id:'e'.repeat(32),processes:{worker:{pid:92,start_ticks:'300'},guardian:{pid:91,start_ticks:'299'}}};
 const inputs={record:{id:'f'.repeat(32),phase:'ready',boot_id:boot,source,worker_identity:native},installation:{id:'f'.repeat(32)},baseline:{sha256:sha}},snapshot={sha256:'b'.repeat(64),records:[]};
 const receipt={transition_id:'f'.repeat(32),receipt_sha256:'c'.repeat(64)},launch={id:'f'.repeat(32),phase:'submitted'};
 const step=async(name,o,result)=>{events.push(name);await o.execute(name,1000);if(failure===name)throw Error('lost '+name+' response');return structuredClone(result);};
 const modules={
  './production-exit':{prepareProductionExit:async o=>{await step('bind',o,{});return {waitForExit:()=>step('exit',o,{record_id:o.record.id}),resumeExitObservation:()=>step('resume-exit',o,{record_id:o.record.id})};}},
  './native-retained-state':{snapshotNativeJobs:async o=>{assert.equal(o.record.id,inputs.record.id);return step('snapshot',o,snapshot);}},
  './managed-restore':{restoreManagedJobs:async o=>{assert.equal(o.snapshot.sha256,snapshot.sha256);assert.equal(o.record.id,inputs.record.id);assert.equal(o.baseline.sha256,sha);assert.equal(o.resume,false);return step('restore',o,receipt);},acceptManagedRestore:async o=>{assert.equal(o.transitionId,receipt.transition_id);assert.equal(o.receiptSha256,receipt.receipt_sha256);return step('accept',o,{pending:{phase:'rollback-state-ready'}});}},
  './managed-launch':{submitManaged:async o=>{assert.equal(o.transitionId,receipt.transition_id);assert.equal(o.receiptSha256,receipt.receipt_sha256);return step('launch',o,launch);}},
  './managed-readiness':{readyManaged:async o=>{assert.equal(o.record.id,launch.id);assert.equal(o.providerIdentity.worker_id,f.info.worker_id);return step('ready',o,{record:{...launch,phase:'ready'}});}}
 };
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,require:n=>modules[n]||real(n)});
 return {...f,inputs,events,create:()=>module.exports.createObserverRetirement({channel:f.channel,source,bound,launcherSha256:sha})};
}
test('rollback provider binds snapshot, restore and managed launch without exposing its executor',async()=>{
 const f=rollbackFixture(),p=await f.create(),foreign={execute:()=>{throw Error('foreign executor');},record:{id:'foreign'},snapshot:{sha256:'foreign'},baseline:{sha256:'foreign'},receiptSha256:'foreign',transitionId:'foreign',providerIdentity:{worker_id:'foreign'},resume:true};
 for(const name of ['restoreManagedState','acceptManagedRestore','launchManaged','verifyManaged'])await assert.rejects(p[name](foreign));assert.deepEqual(f.events,[]);
 const snapshot=await p.snapshotNativeJobs(f.inputs);snapshot.sha256='foreign';
 await assert.rejects(p.snapshotManagedJobs());await assert.rejects(p.installManagedState({}));
 const restored=await p.restoreManagedState(foreign);restored.receipt_sha256='foreign';
 await p.acceptManagedRestore(foreign);const launched=await p.launchManaged(foreign);launched.id='foreign';
 assert.equal((await p.verifyManaged(foreign)).record.phase,'ready');assert.deepEqual(f.events,['snapshot','restore','accept','launch','ready']);assert.equal(p.execute,undefined);
 for(const name of ['snapshotNativeJobs','restoreManagedState','acceptManagedRestore','launchManaged','verifyManaged'])await assert.rejects(p[name](f.inputs));assert.equal(f.calls.length,5);
});
test('rollback provider rejects unrelated native source and provider overlap before snapshot',async()=>{
 for(const mode of ['source','boot','pid','worker']){
  const f=rollbackFixture(),p=await f.create(),inputs=structuredClone(f.inputs);
  if(mode==='source')inputs.record.source.worker_id='0'.repeat(32);
  if(mode==='boot')inputs.record.boot_id=boot.slice(0,-1)+'2';
  if(mode==='pid')inputs.record.worker_identity.processes.guardian.pid=76;
  if(mode==='worker')inputs.record.worker_identity.worker_id=f.info.worker_id;
  await assert.rejects(p.snapshotNativeJobs(inputs));assert.deepEqual(f.events,[]);assert.equal(f.calls.length,0);
 }
});
test('uncertainty in any rollback provider phase forbids retries and later mutation',async()=>{
 for(const failure of ['snapshot','restore','accept','launch','ready']){
  const f=rollbackFixture(failure),p=await f.create(),steps=[['snapshotNativeJobs',f.inputs],['restoreManagedState',{}],['acceptManagedRestore',{}],['launchManaged',{}],['verifyManaged',{}]];
  for(let i=0;i<steps.length;i++){const [name,o]=steps[i];if(['snapshot','restore','accept','launch','ready'][i]===failure){await assert.rejects(p[name](o));break;}await p[name](o);}
  const count=f.calls.length;
  for(const [name,o] of steps)await assert.rejects(p[name](o));await assert.rejects(p.retireUnit(bound));assert.equal(f.calls.length,count);
 }
});

test('bound native exit must finish before rollback snapshot and cannot be replayed',async()=>{
 const f=rollbackFixture(),p=await f.create(),observer=await p.prepareNativeExit(f.inputs.record);
 await assert.rejects(p.snapshotNativeJobs(f.inputs));await assert.rejects(p.prepareNativeExit(f.inputs.record));assert.deepEqual(f.events,['bind']);
 assert.equal((await observer.waitForExit()).record_id,f.inputs.record.id);await assert.rejects(observer.waitForExit());
 const changed=structuredClone(f.inputs);changed.record.worker_identity.processes.worker.start_ticks='999';await assert.rejects(p.snapshotNativeJobs(changed));
 await p.snapshotNativeJobs(f.inputs);assert.deepEqual(f.events,['bind','exit','snapshot']);
});
test('unknown native exit blocks provider operations until explicitly reconciled',async()=>{
 for(const phase of ['bind','exit']){
  const f=rollbackFixture(phase),p=await f.create();
  if(phase==='bind')await assert.rejects(p.prepareNativeExit(f.inputs.record));else{const observer=await p.prepareNativeExit(f.inputs.record);await assert.rejects(observer.waitForExit());}
  const count=f.calls.length;await assert.rejects(p.prepareNativeExit(f.inputs.record));await assert.rejects(p.snapshotNativeJobs(f.inputs));await assert.rejects(p.restoreManagedState({}));assert.equal(f.calls.length,count);
 }
});


test('explicit native exit recovery rechecks provider and permits restoration only after evidence',async()=>{
 const f=rollbackFixture('exit'),p=await f.create(),observer=await p.prepareNativeExit(f.inputs.record);
 await assert.rejects(observer.resumeExitObservation());await assert.rejects(observer.waitForExit());
 const count=f.calls.length;
 await assert.rejects(p.inspectUnit(bound));await assert.rejects(p.retireUnit(bound));await assert.rejects(p.snapshotManagedJobs());
 await assert.rejects(p.snapshotNativeJobs(f.inputs));await assert.rejects(p.restoreManagedState({}));assert.equal(f.calls.length,count);
 assert.equal((await observer.resumeExitObservation()).record_id,f.inputs.record.id);
 await assert.rejects(observer.resumeExitObservation());await assert.rejects(observer.waitForExit());
 await p.snapshotNativeJobs(f.inputs);assert.deepEqual(f.events,['bind','exit','resume-exit','snapshot']);
});

test('exit recovery refuses provider replacement or drift permanently',async()=>{
 for(const mode of ['connection','exited','boot','worker','profile','status']){
  const f=rollbackFixture('exit'),p=await f.create(),observer=await p.prepareNativeExit(f.inputs.record);
  await assert.rejects(observer.waitForExit());const count=f.calls.length,old=f.channel.operation;
  if(mode==='connection')f.channel._conn={...f.peer};
  if(mode==='exited')f.channel._conn=null;
  if(mode==='boot')f.info.boot_id=boot.slice(0,-1)+'2';
  if(mode==='worker')f.info.worker_id='0'.repeat(32);
  if(mode==='profile')f.peer.identity.smack='User';
  if(mode==='status')f.channel.operation=async()=>{throw Error('provider unavailable');};
  await assert.rejects(observer.resumeExitObservation(),mode==='exited'||mode==='connection'?/provider transport closed or replaced/:/./);
  f.channel._conn=f.peer;Object.assign(f.info,status());f.peer.identity.smack='System';f.channel.operation=old;
  await assert.rejects(observer.resumeExitObservation());await assert.rejects(p.snapshotNativeJobs(f.inputs));assert.equal(f.calls.length,count);
 }
});

test('exit observation recovery excludes concurrent retries and mutations',async()=>{
 const f=rollbackFixture('exit'),p=await f.create(),observer=await p.prepareNativeExit(f.inputs.record);
 await assert.rejects(observer.waitForExit());const old=f.channel.operation;let release;
 f.channel.operation=()=>new Promise(resolve=>{release=()=>old().then(resolve);});
 const pending=observer.resumeExitObservation();
 await assert.rejects(observer.resumeExitObservation());await assert.rejects(p.snapshotNativeJobs(f.inputs));await assert.rejects(p.retireUnit(bound));
 f.channel.operation=old;release();await pending;
 await p.snapshotNativeJobs(f.inputs);assert.deepEqual(f.events,['bind','exit','resume-exit','snapshot']);
});
