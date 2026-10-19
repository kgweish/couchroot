'use strict';
// Run separately in an otherwise idle disposable container: this fixture owns
// the real managed job directory. TV signing, systemd and mount setup are fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events'),{createRequire}=require('node:module');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
const {withRetirementState}=require('./retirement-test-state.cjs');
const {observeProcesses}=require('../research/autonomous-root/service/worker-processes');
const {providerId}=require('../research/autonomous-root/service/restart-inventory');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),pause=()=>new Promise(r=>setTimeout(r,20));
for(const mode of ['normal','activation-recovery','shutdown-response-lost','exit-observation-recovery','guardian-stopped-exit-recovery','native-active'])test('real managed/native/managed rehearsal preserves state and cleanup ('+mode+')',{
 skip:process.platform!=='linux'||process.env.COUCHROOT_REHEARSAL!=='1'||!process.env.NATIVE_WORKER||!process.env.MANAGED_PARITY,timeout:60000
},async()=>withRetirementState(async()=>{
 const recoverActivation=mode==='activation-recovery';let shutdownCalls=0,exitReadInterrupted=false,stoppedGuardian=null,productionUnit=null;
 assert(!fs.existsSync('/opt/couchroot-agent'),'Run in a separate fresh container');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-rehearsal-')),state='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state',selectionFile=state+'/selection.json';fs.mkdirSync(state,{recursive:true,mode:0o700});if(mode==='shutdown-response-lost')fs.chmodSync(state,0o2700);
 const managed='a'.repeat(64),native='b'.repeat(64),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),launcherSha=sha(fs.readFileSync('/bin/true')),workerSha=sha(fs.readFileSync(process.env.NATIVE_WORKER)),runtimeSha=sha(fs.readFileSync('/opt/dotnet/bin/dotnet'));
 const children=[],servers=[],roots=['/opt/couchroot-agent'],units=new Map(),modules=new Map();let agent,returnedChannel,productionChannel,runtimeChecks=0,activationInterrupted=false;
 const unitRoot=root+'/units';fs.mkdirSync(unitRoot);
 const systemctl=root+'/systemctl';fs.writeFileSync(systemctl,`#!/bin/sh
set -eu
base='${unitRoot}'
action=$1; shift
props=''
while test "$#" -gt 1; do
 case "$1" in -p) shift; props="$props $1";; --property=*) props=$(printf %s "\${1#--property=}" | tr ',' ' ');; --no-block) :;; *) exit 2;; esac
 shift
done
unit=$1; dir="$base/$unit"
test -d "$dir"
if test "$action" = stop; then
 test "$(cat "$dir/MainPID")" = 0
 test "$(cat "$dir/SubState")" = exited
 touch "$dir/stopped"
 printf not-found > "$dir/LoadState"; printf inactive > "$dir/ActiveState"; printf dead > "$dir/SubState"
 for key in MainPID ExecMainCode ExecMainStatus ExecMainStartTimestampMonotonic; do printf 0 > "$dir/$key"; done
else
 test "$action" = show
 for key in $props; do printf '%s=%s\\n' "$key" "$(cat "$dir/$key")"; done
fi
`,{mode:0o700});
 function syncUnits(){for(const [unit,v] of units){const d=unitRoot+'/'+unit;if(!fs.existsSync(d))fs.mkdirSync(d);if(fs.existsSync(d+'/stopped'))continue;const exited=v.child.exitCode!==null||v.child.signalCode!==null;
  const values={Id:unit,LoadState:'loaded',ActiveState:'active',SubState:exited?'exited':'running',MainPID:exited?0:v.child.pid,ExecMainCode:exited?1:0,ExecMainStatus:exited?v.child.exitCode===0?0:1:0,ExecMainStartTimestampMonotonic:'123'};for(const [k,value] of Object.entries(values))fs.writeFileSync(d+'/'+k,String(value));}}
 class HostServer extends RootAgentServer{
  constructor(options){super({...options,onConnect:peer=>{const executable=fs.readlinkSync('/proc/'+peer.identity.pid+'/exe'),launched=children.find(v=>v.child.pid===peer.identity.pid||v.command===executable);assert(launched);peer.identity.smack=launched.command==='dotnet'?'User':'System';options.onConnect(peer);}});servers.push(this);}
  async execute(command,timeout){
   syncUnits();
   if(mode==='exit-observation-recovery'&&shutdownCalls>0&&!exitReadInterrupted&&command.includes('printf \"worker:\"')){exitReadInterrupted=true;return {exit_code:1,stdout:'',stderr:''};}
   if(command.includes('FALLBACK-RUNTIME-VERIFIED'))command=command.replaceAll('/usr/bin/dotnet','/opt/dotnet/bin/dotnet');
   if(command.includes('MANAGED-VERIFIED')){
    // The harness uses a host runtime/launcher and no TV mount namespace. Keep
    // actual identity, retained-state and wire checks; substitute only this gate.
    runtimeChecks++;const names=fs.readdirSync(state).filter(n=>n.endsWith('.managed-launch.json'));assert.equal(names.length,1);const r=JSON.parse(fs.readFileSync(state+'/'+names[0]));const managedChannel=servers.find(s=>s._conn&&s._conn.identity.pid===units.get(r.unit).child.pid);assert(managedChannel);const info=await managedChannel.operation({op:'status'});
    const identity={boot_id:info.boot_id,worker_id:info.worker_id,processes:info.processes};assert(Object.values(observeProcesses(identity).processes).every(p=>!p||p.observation==='present'));assert.equal(fs.readlinkSync('/proc/'+info.processes.worker.pid+'/exe'),'/opt/dotnet/bin/dotnet');
    const inputs=JSON.parse(fs.readFileSync(state+'/'+r.id+'.managed-restore-input.json'));command=require('../research/autonomous-root/service/managed-restore-plan').planManagedRestore(inputs).verify+'printf "MANAGED-VERIFIED\\n"\n';
   }
   return super.execute(command.replaceAll('systemctl ',systemctl+' '),timeout);
  }
 }
 function start(command,args,unit){const child=spawn(command,args,{stdio:['ignore','ignore','pipe']}),ended=once(child,'exit');let stderr='';child.stderr.on('data',v=>{stderr=(stderr+v).slice(-16384);});const v={child,ended,command,stderr:()=>stderr};children.push(v);child.on('exit',code=>{if(code!==0)console.error('Fixture child failed',unit||'managed-source',code,stderr);});if(unit)units.set(unit,v);return v;}
 function write(name,value){fs.writeFileSync(state+'/'+name,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});}
 function nativeStage(id,kind,options){
  const directory='/opt/couchroot-'+kind+'-'+id,scope=directory+'/state';if(kind==='retirement'){assert(!fs.existsSync(directory));roots.push(directory);fs.mkdirSync(directory,{mode:0o700});fs.mkdirSync(scope,{mode:0o700});}else roots.push(directory);
  fs.mkdirSync(directory+'/code',{mode:0o700});fs.copyFileSync(process.env.NATIVE_WORKER,directory+'/code/worker');fs.chmodSync(directory+'/code/worker',0o500);fs.copyFileSync('/bin/true',scope+'/launcher');fs.chmodSync(scope+'/launcher',0o400);fs.copyFileSync(options.tokenFile,scope+'/token');fs.chmodSync(scope+'/token',0o600);
  return {directory,scope};
 }
 const launchers={
  'retirement-launch':{submitRetirement:async o=>{const {directory,scope}=nativeStage(o.id,'retirement',o),unit='couchroot-retirement-'+o.id+'.service',r={schema:1,id:o.id,phase:'submitted',device:o.device,manifest_sha256:o.manifestSha256,worker_sha256:workerSha,launcher_sha256:launcherSha,observer_sha256:native,boot_id:boot,source:o.source,unit,directory,scope,token_file:o.tokenFile,token_sha256:o.tokenSha256,port:o.port};write('retirement-launch.pending',o.id+'\n');write(o.id+'.retirement.json',r);start(directory+'/code/worker',['127.0.0.1',String(o.port),scope+'/token',scope,scope+'/launcher',launcherSha],unit);return r;}},
  'production-launch':{submitProduction:async o=>{const installation=JSON.parse(fs.readFileSync(state+'/'+o.id+'.state-install.json')),{directory,scope}=nativeStage(o.id,'worker',o),unit='couchroot-worker-'+o.id+'.service',r={schema:1,id:o.id,phase:'submitted',device:o.device,manifest_sha256:o.manifestSha256,state_receipt_sha256:o.receiptSha256,worker_sha256:workerSha,launcher_sha256:launcherSha,source:installation.source,boot_id:boot,unit,directory,scope,token_file:o.tokenFile,token_sha256:o.tokenSha256,port:o.port};write('production-launch.pending',o.id+'\n');write(o.id+'.production.json',r);start(directory+'/code/worker',['127.0.0.1',String(o.port),scope+'/token',scope,scope+'/launcher',launcherSha,'--production'],unit);return r;}},
  'managed-launch':{submitManaged:async o=>{const inputs=JSON.parse(fs.readFileSync(state+'/'+o.transitionId+'.managed-restore-input.json')),id=o.transitionId,directory='/opt/couchroot-managed-'+id,stage='/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+id,unit='couchroot-managed-'+id+'.service';for(const p of [directory,stage]){assert(!fs.existsSync(p));roots.push(p);fs.mkdirSync(p,{recursive:true,mode:0o700});}fs.copyFileSync(o.tokenFile,stage+'/token');fs.chmodSync(stage+'/token',0o600);
   const r={schema:1,id,phase:'submitted',implementation:'managed',manifest_sha256:o.managedSha256,runtime_sha256:o.runtimeSha256,state_receipt_sha256:o.receiptSha256,origin_id:inputs.record.id,source:inputs.record.worker_identity,boot_id:boot,unit,directory,stage,files:{'SamsungTvRootAgent.dll':managed,'SamsungTvRootAgent.runtimeconfig.json':managed,'SamsungTvRootAgent.deps.json':managed},port:o.port,token_file:o.tokenFile,token_sha256:o.tokenSha256};write('managed-launch.pending',id+'\n');write(id+'.managed-launch.json',r);start('dotnet',[process.env.MANAGED_PARITY,'--parity-wire',String(o.port),stage],unit);return r;}}
 };
 const base=path.resolve(__dirname,'../research/autonomous-root/service');
 function load(name){if(modules.has(name))return modules.get(name).exports;if(launchers[name])return launchers[name];if(name==='vendor/root-agent')return {RootAgentServer:HostServer};if(name==='vendor/sdb')return {connect:()=>new Promise(()=>{}),close:()=>{}};
  if(name==='worker-selection')return {...require(base+'/'+name),managedVersion:()=>managed};if(name==='native-candidate')return {candidateStatus:()=>({state:'verified'}),loadCandidate:()=>({manifest_sha256:native})};
  const file=base+'/'+name+'.js',real=createRequire(file),module={exports:{}};modules.set(name,module);vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,__dirname:path.dirname(file),__filename:file,process,Buffer,URL,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,clearImmediate,require:n=>n.startsWith('./')&&fs.existsSync(path.resolve(path.dirname(file),n)+'.js')?load(path.relative(base,path.resolve(path.dirname(file),n))):real(n)});if(name==='managed-activation'&&recoverActivation){const activate=module.exports.activateManaged;module.exports.activateManaged=async options=>{const result=await activate(options);if(!activationInterrupted){activationInterrupted=true;throw Error('lost activation acknowledgement');}return result;};}return module.exports;
 }
 const until=async predicate=>{const end=Date.now()+5000;while(!await predicate()){if(Date.now()>end)throw Error('Rehearsal deadline '+children.map(c=>c.stderr()).join('\n'));await pause();}};
 try{
  agent=load('agent').createAgent({device:'qn90a',hashes:{'/usr/bin/dotnet':runtimeSha}},{selectionFile,verifyFirmware:()=>{},managedVersion:()=>managed});agent.start();await until(()=>servers[0]&&servers[0].listeningPort());
  fs.writeFileSync(root+'/token',servers[0].secret.toString('base64'),{mode:0o600});const original=start('dotnet',[process.env.MANAGED_PARITY,'--parity-wire',String(servers[0].listeningPort()),root]);await until(()=>agent.status().worker_ready);
  for(const id of ['retained-keep-0001','retained-forget-0001']){await agent.operation({op:'job.start',id,profile:'root',timeout_ms:1000,command:'exit 7'});await until(async()=>{const s=await agent.operation({op:'status'});return s.resources.jobs.every(j=>j.monitor_finished);});}
  const saved=fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json');
  // Add real native-created/deleted outcomes while admission remains held.
  const originalHold=agent.holdAdmission;agent.holdAdmission=()=>{const hold=originalHold();const adopt=hold.adoptProduction;hold.adoptProduction=async session=>{const result=await adopt(session);productionChannel=servers.find(s=>s._conn&&s._conn.identity.pid===session.record.worker_identity.processes.worker.pid);const shutdown=productionChannel.shutdown.bind(productionChannel);productionChannel.shutdown=async()=>{shutdownCalls++;const result=await shutdown();if(mode==='shutdown-response-lost')throw Error('Injected lost shutdown response');return result;};if(mode!=='native-active'){await productionChannel.operation({op:'job.forget',id:'retained-forget-0001'});await productionChannel.operation({op:'job.start',id:'native-created-0001',profile:'root',timeout_ms:1000,command:'printf once >> '+root+'/effect; exit 9'});await until(async()=>{const s=await productionChannel.operation({op:'status'});return s.resources.jobs.every(j=>j.monitor_finished);});}if(mode==='guardian-stopped-exit-recovery'){productionUnit=units.get(session.record.unit);stoppedGuardian=session.record.worker_identity.processes.guardian.pid;assert.equal(productionUnit.child.pid,stoppedGuardian);process.kill(stoppedGuardian,'SIGSTOP');}return result;};const adoptManaged=hold.adoptManaged;hold.adoptManaged=async session=>{const result=await adoptManaged(session);returnedChannel=servers.find(s=>s._conn&&s._conn.identity.pid===session.record.worker_identity.processes.worker.pid);return result;};return hold;};
  let result;try{if(mode==='native-active')result=await agent.migrateNative(native,runtimeSha);else if(mode==='guardian-stopped-exit-recovery'){let failure;await assert.rejects(agent.rehearseNative(native,runtimeSha),e=>{failure=e;return e.outcome==='unknown';});const chain=[];for(let c=failure;c;c=c.cause)chain.push(String(c.message));assert(chain.some(m=>m.includes('exit deadline expired')),chain.join(' <- '));assert.equal(shutdownCalls,1);const workerPid=JSON.parse(fs.readFileSync(state+'/'+fs.readdirSync(state).find(n=>n.endsWith('.production.json')))).worker_identity.processes.worker.pid;assert.equal(fs.readFileSync('/proc/'+workerPid+'/stat','utf8').split(') ')[1][0],'Z');assert.equal(agent.status().admission_held,true);await assert.rejects(agent.execute('must remain blocked',100));{const durable=agent.restartInventory();assert.equal(durable.direction,'to-managed');assert.equal(durable.boundary,'native-stop');assert.equal(durable.mutations.find(m=>m.name==='native-stop').status,'submitted-unknown');assert.equal(durable.action,'pending-reconciliation');}process.kill(stoppedGuardian,'SIGCONT');assert.deepEqual(await productionUnit.ended,[0,null]);stoppedGuardian=null;result=await agent.resumeManagedActivation();assert.equal(shutdownCalls,1);}else if(recoverActivation||mode==='exit-observation-recovery'){await assert.rejects(agent.rehearseNative(native,runtimeSha),e=>e.outcome==='unknown');assert(recoverActivation?activationInterrupted:exitReadInterrupted);assert.equal(agent.status().admission_held,true);await assert.rejects(agent.execute('must remain blocked',100));result=await agent.resumeManagedActivation();}else result=await agent.rehearseNative(native,runtimeSha);}catch(e){let causes=[];for(let p=e;p;p=p.cause)causes.push(p.stack||p.message);throw Error(causes.join('\nCAUSED BY\n'));}
  if(mode==='native-active'){
   // Committed native trial: public admission opens on the adopted native worker.
   assert.equal(result.selected_implementation,'native-prototype');assert.equal(result.admission_held,false);const status=agent.status();assert.equal(status.worker_ready,true);assert.equal(status.phase,'ready');assert.equal(status.selected_implementation,'native-prototype');assert.equal(status.native_runtime.transaction_id,result.transaction_id);assert.equal(status.native_runtime.activation_sha256,result.activation_sha256);
   assert.equal(fs.readlinkSync('/proc/'+status.identity.pid+'/exe'),'/opt/couchroot-worker-'+result.transaction_id+'/code/worker');assert.equal((await agent.execute('printf native',1000)).stdout,'native');
   // Retained managed results are readable, and public job operations run on native.
   assert.equal((await agent.operation({op:'job.status',id:'retained-keep-0001'})).record.exit_code,7);assert.equal((await agent.operation({op:'job.status',id:'retained-forget-0001'})).record.exit_code,7);
   await agent.operation({op:'job.forget',id:'retained-forget-0001'});await assert.rejects(agent.operation({op:'job.status',id:'retained-forget-0001'}));
   await agent.operation({op:'job.start',id:'native-created-0001',profile:'root',timeout_ms:1000,command:'printf once >> '+root+'/effect; exit 9'});await until(async()=>{const s=await agent.operation({op:'job.status',id:'native-created-0001'});return s.monitor_finished!==false&&(s.record||s).exit_code===9;});assert.equal((await agent.operation({op:'job.output',id:'native-created-0001',stdout_cursor:0,stderr_cursor:0})).state,'completed');
   assert.equal(JSON.parse(fs.readFileSync(state+'/'+result.transaction_id+'.activation.json')).phase,'active');for(const p of roots.filter(p=>p.startsWith('/opt/couchroot-retirement-')))assert(!fs.existsSync(p));for(const name of ['retirement-launch.pending','production-launch.pending','state-install.pending'])assert(!fs.existsSync(state+'/'+name));
   const selection=load('worker-selection').selectionStatus(selectionFile);assert.equal(selection.history.length,1);assert.equal(selection.history[0].outcome,'committed');assert.equal(original.child.exitCode,0);assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);assert.equal(fs.readFileSync(root+'/effect','utf8'),'once');
   {const durable=agent.restartInventory();assert.equal(durable.action,'none',JSON.stringify(durable));assert.equal(durable.boundary,'native-active');assert.equal(durable.transaction_id,result.transaction_id);}
   // Return the admitted native runtime through a provider launched by native.
   const nativeOrigin=result.transaction_id;assert.equal(shutdownCalls,0);
   await agent.operation({op:'job.start',id:'native-live-job-0001',profile:'root',timeout_ms:60000,command:'printf live; sleep 30'});
   const selectedBefore=JSON.stringify(agent.status().worker_selection),workerBefore=agent.status().worker_id;
   await assert.rejects(agent.returnManaged(runtimeSha),e=>e.outcome==='rejected');assert.equal(agent.status().worker_ready,true);assert.equal(agent.status().worker_id,workerBefore);assert.equal(JSON.stringify(agent.status().worker_selection),selectedBefore);
   assert.equal((await agent.operation({op:'job.status',id:'native-live-job-0001'})).state,'running');
   await agent.operation({op:'job.cancel',id:'native-live-job-0001'});await until(async()=>{const info=await agent.operation({op:'status'});return info.resources.jobs.every(j=>j.monitor_finished);});
   const cancelled=await agent.operation({op:'job.status',id:'native-live-job-0001'});assert.equal(cancelled.state,'cancelled');assert.equal(typeof cancelled.exit_code,'number');assert.equal(cancelled.record,undefined);
   result=await agent.returnManaged(runtimeSha);assert.equal(result.native_origin_id,nativeOrigin);assert.equal(agent.status().native_runtime,null);assert.equal(agent.status().managed_return.phase,'active');const retained=await agent.operation({op:'job.status',id:'native-live-job-0001'});assert.equal(retained.record.state,'cancelled');assert.equal(retained.record.exit_code,cancelled.exit_code);
   returnedChannel=servers.find(s=>s._conn&&s._conn.identity.pid===agent.status().identity.pid);assert(fs.existsSync(state+'/'+providerId(result.transaction_id)+'.retirement.json'));
  }
  assert.equal(result.selected_implementation,'managed');assert.equal(result.admission_held,false);{const durable=agent.restartInventory();assert.equal(durable.action,'none',JSON.stringify(durable));assert.equal(durable.boundary,'settled');}assert.equal(agent.status().worker_ready,true);assert.equal(agent.status().boot_id,boot);assert.equal((await agent.execute('printf restored',1000)).stdout,'restored');
  assert.equal((await agent.operation({op:'job.status',id:'retained-keep-0001'})).record.exit_code,7);assert.equal((await agent.operation({op:'job.status',id:'native-created-0001'})).record.exit_code,9);await assert.rejects(agent.operation({op:'job.status',id:'retained-forget-0001'}));assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);assert.equal(fs.readFileSync(root+'/effect','utf8'),'once');
  const selection=load('worker-selection').selectionStatus(selectionFile);assert.equal(selection.history.length,2);assert.equal(shutdownCalls,1);if(mode==='shutdown-response-lost'){const stopped=JSON.parse(fs.readFileSync(state+'/'+result.transaction_id+'.native-stop.json'));assert.equal(stopped.phase,'stopped');assert.deepEqual(stopped.shutdown,{acknowledged:false,outcome:'unknown'});}assert.equal(selection.selected_implementation,'managed');assert(runtimeChecks>=4);
  assert(!fs.existsSync('/opt/couchroot-worker-'+result.native_origin_id));for(const p of roots.filter(p=>p.startsWith('/opt/couchroot-retirement-')))assert(!fs.existsSync(p));for(const name of ['retirement-launch.pending','production-launch.pending','state-install.pending','managed-restore.pending','managed-launch.pending'])assert(!fs.existsSync(state+'/'+name));
  assert.equal(original.child.exitCode,0);assert(children.filter(c=>c.child!==units.get('couchroot-managed-'+result.transaction_id+'.service').child).every(c=>c.child.exitCode===0));
  assert.equal(JSON.parse(fs.readFileSync(state+'/'+result.transaction_id+'.managed-activation.json')).phase,'active');assert.equal(fs.readdirSync(state).some(n=>/^(production|managed|retirement)-/.test(n)),false);
  await returnedChannel.shutdown();assert.deepEqual(await units.get('couchroot-managed-'+result.transaction_id+'.service').ended,[0,null]);
 }finally{
  if(stoppedGuardian)try{process.kill(stoppedGuardian,'SIGCONT');}catch(_){}
  if(agent)agent.stop();for(const s of servers)s.close();for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null){c.child.kill('SIGTERM');await c.ended;}for(const p of roots.reverse())fs.rmSync(p,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});
 }
}));
