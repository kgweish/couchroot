'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const {validateReadiness,validateResourceInventory}=require('../research/autonomous-root/service/worker-readiness');
const BOOT='00000000-0000-0000-0000-000000000001',DIGEST='a'.repeat(64);
function managed(){return {boot_id:BOOT,uptime_seconds:3,worker_id:'b'.repeat(32),capabilities:['file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1'],app_launcher:{implementation:'native',sha256:DIGEST}};}
function native(){return {...managed(),implementation:'native-prototype',lifetime_mode:'production',lifetime_seconds:0,guardian_pid:42,capabilities:['prototype-production-files-v1','binary-upload-v1','binary-download-v1','prototype-app-exec-v1','prototype-jobs-v1','prototype-helper-lifecycle-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1','prototype-command-fault-diagnostics-v1'],app_launcher:{sha256:DIGEST,independently_staged:true}};}
function inventoried(){const info=managed();info.capabilities.push('resource-inventory-v1','worker-process-identity-v1');info.processes={worker:{pid:42,start_ticks:'123'},guardian:null};info.resources={schema:1,scope:'worker-owned',transfers:[],jobs:[],helpers:[]};return info;}
test('managed deployed shape and additive diagnostics remain compatible',()=>{
 const info=managed();info.extra='diagnostic';info.capabilities.push('future-diagnostic-v1');
 assert.equal(validateReadiness(info,{implementation:'managed',bootId:BOOT}),info);
 info.implementation='managed';assert.equal(validateReadiness(info,{implementation:'managed',bootId:BOOT,launcherSha256:DIGEST}),info);
});
test('wrong boot identities capabilities implementations and launchers cannot become ready',()=>{
 const cases=[v=>v.boot_id='00000000-0000-0000-0000-000000000002',v=>v.uptime_seconds=-1,v=>v.uptime_seconds=NaN,
  v=>v.worker_id='not-a-worker',v=>v.capabilities.pop(),v=>v.capabilities.push(v.capabilities[0]),v=>v.implementation='native-prototype',
  v=>v.app_launcher.sha256='invalid',v=>v.app_launcher.implementation='managed',v=>v.capabilities=undefined];
 for(const change of cases){const info=managed();change(info);assert.throws(()=>validateReadiness(info,{implementation:'managed',bootId:BOOT}));}
 assert.throws(()=>validateReadiness(managed(),{implementation:'managed',bootId:BOOT,launcherSha256:'c'.repeat(64)}));
 assert.throws(()=>validateReadiness(managed(),{implementation:'managed',bootId:'not-a-boot'}));
});
test('native readiness requires pinned launcher and production lifetime',()=>{
 const expected={implementation:'native-prototype',bootId:BOOT,launcherSha256:DIGEST};
 assert.equal(validateReadiness(native(),expected).implementation,'native-prototype');
 for(const change of [v=>v.lifetime_seconds=300,v=>v.lifetime_mode='bounded',v=>v.guardian_pid=0,v=>v.app_launcher.independently_staged=false,v=>v.capabilities[0]='prototype-scoped-files-v1']){const info=native();change(info);assert.throws(()=>validateReadiness(info,expected));}
 assert.throws(()=>validateReadiness(native(),{implementation:'native-prototype',bootId:BOOT}));
 assert.throws(()=>validateReadiness(managed(),expected));
});
function fixture(options={},modules={},device='qn90a',config={}){
 const source=path.resolve(__dirname,'../research/autonomous-root/service/agent.js');
 const realRequire=createRequire(source),channels=[],timers=[];
 class Channel {
  constructor(options){this.options=options;this._conn=null;this._server=new EventEmitter();this.executions=0;channels.push(this);}
  start(callback){callback();}
  close(){if(this._conn)this._conn._socket.destroy();}
  listeningPort(){return 12345;}
  operation(){this.executions++;return Promise.resolve({});}
  execute(){this.executions++;return Promise.resolve({exit_code:0});}
  connect(){
   let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
   const conn={identity:{uid:0,pid:42},operation:()=>pending,_socket:{destroy:()=>{if(this._conn===conn){this._conn=null;this.options.onClose();}}}};
   this._conn=conn;this.options.onConnect(conn);return {resolve,reject,conn};
  }
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,exports:module.exports,__dirname:path.dirname(source),process,Buffer,
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},
  require:name=>modules[name]||(name==='./vendor/root-agent'?{RootAgentServer:Channel}:name==='./vendor/sdb'?{connect:()=>new Promise(()=>{}),close:()=>{}}:realRequire(name))});
 const agent=module.exports.createAgent({device,...config},{verifyFirmware:()=>{},readBootId:()=>BOOT,...options});
 return {agent,channels,timers};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('inventory requires explicit capability bounded identities and known shapes',()=>{
 const info=inventoried();assert.equal(validateResourceInventory(info),info.resources);
 const invalid=[v=>v.capabilities=v.capabilities.filter(c=>c!=='resource-inventory-v1'),v=>v.resources.scope='all',v=>v.resources.extra=true,
  v=>v.resources.jobs.push({id:'valid-job-identity',state:'running',monitor_finished:'false'}),
  v=>v.resources.transfers.push({id:'a'.repeat(32),direction:'other'}),
  v=>v.resources.helpers=Array(9).fill('a'.repeat(32)),v=>v.resources.helpers=['a'.repeat(32),'a'.repeat(32)],
  v=>v.resources.jobs=Array(17).fill({id:'valid-job-identity',state:'running',monitor_finished:false})];
 for(const change of invalid){const v=inventoried();change(v);assert.throws(()=>validateResourceInventory(v));}
 assert.throws(()=>validateResourceInventory(managed()));
});
test('handoff hold drains admitted work and takes fresh inventory before explicit release',async()=>{
 const {agent,channels}=fixture();agent.start();const channel=channels[0],ready=channel.connect();
 try{
  ready.resolve(managed());await flush();
  let complete;channel.execute=()=>new Promise(resolve=>{complete=resolve;});
  let reads=0;const info=inventoried();info.resources.jobs.push({id:'active-job-identity',state:'running',monitor_finished:false});
  channel.operation=async value=>{assert.equal(value.op,'status');reads++;return info;};
  const execution=agent.execute('running command',1000),hold=agent.holdAdmission();
  assert.equal(agent.status().admission_held,true);assert.equal(agent.status().in_flight_requests,1);
  assert.equal(agent.status().worker_ready,false);assert.equal(agent.status().phase,'draining');
  assert.throws(()=>agent.holdAdmission());
  await assert.rejects(agent.operation({op:'job.start'}),e=>e.outcome==='rejected');
  await assert.rejects(agent.execute('must not run',100),e=>e.outcome==='rejected');
  const inventory=hold.snapshot();await flush();assert.equal(reads,0);
  complete({exit_code:0});await execution;const snapshot=await inventory;
  assert.equal(reads,1);assert.equal(snapshot.worker_id,managed().worker_id);assert.equal(snapshot.resources.jobs[0].state,'running');
  assert.equal(agent.status().in_flight_requests,0);assert.equal(agent.status().admission_held,true);
  snapshot.resources.jobs.length=0;assert.equal(info.resources.jobs.length,1);
  hold.release();assert.equal(agent.status().admission_held,false);assert.throws(()=>hold.release());
  assert.equal(agent.status().worker_ready,true);
  await agent.operation({op:'status'});assert.equal(reads,2);
 }finally{agent.stop();}
});
test('uncertain drain and old workers leave admission held without reading or replaying',async()=>{
 for(const outcome of ['unknown',undefined,'failed','rejected']){
  const {agent,channels}=fixture();agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();let reject;
   channel.execute=()=>new Promise((yes,no)=>{reject=no;});let reads=0;
   channel.operation=async()=>{reads++;return inventoried();};
   const request=agent.execute('once',1000);const failed=assert.rejects(request);
   const hold=agent.holdAdmission(),snapshot=hold.snapshot();
   const expected=['failed','rejected'].includes(outcome)?snapshot:assert.rejects(snapshot,/Uncertain request/);
   reject(Object.assign(Error('failure'),{outcome}));await failed;await expected;
   assert.equal(reads,['failed','rejected'].includes(outcome)?1:0);assert.equal(agent.status().admission_held,true);
   hold.release();
  }finally{agent.stop();}
 }
});
test('handoff inventory refuses replacement connections late replies and legacy status',async()=>{
 for(const mode of ['replacement','stop','legacy','wrong-worker']){
  const {agent,channels}=fixture();agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();let finish;
   channel.operation=()=>new Promise(resolve=>{finish=resolve;});
   const hold=agent.holdAdmission(),snapshot=hold.snapshot(),refused=assert.rejects(snapshot);await flush();
   if(mode==='replacement'){ready.conn._socket.destroy();const next=channel.connect();next.resolve(managed());await flush();}
   if(mode==='stop')agent.stop();
   const info=mode==='legacy'?managed():inventoried();if(mode==='wrong-worker')info.worker_id='c'.repeat(32);
   finish(info);await refused;
   if(['replacement','stop'].includes(mode))assert.throws(()=>hold.release());
   else{assert.equal(agent.status().admission_held,true);hold.release();}
  }finally{agent.stop();}
 }
});
test('service blocks operations while checking and clears readiness on disconnect',async()=>{
 const {agent,channels}=fixture();agent.start();const channel=channels[0],pending=channel.connect();
 try{
  assert.equal(agent.status().phase,'checking');
  await assert.rejects(agent.execute('true',100),e=>e.outcome==='rejected');
  await assert.rejects(agent.operation({op:'file.status'}),e=>e.outcome==='rejected');
  assert.equal(channel.executions,0);
  pending.resolve(managed());await flush();assert.equal(agent.status().worker_ready,true);
  await agent.execute('true',100);assert.equal(channel.executions,1);
  pending.conn._socket.destroy();assert.equal(agent.status().worker_ready,false);assert.equal(agent.status().worker_id,null);assert.deepEqual(Array.from(agent.status().capabilities),[]);
 }finally{agent.stop();}
});
test('late status cannot revive disconnected or superseded generations',async()=>{
 for(const restart of [false,true]){
  const {agent,channels}=fixture();agent.start();const pending=channels[0].connect();
  try{
   if(restart){agent.stop();agent.start();}else pending.conn._socket.destroy();
   pending.resolve(managed());await flush();assert.equal(agent.status().worker_ready,false);assert.equal(agent.status().last_root_acquired_at,null);
  }finally{agent.stop();}
 }
});
test('invalid managed readiness closes the connection before command admission',async()=>{
 const {agent,channels}=fixture();agent.start();const pending=channels[0].connect();
 try{
  pending.resolve(native());await flush();assert.equal(agent.status().connected,false);assert.equal(agent.status().worker_ready,false);
  assert.match(agent.status().last_error,/implementation mismatch/);await assert.rejects(agent.execute('true',100));assert.equal(channels[0].executions,0);
 }finally{agent.stop();}
});

test('late rejection from a closed peer cannot overwrite its replacement readiness',async()=>{
 const {agent,channels}=fixture();agent.start();const old=channels[0].connect();old.conn._socket.destroy();
 const replacement=channels[0].connect();
 try{
  replacement.resolve(managed());await flush();assert.equal(agent.status().worker_ready,true);
  old.reject(Error('stale status failure'));await flush();
  assert.equal(agent.status().worker_ready,true);assert.equal(agent.status().last_error,null);
 }finally{agent.stop();}
});

test('a newly pending selection blocks admission without silently killing active work',async()=>{
 const os=require('node:os'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-admission-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);
 const managedVersion='a'.repeat(64);journal.initialize({implementation:'managed',manifest_sha256:managedVersion});
 const {agent,channels}=fixture({selectionFile:file,managedVersion:()=>managedVersion});agent.start();const pending=channels[0].connect();
 try{
  pending.resolve(managed());await flush();assert.equal(agent.status().worker_ready,true);
  journal.begin(1,{implementation:'native-prototype',manifest_sha256:'b'.repeat(64)},'c'.repeat(64));
  assert.equal(agent.status().phase,'selection-required');assert.equal(agent.status().worker_ready,false);assert.equal(agent.status().connected,true);
  await assert.rejects(agent.execute('true',100),e=>e.outcome==='rejected');await assert.rejects(agent.operation({op:'job.start'}),e=>e.outcome==='rejected');assert.equal(channels[0].executions,0);
 }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('handoff shutdown binds durable inventory, observes exit, and suppresses reacquisition',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-stop-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);
 journal.initialize({implementation:'managed',manifest_sha256:DIGEST});let live=true,stops=0;
 const readProcessFile=p=>{if(p.endsWith('boot_id'))return BOOT;if(!live)throw Object.assign(Error('gone'),{code:'ENOENT'});return '42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0';};
 const {agent,channels,timers}=fixture({selectionFile:file,managedVersion:()=>DIGEST,readProcessFile});
 agent.start();const channel=channels[0],ready=channel.connect();
 try{
  ready.resolve(managed());await flush();channel.operation=async()=>inventoried();
  const hold=agent.holdAdmission(),inventory=await hold.snapshot();
  await assert.rejects(hold.shutdown('unbound'),/Selection/);assert.equal(stops,0);
  const digest=crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
  const state=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},digest);
  channel.shutdown=async()=>{stops++;live=false;ready.conn._socket.destroy();return {acknowledged:true,disconnected:true};};
  const outcomes=await Promise.allSettled([hold.shutdown(state.pending.id),hold.shutdown(state.pending.id)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
  const result=outcomes.find(r=>r.status==='fulfilled').value;
  assert.equal(result.transaction_id,state.pending.id);assert.equal(result.source_manifest_sha256,DIGEST);
  assert.equal(result.inventory_sha256,digest);assert.equal(result.exited.processes.worker.observation,'absent');assert.equal(stops,1);
  assert.equal(agent.status().connected,false);assert.equal(agent.status().admission_held,true);assert.equal(timers.length,0);
  await assert.rejects(agent.execute('must not replay',100),e=>e.outcome==='rejected');
  await assert.rejects(hold.shutdown(state.pending.id));assert.throws(()=>hold.release());
  const unwanted=channel.connect();assert.equal(channel._conn,null);assert.equal(timers.length,0);unwanted.resolve(managed());await flush();assert.equal(agent.status().worker_ready,false);
  assert.equal(journal.read().pending.phase,'prepared'); // No state installation or commit is implied.
 }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('shutdown refuses active resources changed inventory and unreadable process identity',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 for(const mode of ['transfer','helper','running','unknown','not-monitored','changed-inventory','denied','reused']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-refuse-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);
  journal.initialize({implementation:'managed',manifest_sha256:DIGEST});let stops=0;
  const readProcessFile=p=>{if(p.endsWith('boot_id'))return BOOT;if(mode==='denied')throw Object.assign(Error('denied'),{code:'EACCES'});return '42 (worker) S '+Array(18).fill('0').join(' ')+' '+(mode==='reused'?'124':'123')+' 0';};
  const {agent,channels}=fixture({selectionFile:file,managedVersion:()=>DIGEST,readProcessFile});agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();const info=inventoried();
   if(mode==='transfer')info.resources.transfers.push({id:'a'.repeat(32),direction:'upload'});
   if(mode==='helper')info.resources.helpers.push('a'.repeat(32));
   if(['running','unknown','not-monitored'].includes(mode))info.resources.jobs.push({id:'active-job-identity',state:mode==='not-monitored'?'completed':mode,monitor_finished:mode==='unknown'});
   channel.operation=async()=>info;channel.shutdown=async()=>{stops++;throw Error('must not stop');};
   const hold=agent.holdAdmission(),inventory=await hold.snapshot(),digest=crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
   const state=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},digest);
   if(mode==='changed-inventory')info.resources.jobs.push({id:'completed-job-identity',state:'completed',monitor_finished:true});
   await assert.rejects(hold.shutdown(state.pending.id));assert.equal(stops,0);assert.equal(agent.status().admission_held,true);
   assert.equal(journal.read().pending.phase,'prepared');
  }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('packaged observer staging binds target transaction and never retries uncertainty',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 for(const mode of ['success','lost','changed','target']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'observer-stage-hold-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);
  journal.initialize({implementation:'managed',manifest_sha256:DIGEST});const events=[];
  const modules={
   './observer-stage':{stageObserver:async input=>{
    events.push('stage');assert.equal(input.expectedManifest,'c'.repeat(64));assert.equal(input.bootId,BOOT);
    await input.execute('stage fixture',25000);return {binary:'/fixture',sha256:'d'.repeat(64),manifest_sha256:input.expectedManifest};
   }},
   './pidfd-observer':{preparePidfdExit:async input=>{
    events.push('bind');await input.confirm();events.push('confirm');
    return {assertReady:()=>{},waitForExit:async()=>{events.push('exit');return {method:'pidfd'};},cancel:async()=>events.push('cancel')};
   }}
  };
  const {agent,channels}=fixture({selectionFile:file,managedVersion:()=>DIGEST,stagePackagedObserver:true},modules);
  agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();channel.operation=async()=>inventoried();
   const hold=agent.holdAdmission(),inventory=await hold.snapshot();
   await assert.rejects(hold.shutdown('missing'));assert.deepEqual(events,[]);
   const digest=crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
   const state=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},digest);
   channel.execute=async()=>{events.push('execute');if(mode==='lost')throw Error('lost stage reply');if(mode==='changed')journal.advance(2,state.pending.id,'state-ready','d'.repeat(64));if(mode==='target'){const altered=journal.read();altered.pending.to.manifest_sha256='e'.repeat(64);fs.writeFileSync(file,JSON.stringify(altered));}return {exit_code:0};};
   channel.shutdown=async()=>{events.push('shutdown');ready.conn._socket.destroy();return {acknowledged:true,disconnected:true};};
   if(mode==='success'){
    const result=await hold.shutdown(state.pending.id);assert.equal(result.observer_stage.manifest_sha256,'c'.repeat(64));
    assert.deepEqual(events,['stage','execute','bind','confirm','shutdown','exit','cancel']);
   }else{
    await assert.rejects(hold.shutdown(state.pending.id));assert.throws(()=>hold.release(),/unresolved observer staging/);
    await assert.rejects(hold.shutdown(state.pending.id),/reconciliation/);assert.deepEqual(events,['stage','execute']);
    assert.equal(agent.status().connected,true);
   }
  }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('observer probe runs in held service context and releases without stopping the worker',async()=>{
 for(const device of ['qn90a','s90d'])for(const failure of [false,true,'known']){
  const events=[],modules={
   './observer-stage':{stageObserver:async input=>{events.push('stage');assert.equal(input.expectedManifest,DIGEST);await input.execute('stage fixture',25000);return {binary:'/fixture',sha256:'d'.repeat(64),manifest_sha256:DIGEST};}},
   './pidfd-observer':{probeExecutable:async()=>{events.push('execute-observer');if(failure)throw Object.assign(Error('probe refused'),failure==='known'?{outcome:'failed'}:{});},preparePidfdExit:async input=>{events.push('bind');await input.confirm();return {assertReady:()=>{},cancel:async()=>events.push('cancel')};}}
  };
  const readProcessFile=p=>p.endsWith('boot_id')?BOOT:'42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0';
  const {agent,channels}=fixture({readProcessFile},modules,device);agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();channel.operation=async()=>inventoried();channel.execute=async()=>{events.push('stage-command');return {exit_code:0};};
   channel.shutdown=async()=>{throw Error('Probe must not submit shutdown');};
   if(failure&&device==='s90d'){await assert.rejects(agent.probeObserver(DIGEST),/probe refused/);assert.equal(agent.status().admission_held,failure!=='known');if(failure!=='known')await assert.rejects(agent.probeObserver(DIGEST));}
   else{
    const result=await agent.probeObserver(DIGEST);assert.equal(result.worker_stopped,false);assert.equal(result.manifest_sha256,DIGEST);
    assert.equal(result.method,device==='s90d'?'pidfd-bind-cancel':'proc-stat');
    assert.equal(agent.status().admission_held,false);assert.equal(agent.status().worker_ready,true);
   }
   assert.equal(agent.status().connected,true);assert.equal(events.filter(e=>e==='stage-command').length,1);
   assert.equal(events.includes('execute-observer'),device==='s90d');
   assert.equal(events.includes('cancel'),!failure&&device==='s90d');
  }finally{agent.stop();}
 }
});

test('QN90A proc-stat probe refuses unreadable or replaced workers without launching a child',async()=>{
 for(const kind of ['unreadable','replaced']){
  let launches=0;
  const modules={
   './observer-stage':{stageObserver:async()=>({manifest_sha256:DIGEST,sha256:'d'.repeat(64)})},
   './pidfd-observer':{probeExecutable:async()=>{launches++;throw Error('Unexpected child launch');},preparePidfdExit:async()=>{launches++;throw Error('Unexpected pidfd launch');}}
  };
  const readProcessFile=p=>{
   if(p.endsWith('boot_id'))return BOOT;
   if(kind==='unreadable')throw Object.assign(Error('denied'),{code:'EACCES'});
   return '42 (replacement) S '+Array(18).fill('0').join(' ')+' 999 0';
  };
  const {agent,channels}=fixture({readProcessFile},modules,'qn90a');agent.start();
  const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();channel.operation=async()=>inventoried();
   channel.shutdown=async()=>{throw Error('Probe must not stop worker');};
   await assert.rejects(agent.probeObserver(DIGEST));
   assert.equal(launches,0);assert.equal(agent.status().connected,true);
   assert.equal(agent.status().admission_held,true);
  }finally{agent.stop();}
 }
});

test('unqualified service child-process transport rejects before staging or shutdown and releases admission',async()=>{
 let mutations=0;
 const forbidden=()=>{mutations++;throw Error('Unexpected mutation');};
 const modules={'./observer-stage':{stageObserver:forbidden},'./pidfd-observer':{probeExecutable:forbidden,preparePidfdExit:forbidden}};
 const {agent,channels}=fixture({observerChildProcess:false,stagePackagedObserver:true},modules,'s90d');
 agent.start();const channel=channels[0],ready=channel.connect();
 try{
  ready.resolve(managed());await flush();channel.execute=forbidden;channel.shutdown=forbidden;
  await assert.rejects(agent.probeObserver(DIGEST),e=>e.outcome==='rejected'&&/external launch transport/.test(e.message));
  assert.equal(agent.status().worker_ready,true);assert.equal(agent.status().admission_held,false);
  const hold=agent.holdAdmission();
  await assert.rejects(hold.shutdown('unused'),e=>e.outcome==='rejected'&&/external launch transport/.test(e.message));
  hold.release();assert.equal(agent.status().worker_ready,true);assert.equal(mutations,0);
 }finally{agent.stop();}
});

test('external service probe confirms fresh status and cleans up while retaining shutdown guard',async()=>{
 for(const failure of [false,'submission','cleanup','missing-id']){
  const events=[],runtime=require('../research/autonomous-root/service/observer-runtime');
  const modules={
   './observer-stage':{stageObserver:async input=>{events.push('stage');await input.execute('stage',25000);return {manifest_sha256:DIGEST,sha256:'d'.repeat(64)};}},
   './pidfd-observer':{probeExecutable:async()=>{throw Error('Forbidden child launch');},preparePidfdExit:async()=>{throw Error('Forbidden child launch');}},
   './observer-runtime':{observerTransactionId:runtime.observerTransactionId,prepareRuntimeObserver:async input=>{
    events.push('external');assert.equal(input.requestId,'external-probe-identity');assert.equal(input.directory,'/fixture');
    if(failure==='submission')throw Error('Submission unknown');
    await input.execute('submit',25000);
    const fresh=await input.confirm();assert.ok(fresh.capabilities.includes('worker-process-identity-v1'));assert.equal(fresh.worker_id,input.bound.worker_id);
    return {assertReady:()=>events.push('armed'),cancel:async()=>{events.push('cleanup');await input.execute('inspect-retire',5000);if(failure==='cleanup')throw Error('Cleanup unknown');}};
   }}
  };
  const {agent,channels}=fixture({observerChildProcess:false,stagePackagedObserver:true,externalObserverDirectory:'/fixture'},modules,'s90d');
  agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();channel.operation=async()=>inventoried();channel.execute=async()=>({exit_code:0});channel.shutdown=async()=>{throw Error('Forbidden shutdown');};
   if(failure){
    await assert.rejects(agent.probeObserver(DIGEST,failure==='missing-id'?undefined:'external-probe-identity'));
    assert.equal(agent.status().admission_held,failure!=='missing-id');
    if(failure==='missing-id')assert.deepEqual(events,[]);
   }else{
    const result=await agent.probeObserver(DIGEST,'external-probe-identity');assert.equal(result.method,'pidfd-external-bind-cancel');
    assert.deepEqual(events,['stage','external','armed','cleanup']);assert.equal(agent.status().admission_held,false);
    const hold=agent.holdAdmission();await assert.rejects(hold.shutdown('unused'),/external launch transport/);hold.release();
   }
   assert.equal(agent.status().connected,true);
   assert.equal(agent.status().worker_ready,!failure||failure==='missing-id');
  }finally{agent.stop();}
 }
});

test('external handoff uses independent cleanup after disconnect and retains pending ownership',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 for(const failure of [false,'cleanup','drift']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'external-handoff-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);
  journal.initialize({implementation:'managed',manifest_sha256:DIGEST});
  let departed=false,stops=0,cleanup=0;const info=inventoried();
  const retirement={inspectUnit:async()=>{assert.equal(departed,true);cleanup++;return {};},retireUnit:async()=>{assert.equal(departed,true);cleanup++;if(failure==='cleanup')throw Error('Independent cleanup unknown');}};
  const modules={
   './observer-stage':{stageObserver:async o=>{await o.execute('stage',1000);return {sha256:DIGEST,manifest_sha256:'c'.repeat(64)};}},
   './pidfd-observer':{preparePidfdExit:()=>{throw Error('Forbidden WRT child launch');}},
   './observer-runtime':{prepareRuntimeObserver:async o=>{
    assert.equal(o.purpose,'handoff');assert.equal(o.retirement,retirement);assert.equal(o.staged.manifest_sha256,'c'.repeat(64));
    await o.execute('submit',1000);
    if(failure==='drift')info.resources.jobs.push({id:'late-job-identity',state:'running',monitor_finished:false});
    const fresh=await o.confirm();assert.equal(fresh.worker_id,info.worker_id);
    return {assertReady:()=>assert.equal(departed,false),waitForExit:async()=>{assert.equal(departed,true);return {method:'external-fixture'};},cancel:async()=>{await o.retirement.inspectUnit();await o.retirement.retireUnit();}};
   }}
  };
  const {agent,channels}=fixture({selectionFile:file,managedVersion:()=>DIGEST,observerChildProcess:false,stagePackagedObserver:true,externalObserverDirectory:'/fixture',externalObserverRetirement:retirement},modules,'s90d');
  agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();channel.operation=async()=>info;
   channel.execute=async()=>{assert.equal(departed,false);return {exit_code:0};};
   channel.shutdown=async()=>{stops++;departed=true;ready.conn._socket.destroy();return {acknowledged:true};};
   const hold=agent.holdAdmission(),inventory=await hold.snapshot();
   const prepared=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex'));
   if(failure)await assert.rejects(hold.shutdown(prepared.pending.id),failure==='drift'?/inventory changed/:/cleanup unknown/);
   else assert.equal((await hold.shutdown(prepared.pending.id)).exited.method,'external-fixture');
   assert.equal(stops,failure==='drift'?0:1);assert.equal(cleanup,failure==='drift'?0:2);
   assert.equal(agent.status().admission_held,true);assert.equal(journal.read().pending.phase,'prepared');
   await assert.rejects(agent.execute('must not replay',100),e=>e.outcome==='rejected');
  }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('service provider probe uses independent observer retirement then tears down without stopping source',async()=>{
 for(const device of ['qn90a','s90d'])for(const failure of [false,'launch','observer','retire','missing-id']){
  const events=[],runtime=require('../research/autonomous-root/service/observer-runtime'),provider={inspectUnit(){},retireUnit(){}};
  const modules={
   './observer-stage':{stageObserver:async input=>{events.push('stage');await input.execute('stage',1000);return {manifest_sha256:DIGEST,sha256:'d'.repeat(64)};}},
   './pidfd-observer':{probeExecutable:()=>{throw Error('Forbidden WRT launch');},preparePidfdExit:()=>{throw Error('Forbidden WRT launch');}},
   './retirement-session':{openRetirementSession:async input=>{
    events.push('provider-launch');assert.equal(input.device,device);assert.equal(input.id,runtime.observerTransactionId('provider-probe-request','provider-probe'));assert.equal(input.manifestSha256,DIGEST);assert.equal(input.journalDirectory,'/fixture');
    const fresh=await input.confirmSource();assert.equal(fresh.worker_id,input.source.worker_id);await input.execute('provider-launch',1000);
    if(failure==='launch')throw Error('Provider launch uncertain');
    return {provider,closeTransport:()=>events.push('provider-close'),retire:async executor=>{events.push('provider-retire');assert.equal(executor.executorPid,42);assert.equal((await executor.confirmExecutor()).worker_id,fresh.worker_id);await executor.execute('provider-cleanup',1000);if(failure==='retire')throw Error('Provider retirement uncertain');return {phase:'complete'};}};
   }},
   './observer-runtime':{observerTransactionId:runtime.observerTransactionId,prepareRuntimeObserver:async input=>{
    events.push('observer');assert.equal(input.purpose,'provider-probe');assert.equal(input.retirement,provider);assert.equal(input.requestId,'provider-probe-request');await input.confirm();
    if(failure==='observer')throw Error('Observer uncertain');return {assertReady(){},cancel:async()=>events.push('observer-retire')};
   }}
  };
  const readProcessFile=p=>p.endsWith('boot_id')?BOOT:'42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0';
  const {agent,channels}=fixture({readProcessFile,observerChildProcess:false,stagePackagedObserver:device==='s90d',retirementProbeDirectory:'/fixture',externalObserverDirectory:device==='s90d'?'/fixture':undefined},modules,device);
  agent.start();const channel=channels[0],ready=channel.connect();
  try{
   ready.resolve(managed());await flush();channel.operation=async()=>inventoried();channel.execute=async()=>({exit_code:0});channel.shutdown=async()=>{throw Error('Source must remain running');};
   const failed=failure&&!(failure==='observer'&&device==='qn90a');
   if(failed){await assert.rejects(agent.probeObserver(DIGEST,failure==='missing-id'?undefined:'provider-probe-request'));assert.equal(agent.status().admission_held,failure!=='missing-id');if(failure==='missing-id')assert.deepEqual(events,[]);}
   else{const result=await agent.probeObserver(DIGEST,'provider-probe-request');assert.equal(result.worker_stopped,false);assert.equal(result.retirement_provider_verified,true);assert.equal(result.retirement_provider_retired,true);assert.equal(agent.status().admission_held,false);assert.deepEqual(events,['stage','provider-launch',...(device==='s90d'?['observer','observer-retire']:[]),'provider-retire','provider-close']);}
   assert.equal(agent.status().connected,true);
   if(failure==='observer'&&device==='s90d'){assert.equal(events.includes('provider-retire'),false);assert.equal(events.at(-1),'provider-close');}
   if(failure==='retire')assert.equal(events.at(-1),'provider-close');
  }finally{agent.stop();}
 }
});

test('stopped handoff adopts matching native channel while retaining admission and ignoring stale callbacks',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
 for(const mode of ['ok','activation-failure','retirement-failure','identity-drift','selection-drift']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-adoption-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);journal.initialize({implementation:'managed',manifest_sha256:DIGEST});let live=true,taken=0,closed=0;
  const readProcessFile=p=>{if(p.endsWith('boot_id'))return BOOT;if(!live)throw Object.assign(Error('gone'),{code:'ENOENT'});return '42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0';};
  const activationModule={activateProduction:async o=>{if(mode==='retirement-failure')assert.equal(o.resume,false,'activation was never submitted before retirement reconciliation');await o.confirmNative();await o.execute('activation check',1000);if(mode==='activation-failure'&&!o.resume)throw Error('activation publication lost');return {readiness_sha256:digest(o.record),receipt_sha256:'9'.repeat(64)};}};
  const {agent,channels,timers}=fixture({selectionFile:file,managedVersion:()=>DIGEST,readProcessFile},{'./production-activation':activationModule});agent.start();const old=channels[0],ready=old.connect();
  try{
   ready.resolve(managed());await flush();old.operation=async()=>inventoried();const hold=agent.holdAdmission(),inventory=await hold.snapshot();
   const transition=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},digest(inventory));
   const info={...native(),worker_id:'f'.repeat(32),guardian_pid:51,processes:{worker:{pid:52,start_ticks:'200'},guardian:{pid:51,start_ticks:'199'}},resources:{schema:1,scope:'worker-owned',jobs:[],helpers:[],transfers:[]}};info.capabilities.push('worker-process-identity-v1','resource-inventory-v1');
   const identity={boot_id:BOOT,worker_id:info.worker_id,processes:info.processes},source={boot_id:BOOT,worker_id:inventory.worker_id,processes:inventory.processes};
   const record={schema:1,id:transition.pending.id,phase:'ready',device:'qn90a',manifest_sha256:'c'.repeat(64),state_receipt_sha256:'d'.repeat(64),worker_sha256:'e'.repeat(64),launcher_sha256:DIGEST,source,boot_id:BOOT,unit:'couchroot-worker-'+transition.pending.id+'.service',directory:'/opt/couchroot-worker-'+transition.pending.id,scope:'/opt/couchroot-worker-'+transition.pending.id+'/state',port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',token_sha256:'e'.repeat(64),worker_identity:identity,unit_started_monotonic:'123'};
   const next={_conn:{identity:{pid:52,uid:0,euid:0,gid:0,egid:0,smack:'System'}},operation:async()=>mode==='identity-drift'?{...info,worker_id:'0'.repeat(32)}:info,execute:async()=>({exit_code:0,stdout:'native'}),close(){this._conn=null;if(this.onClose)this.onClose();}};
   const session={record,readiness_sha256:digest(record),takeChannel:async()=>{taken++;if(mode==='selection-drift')journal.begin(5,{implementation:'managed',manifest_sha256:DIGEST},'a'.repeat(64));return next;},closeTransport:()=>{closed++;next.close();}};
   await assert.rejects(hold.adoptProduction(session),/Stopped handoff/);assert.equal(taken,0);
   old.shutdown=async()=>{live=false;ready.conn._socket.destroy();return {acknowledged:true,disconnected:true};};await hold.shutdown(transition.pending.id);
   journal.advance(2,transition.pending.id,'state-ready',record.state_receipt_sha256);journal.advance(3,transition.pending.id,'trial-ready',session.readiness_sha256);
   await assert.rejects(hold.adoptProduction(session),/Committed production/);assert.equal(taken,0);journal.commit(4,transition.pending.id);
   if(['ok','activation-failure','retirement-failure'].includes(mode)){
    const adopted=await hold.adoptProduction(session);assert.equal(adopted.worker_id,info.worker_id);assert.equal(adopted.admission_held,true);assert.equal(agent.status().connected,true);assert.equal(agent.status().worker_id,info.worker_id);assert.equal(agent.status().identity.pid,52);
    old.options.onClose();assert.equal(agent.status().connected,true);assert.equal(agent.status().worker_id,info.worker_id);
    await assert.rejects(agent.execute('not admitted',100),e=>e.outcome==='rejected');await assert.rejects(hold.adoptProduction(session));assert.throws(()=>hold.release());assert.equal(taken,1);assert.equal(timers.length,0);
    const retirementSession={record:{source,manifest_sha256:record.manifest_sha256},retire:async o=>{assert.equal(o.executorPid,52);assert.equal((await o.confirmExecutor()).worker_id,info.worker_id);await o.execute('retire provider',1000);if(mode==='retirement-failure')throw Error('cleanup acknowledgement lost');return {phase:'complete'};}};
    if(mode==='retirement-failure'){let reconciled=0;retirementSession.resumeRetirement=async o=>{reconciled++;assert.equal((await o.confirmExecutor()).worker_id,info.worker_id);return {phase:'complete'};};await assert.rejects(hold.completeProduction(retirementSession),e=>e.outcome==='unknown');assert.equal(agent.status().admission_held,true);retirementSession.retire=async()=>{throw Error('Must not repeat shutdown');};const active=await hold.completeProduction(retirementSession,{resume:true});assert.equal(active.admission_held,false);assert.equal(reconciled,1);assert.equal(agent.status().worker_ready,true);}
    else if(mode==='activation-failure'){await assert.rejects(hold.completeProduction(retirementSession),e=>e.outcome==='unknown');assert.equal(agent.status().admission_held,true);await assert.rejects(agent.execute('not admitted',100));retirementSession.retire=async()=>{throw Error('Must not repeat retirement');};const resumed=await hold.completeProduction(retirementSession,{resume:true});assert.equal(resumed.admission_held,false);assert.equal(agent.status().worker_ready,true);}
    else{const active=await hold.completeProduction(retirementSession);assert.equal(active.admission_held,false);assert.equal(agent.status().worker_ready,true);assert.equal(agent.status().phase,'ready');assert.equal(agent.status().native_runtime.transaction_id,session.record.id);assert.equal(agent.status().native_runtime.activation_sha256,active.activation_sha256);assert.equal((await agent.execute('public request',100)).stdout,'native');old.options.onClose();assert.equal(agent.status().worker_ready,true);}
    await assert.rejects(hold.completeProduction(retirementSession));
    next.close();assert.equal(agent.status().connected,false);assert.equal(agent.status().native_runtime,null);assert.match(agent.status().last_error,/reconciliation required/);assert.equal(timers.length,1);
   }else{await assert.rejects(hold.adoptProduction(session),e=>e.outcome==='unknown');assert.equal(closed,1);assert.equal(agent.status().admission_held,true);await assert.rejects(hold.adoptProduction(session));assert.equal(taken,1);}
  }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('native preparation binds held inventory and prevents shutdown during provider startup',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection'),{observerTransactionId}=require('../research/autonomous-root/service/observer-runtime');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'held-provider-')),file=path.join(dir,'selection.json'),journal=new SelectionJournal(file);journal.initialize({implementation:'managed',manifest_sha256:DIGEST});
 let release,launchOptions;const waiting=new Promise(resolve=>{release=resolve;}),session={provider:{},retire:async()=>{}};
 const modules={'./retirement-session':{openRetirementSession:async options=>{launchOptions=options;await options.execute('stage provider',1000);assert.equal((await options.confirmSource()).worker_id,managed().worker_id);await waiting;return session;}}};
 const {agent,channels}=fixture({selectionFile:file,managedVersion:()=>DIGEST},modules);agent.start();const channel=channels[0],ready=channel.connect();
 try{
  ready.resolve(managed());await flush();channel.operation=async()=>inventoried();channel.execute=async()=>({exit_code:0});const hold=agent.holdAdmission(),inventory=await hold.snapshot();
  const transition=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex'));
  const preparing=hold.prepareNative(transition.pending.id);await flush();assert.equal(launchOptions.id,observerTransactionId(transition.pending.id,'handoff'));assert.equal(launchOptions.journalDirectory,dir);assert.equal(launchOptions.manifestSha256,'c'.repeat(64));
  await assert.rejects(hold.shutdown(transition.pending.id),/reconciliation/);assert.throws(()=>hold.release());release();assert.equal(await preparing,session);await assert.rejects(hold.prepareNative(transition.pending.id));assert.throws(()=>hold.release());assert.equal(agent.status().admission_held,true);
 }finally{release();agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('held handoff adopts managed rollback with admission closed and stale callbacks invalidated',async()=>{
 const os=require('node:os'),crypto=require('node:crypto'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
 const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
 for(const mode of ['ok','after-native-adoption','identity-drift','profile-drift','selection-drift','receipt-drift','cleanup-failure','provider-failure','activation-failure','final-drift','native-stop-identity','native-stop-selection','native-stop-shutdown','native-stop-both','native-stop-exit','native-stop-journal','native-stop-publish','native-stop-renamed']){
  const nativeReturn=mode==='after-native-adoption'||mode.startsWith('native-stop-');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'managed-adoption-')),file=dir+'/selection.json',journal=new SelectionJournal(file);journal.initialize({implementation:'managed',manifest_sha256:DIGEST});let live=true,taken=0,closed=0;
  const readProcessFile=p=>{if(p.endsWith('boot_id'))return BOOT;if(!live)throw Object.assign(Error('gone'),{code:'ENOENT'});return '42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0';};
  const events=[];let finalDrift=false;
  const modules={
   './production-retirement':{retireProduction:async o=>{events.push('native');assert.equal((await o.confirmManaged()).processes.worker.pid,73);await o.execute('native cleanup',1000);if(mode==='cleanup-failure')throw Error('cleanup unknown');return {phase:'staging-retired'};}},
   './managed-activation':{activateManaged:async o=>{events.push('activate');assert.equal(o.retired.phase,'complete');await o.confirmManaged();await o.execute('activation check',1000);if(mode==='activation-failure'&&!o.resume)throw Error('publication unknown');if(mode==='final-drift')finalDrift=true;return {receipt_sha256:'9'.repeat(64)};}}
  };
  // Fail the first stopped-receipt publication either before or after its rename.
  let publishFailures=['native-stop-publish','native-stop-renamed'].includes(mode)?1:0;
  if(publishFailures){const policy=require('../research/autonomous-root/service/policy');modules['./policy']={...policy,atomic:(target,value)=>{if(target.endsWith('.native-stop.json')&&publishFailures){publishFailures--;if(mode==='native-stop-renamed')policy.atomic(target,value);throw Error('stopped receipt publication failed');}return policy.atomic(target,value);}};}
  const {agent,channels,timers}=fixture({selectionFile:file,managedVersion:()=>DIGEST,readProcessFile},modules);agent.start();const old=channels[0],ready=old.connect();
  try{
   ready.resolve(managed());await flush();old.operation=async()=>inventoried();const hold=agent.holdAdmission(),inventory=await hold.snapshot(),source={boot_id:BOOT,worker_id:inventory.worker_id,processes:inventory.processes};
   const transition=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},digest(inventory)),origin=transition.pending.id;
   const nativeInfo={...native(),worker_id:'f'.repeat(32),guardian_pid:51,processes:{worker:{pid:52,start_ticks:'200'},guardian:{pid:51,start_ticks:'199'}},resources:{schema:1,scope:'worker-owned',jobs:[],helpers:[],transfers:[]}};nativeInfo.capabilities.push('worker-process-identity-v1','resource-inventory-v1');
   const nativeIdentity={boot_id:BOOT,worker_id:nativeInfo.worker_id,processes:nativeInfo.processes},nativeRecord={schema:1,id:origin,phase:'ready',device:'qn90a',manifest_sha256:'c'.repeat(64),state_receipt_sha256:'d'.repeat(64),worker_sha256:'e'.repeat(64),launcher_sha256:DIGEST,source,boot_id:BOOT,unit:'couchroot-worker-'+origin+'.service',directory:'/opt/couchroot-worker-'+origin,scope:'/opt/couchroot-worker-'+origin+'/state',port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',token_sha256:'e'.repeat(64),worker_identity:nativeIdentity,unit_started_monotonic:'123'};
   old.shutdown=async()=>{live=false;ready.conn._socket.destroy();return {acknowledged:true,disconnected:true};};await hold.shutdown(origin);
   let id=origin,nativeChannel;
   if(nativeReturn){
    journal.advance(2,origin,'state-ready',nativeRecord.state_receipt_sha256);journal.advance(3,origin,'trial-ready',digest(nativeRecord));journal.commit(4,origin);
    nativeChannel={_conn:{identity:{pid:52,uid:0,euid:0,gid:0,egid:0,smack:'System'}},operation:async()=>nativeInfo,close(){this._conn=null;if(this.onClose)this.onClose();}};
    await hold.adoptProduction({record:nativeRecord,readiness_sha256:digest(nativeRecord),takeChannel:async()=>nativeChannel,closeTransport:()=>nativeChannel.close()});
    id=journal.begin(5,{implementation:'managed',manifest_sha256:DIGEST},digest({...nativeIdentity,resources:nativeInfo.resources})).pending.id;
   }else journal.advance(2,id,'rollback-required','8'.repeat(64));
   const restored={schema:1,id:origin,transition_id:id,phase:'restored',quiescence_sha256:journal.read().pending.quiescence_sha256},stateDigest=digest(restored);
   const info={...inventoried(),worker_id:'9'.repeat(32),processes:{worker:{pid:73,start_ticks:'500'},guardian:null}};
   const record={schema:1,id,phase:'ready',implementation:'managed',manifest_sha256:DIGEST,runtime_sha256:'e'.repeat(64),state_receipt_sha256:stateDigest,origin_id:origin,source:nativeIdentity,boot_id:BOOT,unit:'couchroot-managed-'+id+'.service',directory:'/opt/couchroot-managed-'+id,stage:'/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+id,files:{'SamsungTvRootAgent.dll':'e'.repeat(64),'SamsungTvRootAgent.runtimeconfig.json':'e'.repeat(64),'SamsungTvRootAgent.deps.json':'e'.repeat(64)},port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/managed-ABC123/token',token_sha256:'e'.repeat(64),worker_identity:{boot_id:BOOT,worker_id:info.worker_id,processes:info.processes},launcher_sha256:DIGEST,unit_started_monotonic:'456'};
   for(const [name,value] of [[origin+'.production.json',nativeRecord],[id+'.managed-restore.json',restored],[id+'.managed-launch.json',record]])fs.writeFileSync(dir+'/'+name,JSON.stringify(value),{mode:0o600});
   if(nativeReturn){
    const nativeInventory=await hold.snapshotNative();assert.equal(nativeInventory.worker_id,nativeInfo.worker_id);
    let binds=0,stops=0,observations=0;const provider={record:{source,manifest_sha256:nativeRecord.manifest_sha256},provider:{prepareNativeExit:async record=>{binds++;assert.equal(record.id,origin);if(mode==='native-stop-identity')nativeInfo.worker_id='0'.repeat(32);if(mode==='native-stop-selection')journal.advance(journal.read().revision,id,'state-ready',DIGEST);return {waitForExit:async()=>{observations++;if(['native-stop-exit','native-stop-both'].includes(mode))throw Error('exit observation unknown');return {record_id:origin,identity:nativeIdentity};},resumeExitObservation:async()=>{observations++;return {record_id:origin,identity:nativeIdentity};}};}}};
    const published=['native-stop-publish','native-stop-renamed'].includes(mode);
    nativeChannel.shutdown=async()=>{stops++;assert.equal(JSON.parse(fs.readFileSync(dir+'/'+id+'.native-stop.json')).phase,'submitting');nativeChannel.close();if(['native-stop-shutdown','native-stop-both'].includes(mode))throw Error('shutdown response lost');return {acknowledged:true,disconnected:true};};
    if(mode==='native-stop-journal')fs.writeFileSync(dir+'/'+id+'.native-stop.json','existing',{mode:0o600});
    if(mode.startsWith('native-stop-')&&mode!=='native-stop-shutdown'){
     await assert.rejects(hold.shutdownNative(id,provider),e=>e.outcome==='unknown');const before=[binds,stops];await assert.rejects(hold.shutdownNative(id,provider));assert.deepEqual([binds,stops],before);assert.equal(agent.status().admission_held,true);await assert.rejects(agent.execute('blocked',100));
     assert.equal(stops,['native-stop-shutdown','native-stop-both','native-stop-exit'].includes(mode)||published?1:0);if(stops){
      assert.equal(JSON.parse(fs.readFileSync(dir+'/'+id+'.native-stop.json')).phase,mode==='native-stop-renamed'?'stopped':'submitting');
      await assert.rejects(hold.resumeNativeExit(id,{...provider}));await assert.rejects(hold.resumeNativeExit(origin,provider));
      const seen=observations,recovered=await hold.resumeNativeExit(id,provider);assert.equal(recovered.phase,'stopped');assert.equal(stops,1);assert.equal(binds,1);
      // Publication recovery reuses verified evidence; it neither observes again nor stops again.
      if(published){assert.equal(observations,seen);assert.equal(observations,1);assert.deepEqual(JSON.parse(fs.readFileSync(dir+'/'+id+'.native-stop.json')),JSON.parse(JSON.stringify(recovered)));}
      if(mode==='native-stop-both')assert.deepEqual(JSON.parse(JSON.stringify(recovered.shutdown)),{acknowledged:false,outcome:'unknown'});
      await assert.rejects(hold.resumeNativeExit(id,provider));assert.equal(agent.status().admission_held,true);
     }else await assert.rejects(hold.resumeNativeExit(id,provider));continue;
    }
    const stopped=await hold.shutdownNative(id,provider);assert.equal(stopped.phase,'stopped');assert.equal(stops,1);if(mode==='native-stop-shutdown')assert.deepEqual(JSON.parse(JSON.stringify(stopped.shutdown)),{acknowledged:false,outcome:'unknown'});assert.equal(stopped.inventory_sha256,digest(nativeInventory));assert.equal(agent.status().admission_held,true);assert.equal(JSON.parse(fs.readFileSync(dir+'/'+id+'.native-stop.json')).phase,'stopped');await assert.rejects(hold.shutdownNative(id,provider));
   }
   const next={_conn:{identity:{pid:73,uid:0,euid:0,gid:0,egid:0,smack:mode==='profile-drift'?'System':'User'}},operation:async()=>(mode==='identity-drift'||finalDrift)?{...info,worker_id:'0'.repeat(32)}:info,execute:async()=>({exit_code:0,stdout:'managed'}),close(){this._conn=null;if(this.onClose)this.onClose();}};
   const session={record,readiness_sha256:digest(record),takeChannel:async()=>{taken++;if(mode==='selection-drift')journal.begin(journal.read().revision,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},DIGEST);if(mode==='receipt-drift')fs.writeFileSync(dir+'/'+id+'.managed-restore.json','{}');return next;},closeTransport:()=>{closed++;next.close();}};
   journal.advance(journal.read().revision,id,nativeReturn?'state-ready':'rollback-state-ready',stateDigest);
   await assert.rejects(hold.adoptManaged(session),/Committed managed/);assert.equal(taken,0);
   if(nativeReturn){journal.advance(journal.read().revision,id,'trial-ready',session.readiness_sha256);journal.commit(journal.read().revision,id);}else journal.commitRollback(journal.read().revision,id,session.readiness_sha256);
   if(!['identity-drift','profile-drift','selection-drift','receipt-drift'].includes(mode)){
    const result=await hold.adoptManaged(session);assert.equal(result.admission_held,true);assert.equal(agent.status().worker_id,info.worker_id);assert.equal(agent.status().connected,true);assert.equal(agent.status().worker_ready,false);
    old.options.onClose();if(nativeChannel&&nativeChannel.onClose)nativeChannel.onClose();assert.equal(agent.status().connected,true);assert.equal(agent.status().worker_id,info.worker_id);
    await assert.rejects(agent.execute('not admitted',100));await assert.rejects(hold.completeProduction({}));await assert.rejects(hold.adoptManaged(session));assert.throws(()=>hold.release());assert.equal(taken,1);assert.equal(timers.length,0);
    const provider={record:{source,manifest_sha256:nativeRecord.manifest_sha256},retire:async o=>{events.push('provider');assert.equal(o.executorPid,73);await o.confirmExecutor();await o.execute('retire provider',1000);if(mode==='provider-failure')throw Error('provider unknown');return {phase:'complete'};}};
    await assert.rejects(hold.completeManaged({...provider,record:{source,manifest_sha256:DIGEST}}),/Matching retirement/);assert.deepEqual(events,[]);
    if(mode==='ok'||mode==='after-native-adoption'||mode==='native-stop-shutdown'){
     const active=await hold.completeManaged(provider);assert.equal(active.admission_held,false);assert.equal(active.activation_sha256,'9'.repeat(64));assert.deepEqual(events,['native','provider','activate']);assert.equal(agent.status().worker_ready,true);assert.equal((await agent.execute('public request',100)).stdout,'managed');
    }else{
     await assert.rejects(hold.completeManaged(provider),e=>e.outcome==='unknown');assert.equal(agent.status().admission_held,true);await assert.rejects(agent.execute('not admitted',100));assert.deepEqual(events,mode==='cleanup-failure'?['native']:mode==='provider-failure'?['native','provider']:['native','provider','activate']);
    }
    const count=events.length;await assert.rejects(hold.completeManaged(provider));assert.equal(events.length,count);
    if(mode==='activation-failure'){provider.retire=async()=>{throw Error('must not repeat provider retirement');};assert.equal((await hold.completeManaged(provider,{resume:true})).admission_held,false);assert.deepEqual(events,['native','provider','activate','activate']);assert.equal((await agent.execute('recovered',100)).stdout,'managed');}
    else if(!['ok','after-native-adoption','native-stop-shutdown','final-drift'].includes(mode)){await assert.rejects(hold.completeManaged(provider,{resume:true}));assert.equal(events.length,count);}
    next.close();assert.equal(agent.status().connected,false);assert.equal(agent.status().admission_held,!(mode==='ok'||mode==='after-native-adoption'||mode==='native-stop-shutdown'||mode==='activation-failure'));assert.match(agent.status().last_error,/reconciliation required/);assert.equal(timers.length,0);
   }else{await assert.rejects(hold.adoptManaged(session),e=>e.outcome==='unknown');assert.equal(closed,1);assert.equal(agent.status().admission_held,true);assert.equal(taken,1);await assert.rejects(hold.adoptManaged(session));}
  }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('rehearsal rejects missing or mismatched fallback pins before migration creation',async()=>{
 for(const hashes of [undefined,{}, {'/usr/bin/dotnet':'b'.repeat(64)}]){
  let checked=0,created=0;
  const {agent}=fixture({verifyFirmware:()=>{checked++;}},{'./native-migration':{createNativeMigration:()=>{created++;throw Error('must not create');}}},'qn90a',{hashes});
  await assert.rejects(agent.rehearseNative(DIGEST,DIGEST),e=>e.outcome==='rejected');
  await assert.rejects(agent.migrateNative(DIGEST,DIGEST),e=>e.outcome==='rejected'&&/Native migration rejected/.test(e.message));await assert.rejects(agent.migrateNative(DIGEST),e=>e.outcome==='rejected');await assert.rejects(agent.returnManaged(DIGEST),e=>e.outcome==='rejected'&&/Managed return rejected/.test(e.message));assert.equal(agent.status().managed_return,null);
  assert.equal(checked,0);assert.equal(created,0);assert.equal(agent.status().admission_held,false);
 }
});
test('rehearsal checks firmware before creating its controller',async()=>{
 let created=0;
 const {agent}=fixture({verifyFirmware:()=>{throw Error('Firmware mismatch');}},{'./native-migration':{createNativeMigration:()=>{created++;}}},'qn90a',{hashes:{'/usr/bin/dotnet':DIGEST}});
 await assert.rejects(agent.rehearseNative(DIGEST,DIGEST),e=>e.outcome==='rejected'&&e.cause.message==='Firmware mismatch');
 assert.equal(created,0);assert.equal(agent.status().admission_held,false);
});

test('live fallback verification must succeed on the same ready worker before migration starts',async()=>{
 for(const mode of ['match','mismatch','timeout','transport','disconnect']){
  let started=0;
  const {agent,channels}=fixture({}, {'./native-migration':{createNativeMigration:()=>({status:()=>({phase:'fixture'}),run:async()=>{started++;return 'started';}})}},'qn90a',{hashes:{'/usr/bin/dotnet':DIGEST}});
  agent.start();const channel=channels[0],ready=channel.connect();ready.resolve(managed());await flush();
  channel.execute=async command=>{
   assert(command.includes('sha256sum /usr/bin/dotnet'));assert(command.includes(DIGEST));
   assert.equal(agent.status().admission_held,false);
   if(mode==='transport')throw Error('lost reply');
   if(mode==='disconnect')ready.conn._socket.destroy();
   return {exit_code:mode==='mismatch'?1:0,timed_out:mode==='timeout',stdout:'FALLBACK-RUNTIME-VERIFIED\n'};
  };
  if(mode==='match'){assert.equal(await agent.rehearseNative(DIGEST,DIGEST),'started');assert.equal(started,1);}
  else{await assert.rejects(agent.rehearseNative(DIGEST,DIGEST),e=>e.outcome==='rejected');assert.equal(started,0);}
  assert.equal(agent.status().admission_held,false);
  if(['mismatch','timeout','transport'].includes(mode)){channel.execute=async()=>({exit_code:0});assert.equal((await agent.execute('true',100)).exit_code,0);}
 }
});

test('restart abandons only a provably unsubmitted transition before acquiring managed',async()=>{
 const os=require('node:os'),{SelectionJournal}=require('../research/autonomous-root/service/worker-selection'),{providerId}=require('../research/autonomous-root/service/restart-inventory');
 for(const mode of ['unsubmitted','provider-submitted']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restart-abandon-'));fs.chmodSync(dir,0o700);const file=dir+'/selection.json',journal=new SelectionJournal(file);journal.initialize({implementation:'managed',manifest_sha256:DIGEST});
  const id=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},'d'.repeat(64)).pending.id;
  if(mode==='provider-submitted')fs.writeFileSync(dir+'/retirement-launch.pending',providerId(id)+'\n',{mode:0o600});
  const {agent,channels}=fixture({selectionFile:file,managedVersion:()=>DIGEST});agent.start();
  try{
   await flush();const durable=agent.restartInventory();
   if(mode==='unsubmitted'){
    assert.equal(durable.startup_reconciliation.abandoned,true);assert.equal(durable.startup_reconciliation.transaction_id,id);assert.equal(durable.action,'none');assert.equal(journal.read().history.at(-1).outcome,'abandoned');
    assert.equal(channels.length,1);const ready=channels[0].connect();ready.resolve(managed());await flush();assert.equal(agent.status().worker_ready,true);
   }else{
    assert.equal(durable.startup_reconciliation.abandoned,false);assert.equal(durable.action,'pending-reconciliation');assert.equal(durable.mutations.find(m=>m.name==='provider-launch').status,'submitted-unknown');
    assert.equal(channels.length,0);assert.match(agent.status().last_error,/requires reconciliation/);assert.equal(journal.read().pending.id,id);
   }
  }finally{agent.stop();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
