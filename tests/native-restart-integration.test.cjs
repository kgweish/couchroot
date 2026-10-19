'use strict';
// Run separately in an otherwise idle disposable container, like the rehearsal
// fixture, with docker --init to reap orphaned EXITKILL victims: it owns the real
// managed job directory. A service restart is modelled
// by closing every listener of the first agent and starting a second agent with
// fresh module instances; TV signing, systemd and SDK acquisition are fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events'),{createRequire}=require('node:module');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
const {withRetirementState}=require('./retirement-test-state.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),pause=()=>new Promise(r=>setTimeout(r,20));
const MUTATION=/(^|[\s;|&(])(rm|rmdir|mv|mkdir|cp|ln|chmod|chown|kill|pkill|touch|truncate|dd|systemd-run|sqlite3)\s|systemctl (stop|start|kill|restart)|>(?!\s*&)\s*\/|set -C/m;
for(const mode of ['abandon-prepared','provider-ready','state-ready','trial-ready','native-committed','native-disable','native-lost','native-guardian-lost','native-persistence-lost','native-reboot','native-reboot-bootstrap','native-reboot-startup','native-reboot-receipt','native-startup-journal','native-startup-partial','native-startup-initial','return-prepared','return-stopped','return-state-ready','return-trial-ready','return-reboot-prepared','return-reboot-provider','return-reboot-stopped','return-reboot-state-ready','return-reboot-trial-ready','return-reboot-recovery-ack','return-reboot-provider-ack','return-reboot-cutover','return-reboot-unit-reuse','live-provider-loss','live-state-ready','live-trial-ready','live-published-commit','live-ambiguous-commit','live-observer-loss','live-observer-ack-lost','live-production-loss'])test('coordinator recovers or holds an interrupted handoff ('+mode+')',{
 skip:process.platform!=='linux'||process.env.COUCHROOT_REHEARSAL!=='1'||!process.env.NATIVE_WORKER||!process.env.MANAGED_PARITY||((mode.startsWith('native-startup-')||mode==='native-reboot-startup')&&process.env.COUCHROOT_STARTUP_FAULT!=='1'),timeout:90000
},async()=>withRetirementState(async()=>{
 assert(!fs.existsSync('/opt/couchroot-agent'),'Run in a separate fresh container');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-restart-')),state='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state',selectionFile=state+'/selection.json';fs.mkdirSync(state,{recursive:true,mode:0o700});
 const managed='a'.repeat(64),native='b'.repeat(64),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),launcherSha=sha(fs.readFileSync('/bin/true')),workerSha=sha(fs.readFileSync(process.env.NATIVE_WORKER)),runtimeSha=sha(fs.readFileSync('/opt/dotnet/bin/dotnet'));
 const live=mode.startsWith('live-'),observerLoss=mode.startsWith('live-observer-');let faulted=false,cleanupFaulted=false,startupFaulted=false,receiptFaulted=false;
 const reboot=mode.startsWith('native-reboot'),returnReboot=mode.startsWith('return-reboot-'),returnMode=({'return-reboot-recovery-ack':'return-prepared','return-reboot-provider-ack':'return-provider','return-reboot-cutover':'return-state-ready','return-reboot-unit-reuse':'return-prepared'})[mode]||(returnReboot?mode.replace('return-reboot-','return-'):mode);
 let recoveryAcknowledgementLost=false,recoveryExecutions=0;
 const startupStage={'native-reboot-startup':'journal-runtime','native-startup-journal':'journal-runtime','native-startup-partial':'partial-runtime','native-startup-initial':'initial-created'}[mode];
 const children=[],servers=[],roots=['/opt/couchroot-agent'],units=new Map(),commands=new Map();let first,second;
 const unitRoot=root+'/units';fs.mkdirSync(unitRoot);
 // Unknown units report systemd's not-found defaults; the fixture has no cgroups.
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
if test "$action" = stop || test "$action" = reset-failed; then
 test "$(cat "$dir/MainPID")" = 0
 touch "$dir/stopped"
 printf not-found > "$dir/LoadState"; printf inactive > "$dir/ActiveState"; printf dead > "$dir/SubState"
 for key in MainPID ExecMainCode ExecMainStatus ExecMainStartTimestampMonotonic; do printf 0 > "$dir/$key"; done
 exit 0
fi
test "$action" = show
for key in $props; do
 if test -d "$dir"; then value=$(cat "$dir/$key"); else case "$key" in LoadState) value=not-found;; ActiveState) value=inactive;; SubState) value=dead;; Id) value=$unit;; ControlGroup) value=;; *) value=0;; esac; fi
 printf '%s=%s\\n' "$key" "$value"
done
`,{mode:0o700});
 function syncUnits(){for(const [unit,v] of units){const d=unitRoot+'/'+unit;if(!fs.existsSync(d))fs.mkdirSync(d);if(fs.existsSync(d+'/stopped'))continue;const exited=v.child.exitCode!==null||v.child.signalCode!==null;
  const values={Id:unit,LoadState:'loaded',ActiveState:'active',SubState:exited?'exited':'running',MainPID:exited?0:v.child.pid,ExecMainCode:exited?1:0,ExecMainStatus:exited?v.child.exitCode===0?0:1:0,ExecMainStartTimestampMonotonic:'123',ControlGroup:''};for(const [k,value] of Object.entries(values))fs.writeFileSync(d+'/'+k,String(value));}}
 class HostServer extends RootAgentServer{
  constructor(options){super({...options,onConnect:peer=>{const executable=fs.readlinkSync('/proc/'+peer.identity.pid+'/exe'),launched=children.find(v=>v.child.pid===peer.identity.pid||v.command===executable);assert(launched);peer.identity.smack=launched.command==='dotnet'?'User':'System';options.onConnect(peer);}});servers.push(this);commands.set(this,[]);}
  async execute(command,timeout){
   syncUnits();commands.get(this).push(command);
   if(command.includes('NATIVE-RESTART-SUBMITTED')){
    const filename=fs.readdirSync(state).find(n=>n.endsWith('.startup.json')),a=JSON.parse(fs.readFileSync(state+'/'+filename)),r=JSON.parse(fs.readFileSync(state+'/'+a.origin_id+'.production.json'));
    assert.equal(a.phase,'submitted');assert.equal(sha(fs.readFileSync(a.token_file)),a.token_sha256);
    if(a.schema===2){const command=require('../research/autonomous-root/service/launch-fence').fenceCommand(a,'printf FENCED\n',{kind:'startup'});const fenced=await super.execute(command,5000);assert.equal(fenced.exit_code,0,fenced.stderr);roots.push(a.fence);}
    fs.copyFileSync(a.token_file,r.scope+'/token');fs.chmodSync(r.scope+'/token',0o600);
    const startupEnv=startupStage&&!startupFaulted?{COUCHROOT_NATIVE_STARTUP_FAULT:startupStage}:{};startupFaulted=true;
    start(r.directory+'/code/worker',['127.0.0.1',String(a.port),r.scope+'/token',r.scope,r.scope+'/launcher',launcherSha,'--production'],r.unit,startupEnv);
    return {exit_code:0,timed_out:false,stdout:'NATIVE-RESTART-SUBMITTED\n',stderr:''};
   }
   if(command.includes('FALLBACK-RUNTIME-VERIFIED'))command=command.replaceAll('/usr/bin/dotnet','/opt/dotnet/bin/dotnet');
   if(command.includes('MANAGED-VERIFIED')){
    // As in the rehearsal fixture: substitute only the TV runtime/mount gate.
    const names=fs.readdirSync(state).filter(n=>n.endsWith('.managed-launch.json'));assert.equal(names.length,1);const r=JSON.parse(fs.readFileSync(state+'/'+names[0]));
    const inputs=JSON.parse(fs.readFileSync(state+'/'+r.id+'.managed-restore-input.json'));command=require('../research/autonomous-root/service/managed-restore-plan').planManagedRestore(inputs).verify+'printf "MANAGED-VERIFIED\\n"\n';
   }
   const result=await super.execute(command.replaceAll('systemctl ',systemctl+' '),timeout);
   if(command.includes('--reconcile-state')){recoveryExecutions++;if(['return-reboot-recovery-ack','return-reboot-provider-ack'].includes(mode)&&!recoveryAcknowledgementLost){assert.equal(result.exit_code,0,result.stderr);recoveryAcknowledgementLost=true;throw Error('offline recovery acknowledgement lost');}}
   if(mode==='live-observer-ack-lost'&&!cleanupFaulted&&command.includes('OBSERVER-RECOVERY-RETIRED')){assert.equal(result.exit_code,0);cleanupFaulted=true;throw Error('observer cleanup acknowledgement lost');}return result;
  }
 }
 function start(command,args,unit,extraEnv={}){const child=spawn(command,args,{stdio:['ignore','ignore','pipe'],env:{...process.env,...extraEnv}}),ended=once(child,'exit');let stderr='';child.stderr.on('data',v=>{stderr=(stderr+v).slice(-16384);});const v={child,ended,command,stderr:()=>stderr};children.push(v);if(unit)units.set(unit,v);return v;}
 function write(name,value){fs.writeFileSync(state+'/'+name,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});}
 function nativeStage(id,kind,options){
  const directory='/opt/couchroot-'+kind+'-'+id,scope=directory+'/state';if(kind==='retirement'){assert(!fs.existsSync(directory));roots.push(directory);fs.mkdirSync(directory,{mode:0o700});fs.mkdirSync(scope,{mode:0o700});}else roots.push(directory);
  fs.mkdirSync(directory+'/code',{mode:0o700});fs.copyFileSync(process.env.NATIVE_WORKER,directory+'/code/worker');fs.chmodSync(directory+'/code/worker',0o500);fs.copyFileSync('/bin/true',scope+'/launcher');fs.chmodSync(scope+'/launcher',0o400);fs.copyFileSync(options.tokenFile,scope+'/token');fs.chmodSync(scope+'/token',0o600);
  return {directory,scope};
 }
 const launchers={
  'retirement-launch':{submitRetirement:async o=>{const {directory,scope}=nativeStage(o.id,'retirement',o),unit='couchroot-retirement-'+o.id+'.service',r={schema:1,id:o.id,phase:'submitted',device:o.device,manifest_sha256:o.manifestSha256,worker_sha256:workerSha,launcher_sha256:launcherSha,observer_sha256:sha('fixture observer'),boot_id:boot,source:o.source,unit,directory,scope,token_file:o.tokenFile,token_sha256:o.tokenSha256,port:o.port};write('retirement-launch.pending',o.id+'\n');write(o.id+'.retirement.json',r);start(directory+'/code/worker',['127.0.0.1',String(o.port),scope+'/token',scope,scope+'/launcher',launcherSha],unit);return r;}},
  'managed-launch':{submitManaged:async o=>{const inputs=JSON.parse(fs.readFileSync(state+'/'+o.transitionId+'.managed-restore-input.json')),id=o.transitionId,directory='/opt/couchroot-managed-'+id,stage='/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+id,unit='couchroot-managed-'+id+'.service';for(const p of [directory,stage]){assert(!fs.existsSync(p));roots.push(p);fs.mkdirSync(p,{recursive:true,mode:0o700});}fs.copyFileSync(o.tokenFile,stage+'/token');fs.chmodSync(stage+'/token',0o600);
   const r={schema:1,id,phase:'submitted',implementation:'managed',manifest_sha256:o.managedSha256,runtime_sha256:o.runtimeSha256,state_receipt_sha256:o.receiptSha256,origin_id:inputs.record.id,source:inputs.record.worker_identity,boot_id:boot,unit,directory,stage,files:{'SamsungTvRootAgent.dll':managed,'SamsungTvRootAgent.runtimeconfig.json':managed,'SamsungTvRootAgent.deps.json':managed},port:o.port,token_file:o.tokenFile,token_sha256:o.tokenSha256};write('managed-launch.pending',id+'\n');write(id+'.managed-launch.json',r);start('dotnet',[process.env.MANAGED_PARITY,'--parity-wire',String(o.port),stage],unit);return r;}},
  'production-launch':{submitProduction:async o=>{const installation=JSON.parse(fs.readFileSync(state+'/'+o.id+'.state-install.json')),{directory,scope}=nativeStage(o.id,'worker',o),unit='couchroot-worker-'+o.id+'.service',r={schema:1,id:o.id,phase:'submitted',device:o.device,manifest_sha256:o.manifestSha256,state_receipt_sha256:o.receiptSha256,worker_sha256:workerSha,launcher_sha256:launcherSha,source:installation.source,boot_id:boot,unit,directory,scope,token_file:o.tokenFile,token_sha256:o.tokenSha256,port:o.port};write('production-launch.pending',o.id+'\n');write(o.id+'.production.json',r);start(directory+'/code/worker',['127.0.0.1',String(o.port),scope+'/token',scope,scope+'/launcher',launcherSha,'--production'],unit);return r;}}
 };
 const base=path.resolve(__dirname,'../research/autonomous-root/service');
 // Each agent gets its own module instances, as a restarted service process would.
 function loader(modules,inject){
  return function load(name){if(modules.has(name))return modules.get(name).exports;if(launchers[name])return launchers[name];if(name==='vendor/root-agent')return {RootAgentServer:HostServer};if(name==='vendor/sdb')return {connect:()=>new Promise(()=>{}),close:()=>{}};
   if(name==='worker-selection'){const selected=require(base+'/'+name);return {...selected,managedVersion:()=>managed,...(['live-trial-ready','live-published-commit','live-ambiguous-commit'].includes(mode)?{SelectionJournal:class extends selected.SelectionJournal{commit(...args){if(!faulted){faulted=true;if(mode==='live-published-commit')super.commit(...args);if(mode==='live-ambiguous-commit')fs.writeFileSync(selectionFile+'.writer','uncertain');throw injected;}return super.commit(...args);}}}:{})};}if(name==='native-candidate')return {candidateStatus:()=>({state:'verified'}),loadCandidate:()=>({manifest_sha256:native})};
   const file=base+'/'+name+'.js',real=createRequire(file),module={exports:{}};modules.set(name,module);vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,__dirname:path.dirname(file),__filename:file,process,Buffer,URL,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,clearImmediate,require:n=>n.startsWith('./')&&fs.existsSync(path.resolve(path.dirname(file),n)+'.js')?load(path.relative(base,path.resolve(path.dirname(file),n))):real(n)});
   if(inject)inject(name,module);return module.exports;
  };
 }
 const until=async(predicate,ms=5000)=>{const end=Date.now()+ms;while(!await predicate()){if(Date.now()>end)throw Error('Restart rehearsal deadline '+JSON.stringify(second&&second.restartInventory())+' '+children.map(c=>c.stderr()).join('\n'));await pause();}};
 const createAgent=load=>load('agent').createAgent({device:observerLoss?'s90d':'qn90a',hashes:{'/usr/bin/dotnet':runtimeSha}},{selectionFile,verifyFirmware:()=>{},managedVersion:()=>managed,restartRollbackRetryMs:200});
 // Acquisition: the fixture starts the managed parity worker against the agent's listener.
 async function acquire(agent){const before=servers.length;agent.start();await until(()=>servers.length>before&&servers[servers.length-1].listeningPort(),12000);return attach(servers[servers.length-1]);}
 function attach(server){fs.writeFileSync(root+'/token',server.secret.toString('base64'),{mode:0o600});return {server,worker:start('dotnet',[process.env.MANAGED_PARITY,'--parity-wire',String(server.listeningPort()),root])};}
 const injected=Error('injected service restart');
 try{
  first=createAgent(loader(new Map(),(name,module)=>{
   if(name==='policy'&&mode==='native-reboot-receipt'){const atomic=module.exports.atomic;module.exports.atomic=(file,value)=>{const result=atomic(file,value);if(!receiptFaulted&&file.endsWith('.runtime.json')){receiptFaulted=true;throw injected;}return result;};}
   if(name==='managed-return'&&['return-prepared','return-provider','return-stopped'].includes(returnMode)){const create=module.exports.createManagedReturn;module.exports.createManagedReturn=o=>{if(returnMode==='return-prepared')o.openRetirement=async()=>{throw injected;};else if(returnMode==='return-provider'){const open=o.openRetirement;o.openRetirement=async(...args)=>{await open(...args);throw injected;};}else{const stop=o.hold.shutdownNative;o.hold.shutdownNative=async(...a)=>{await stop(...a);throw injected;};}return create(o);};}
   if(name==='managed-session'&&returnMode.startsWith('return-')&&returnMode.endsWith('ready')){const open=module.exports.openManagedSession;module.exports.openManagedSession=async o=>{if(returnMode==='return-state-ready')throw injected;await open(o);throw injected;};}
   if(name==='production-readiness'&&mode==='live-production-loss'){
    const ready=module.exports.readyProduction;
    module.exports.readyProduction=async o=>{
     const execute=o.execute;
     return ready({...o,execute:async(command,timeout)=>{
      // Kill a real connected production guardian during file verification,
      // after readiness intent publication but before trial-ready acceptance.
      if(!faulted&&command.includes('PRODUCTION-VERIFIED')){
       faulted=true;const production=units.get(o.record.unit);assert(production);
       assert(o.channel._conn,'production callback must already be connected');
       assert.equal(JSON.parse(fs.readFileSync(state+'/'+o.record.id+'.production.json')).phase,'submitted');
       assert.equal(fs.readFileSync(state+'/'+o.record.id+'.production.json.readiness.pending','utf8'),o.record.id+'\n');
       production.child.kill('SIGTERM');await production.ended;
      }
      return execute(command,timeout);
     }});
    };
   }
   if(name==='production-session'&&mode==='live-state-ready'){const open=module.exports.openProductionSession;module.exports.openProductionSession=async o=>{if(!faulted){faulted=true;throw injected;}return open(o);};}
   if(name==='production-session'&&['state-ready','trial-ready'].includes(mode)){const open=module.exports.openProductionSession;module.exports.openProductionSession=async options=>{if(mode==='state-ready')throw injected;await open(options);throw injected;};}
  }));
  const source=await acquire(first);await until(()=>first.status().worker_ready);
  await first.operation({op:'job.start',id:'retained-keep-0001',profile:'root',timeout_ms:1000,command:'exit 7'});await until(async()=>(await first.operation({op:'status'})).resources.jobs.every(j=>j.monitor_finished));
  const saved=fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json');
  const originalHold=first.holdAdmission;first.holdAdmission=()=>{const hold=originalHold();
   if(mode==='abandon-prepared')hold.prepareNative=async()=>{throw injected;};
   if(mode==='live-provider-loss'||observerLoss){const prepare=hold.prepareNative;hold.prepareNative=async id=>{const session=await prepare(id);if(!faulted){faulted=true;
    if(observerLoss){
     const record=session.record,obs=record.id,nested=state+'/observer-launches',scope=state+'/observer-Abc123',directory='/opt/couchroot-observer-'+obs,unit='couchroot-observer-'+obs+'.service';
     fs.mkdirSync(nested,{mode:0o700});fs.mkdirSync(scope,{mode:0o700});fs.mkdirSync(directory,{mode:0o700});roots.push(directory);fs.writeFileSync(directory+'/observer','fixture observer',{mode:0o500});
     const observed=start('/bin/true',[],unit);await observed.ended;
     write('observer-launches/observer-launch.pending',obs+'\n');write('observer-launches/'+obs+'.observer.json',{schema:1,id:obs,phase:'submitted',manifest_sha256:native,observer_sha256:record.observer_sha256,boot_id:boot,pids:[record.source.processes.worker.pid],unit,root:scope,execution_directory:directory,credentials:{uid:5001,gid:100,groups:[100,201],label:'User::Pkg::MiniRoot01'}});
     write('observer-Abc123/token','c'.repeat(64));write('observer-Abc123/result',{schema:1,boot_id:boot,worker_pid:record.source.processes.worker.pid,guardian_pid:null,observer_pid:observed.child.pid,exit_code:1,signal:null});
    }
    const provider=units.get(session.record.unit);assert(provider);provider.child.kill('SIGTERM');await provider.ended;}return session;};}
   if(mode==='provider-ready'){const prepare=hold.prepareNative;hold.prepareNative=async id=>{await prepare(id);throw injected;};}
   return hold;};
  if(mode.startsWith('native-')||mode.startsWith('return-')){
   await first.migrateNative(native,runtimeSha);const before=first.status(),id=before.native_runtime.transaction_id;let history=JSON.stringify(before.worker_selection.history),committed=fs.readFileSync(state+'/'+id+'.production.json'),activation=fs.readFileSync(state+'/'+id+'.activation.json');
   await first.operation({op:'job.start',id:'native-keep-00001',profile:'root',timeout_ms:1000,command:'exit 9'});await until(async()=>(await first.operation({op:'status'})).resources.jobs.every(j=>j.monitor_finished));
   const persistenceLoss=mode==='native-persistence-lost',guardianLoss=mode==='native-guardian-lost'||persistenceLoss||reboot;let production=JSON.parse(committed),nativeSaved=fs.readFileSync(production.scope+'/.jobs/native-keep-00001.json');
   if(guardianLoss){
    await first.operation({op:'job.start',id:'native-live-00001',profile:'root',timeout_ms:60000,command:'printf x >> '+root+'/effect; sleep 50'});
    await until(()=>fs.existsSync(root+'/effect'));assert.equal(fs.readFileSync(root+'/effect','utf8'),'x');
    assert.equal((await first.operation({op:'job.status',id:'native-live-00001'})).state,'running');
   }
   let returnId=null;
   if(mode.startsWith('return-')){
    const hold=first.holdAdmission;first.holdAdmission=o=>{const h=hold(o);if(mode==='return-prepared')h.openReturnProvider=async()=>{throw injected;};if(mode==='return-stopped'){const stop=h.shutdownNative;h.shutdownNative=async(...a)=>{await stop(...a);throw injected;};}return h;};
    await assert.rejects(first.returnManaged(runtimeSha,'original-return-request-0001'));returnId=first.status().worker_selection.pending.id;
   }
   const old=children.slice();
   if(returnReboot){
    // Model kernel loss: kill owned fixture processes before transport teardown
    // so native journals and provider runtime evidence remain for recovery.
    for(const v of old)if(v.child.exitCode===null&&v.child.signalCode===null){v.child.kill('SIGKILL');await v.ended;}
    first.stop();for(const server of servers.slice())server.close();
   }else if(guardianLoss){
    const current=await first.operation({op:'status'}),guardian=units.get(production.unit);assert(guardian);
    assert.equal(current.processes.guardian.pid,guardian.child.pid);
    // The real owned guardian dies without cleanup; EXITKILL must terminate
    // its worker and command, then ordinary selected-native startup reconciles.
    const journal=fs.readFileSync(production.scope+'/.jobs/guardian');
    guardian.child.kill('SIGKILL');await guardian.ended;
    assert.deepEqual(fs.readFileSync(production.scope+'/.jobs/guardian'),journal);
    if(persistenceLoss){
     // Real native reconciliation consumes bounded on-disk crash states; the
     // service must neither delete these files nor replay their commands.
     const jobs=production.scope+'/.jobs',owner=JSON.parse(journal).worker_id;
     const put=(name,bytes)=>fs.writeFileSync(jobs+'/'+name,bytes,{mode:0o600});
     put('.intent-'+owner+'-native-empty-0001','');
     put('.intent-'+owner+'-native-repair-001','{');put('.repair-'+owner+'-native-repair-001','{');
     for(const kind of ['intent','repair']){
      const jid='native-linked-'+kind,bytes=JSON.stringify({id:jid,worker_id:owner,boot_id:boot,state:kind==='intent'?'starting':'interrupted',exit_code:null,launch_started:false});
      put(jid+'.json',bytes);fs.linkSync(jobs+'/'+jid+'.json',jobs+'/.'+kind+'-'+owner+'-'+jid);
      if(kind==='repair')put('.intent-'+owner+'-'+jid,'{');
     }
     put('native-live-00001.json.next','{');put('native-keep-00001.json.next','{');
    }
   }else if(mode==='native-lost')servers[servers.length-1]._conn._socket.destroy();else{first.stop();for(const s of servers.slice())s.close();}
   await until(()=>old.every(c=>c.child.exitCode!==null||c.child.signalCode!==null),10000);
   let bootstrapReceipt;
   if(reboot){const helper=require('./native-reboot-state.cjs'),historical=helper.historicalBoot(state,id);production=historical.record;committed=historical.committed;activation=historical.activation;history=historical.history;
    if(mode==='native-reboot-bootstrap'){bootstrapReceipt=helper.historicalBootstrap(state,production);roots.push(bootstrapReceipt.directory,bootstrapReceipt.fence);}
   }
   if(returnReboot){const historical=require('./native-reboot-state.cjs').historicalReturn(state,id,returnId,{cutover:mode==='return-reboot-cutover'});production=historical.record;committed=historical.committed;activation=historical.activation;history=historical.history;units.clear();for(const name of fs.readdirSync(unitRoot))fs.rmSync(unitRoot+'/'+name,{recursive:true});
    if(mode==='return-reboot-unit-reuse'){const dir=unitRoot+'/'+production.unit;fs.mkdirSync(dir);for(const [key,value] of Object.entries({LoadState:'loaded',ActiveState:'inactive',SubState:'dead',MainPID:'0',ControlGroup:''}))fs.writeFileSync(dir+'/'+key,value);}
   }
   second=mode==='native-committed'||mode.startsWith('return-')?createAgent(loader(new Map())):first;await acquire(second);
   if(mode==='return-reboot-unit-reuse'){
    await until(()=>second.restartInventory().restart_return.phase==='failed');assert.equal(second.status().worker_ready,false);await assert.rejects(second.execute('touch '+root+'/forbidden',1000));assert(!fs.existsSync(root+'/forbidden'));assert(!fs.existsSync(state+'/'+returnId+'.return-native-recovery.json'));assert(fs.existsSync(production.scope+'/.jobs/guardian'));assert(!fs.existsSync(unitRoot+'/'+production.unit+'/stopped'));fs.rmSync(unitRoot+'/'+production.unit,{recursive:true});
   }
   let interruptedAttempt;
   if(startupStage||mode==='native-reboot-receipt'){
    await until(()=>second.restartInventory().native_startup&&second.restartInventory().native_startup.phase==='failed',40000);
    assert.equal(second.status().worker_ready,false);assert(startupStage?startupFaulted:receiptFaulted);
    interruptedAttempt=JSON.parse(fs.readFileSync(state+'/'+id+'.startup.json'));assert.equal(interruptedAttempt.schema,reboot?3:2);assert.equal(interruptedAttempt.phase,'submitted');
    assert.equal(interruptedAttempt.source_worker_id,production.worker_identity.worker_id);
    if(startupStage){
     const failed=units.get(production.unit);assert.equal(failed.child.exitCode,86);
     const checkpoint=production.scope+'/.jobs/'+(startupStage==='initial-created'?'guardian.initial':'guardian');assert(fs.existsSync(checkpoint));
     if(startupStage!=='initial-created')assert.equal(JSON.parse(fs.readFileSync(checkpoint)).startup_token_sha256,interruptedAttempt.token_sha256);
    }else{const published=JSON.parse(fs.readFileSync(state+'/'+id+'.runtime.json'));assert.equal(published.schema,2);assert.equal(published.record.boot_id,boot);assert.notEqual(published.record.worker_identity.worker_id,interruptedAttempt.source_worker_id);}
    second.stop();for(const server of servers.slice())server.close();
    await until(()=>children.every(c=>c.child.exitCode!==null||c.child.signalCode!==null),10000);
    second=createAgent(loader(new Map()));await acquire(second);
   }

   await until(()=>second.status().worker_ready,15000);
   if(bootstrapReceipt){
    const retired=JSON.parse(fs.readFileSync(bootstrapReceipt.file));assert.equal(retired.boot_id,bootstrapReceipt.boot_id);assert.equal(retired.reconciled_boot_id,boot);assert.equal(retired.phase,'retired');
    assert.equal(second.restartInventory().bootstrap_recovery.phase,'complete');assert(!fs.existsSync(state+'/bootstrap-launch.pending'));assert(!fs.existsSync(bootstrapReceipt.directory));assert.equal(fs.readFileSync(bootstrapReceipt.fence+'/sealed','utf8'),bootstrapReceipt.id+'\n');
   }
   if(mode.startsWith('return-')){
    const after=second.status();assert.equal(after.selected_implementation,'managed');assert.equal(after.worker_selection.history.slice(-1)[0].id,returnId);assert.equal(after.worker_selection.history.length,2);
    assert.equal((await second.operation({op:'job.status',id:'native-keep-00001'})).record.exit_code,9);assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);assert.equal(second.restartInventory().boundary,'settled');assert.equal(second.restartInventory().restart_return.phase,'complete');if(returnReboot){if(mode.endsWith('-ack')){assert(recoveryAcknowledgementLost);assert.equal(recoveryExecutions,mode==='return-reboot-provider-ack'?2:1);}assert.deepEqual(fs.readFileSync(state+'/'+id+'.production.json'),committed);assert.deepEqual(fs.readFileSync(state+'/'+id+'.activation.json'),activation);assert.equal(after.boot_id,boot);assert.equal(after.worker_selection.history.slice(-1)[0].id,returnId);assert(!fs.existsSync(production.scope+'/.jobs/guardian'));}assert.equal(second.canResumeManaged('wrong-return-request-0001'),false);assert.equal(second.canResumeManaged('original-return-request-0001'),true);const resumed=await second.resumeManagedActivation('original-return-request-0001');assert.equal(resumed.transaction_id,returnId);assert.equal(resumed.native_origin_id,id);return;
   }
   if(startupStage||mode==='native-reboot-receipt'){
    assert.equal(fs.readFileSync(interruptedAttempt.fence+'/sealed','utf8'),interruptedAttempt.id+'\n');
    const retired=JSON.parse(fs.readFileSync(state+'/'+id+'.startup-'+interruptedAttempt.id+'.json'));assert.equal(retired.phase,'retired');assert.equal(retired.token_sha256,interruptedAttempt.token_sha256);
    assert(!fs.existsSync(production.scope+'/.jobs/guardian.initial'));assert(!fs.existsSync(production.scope+'/.jobs/guardian.next'));
    assert.notEqual(JSON.parse(fs.readFileSync(state+'/'+id+'.startup.json')).id,interruptedAttempt.id);
   }
   const after=second.status();assert.equal(after.selected_implementation,'native-prototype');assert.notEqual(after.worker_id,before.worker_id);assert.equal(after.native_runtime.transaction_id,id);assert.equal(JSON.stringify(after.worker_selection.history),history);
   assert.deepEqual(fs.readFileSync(state+'/'+id+'.production.json'),committed);assert.deepEqual(fs.readFileSync(state+'/'+id+'.activation.json'),activation);
   assert.equal((await second.execute('printf restarted',1000)).stdout,'restarted');assert.equal((await second.operation({op:'job.status',id:'native-keep-00001'})).record.exit_code,9);
   if(guardianLoss){
    const interrupted=await second.operation({op:'job.status',id:'native-live-00001'});
    assert.equal(interrupted.record.state,'interrupted');assert.equal(interrupted.record.exit_code,null);
    assert.equal(fs.readFileSync(root+'/effect','utf8'),'x');
    assert.deepEqual(fs.readFileSync(production.scope+'/.jobs/native-keep-00001.json'),nativeSaved);
    await assert.rejects(second.operation({op:'job.start',id:'native-live-00001',profile:'root',timeout_ms:1000,command:'printf replay >> '+root+'/effect'}));
   }
   if(persistenceLoss){
    for(const jid of ['native-empty-0001','native-repair-001','native-linked-intent','native-linked-repair']){
     const recovered=await second.operation({op:'job.status',id:jid});assert.equal(recovered.record.state,'interrupted');assert.equal(recovered.record.exit_code,null);
     if(jid==='native-empty-0001'||jid==='native-repair-001'){assert.equal(recovered.record.launch_started,false);assert.equal(recovered.record.recovery,'initial-intent-not-published');}
     await assert.rejects(second.operation({op:'job.start',id:jid,profile:'root',timeout_ms:1000,command:'printf replay >> '+root+'/effect'}));
    }
    assert(!fs.readdirSync(production.scope+'/.jobs').some(n=>n.startsWith('.intent-')||n.startsWith('.repair-')||n.endsWith('.next')));
   }
   if(reboot){
    let runtime=JSON.parse(fs.readFileSync(state+'/'+id+'.runtime.json'));assert.equal(runtime.schema,2);assert.equal(runtime.record.boot_id,boot);assert.equal(runtime.record.source.boot_id,production.boot_id);
    assert.equal((await second.operation({op:'job.status',id:'native-live-00001'})).record.boot_id,production.boot_id);
    // Restart again on the new boot before returning to managed. The original
    // activation stays on the historical boot while the runtime remains current.
    second.stop();for(const server of servers.slice())server.close();await until(()=>children.every(c=>c.child.exitCode!==null||c.child.signalCode!==null),10000);
    second=createAgent(loader(new Map()));await acquire(second);await until(()=>second.status().worker_ready,15000);
    runtime=JSON.parse(fs.readFileSync(state+'/'+id+'.runtime.json'));assert.equal(runtime.schema,2);assert.equal(runtime.record.boot_id,boot);
    assert.deepEqual(fs.readFileSync(state+'/'+id+'.production.json'),committed);assert.deepEqual(fs.readFileSync(state+'/'+id+'.activation.json'),activation);
   }
   await second.returnManaged(runtimeSha).catch(e=>{for(let c=e;c;c=c.cause)console.error(c.stack);throw e;});assert.equal(second.status().worker_ready,true);assert.equal(second.status().selected_implementation,'managed');
   assert.equal((await second.operation({op:'job.status',id:'native-keep-00001'})).record.exit_code,9);assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);
   if(guardianLoss){
    const interrupted=await second.operation({op:'job.status',id:'native-live-00001'});
    assert.equal(interrupted.record.state,'interrupted');assert.equal(interrupted.record.exit_code,null);
    assert.equal(fs.readFileSync(root+'/effect','utf8'),'x');
   }
   if(guardianLoss){
    assert.equal((await second.operation({op:'job.forget',id:'native-live-00001'})).forgotten,true);
    assert(!fs.existsSync('/opt/couchroot-agent/jobs/native-live-00001.json'));
    assert.equal((await second.operation({op:'job.status',id:'native-keep-00001'})).record.exit_code,9);
    assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);
    assert.equal(fs.readFileSync(root+'/effect','utf8'),'x');
   }
   assert.equal(second.restartInventory().boundary,'settled');return;
  }
  await assert.rejects(first.rehearseNative(native,runtimeSha),e=>{if(mode==='live-provider-loss'||mode==='live-production-loss'||observerLoss)return e.outcome==='unknown'&&/^[a-f0-9]{32}$/.test(e.recovery_transaction_id);for(let c=e;c;c=c.cause)if(c===injected)return true;return false;});
  if(['live-published-commit','live-ambiguous-commit'].includes(mode)){
   const held=first.status(),count=servers.length;assert.equal(held.admission_held,true);assert.equal(held.worker_ready,false);assert.equal(first.restartInventory().restart_rollback,null);
   assert.equal(held.native_migration.phase,'reconciliation-required');assert.equal(held.native_migration.failed_phase,'committing');
   await assert.rejects(first.execute('echo admission-escape',1000),e=>e.outcome==='rejected');await pause();assert.equal(servers.length,count,'unexpected recovery listener');return;
  }
  const pending=load=>load('worker-selection').selectionStatus(selectionFile).pending;
  const id=pending(loader(new Map()))&&pending(loader(new Map())).id;assert(id);
  assert.equal(pending(loader(new Map())).phase,{'abandon-prepared':'prepared','provider-ready':'prepared','state-ready':'state-ready','trial-ready':'trial-ready','live-provider-loss':'prepared','live-state-ready':'state-ready','live-trial-ready':'trial-ready','live-observer-loss':'prepared','live-observer-ack-lost':'prepared','live-production-loss':'state-ready'}[mode]);
  if(mode==='live-production-loss'){assert(faulted);assert.equal(JSON.parse(fs.readFileSync(state+'/'+id+'.production.json')).phase,'submitted');assert(fs.existsSync(state+'/'+id+'.production.json.readiness.pending'));}
  // Live recovery keeps the same agent; restart cases discard all old handles.
  const old=children.slice();if(!live){first.stop();for(const s of servers.slice())s.close();}else{assert.equal(first.canCleanupRestart(id),false);await assert.rejects(first.execute('echo admission-escape',1000),e=>e.outcome==='rejected');}
  await until(()=>old.every(c=>c.child.exitCode!==null||c.child.signalCode!==null),10000);
  const listing=()=>fs.readdirSync(state).sort().map(n=>[n,fs.statSync(state+'/'+n).isFile()?fs.readFileSync(state+'/'+n,'utf8'):'dir']),before=new Map(listing());
  second=live?first:createAgent(loader(new Map()));
  let server;if(live){assert.equal(second,first);await until(()=>servers[servers.length-1].listeningPort());({server}=attach(servers[servers.length-1]));}else ({server}=await acquire(second));
  if(mode==='abandon-prepared'){await until(()=>second.status().worker_ready,10000);assert.equal(second.restartInventory().startup_reconciliation.abandoned,true);}
  else{
   await until(()=>{const r=second.restartInventory().restart_rollback;return r&&r.phase==='complete';},15000);
   const r=second.restartInventory();assert.equal(r.restart_rollback.transaction_id,id);
   if(live){assert.equal(r.restart_rollback.trigger,'live-forward-failure');assert.equal(second.canCleanupRestart(id),true);assert.equal(second.canCleanupRestart('0'.repeat(32)),false);}
   for(const c of commands.get(server))assert(!MUTATION.test(c),'held executor received a mutating command: '+c.slice(0,200));
   const receipt=JSON.parse(fs.readFileSync(state+'/'+id+'.restart-rollback.json'));assert.equal(receipt.outcome,'restart-rollback');
   // Ownership markers, records and staging remain for explicit cleanup and block another handoff.
   const after=new Map(listing());for(const [n,v] of before)if(n!=='selection.json')assert.equal(after.get(n),v,n);
   assert(r.markers.includes('retirement-launch.pending'));assert.equal(r.action,'pending-reconciliation');
   if(!['provider-ready','live-provider-loss'].includes(mode)&&!observerLoss)assert(fs.existsSync('/opt/couchroot-worker-'+id+'/state/.jobs'));
  }
  await until(()=>second.status().worker_ready);
  const s=load=>load('worker-selection').selectionStatus(selectionFile),final=s(loader(new Map())),h=final.history[final.history.length-1];
  assert.equal(final.phase,'stable');assert.equal(final.selected_implementation,'managed');assert.equal(h.id,id);assert.equal(h.outcome,mode==='abandon-prepared'?'abandoned':'rolled-back');
  assert.equal(second.status().boot_id,boot);assert.equal((await second.execute('printf restored',1000)).stdout,'restored');
  assert.equal((await second.operation({op:'job.status',id:'retained-keep-0001'})).record.exit_code,7);assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);
  if(mode!=='abandon-prepared'){
   await assert.rejects(second.migrateNative(native,runtimeSha),e=>e.outcome==='rejected'&&/Existing native transition requires reconciliation/.test(e.cause&&e.cause.message));
   const obs=require('../research/autonomous-root/service/restart-inventory').providerId(id);
   if(mode==='live-observer-ack-lost'){await assert.rejects(second.cleanupRestart(id),e=>e.outcome==='unknown');assert.equal(second.status().worker_ready,true);assert.equal(JSON.parse(fs.readFileSync(state+'/observer-launches/'+obs+'.recovery.json')).phase,'prepared');assert(fs.existsSync(state+'/observer-Abc123/result'));}
   const cleaned=await second.cleanupRestart(id);
   if(observerLoss){assert(!fs.existsSync('/opt/couchroot-observer-'+obs));assert(!fs.existsSync(state+'/observer-Abc123'));assert(!fs.existsSync(state+'/observer-launches/observer-launch.pending'));assert.equal(JSON.parse(fs.readFileSync(state+'/observer-launches/'+obs+'.recovery.json')).phase,'complete');}
   assert.equal(cleaned.id,id);assert.equal(second.status().admission_held,false);
   for(const p of ['/opt/couchroot-worker-'+id,'/opt/couchroot-retirement-'+obs])assert(!fs.existsSync(p),p);
   for(const n of ['retirement-launch.pending','state-install.pending','production-launch.pending'])assert(!fs.existsSync(state+'/'+n),n);
   assert(!fs.readdirSync(state).some(n=>/^(production|retirement)-[A-Za-z0-9]{6}$/.test(n)));assert(fs.existsSync(state+'/'+id+'.restart-cleanup.json'));
   {const r=second.restartInventory();assert.equal(r.action,'none',JSON.stringify(r));assert.equal(r.boundary,'settled');}
   assert.deepEqual(JSON.parse(JSON.stringify(await second.cleanupRestart(id))),{id,already_clean:true,receipt_sha256:cleaned.receipt_sha256});
  }
  // The restarted service can complete an ordinary round trip afterwards.
  const round=await second.rehearseNative(native,runtimeSha);assert.equal(round.selected_implementation,'managed');assert.equal(round.admission_held,false);
  {const r=second.restartInventory();assert.equal(r.action,'none',JSON.stringify(r));}
  assert.deepEqual(fs.readFileSync('/opt/couchroot-agent/jobs/retained-keep-0001.json'),saved);
  // A source never asked to stop ends with its transport; a stopped one exits cleanly.
  if(['state-ready','trial-ready'].includes(mode))assert.equal(source.worker.child.exitCode,0);else assert(source.worker.child.exitCode!==null||source.worker.child.signalCode!==null,'source still running');
 }finally{
  for(const agent of [first,second])if(agent)agent.stop();for(const s of servers)s.close();for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null){c.child.kill('SIGTERM');await c.ended;}for(const p of roots.reverse())fs.rmSync(p,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true});
 }
}));
