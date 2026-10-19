'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sdb=require('./vendor/sdb'),{tarGz}=require('./vendor/tar'),{RootAgentServer}=require('./vendor/root-agent');
const {read,hash,atomic,verifyFirmware,sdkRuntimeGuard}=require('./policy');
const {candidateStatus}=require('./native-candidate');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const {selectionStatus,managedVersion}=require('./worker-selection');
const {processIdentities,observeProcesses,waitForProcessExit}=require('./worker-processes');
const {preparePidfdExit,probeExecutable}=require('./pidfd-observer');
const {stageObserver}=require('./observer-stage');
const {prepareRuntimeObserver,observerTransactionId}=require('./observer-runtime');
const {openRetirementSession}=require('./retirement-session');
const {inventoryRestart,abandonUnsubmitted}=require('./restart-inventory');
const {restartRollbackCandidate,reconcileRestartRollback}=require('./restart-rollback');
const {cleanupRestartRollback}=require('./restart-cleanup');
const {startupCandidate,startSelectedNative}=require('./native-startup');
const {runtimeRead,nativeReadiness}=require('./native-runtime');
const {restartReturnCandidate,reconcileRestartReturn}=require('./restart-return');
const {validateLaunch,validateRuntimeLaunch}=require('./production-readiness');
const {validateManagedLaunch}=require('./managed-readiness');
const {privateRead}=require('./private-state');
const {activateProduction}=require('./production-activation');
const {retireProduction}=require('./production-retirement');
const {activateManaged}=require('./managed-activation');
const {createNativeMigration}=require('./native-migration');
const {createManagedReturn}=require('./managed-return');
const {loadAcquisition,stageAcquisition}=require('./service-acquisition');
const {prepareBootstrap,validateBootstrap,bindBootstrap,retireBootstrap}=require('./held-bootstrap');
const {recoveryCandidate,reconcileBootstrap}=require('./bootstrap-recovery');
const BASE='/home/owner/share/tmp/sdk_tools';
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function launchRequest(stage,gate){
 const script='mkdir '+quote(gate)+' 2>/dev/null && { . '+quote(stage+'/launch-sdk.sh')+'; }';
 const encoded=Buffer.from(script).toString('base64');
 const request='shell:0 appinstall tpk new2.tpk`printf${IFS}%s${IFS}'+encoded+'|base64${IFS}-d|bash`.tpk';
 if(Buffer.byteLength(request)>510)throw Error('SDK launch command exceeds safe transport limit');
 return request;
}
async function launchSdk(client,stage,gate,privateLog){
 // The app writes SDK diagnostics itself; SDK UID 901 needs no log-file access.
 if(privateLog)fs.writeFileSync(stage+'/launcher.log','',{mode:0o600,flag:'wx'});
 const output=await sdb.exec(client,launchRequest(stage,gate),{timeout:30000});
 if(privateLog)fs.appendFileSync(stage+'/launcher.log',output||'');
 return output;
}
function createAgent(config,options={}){
 let running=false,connected=false,launching=false,timer=null,channel=null,client=null,stage=null,attempts=0,generation=0,lastError=null,identity=null,lastAcquired=null,workerReady=false,workerStatus=null,workerStatusAt=0;
 const firmware=options.verifyFirmware||verifyFirmware;
 const currentBoot=options.readBootId||(()=>read('/proc/sys/kernel/random/boot_id',128).toString().trim());
 const payload=options.payload||path.join(__dirname,'../payload');
 let nativeCandidate=candidateStatus(payload,config.device);
 let acquisitionMode=null;
 let managedDigest=null,admissionHold=null,nativeRuntime=null,migration=null,managedReturn=null,reconciliation=null,restartRollback=null,nativeStartup=null,restartReturn=null,bootstrapRecovery=null;
 const inFlight=new Set();
 function selection(refresh=false){
  if(!options.selectionFile)return {phase:'legacy-managed',selected_implementation:'managed',launch_allowed:true};
  const state=selectionStatus(options.selectionFile);
  if(state.launch_allowed&&state.phase==='stable'){
   try{if(refresh||managedDigest===null)managedDigest=(options.managedVersion||managedVersion)(payload);if(state.selected_manifest_sha256!==managedDigest)throw Error('mismatch');}
   catch(_){return {...state,phase:'inspection-required',launch_allowed:false,reason:'managed-package-version-mismatch'};}
  }
  return state;
 }

 function runtimeAllowed(selected){
  if(selected.selected_implementation==='managed')return selected.launch_allowed;
  const h=selected.history&&selected.history[selected.history.length-1];
  return !!(nativeRuntime&&running&&connected&&workerReady&&generation===nativeRuntime.generation&&channel===nativeRuntime.channel&&JSON.stringify(selected)===nativeRuntime.selection&&selected.phase==='stable'&&selected.selected_implementation==='native-prototype'&&selected.selected_manifest_sha256===nativeRuntime.record.manifest_sha256&&h&&h.id===nativeRuntime.record.id&&h.outcome==='committed'&&h.readiness_sha256===nativeRuntime.activation.readiness_sha256);
 }
 function diagnostics(){const out={};if(stage)for(const n of ['launcher.log','root-agent.status','root-agent.log']){try{out[n]=read(stage+'/'+n,65536).toString().slice(-2048);}catch(_){}}return out;}
 function status(){const selected=selection();let boot=null,uptime=null;try{boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();uptime=Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0]);}catch(_){}if(workerStatus){boot=workerStatus.boot_id;uptime=workerStatus.uptime_seconds+process.uptime()-workerStatusAt;}return {schema:2,root_acquisition:acquisitionMode,native_migration:migration?migration.status():null,managed_return:managedReturn?managedReturn.status():null,native_runtime:nativeRuntime&&runtimeAllowed(selected)?{transaction_id:nativeRuntime.record.id,manifest_sha256:nativeRuntime.record.manifest_sha256,activation_sha256:nativeRuntime.activation.receipt_sha256}:null,admission_held:admissionHold!==null,in_flight_requests:inFlight.size,selected_implementation:selected.selected_implementation||null,worker_selection:selected,native_candidate:nativeCandidate,boot_id:boot,uptime_seconds:uptime,worker_ready:workerReady&&runtimeAllowed(selected)&&!admissionHold&&!restartHeld(),worker_id:workerStatus&&workerStatus.worker_id,capabilities:workerStatus?workerStatus.capabilities:[],last_root_acquired_at:lastAcquired,device:config.device,enabled:running,connected,phase:restartHeld()&&connected?'reconciling':!runtimeAllowed(selected)&&!selected.launch_allowed?'selection-required':admissionHold?'draining':workerReady?'ready':connected?'checking':launching?'acquiring':running?'waiting':'disabled',attempts,last_error:lastError,identity,diagnostics:diagnostics()};}
 function clean(){
  if(!stage)return;
  // Do not remove other tools' staging directories or recursively delete unknown files.
  if(fs.existsSync(stage+'/code')&&fs.lstatSync(stage+'/code').isDirectory()&&!fs.lstatSync(stage+'/code').isSymbolicLink()){
   for(const n of ['libacquire.so','native-worker','native-app-launcher']){const p=stage+'/code/'+n;if(fs.existsSync(p)&&fs.lstatSync(p).isFile())fs.unlinkSync(p);}
   try{fs.rmdirSync(stage+'/code');}catch(_){}
  }
  for(const n of fs.readdirSync(stage)){
   if(!/^(SamsungTv(RootAgent|ArchiveRoot)\.(dll|runtimeconfig\.json|deps\.json)|NativeEntry\.(dll|runtimeconfig\.json|deps\.json)|operation\.sh|public\.pem|passwd|root-agent\.(token|log|status)|launcher\.log|launch-sdk\.sh)$/.test(n))continue;
   const p=path.join(stage,n);if(fs.lstatSync(p).isFile())fs.unlinkSync(p);
  }
  try{fs.rmdirSync(stage+'/launch-once');}catch(_){}
  const pkg=path.basename(stage);for(const suffix of ['.tar.gz','.tar.gz.signature']){const p=BASE+'/on-demand/'+pkg+suffix;if(fs.existsSync(p)&&fs.lstatSync(p).isFile())fs.unlinkSync(p);}
  try{fs.rmdirSync(stage);stage=null;}catch(_){}try{fs.rmdirSync(BASE+'/on-demand');}catch(_){}
 }
 function schedule(){if(!running||timer||connected||admissionHold)return;if(attempts>=8){lastError='Acquisition retry budget exhausted; use authenticated disable/enable after diagnosis';return;}timer=setTimeout(()=>{timer=null;launch();},Math.min(60000,5000*Math.pow(2,Math.max(0,attempts-1))));}
 function prepare(port,secret,attempt){
  firmware(config);
  if(options.selectionFile){const prior=recoveryCandidate(options.selectionFile,currentBoot);if(prior&&(!attempt.recovery||prior.id!==attempt.recovery.id))throw Error('Bootstrap recovery must precede acquisition');}
  const pkg='archive-root-'+crypto.randomBytes(8).toString('hex');stage=BASE+'/'+pkg;
  fs.mkdirSync(stage,{mode:0o755});
  const onDemand=BASE+'/on-demand';try{fs.mkdirSync(onDemand,{mode:0o755});}catch(e){if(e.code!=='EEXIST')throw e;const s=fs.lstatSync(onDemand);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Unsafe staging directory');}
  const manifest=JSON.parse(read(payload+'/manifest.json'));
  attempt.acquisition=config.service_acquisition==='managed'?null:loadAcquisition(payload,config.device);
  if(config.service_acquisition==='native'&&!attempt.acquisition)throw Error('Native acquisition package required');
  acquisitionMode=attempt.acquisition?'native-managed-entry':'managed';
  if(attempt.acquisition)stageAcquisition(stage,attempt.acquisition);
  for(const name of ['SamsungTvArchiveRoot','SamsungTvRootAgent'])for(const suffix of ['dll','runtimeconfig.json','deps.json']){
   const file=name+'.'+suffix,bytes=read(payload+'/'+file,4*1024*1024);if(hash(bytes)!==manifest[file])throw Error('Payload mismatch');fs.writeFileSync(stage+'/'+file,bytes,{mode:0o644,flag:'wx'});
  }
  const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  fs.writeFileSync(stage+'/public.pem',keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o644,flag:'wx'});
  const passwd=read('/etc/passwd').toString().split('\n');let changed=0;
  const view=passwd.map(line=>{const parts=line.split(':');if(parts[0]==='owner'){if(parts.length!==7||parts[2]!=='5001'||parts[3]!=='100')throw Error('Unexpected owner identity');parts[2]='0';parts[3]='0';changed++;return parts.join(':');}return line;}).join('\n');
  if(changed!==1)throw Error('Missing owner identity');fs.writeFileSync(stage+'/passwd',view,{mode:0o644,flag:'wx'});
  fs.writeFileSync(stage+'/root-agent.token',secret.toString('base64')+'\n',{mode:0o600,flag:'wx'});
  let script='/usr/bin/dotnet '+stage+'/SamsungTvRootAgent.dll 127.0.0.1 '+port+' '+stage+'/root-agent.token '+stage+' </dev/null >'+stage+'/root-agent.log 2>&1 &\n';
  if(attempt.acquisition){
   if(nativeStartup&&nativeStartup.phase!=='complete'&&!restartReturn&&!restartRollback&&!attempt.recovery){
    const prepared=prepareBootstrap({payload,device:config.device,stage,port,bootId:currentBoot(),journalDirectory:path.dirname(options.selectionFile),selectionFile:options.selectionFile});
    attempt.bootstrap=prepared.record;script=prepared.command;
   }
   fs.writeFileSync(stage+'/operation.sh',script,{mode:0o644,flag:'wx'});
  }
  const archive=tarGz([{name:'launch.sh',data:script,mode:0o700}]);
  fs.writeFileSync(onDemand+'/'+pkg+'.tar.gz',archive,{mode:0o644,flag:'wx'});fs.writeFileSync(onDemand+'/'+pkg+'.tar.gz.signature',crypto.sign('RSA-SHA256',archive,keys.privateKey),{mode:0o644,flag:'wx'});
  return pkg;
 }
 async function launch(){
  if(!running||connected||launching||admissionHold)return;
  // A restarted service has no live coordinator handles. Only a transition proven
  // to have submitted nothing remote is abandoned; others stay blocked unless
  // their durable evidence admits a held restart rollback below.
  if(!selection(true).launch_allowed&&!migration&&options.selectionFile){try{reconciliation=abandonUnsubmitted(options.selectionFile);}catch(error){reconciliation={abandoned:false,error:String(error.message).slice(0,160)};}}
  // A submitted but uncommitted forward trial, or a committed restart rollback
  // whose intent remains, is finished through a held managed executor.
  if(!migration&&options.selectionFile&&(!restartRollback||restartRollback.phase==='complete')){try{const c=restartRollbackCandidate(options.selectionFile,(options.managedVersion||managedVersion)(payload));if(c)restartRollback={id:c.id,phase:'acquiring',running:false,attempts:0,error:null,result:null};}catch(error){reconciliation={...(reconciliation||{}),error:String(error.message).slice(0,160)};}}
  if(options.selectionFile&&!managedReturn){const c=restartReturnCandidate(options.selectionFile,(options.managedVersion||managedVersion)(payload));if(c)restartReturn={...c,phase:'acquiring',attempts:0,error:null};}
  if(options.selectionFile&&selection().selected_implementation==='native-prototype'&&selection().phase==='stable'){try{const c=startupCandidate(options.selectionFile);if(c)nativeStartup={id:c.record.id,phase:'acquiring',error:null};}catch(e){lastError=e.message;}}
  if(options.selectionFile){try{const prior=recoveryCandidate(options.selectionFile,currentBoot);if(prior)bootstrapRecovery={id:prior.id,phase:'acquiring',attempts:0,error:null};}catch(error){running=false;lastError=String(error.message);return;}}
  if(!selection(true).launch_allowed&&!restartHeld()){running=false;lastError='Worker selection requires reconciliation';return;}
  launching=true;attempts++;const gen=++generation,attempt={acquisition:null,bootstrap:null,recovery:bootstrapRecovery&&bootstrapRecovery.phase!=='complete'?bootstrapRecovery:null};let step='firmware verification';
  try{
   nativeCandidate=candidateStatus(payload,config.device);
   firmware(config);
   const secret=crypto.randomBytes(32);
   if(channel)channel.close();
   channel=new RootAgentServer({secret,onConnect:conn=>{if(!running||gen!==generation||(admissionHold&&admissionHold.stopping)){conn._socket.destroy();return;}connected=true;workerReady=false;identity=conn.identity;conn.operation({op:'status'}).then(info=>{if(!running||gen!==generation||!connected||channel._conn!==conn)return;if(attempt.bootstrap)validateBootstrap(info,{bootId:currentBoot(),launcherSha256:attempt.bootstrap.launcher_sha256});else validateReadiness(info,{implementation:'managed',bootId:currentBoot()});workerStatus=info;workerStatusAt=process.uptime();workerReady=true;lastAcquired=new Date().toISOString();if(attempt.recovery)runBootstrapRecovery(conn,gen);else if(restartReturn&&restartReturn.phase!=='complete')runRestartReturn(conn,gen);else if(nativeStartup&&nativeStartup.phase!=='complete')runNativeStartup(conn,gen,attempt.bootstrap);else if(restartHeld())runRestartRollback(conn,gen);}).catch(error=>{if(gen===generation&&connected&&channel._conn===conn){lastError=String(error.message);conn._socket.destroy();}});lastError=null;launching=false;if(timer){clearTimeout(timer);timer=null;}if(client){sdb.close(client);client=null;}},onClose:()=>{if(gen!==generation||(attempt.bootstrap&&nativeStartup&&nativeStartup.retiring))return;connected=false;workerReady=false;identity=null;workerStatus=null;workerStatusAt=0;schedule();}});
   await new Promise((resolve,reject)=>{channel.start(resolve);channel._server.once('error',reject);});
   if(!running||gen!==generation)return;
   step='loopback connection';
   const opened=await sdb.connect({host:'127.0.0.1',port:26101,timeout:8000});
   if(!running||gen!==generation){sdb.close(opened);return;}
   client=opened;
   step='payload staging';clean();const pkg=prepare(channel.listeningPort(),secret,attempt);
   let command=attempt.acquisition?'env -i PATH=/usr/bin:/bin DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus /usr/bin/dotnet '+quote(stage+'/NativeEntry.dll')+' probe '+quote(pkg):'/usr/bin/dotnet '+quote(stage+'/SamsungTvArchiveRoot.dll')+' '+quote(pkg);
   // SDK UID 901 cannot create a marker in the app-owned staging directory.
   const gate='/tmp/'+pkg+'-launch-once';
   fs.writeFileSync(stage+'/launch-sdk.sh','set -eu\n'+sdkRuntimeGuard(config)+command+'\n',{mode:0o644,flag:'wx'});
   step='SDK launcher';const output=await launchSdk(client,stage,gate,!!attempt.acquisition);
   if(!connected&&output)lastError='SDK launcher: '+output.slice(-300).replace(/[\r\n]+/g,' ');
   if(!connected&&running&&gen===generation)throw Error(lastError&&lastError.startsWith('SDK launcher:')?lastError:'Launcher returned without authenticated agent');
  }catch(e){if(running&&gen===generation&&!connected)lastError=(step+': '+String(e.message||e.code)).slice(0,300);}
  finally{if(gen===generation){launching=false;if(client){sdb.close(client);client=null;}if(!connected)schedule();}}
 }
 function restartHeld(){return !!bootstrapRecovery&&bootstrapRecovery.phase!=='complete'||!!restartRollback&&restartRollback.phase!=='complete'||!!nativeStartup&&nativeStartup.phase!=='complete'||!!restartReturn&&restartReturn.phase!=='complete';}
 async function runBootstrapRecovery(conn,gen){
  const r=bootstrapRecovery,owner=channel;if(r.running)return;r.running=true;r.phase='reconciling';r.attempts++;
  const owned=()=>{if(!running||gen!==generation||channel!==owner||owner._conn!==conn||!connected||bootstrapRecovery!==r)throw Error('Bootstrap recovery executor changed');};
  try{
   r.result=await reconcileBootstrap({selectionFile:options.selectionFile,bootId:currentBoot(),executor:{pid:conn.identity.pid,status:async()=>{owned();const v=await conn.operation({op:'status'});owned();return v;},execute:async(c,t)=>{owned();const v=await owner.execute(c,t);owned();return v;}}});
   owned();r.phase='complete';r.error=null;lastError=null;
   if(restartReturn&&restartReturn.phase!=='complete')runRestartReturn(conn,gen);
   else if(nativeStartup&&nativeStartup.phase!=='complete')runNativeStartup(conn,gen);
   else if(restartRollback&&restartRollback.phase!=='complete')runRestartRollback(conn,gen);
  }catch(error){r.phase='failed';r.error=String(error.message).slice(0,160);lastError=r.error;
   // The fence/cleanup contract is convergent: re-observe on the same held
   // executor, never submit the interrupted launch again.
   if(r.attempts<36)setTimeout(()=>{if(bootstrapRecovery===r&&running&&gen===generation&&connected)runBootstrapRecovery(conn,gen);},options.restartRollbackRetryMs||10000);
  }finally{r.running=false;}
 }
 async function runRestartReturn(conn,gen){
  const r=restartReturn,owner=channel;if(r.running)return;r.running=true;r.phase='reconciling';r.attempts++;
  const owned=()=>{if(!running||gen!==generation||channel!==owner||owner._conn!==conn||!connected||restartReturn!==r)throw Error('Return bootstrap executor changed');};
  r.resume=()=>runRestartReturn(conn,gen);
  try{
   r.result=await reconcileRestartReturn({selectionFile:options.selectionFile,managedSha256:(options.managedVersion||managedVersion)(payload),executor:{pid:conn.identity.pid,status:async()=>{owned();const v=await conn.operation({op:'status'});owned();return v;},operation:async o=>{owned();const v=await conn.operation(o);owned();return v;},execute:async(c,t)=>{owned();const v=await owner.execute(c,t);owned();return v;}}});
   owned();r.phase='complete';r.error=null;lastError=null;
  }catch(error){r.phase='failed';r.error=[];for(let c=error;c&&r.error.length<4;c=c.cause)r.error.push(String(c.message).slice(0,160));lastError=r.error.join(': ');
   if(r.attempts<36)setTimeout(()=>{if(restartReturn===r&&running&&gen===generation&&connected)runRestartReturn(conn,gen);},options.restartRollbackRetryMs||10000);
  }finally{r.running=false;}
  return r.result;
 }
 async function runNativeStartup(conn,gen,bootstrap){
  const r=nativeStartup,owner=channel;
  const owned=()=>{if(!running||gen!==generation||channel!==owner||owner._conn!==conn||!connected||nativeStartup!==r)throw Error('Native bootstrap executor changed');};
  r.phase='verifying';let result;
  try{
   if(bootstrap){bootstrap=await bindBootstrap(bootstrap,owner,currentBoot());owned();r.bootstrap={id:bootstrap.id,implementation:'native-bootstrap',phase:'ready'};}
   result=await startSelectedNative({selectionFile:options.selectionFile,executor:{implementation:bootstrap?'native-bootstrap':'managed',launcherSha256:bootstrap&&bootstrap.launcher_sha256,pid:conn.identity.pid,status:async()=>{owned();const info=await conn.operation({op:'status'});owned();return info;},execute:async(c,t)=>{owned();const value=await owner.execute(c,t);owned();return value;}}});
   owned();const next=result.channel,peer=next._conn;
   if(!peer)throw Error('Native startup transport changed');
   if(bootstrap){r.retiring=true;await retireBootstrap(bootstrap,owner,next);if(!running||gen!==generation||channel!==owner||nativeStartup!==r||owner._conn!==null||next._conn!==peer)throw Error('Retired bootstrap ownership changed');r.bootstrap.phase='retired';}
   const adoptedGeneration=++generation;channel=next;connected=true;workerReady=true;workerStatus=result.info;workerStatusAt=process.uptime();identity=peer.identity;launching=false;lastError=null;
   nativeRuntime={...result,generation:adoptedGeneration};r.phase='complete';migration=null;managedReturn=null;
   const previousClose=next.onClose;next.onClose=error=>{try{if(previousClose)previousClose(error);}finally{nativeDisconnected(next,adoptedGeneration);}};
   owner.close();
  }catch(error){if(result&&channel!==result.channel)result.channel.close();r.phase='failed';r.error=[];for(let c=error;c&&r.error.length<4;c=c.cause)r.error.push(String(c.message).slice(0,160));lastError=r.error.join(': ');}
 }
 function nativeDisconnected(next,gen){
  if(generation!==gen||channel!==next)return;connected=false;workerReady=false;workerStatus=null;identity=null;workerStatusAt=0;nativeRuntime=null;lastError='Native worker disconnected; reconciliation required';
  if(!admissionHold){migration=null;managedReturn=null;nativeStartup=null;schedule();}
 }
 // Uses only the held channel that just passed managed readiness. Any change of
 // connection or generation aborts; the journal records how far it got.
 async function runRestartRollback(conn,gen){
  const r=restartRollback;if(!r||r.running||r.phase==='complete')return;
  const owner=channel,owned=()=>{if(!running||gen!==generation||!connected||channel!==owner||owner._conn!==conn||restartRollback!==r)throw Error('Restart rollback executor changed');};
  r.running=true;r.phase='verifying';r.attempts++;
  try{
   const result=await reconcileRestartRollback({selectionFile:options.selectionFile,managedSha256:(options.managedVersion||managedVersion)(payload),executor:{pid:conn.identity.pid,
    status:async()=>{owned();const info=await conn.operation({op:'status'});owned();return info;},
    execute:async(command,timeout)=>{owned();const result=await owner.execute(command,timeout);owned();return result;}}});
   owned();if(!selection(true).launch_allowed)throw Error('Managed selection not restored');
   r.result=result;r.error=null;r.phase='complete';
  }catch(error){
   const chain=[];for(let c=error;c&&chain.length<4;c=c.cause)chain.push(String(c.message||c).slice(0,160));r.error=chain;r.phase='failed';
   // Old workers exit when their transports close, and the bounded provider
   // within its 300 s lifetime. A rejected attempt changed nothing durable, so
   // re-observe on the same held worker; anything uncertain waits for a new one.
   if(error.outcome==='rejected'&&r.attempts<(options.restartRollbackAttempts||36))setTimeout(()=>{if(restartRollback===r&&gen===generation&&connected&&channel===owner&&owner._conn===conn)runRestartRollback(conn,gen);},options.restartRollbackRetryMs||10000);
  }
  finally{r.running=false;}
 }
 function start(){if(running)return;running=true;attempts=0;lastError=null;launch();}
 function stop(){admissionHold=null;nativeRuntime=null;running=false;connected=false;workerReady=false;identity=null;workerStatus=null;workerStatusAt=0;++generation;if(migration)migration.closeTransport();if(managedReturn)managedReturn.closeTransport();migration=null;managedReturn=null;nativeStartup=null;restartRollback=null;restartReturn=null;bootstrapRecovery=null;if(timer)clearTimeout(timer);timer=null;if(client)sdb.close(client);client=null;if(channel)channel.close();channel=null;launching=false;const stopped=generation;setTimeout(()=>{if(!running&&generation===stopped){try{clean();}catch(e){lastError='Staging cleanup incomplete';}}},1000);}
 function submit(call){
  if(admissionHold||restartHeld()||!running||!connected||!workerReady||!channel||!runtimeAllowed(selection()))return Promise.reject(Object.assign(Error('Root worker unavailable or admission held'),{outcome:'rejected'}));
  let request;try{request=Promise.resolve(call(channel));}catch(e){request=Promise.reject(e);}
  // Keep a result classification, not command output, for the handoff drain.
  // Transport errors without an explicit outcome are also uncertain.
  const settled=request.then(()=>true,e=>!!e&&['failed','rejected'].includes(e.outcome));
  inFlight.add(settled);settled.then(()=>inFlight.delete(settled));
  return request;
 }
 // activeNative holds an admitted native runtime for its return to managed; the
 // hold then starts where a rehearsal's adoption left off.
 function holdAdmission({activeNative=false}={}){
  const selected=selection();
  if(admissionHold||restartHeld()||!running||!connected||!workerReady||!channel||!(activeNative?nativeRuntime&&runtimeAllowed(selected):selected.launch_allowed))throw Error('Ready worker required for handoff hold');
  const returnVersion=activeNative?(options.managedVersion||managedVersion)(payload):null;
  const token={},owner=channel,peer=channel._conn,gen=generation,worker=workerStatus.worker_id,boot=workerStatus.boot_id,pending=Array.from(inFlight),sourceVersion=activeNative?returnVersion:selected.selected_manifest_sha256;
  if(activeNative){const record=JSON.parse(JSON.stringify(nativeRuntime.record));Object.assign(token,{activeReturn:true,adopted:{generation:gen,channel:owner,record},stopped:{transaction_id:record.id},source:record.source,providerSource:record.worker_identity,targetVersion:'native-prototype|'+record.manifest_sha256});}
  const providerSource=()=>JSON.stringify(token.activeReturn?token.providerSource:token.source);
  admissionHold=token;
  function current(){if(admissionHold!==token||generation!==gen||channel!==owner||owner._conn!==peer||!running||!connected||!workerReady||!workerStatus||workerStatus.worker_id!==worker)throw Error('Worker changed during handoff hold');}
  async function snapshot(full=false){
    current();if(token.stopping)throw Error('Worker shutdown already submitted');const outcomes=await Promise.all(pending);current();
    if(outcomes.some(known=>!known))throw Error('Uncertain request outcome during handoff drain');
    const info=await owner.operation({op:'status'});current();
    validateReadiness(info,{implementation:'managed',bootId:boot});
    if(info.worker_id!==worker)throw Error('Worker identity changed during handoff inventory');
    const resources=validateResourceInventory(info),bound=processIdentities(info,peer.identity.pid);
    // This is a fresh inventory under a held service admission gate, not a
    // durable quiescence receipt or proof that detached work has stopped.
    return full?JSON.parse(JSON.stringify(info)):{...bound,resources:JSON.parse(JSON.stringify(resources))};
  }
  function prepared(id,digest){
   if(!options.selectionFile)throw Error('Durable selection required before shutdown');
   const state=selection(),p=state.pending;
   if(state.phase!=='reconciliation-required'||!p||p.id!==id||p.phase!=='prepared'||p.from.implementation!=='managed'||!sourceVersion||p.from.manifest_sha256!==sourceVersion||p.quiescence_sha256!==digest)throw Error('Selection does not bind this drained worker inventory');
   const target=p.to.implementation+'|'+p.to.manifest_sha256;
   if(token.targetVersion&&token.targetVersion!==target)throw Error('Selection target changed during handoff');
   token.targetVersion=target;
  }
  async function nativeSnapshot(){
   const adopted=token.adopted,peer=adopted&&adopted.channel._conn;
   const bound=()=>{if(!adopted||adopted.managed||admissionHold!==token||generation!==adopted.generation||channel!==adopted.channel||!running||!connected||!workerReady||!peer||adopted.channel._conn!==peer||currentBoot()!==boot)throw Error('Held native ownership required');};
   bound();const info=await adopted.channel.operation({op:'status'});bound();
   validateReadiness(info,{implementation:'native-prototype',bootId:boot,launcherSha256:adopted.record.launcher_sha256});
   const nativeIdentity=processIdentities(info,peer.identity.pid),resources=validateResourceInventory(info);
   if(JSON.stringify(nativeIdentity)!==JSON.stringify(adopted.record.worker_identity))throw Error('Native identity changed before rollback');
   return {...nativeIdentity,resources:JSON.parse(JSON.stringify(resources))};
  }
  return {
   snapshot:async()=>{if(token.preparingStop)throw Error('Worker shutdown preparation in progress');return snapshot();},
   probeObserver:async (expectedManifest,requestId)=>{
    current();if(token.preparingStop||token.stopping||token.observerStaging||token.observerProbe||token.retirementPreparing||token.retirementSession)throw Error('Observer probe already pending');
    if(config.device==='s90d'&&options.observerChildProcess===false&&!options.externalObserverDirectory)throw Object.assign(Error('Process observer requires an external launch transport'),{outcome:'rejected'});
    if(typeof expectedManifest!=='string'||expectedManifest.length!==64||!/^[a-f0-9]{64}$/.test(expectedManifest))throw Error('Candidate manifest digest required');
    if(options.retirementProbeDirectory)observerTransactionId(requestId,'provider-probe');
    else if(config.device==='s90d'&&options.externalObserverDirectory)observerTransactionId(requestId);
    token.preparingStop=true;
    let retirementSession=null;
    try{
     const bound=await snapshot();current();
     const staged=await stageObserver({payload,device:config.device,bootId:boot,expectedManifest,execute:async(command,timeout)=>{
      current();token.observerStaging=true;const result=await owner.execute(command,timeout);current();return result;
     }});
     token.observerStaging=false;token.observerProbe=true;
     const executeHeld=async(command,timeout)=>{current();const result=await owner.execute(command,timeout);current();return result;};
     if(options.retirementProbeDirectory){
      retirementSession=await openRetirementSession({device:config.device,id:observerTransactionId(requestId,'provider-probe'),payload,manifestSha256:expectedManifest,
       source:{boot_id:bound.boot_id,worker_id:bound.worker_id,processes:bound.processes},journalDirectory:options.retirementProbeDirectory,execute:executeHeld,confirmSource:()=>snapshot(true)});
      current();
     }
     if(config.device==='s90d'&&options.externalObserverDirectory){
      const observer=await prepareRuntimeObserver({...(retirementSession?{purpose:'provider-probe',retirement:retirementSession.provider}:{}),directory:options.externalObserverDirectory,requestId,staged,bound,confirm:()=>snapshot(true),execute:async(command,timeout)=>{
       current();const result=await owner.execute(command,timeout);current();return result;
      }});
      try{observer.assertReady();}finally{await observer.cancel();}
     }else if(config.device==='s90d'){
      try{await probeExecutable(staged);}catch(error){if(['failed','rejected'].includes(error.outcome))token.observerProbe=false;throw error;}current();
      const observer=await preparePidfdExit({...staged,bound,confirm:snapshot});
      try{observer.assertReady();}finally{await observer.cancel();}
     }else{
      // QN90A uses the service's proc-stat reader for the real handoff. Its WRT
      // child-process cleanup crashes in HandleWrap::Close; an unused native
      // executable smoke test must not take down the administration service.
      const result=observeProcesses(bound,options.readProcessFile);
      if(Object.values(result.processes).some(p=>p&&p.observation!=='present'))throw Error('Worker identity changed during observer probe');
     }
     if(retirementSession){const retired=await retirementSession.retire({execute:executeHeld,confirmExecutor:()=>snapshot(true),executorPid:peer.identity.pid});current();if(!retired||retired.phase!=='complete')throw Error('Provider retirement incomplete');}
     const final=await snapshot();current();
     if(hash(JSON.stringify({boot_id:final.boot_id,worker_id:final.worker_id,processes:final.processes}))!==hash(JSON.stringify({boot_id:bound.boot_id,worker_id:bound.worker_id,processes:bound.processes})))throw Error('Worker changed during observer probe');
     token.observerProbe=false;
     return {verified:true,method:config.device==='s90d'?(options.externalObserverDirectory?'pidfd-external-bind-cancel':'pidfd-bind-cancel'):'proc-stat',manifest_sha256:staged.manifest_sha256,observer_sha256:staged.sha256,boot_id:boot,worker_id:worker,worker_stopped:false,...(retirementSession?{retirement_provider_verified:true,retirement_provider_retired:true}:{})};
    }finally{if(retirementSession)retirementSession.closeTransport();token.preparingStop=false;}
   },
   prepareNative:async transactionId=>{
    current();if(token.stopping||token.preparingStop||token.retirementPreparing||token.retirementSession)throw Error('Native provider preparation requires reconciliation');
    const inventory=await snapshot(),digest=hash(JSON.stringify(inventory));current();prepared(transactionId,digest);
    const target=selection().pending.to;if(target.implementation!=='native-prototype')throw Error('Native handoff target required');
    token.retirementPreparing=true;
    const execute=async(command,timeout)=>{current();prepared(transactionId,digest);const result=await owner.execute(command,timeout);current();prepared(transactionId,digest);return result;};
    try{
     const session=await openRetirementSession({device:config.device,id:observerTransactionId(transactionId,'handoff'),payload,manifestSha256:target.manifest_sha256,source:{boot_id:inventory.boot_id,worker_id:inventory.worker_id,processes:inventory.processes},journalDirectory:path.dirname(options.selectionFile),execute,confirmSource:()=>snapshot(true)});
     current();prepared(transactionId,digest);token.retirementSession=session;return session;
    }catch(error){throw Object.assign(Error('Native provider preparation requires reconciliation'),{outcome:'unknown',cause:error});}
   },
   shutdown:async transactionId=>{
    current();if(token.stopping||token.preparingStop||token.observerStaging||(token.retirementPreparing&&!token.retirementSession))throw Error('Worker shutdown or observer staging requires reconciliation');
    const retirement=token.retirementSession?token.retirementSession.provider:options.externalObserverRetirement;
    const externalHandoff=config.device==='s90d'&&options.externalObserverDirectory&&retirement&&typeof retirement.inspectUnit==='function'&&typeof retirement.retireUnit==='function';
    if(options.observerChildProcess===false&&(options.processObserver||options.stagePackagedObserver)&&!externalHandoff)throw Object.assign(Error('Process observer requires an external launch transport with independent retirement'),{outcome:'rejected'});
    token.preparingStop=true;
    let observer=null,stagedObserver=null,completed=null;
    try{
    const inventory=await snapshot();current();if(token.stopping)throw Error('Worker shutdown already submitted');
    const r=inventory.resources;
    if(r.transfers.length||r.helpers.length||r.jobs.some(j=>!j.monitor_finished||!['completed','cancelled','timed_out','interrupted'].includes(j.state)))throw Error('Worker resources must be settled before shutdown');
    const digest=hash(JSON.stringify(inventory));prepared(transactionId,digest);
    // Explicit trusted construction option only. Packaging/staging must provide
    // an immutable manifest-bound observer; never downgrade an EACCES to exit.
    let observerOptions=options.processObserver;
    if(!observerOptions&&options.stagePackagedObserver){
     const target=selection().pending.to;
     if(target.implementation!=='native-prototype')throw Error('Observer staging requires a native candidate target');
     token.observerStaging=true;
     stagedObserver=await stageObserver({payload,device:config.device,bootId:boot,expectedManifest:target.manifest_sha256,execute:async(command,timeout)=>{
      current();prepared(transactionId,digest);
      const result=await owner.execute(command,timeout);
      current();prepared(transactionId,digest);return result;
     }});
     token.observerStaging=false;observerOptions=stagedObserver;
    }
    if(externalHandoff){
     if(!stagedObserver)throw Error('External handoff requires a packaged observer');
     observer=await prepareRuntimeObserver({purpose:'handoff',directory:options.externalObserverDirectory,requestId:transactionId,staged:stagedObserver,bound:inventory,retirement,
      execute:async(command,timeout)=>{current();prepared(transactionId,digest);const result=await owner.execute(command,timeout);current();prepared(transactionId,digest);return result;},
      confirm:async()=>{
       const info=await snapshot(true);current();prepared(transactionId,digest);
       const fresh={...processIdentities(info,peer.identity.pid),resources:JSON.parse(JSON.stringify(validateResourceInventory(info)))};
       if(hash(JSON.stringify(fresh))!==digest)throw Error('Worker inventory changed after external process binding');
       return info;
      }});
     observer.assertReady();
    }else if(observerOptions){
     observer=await preparePidfdExit({...observerOptions,bound:inventory,confirm:async()=>{
      const fresh=await snapshot();current();prepared(transactionId,digest);
      if(hash(JSON.stringify(fresh))!==digest)throw Error('Worker inventory changed after process handle binding');
      return fresh;
     }});
     observer.assertReady();
    }else{
     const before=observeProcesses(inventory,options.readProcessFile);
     if(Object.values(before.processes).some(p=>p&&p.observation!=='present'))throw Error('Worker process identity changed before shutdown');
    }
    current();prepared(transactionId,digest);token.stopping=true;
    const shutdown=await owner.shutdown();
    const exited=await (observer?observer.waitForExit():waitForProcessExit(inventory,{read:options.readProcessFile}));
    if(admissionHold!==token||generation!==gen||channel!==owner||!running)throw Error('Handoff ownership changed during shutdown');
    prepared(transactionId,digest);
    completed={transaction_id:transactionId,source_manifest_sha256:sourceVersion,inventory_sha256:digest,shutdown,exited,...(stagedObserver?{observer_stage:stagedObserver}:{})};
    token.source={boot_id:inventory.boot_id,worker_id:inventory.worker_id,processes:inventory.processes};return completed;
    }finally{try{if(observer)await observer.cancel();if(completed)token.stopped=JSON.parse(JSON.stringify(completed));}finally{token.preparingStop=false;}}
   },
   adoptProduction:async session=>{
    const bound=()=>{if(admissionHold!==token||generation!==gen||channel!==owner||!running||!token.stopped||token.preparingStop)throw Error('Stopped handoff ownership required for native adoption');};
    bound();if(token.adopting||token.activeReturn)throw Error('Native adoption requires reconciliation');
    if(!session||typeof session.takeChannel!=='function'||typeof session.closeTransport!=='function'||!session.record||session.record.phase!=='ready'||hash(JSON.stringify(session.record))!==session.readiness_sha256)throw Error('Verified production session required');
    const readinessDigest=session.readiness_sha256,readyRecord=JSON.parse(JSON.stringify(session.record));
    const {worker_identity,unit_started_monotonic,...launch}=readyRecord;validateLaunch({...launch,phase:'submitted'});
    if(!/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic)||launch.id!==token.stopped.transaction_id||launch.boot_id!==boot||JSON.stringify(launch.source)!==JSON.stringify(token.source))throw Error('Production session does not match stopped source');
    const committed=()=>{const s=selectionStatus(options.selectionFile),h=s.history&&s.history[s.history.length-1];if(s.phase!=='stable'||s.selected_implementation!=='native-prototype'||s.selected_manifest_sha256!==launch.manifest_sha256||!h||h.id!==launch.id||h.outcome!=='committed'||h.state_sha256!==launch.state_receipt_sha256||h.readiness_sha256!==readinessDigest||h.quiescence_sha256!==token.stopped.inventory_sha256)throw Error('Committed production trial required');return JSON.stringify(s);};
    const selected=committed();token.adopting=true;let next;
    try{
     next=await session.takeChannel();bound();if(committed()!==selected||!next||next===owner||!next._conn)throw Error('Production channel ownership changed');
     const peer=next._conn,info=await next.operation({op:'status'});bound();
     if(committed()!==selected||next._conn!==peer||currentBoot()!==boot||!['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)||peer.identity.smack!=='System')throw Error('Production peer changed during adoption');
     validateReadiness(info,{implementation:'native-prototype',bootId:boot,launcherSha256:launch.launcher_sha256});
     const nativeIdentity=processIdentities(info,peer.identity.pid),resources=validateResourceInventory(info);
     if(JSON.stringify(nativeIdentity)!==JSON.stringify(worker_identity)||resources.jobs.length||resources.transfers.length||resources.helpers.length)throw Error('Production identity or resources changed');
     // Invalidate old callbacks before closing the stopped source listener.
     const adoptedGeneration=++generation,previousClose=next.onClose;
     channel=next;connected=true;workerReady=true;workerStatus=info;workerStatusAt=process.uptime();identity=peer.identity;launching=false;lastError=null;
     if(timer){clearTimeout(timer);timer=null;}
     next.onClose=error=>{try{if(previousClose)previousClose(error);}finally{if(generation===adoptedGeneration&&channel===next){nativeDisconnected(next,adoptedGeneration);}}};
     owner.close();token.adopted={generation:adoptedGeneration,channel:next,record:readyRecord};
     // Admission stays held until provider retirement and transition completion
     // are independently verified by the controller.
     return {transaction_id:launch.id,worker_id:info.worker_id,admission_held:true};
    }catch(error){session.closeTransport();throw Object.assign(Error('Production channel adoption requires reconciliation'),{outcome:'unknown',cause:error});}
   },
   snapshotNative:async()=>{
    if(token.nativeStopAttempted||token.nativeStopping||token.preparingNativeStop||token.completionBusy)throw Error('Native shutdown requires reconciliation');
    // Public requests admitted before the hold must have known outcomes.
    if(token.activeReturn&&!token.drained){const outcomes=await Promise.all(pending);if(outcomes.some(known=>!known))throw Error('Uncertain request outcome during handoff drain');token.drained=true;}
    return nativeSnapshot();
   },
   // Launch the bounded provider through the held native worker, bound to it as
   // source, only once the return transition names this transaction.
   openReturnProvider:async transactionId=>{
    const adopted=token.adopted;
    if(!token.activeReturn||!token.drained||!adopted||adopted.managed||token.retirementSession||token.retirementPreparing||token.nativeStopAttempted||token.preparingNativeStop||token.completionBusy)throw Error('Return provider requires reconciliation');
    const bind=()=>{const s=selectionStatus(options.selectionFile),p=s.pending,h=s.history&&s.history[s.history.length-1];if(s.phase!=='reconciliation-required'||!p||p.id!==transactionId||p.phase!=='prepared'||p.from.implementation!=='native-prototype'||p.from.manifest_sha256!==adopted.record.manifest_sha256||p.to.implementation!=='managed'||p.to.manifest_sha256!==sourceVersion||!h||h.id!==adopted.record.id||h.outcome!=='committed')throw Error('Selection does not bind the native return');};
    bind();const inventory=await nativeSnapshot();bind();
    const identity={boot_id:inventory.boot_id,worker_id:inventory.worker_id,processes:inventory.processes};
    if(JSON.stringify(identity)!==JSON.stringify(token.providerSource))throw Error('Native identity changed before return provider');
    const nativePeer=adopted.channel._conn,live=()=>{if(admissionHold!==token||generation!==adopted.generation||channel!==adopted.channel||!running||adopted.channel._conn!==nativePeer||currentBoot()!==boot)throw Error('Held native ownership required');bind();};
    token.retirementPreparing=true;
    try{
     const session=await openRetirementSession({device:config.device,id:observerTransactionId(transactionId,'handoff'),payload,manifestSha256:adopted.record.manifest_sha256,source:identity,journalDirectory:path.dirname(options.selectionFile),
      execute:async(command,timeout)=>{live();const result=await adopted.channel.execute(command,timeout);live();return result;},
      confirmSource:async()=>{live();const info=await adopted.channel.operation({op:'status'});live();return info;}});
     token.retirementSession=session;live();if(JSON.stringify(session.record.source)!==providerSource())throw Error('Return provider source changed');return session;
    }catch(error){throw Object.assign(Error('Return provider preparation requires reconciliation'),{outcome:'unknown',cause:error});}
   },
   shutdownNative:async (transactionId,retirementSession)=>{
    if(token.nativeStopAttempted||token.nativeStopping||token.preparingNativeStop||token.completionBusy)throw Error('Native shutdown requires reconciliation');
    const adopted=token.adopted;if(!adopted||adopted.managed)throw Error('Held native ownership required');
    if((token.retirementSession&&retirementSession!==token.retirementSession)||!retirementSession||!retirementSession.provider||typeof retirementSession.provider.prepareNativeExit!=='function'||!retirementSession.record||JSON.stringify(retirementSession.record.source)!==providerSource()||retirementSession.record.manifest_sha256!==adopted.record.manifest_sha256)throw Error('Matching rollback provider required');
    token.preparingNativeStop=true;
    try{
     const inventory=await nativeSnapshot(),digest=hash(JSON.stringify(inventory)),r=inventory.resources;
     if(r.transfers.length||r.helpers.length||r.jobs.some(j=>!j.monitor_finished||!['completed','cancelled','timed_out','interrupted'].includes(j.state)))throw Error('Native resources must be settled before rollback');
     const directory=path.dirname(options.selectionFile),file=path.join(directory,transactionId+'.native-stop.json');
     const selected=selectionStatus(options.selectionFile),p=selected.pending,h=selected.history&&selected.history[selected.history.length-1];
     if(selected.phase!=='reconciliation-required'||!p||p.id!==transactionId||p.phase!=='prepared'||p.from.implementation!=='native-prototype'||p.from.manifest_sha256!==adopted.record.manifest_sha256||p.to.implementation!=='managed'||p.to.manifest_sha256!==sourceVersion||p.quiescence_sha256!==digest||!h||h.id!==adopted.record.id||h.outcome!=='committed'||h.readiness_sha256!==nativeReadiness(directory,adopted.record))throw Error('Selection does not bind native rollback inventory');
     const selectedText=JSON.stringify(selected),readyText=JSON.stringify(adopted.record);
     const owned=()=>{if(admissionHold!==token||generation!==adopted.generation||channel!==adopted.channel||!running||currentBoot()!==boot||JSON.stringify(selectionStatus(options.selectionFile))!==selectedText||runtimeRead(path.join(directory,adopted.record.id+'.production.json'),16384)!==readyText)throw Error('Native rollback ownership changed');};
     owned();try{fs.lstatSync(file);throw Error('Native shutdown requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}
     token.nativeStopAttempted=true;const observer=await retirementSession.provider.prepareNativeExit(adopted.record);owned();
     if(hash(JSON.stringify(await nativeSnapshot()))!==digest)throw Error('Native inventory changed after exit binding');owned();
     const pending={schema:1,id:transactionId,origin_id:adopted.record.id,phase:'submitting',inventory_sha256:digest,worker_identity:adopted.record.worker_identity,readiness_sha256:hash(readyText)},text=JSON.stringify(pending);
     const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     const parent=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
     token.nativeStopping=true;owned();let shutdown;
     try{shutdown=await adopted.channel.shutdown();}
     catch(_){shutdown={acknowledged:false,outcome:'unknown'};}
     // A lost BYE is not exit evidence. Use the already-bound independent
     // observer even after a transport failure; never submit shutdown again.
     // Verified exit evidence is retained before publication. If publishing the
     // stopped receipt fails, recovery republishes that evidence, or adopts the
     // identical receipt already renamed into place, without observing again.
     let verified=null;
     const finishExit=async resume=>{
      owned();
      if(!verified){
       if(privateRead(file,16384)!==text)throw Error('Native stop journal changed');
       const exited=await (resume?observer.resumeExitObservation():observer.waitForExit());owned();
       if(!exited||exited.record_id!==adopted.record.id||JSON.stringify(exited.identity)!==JSON.stringify(adopted.record.worker_identity)||privateRead(file,16384)!==text)throw Error('Native exit evidence changed');
       verified=JSON.stringify({...pending,phase:'stopped',shutdown,exited});
      }
      const published=privateRead(file,65536);
      if(published===text)atomic(file,JSON.parse(verified));
      else if(published!==verified)throw Error('Native stop journal changed');
      else{const parent=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
      owned();if(privateRead(file,65536)!==verified)throw Error('Native stop journal changed');
      token.nativeStopped=JSON.parse(verified);return JSON.parse(verified);
     };
     token.nativeExitRecovery={transactionId,retirementSession,finishExit};
     return await finishExit(false);
    }catch(cause){throw Object.assign(Error('Native rollback shutdown requires reconciliation'),{outcome:'unknown',cause});}finally{token.preparingNativeStop=false;}
   },
   resumeNativeExit:async (transactionId,retirementSession)=>{
    const recovery=token.nativeExitRecovery;
    if(!recovery||recovery.transactionId!==transactionId||recovery.retirementSession!==retirementSession||token.nativeStopped||token.preparingNativeStop||token.completionBusy)throw Error('Native exit recovery unavailable');
    token.preparingNativeStop=true;
    try{return await recovery.finishExit(true);}
    catch(cause){throw Object.assign(Error('Native rollback exit requires reconciliation'),{outcome:'unknown',cause});}
    finally{token.preparingNativeStop=false;}
   },
   adoptManaged:async session=>{
    const previous=token.adopted,previousChannel=previous?previous.channel:owner,previousGeneration=previous?previous.generation:gen;
    const bound=()=>{if(admissionHold!==token||generation!==previousGeneration||channel!==previousChannel||!running||!token.stopped||token.preparingStop||token.preparingNativeStop||token.completionBusy)throw Error('Stopped handoff ownership required for managed adoption');};
    bound();if(previous&&!token.nativeStopped)throw Error('Verified native shutdown required before managed adoption');if(token.managedAdopting)throw Error('Managed adoption requires reconciliation');
    if(!session||typeof session.takeChannel!=='function'||typeof session.closeTransport!=='function'||!session.record||session.record.phase!=='ready'||hash(JSON.stringify(session.record))!==session.readiness_sha256)throw Error('Verified managed session required');
    const readinessDigest=session.readiness_sha256,readyRecord=JSON.parse(JSON.stringify(session.record));
    const {worker_identity,unit_started_monotonic,launcher_sha256,...launch}=readyRecord;validateManagedLaunch({...launch,phase:'submitted'});
    if(!/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic)||typeof launcher_sha256!=='string'||launcher_sha256.length!==64||!/^[a-f0-9]+$/.test(launcher_sha256)||launch.origin_id!==token.stopped.transaction_id||launch.boot_id!==boot||launch.manifest_sha256!==sourceVersion)throw Error('Managed session does not match stopped handoff');
    const directory=path.dirname(options.selectionFile),nativeText=runtimeRead(path.join(directory,launch.origin_id+'.production.json'),16384),nativeRecord=JSON.parse(nativeText),restoreText=privateRead(path.join(directory,launch.id+'.managed-restore.json'),16384),restored=JSON.parse(restoreText);
    const {worker_identity:nativeIdentity,unit_started_monotonic:nativeStarted,...nativeLaunch}=nativeRecord;validateRuntimeLaunch({...nativeLaunch,phase:'submitted'});
    if(nativeRecord.phase!=='ready'||nativeRecord.id!==launch.origin_id||token.targetVersion!=='native-prototype|'+nativeRecord.manifest_sha256||(previous&&JSON.stringify(previous.record)!==nativeText)||JSON.stringify(nativeRecord.source)!==JSON.stringify(token.source)||JSON.stringify(nativeIdentity)!==JSON.stringify(launch.source)||!nativeStarted||hash(restoreText)!==launch.state_receipt_sha256||restored.phase!=='restored'||restored.id!==launch.origin_id||restored.transition_id!==launch.id)throw Error('Managed restoration is not bound to this handoff');
    const committed=()=>{const s=selectionStatus(options.selectionFile),h=s.history&&s.history[s.history.length-1],rollback=launch.id===launch.origin_id;
     if(s.phase!=='stable'||s.selected_implementation!=='managed'||s.selected_manifest_sha256!==sourceVersion||!h||h.id!==launch.id||h.outcome!==(rollback?'rolled-back':'committed')||h.state_sha256!==launch.state_receipt_sha256||h.readiness_sha256!==readinessDigest||h.quiescence_sha256!==restored.quiescence_sha256||h.from.implementation!==(rollback?'managed':'native-prototype')||h.to.implementation!==(rollback?'native-prototype':'managed')||h.from.manifest_sha256!==(rollback?sourceVersion:nativeRecord.manifest_sha256)||h.to.manifest_sha256!==(rollback?nativeRecord.manifest_sha256:sourceVersion))throw Error('Committed managed rollback required');
     if(runtimeRead(path.join(directory,launch.origin_id+'.production.json'),16384)!==nativeText||privateRead(path.join(directory,launch.id+'.managed-restore.json'),16384)!==restoreText||hash(privateRead(path.join(directory,launch.id+'.managed-launch.json'),16384))!==readinessDigest)throw Error('Managed rollback evidence changed');return JSON.stringify(s);};
    const selected=committed();token.managedAdopting=true;let next;
    try{
     next=await session.takeChannel();bound();if(committed()!==selected||!next||next===previousChannel||!next._conn)throw Error('Managed channel ownership changed');
     const peer=next._conn,info=await next.operation({op:'status'});bound();
     if(committed()!==selected||next._conn!==peer||currentBoot()!==boot||!['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)||peer.identity.smack!=='User')throw Error('Managed peer changed during adoption');
     validateReadiness(info,{implementation:'managed',bootId:boot,launcherSha256:launcher_sha256});
     const identityNow=processIdentities(info,peer.identity.pid),resources=validateResourceInventory(info);
     if(JSON.stringify(identityNow)!==JSON.stringify(worker_identity)||resources.jobs.length||resources.transfers.length||resources.helpers.length||[token.source,launch.source].some(s=>s.worker_id===identityNow.worker_id||s.boot_id===boot&&Object.values(s.processes).some(p=>p&&p.pid===peer.identity.pid)))throw Error('Managed identity or resources changed');
     const adoptedGeneration=++generation,previousClose=next.onClose;
     channel=next;connected=true;workerReady=true;workerStatus=info;workerStatusAt=process.uptime();identity=peer.identity;launching=false;lastError=null;nativeRuntime=null;
     if(timer){clearTimeout(timer);timer=null;}
     next.onClose=error=>{try{if(previousClose)previousClose(error);}finally{if(generation===adoptedGeneration&&channel===next){connected=false;workerReady=false;workerStatus=null;identity=null;workerStatusAt=0;lastError='Managed rollback worker disconnected; reconciliation required';}}};
     previousChannel.close();token.adopted={generation:adoptedGeneration,channel:next,record:readyRecord,managed:true};
     return {transaction_id:launch.id,worker_id:info.worker_id,admission_held:true};
    }catch(error){session.closeTransport();throw Object.assign(Error('Managed channel adoption requires reconciliation'),{outcome:'unknown',cause:error});}
   },
   completeManaged:async (retirementSession,{resume=false}={})=>{
    const adopted=token.adopted;
    const bound=()=>{if(!adopted||!adopted.managed||admissionHold!==token||generation!==adopted.generation||channel!==adopted.channel||!running||!connected||!workerReady||!channel._conn)throw Error('Adopted managed ownership required');};
    bound();if(token.preparingNativeStop||token.nativeStopAttempted&&!adopted.managed||typeof resume!=='boolean'||token.completionBusy||(!resume&&token.managedCompleting)||(resume&&(!token.managedActivating||!token.managedProviderRetired)))throw Error('Managed completion requires reconciliation');
    if((token.retirementSession&&retirementSession!==token.retirementSession)||!retirementSession||typeof retirementSession.retire!=='function'||!retirementSession.record||JSON.stringify(retirementSession.record.source)!==providerSource()||token.targetVersion!=='native-prototype|'+retirementSession.record.manifest_sha256)throw Error('Matching retirement session required');
    const selected=JSON.stringify(selectionStatus(options.selectionFile)),peer=channel._conn;
    const confirm=async()=>{
     bound();const info=await adopted.channel.operation({op:'status'});bound();
     if(adopted.channel._conn!==peer||currentBoot()!==boot||JSON.stringify(selectionStatus(options.selectionFile))!==selected)throw Error('Managed completion ownership changed');
     validateReadiness(info,{implementation:'managed',bootId:boot,launcherSha256:adopted.record.launcher_sha256});
     if(JSON.stringify(processIdentities(info,peer.identity.pid))!==JSON.stringify(adopted.record.worker_identity))throw Error('Managed identity changed');
     const r=validateResourceInventory(info);if(r.jobs.length||r.helpers.length||r.transfers.length)throw Error('Managed resources changed before activation');return info;
    };
    const execute=async(command,timeout)=>{await confirm();const result=await adopted.channel.execute(command,timeout);await confirm();return result;};
    token.managedCompleting=true;token.completionBusy=true;
    try{
     const optionsManaged={managed:adopted.record,journalDirectory:path.dirname(options.selectionFile),selectionFile:options.selectionFile,execute};
     if(!resume){token.productionRetired=await retireProduction({...optionsManaged,confirmManaged:async()=>processIdentities(await confirm(),peer.identity.pid)});
     await confirm();token.managedProviderRetired=JSON.parse(JSON.stringify(await retirementSession.retire({execute,confirmExecutor:confirm,executorPid:peer.identity.pid})));}
     await confirm();token.managedActivating=true;const activation=await activateManaged({...optionsManaged,resume,retired:token.managedProviderRetired,confirmManaged:confirm});
     const info=await confirm();bound();if(!runtimeAllowed(selection()))throw Error('Managed selection changed before admission');
     workerStatus=info;workerStatusAt=process.uptime();nativeRuntime=null;admissionHold=null;
     return {transaction_id:adopted.record.id,worker_id:info.worker_id,admission_held:false,activation_sha256:activation.receipt_sha256};
    }catch(cause){throw Object.assign(Error('Managed completion requires reconciliation'),{outcome:'unknown',cause});}finally{token.completionBusy=false;}
   },
   completeProduction:async (retirementSession,{resume=false}={})=>{
    const adopted=token.adopted;
    const bound=()=>{if(!adopted||adopted.managed||admissionHold!==token||generation!==adopted.generation||channel!==adopted.channel||!running||!connected||!workerReady||!channel._conn)throw Error('Adopted production ownership required');};
    bound();if(token.activeReturn||token.preparingNativeStop||token.nativeStopAttempted&&!adopted.managed||typeof resume!=='boolean'||token.completionBusy||(!resume&&token.completing)||(resume&&!token.completing))throw Error('Production completion requires reconciliation');
    if((token.retirementSession&&retirementSession!==token.retirementSession)||!retirementSession||typeof retirementSession.retire!=='function'||!retirementSession.record||JSON.stringify(retirementSession.record.source)!==JSON.stringify(token.source)||retirementSession.record.manifest_sha256!==adopted.record.manifest_sha256)throw Error('Matching retirement session required');
    token.completing=true;token.completionBusy=true;const peer=channel._conn;
    const confirm=async()=>{
     bound();const info=await adopted.channel.operation({op:'status'});bound();if(adopted.channel._conn!==peer)throw Error('Production peer changed');
     validateReadiness(info,{implementation:'native-prototype',bootId:boot,launcherSha256:adopted.record.launcher_sha256});
     if(JSON.stringify(processIdentities(info,peer.identity.pid))!==JSON.stringify(adopted.record.worker_identity))throw Error('Production identity changed');
     const r=validateResourceInventory(info);if(r.jobs.length||r.helpers.length||r.transfers.length)throw Error('Production resources changed before activation');return info;
    };
    const execute=async(command,timeout)=>{await confirm();const result=await adopted.channel.execute(command,timeout);await confirm();return result;};
    try{
     if(!token.retired){
      const executor={execute,confirmExecutor:confirm,executorPid:peer.identity.pid};
      token.retired=JSON.parse(JSON.stringify(await (resume?retirementSession.resumeRetirement(executor):retirementSession.retire(executor))));
     }
     bound();const retired=token.retired,resumeActivation=resume&&!!token.activating;token.activating=true;
     const activation=await activateProduction({resume:resumeActivation,record:adopted.record,retired,journalDirectory:path.dirname(options.selectionFile),selectionFile:options.selectionFile,execute,confirmNative:async()=>processIdentities(await confirm(),peer.identity.pid)});
     const info=await confirm();bound();nativeRuntime={...adopted,activation,selection:JSON.stringify(selectionStatus(options.selectionFile))};workerStatus=info;workerStatusAt=process.uptime();
     if(!runtimeAllowed(selection()))throw Error('Native selection changed before admission');admissionHold=null;
     return {transaction_id:adopted.record.id,worker_id:info.worker_id,admission_held:false,activation_sha256:activation.receipt_sha256};
    }catch(error){nativeRuntime=null;throw Object.assign(Error('Production completion requires reconciliation'),{outcome:'unknown',cause:error});}finally{token.completionBusy=false;}
   },
   // Removes only verified staging of a committed restart rollback; drained first.
   cleanupRestart:async transactionId=>{
    current();if(token.preparingStop||token.stopping||token.observerStaging||token.observerProbe||token.retirementPreparing||token.retirementSession)throw Error('Restart cleanup requires an idle hold');
    token.preparingStop=true;
    try{
     await snapshot();current();
     return await cleanupRestartRollback({selectionFile:options.selectionFile,id:transactionId,executor:{pid:peer.identity.pid,
      status:async()=>{current();const info=await owner.operation({op:'status'});current();return info;},
      execute:async(command,timeout)=>{current();const result=await owner.execute(command,timeout);current();return result;}}});
    }finally{token.preparingStop=false;}
   },
   release:()=>{current();if(token.stopping||token.preparingStop||token.observerStaging||token.observerProbe||token.retirementPreparing||token.retirementSession)throw Error('Cannot release a pending shutdown or unresolved observer staging/probe');admissionHold=null;}
  };
 }
 async function probeObserver(expectedManifest,requestId){
  let hold;try{hold=holdAdmission();}catch(error){throw Object.assign(error,{outcome:'rejected'});}
  try{const result=await hold.probeObserver(expectedManifest,requestId);hold.release();return result;}
  catch(error){try{hold.release();}catch(_){}throw error;}
 }
 async function cleanupRestart(transactionId){
  let hold;try{hold=holdAdmission();}catch(error){throw Object.assign(error,{outcome:'rejected'});}
  // Cleanup never touches managed state; an incomplete one keeps its intent and
  // markers, which block another handoff, while managed admission reopens.
  try{return await hold.cleanupRestart(transactionId);}finally{try{hold.release();}catch(_){}}
 }
 // Both directions keep .NET as the deployed fallback: verify it before handoff.
 async function verifyFallback(runtimeSha256,label){
  try{
   if(typeof runtimeSha256!=='string'||runtimeSha256.length!==64||!/^[a-f0-9]{64}$/.test(runtimeSha256)||!config.hashes||config.hashes['/usr/bin/dotnet']!==runtimeSha256)throw Error('Managed fallback runtime must match the configured digest');
   firmware(config);
   const owner=channel,peer=owner&&owner._conn,gen=generation;
   // Verify through the existing worker: the service label cannot read this
   // runtime on every firmware. This command only reads the fixed runtime path.
   const command="set -eu\ntest -f /usr/bin/dotnet\ntest ! -L /usr/bin/dotnet\ntest \"$(sha256sum /usr/bin/dotnet | cut -d ' ' -f 1)\" = '"+runtimeSha256+"'\nprintf 'FALLBACK-RUNTIME-VERIFIED\\n'\n";
   const result=await submit(worker=>worker.execute(command,10000));
   if(!running||!connected||!workerReady||channel!==owner||!owner||owner._conn!==peer||generation!==gen||!result||result.exit_code!==0||result.timed_out||result.stdout!=='FALLBACK-RUNTIME-VERIFIED\n')throw Error('Managed fallback runtime verification failed');
  }catch(cause){throw Object.assign(Error(label+' rejected before handoff'),{outcome:'rejected',cause});}
 }
 // A migration rejected before handoff changed nothing durable; replace it.
 function freshMigration(){if(!migration||migration.status().phase==='rejected')migration=createNativeMigration({agent:api,device:config.device,payload,selectionFile:options.selectionFile});return migration;}
 // A settled, uncommitted forward failure can use the same read-only rollback
 // as a restart. Install its admission gate before retiring any live handles.
 // Transport closure is not cleanup evidence: the fresh executor must still
 // prove every recorded process/unit gone and retained managed state unchanged.
 function recoverForward(controller){
  const failed=controller.status();
  if(!running||migration!==controller||!admissionHold||nativeRuntime||managedReturn||restartHeld()||!options.selectionFile||failed.phase!=='reconciliation-required'||!['provider','stopping-source','retained-state','production','committing'].includes(failed.failed_phase))return null;
  const selected=selection(true),candidate=restartRollbackCandidate(options.selectionFile,(options.managedVersion||managedVersion)(payload));
  if(!candidate||!selected.pending||selected.pending.id!==failed.transaction_id||candidate.id!==failed.transaction_id||!['prepared','state-ready','trial-ready'].includes(candidate.phase))return null;
  const r={id:candidate.id,phase:'acquiring',running:false,attempts:0,error:null,result:null,trigger:'live-forward-failure',failed_phase:failed.failed_phase};
  restartRollback=r;
  ++generation;connected=false;workerReady=false;identity=null;workerStatus=null;workerStatusAt=0;
  if(timer)clearTimeout(timer);timer=null;
  // If closing a handle fails, leave the original hold in place. No new
  // executor or public operation can escape this unresolved boundary.
  controller.closeTransport();if(channel)channel.close();if(client)sdb.close(client);
  channel=null;client=null;launching=false;migration=null;admissionHold=null;
  launch();return r.id;
 }
 async function runForward(manifestSha256,options){
  const controller=freshMigration();
  try{return await controller.run(manifestSha256,options);}
  catch(error){
   try{const id=recoverForward(controller);if(id)error.recovery_transaction_id=id;}
   catch(cause){lastError='Live forward recovery held: '+String(cause.message).slice(0,160);}
   // Recovery does not change the outcome of the original submitted request.
   throw error;
  }
 }
 function canCleanupRestart(transactionId){
  if(!restartRollback||restartRollback.trigger!=='live-forward-failure'||restartRollback.phase!=='complete'||restartRollback.id!==transactionId)return false;
  const s=selection(true),h=s.history&&s.history[s.history.length-1];
  return s.phase==='stable'&&s.launch_allowed&&s.selected_implementation==='managed'&&!!h&&h.id===transactionId&&h.outcome==='rolled-back';
 }
 async function rehearseNative(manifestSha256,runtimeSha256){
  await verifyFallback(runtimeSha256,'Native rehearsal');
  return runForward(manifestSha256,{returnToManaged:true,runtimeSha256});
 }
 async function migrateNative(manifestSha256,runtimeSha256){
  await verifyFallback(runtimeSha256,'Native migration');
  return runForward(manifestSha256);
 }
 // Return an admitted native runtime to the installed managed version. Nothing
 // durable changes before the return transition begins; a refusal reopens native.
 async function returnManaged(runtimeSha256,requestId){
  await verifyFallback(runtimeSha256,'Managed return');
  if(managedReturn&&managedReturn.status().phase!=='rejected')throw Object.assign(Error('Managed return requires reconciliation'),{outcome:'rejected'});
  let hold;try{hold=holdAdmission({activeNative:true});}catch(error){throw Object.assign(Error('Managed return rejected before handoff'),{outcome:'rejected',cause:error});}
  const controller=createManagedReturn({hold,openRetirement:id=>hold.openReturnProvider(id),record:nativeRuntime.record,payload,selectionFile:options.selectionFile,runtimeSha256,requestId});
  managedReturn=controller;
  try{return await controller.run();}
  catch(error){
   if(error.transition_started)throw error;
   let released=true;try{hold.release();}catch(_){released=false;}
   throw Object.assign(Error('Managed return rejected before handoff'),{outcome:released?'rejected':'unknown',cause:error});
  }
 }
 function canResumeManaged(requestId){
  if(!restartReturn||!options.selectionFile)return false;
  try{const r=JSON.parse(privateRead(path.join(path.dirname(options.selectionFile),restartReturn.id+'.return-request.json'),16384));return r.schema===1&&r.id===restartReturn.id&&r.origin_id===restartReturn.origin_id&&r.request_id===requestId&&r.runtime_sha256===config.hashes['/usr/bin/dotnet'];}catch(_){return false;}
 }
 function resumeManagedActivation(requestId){
  if(restartReturn&&canResumeManaged(requestId)){
   if(restartReturn.phase==='complete')return Promise.resolve(restartReturn.result);
   if(restartReturn.phase==='failed'&&restartReturn.resume)return restartReturn.resume().then(result=>{if(restartReturn.phase!=='complete')throw Error('Restart return still requires reconciliation');return result;});
   return Promise.reject(Error('Restart return is in progress'));
  }

  if(managedReturn&&managedReturn.status().phase==='reconciliation-required')return managedReturn.resumeActivation();
  if(!migration)return Promise.reject(Error('No native migration to reconcile'));return migration.resumeManagedActivation();
 }
 // Durable evidence only; live coordinator handles are reported separately.
 const restartInventory=()=>{if(!options.selectionFile)return null;try{return {...inventoryRestart(options.selectionFile),bootstrap_recovery:bootstrapRecovery&&{id:bootstrapRecovery.id,phase:bootstrapRecovery.phase,attempts:bootstrapRecovery.attempts,error:bootstrapRecovery.error},native_startup:nativeStartup,restart_return:restartReturn&&{transaction_id:restartReturn.id,phase:restartReturn.phase,attempts:restartReturn.attempts,error:restartReturn.error,result:restartReturn.result||null},startup_reconciliation:reconciliation&&{abandoned:!!reconciliation.abandoned,transaction_id:reconciliation.transaction_id||null,error:reconciliation.error||null},restart_rollback:restartRollback&&{transaction_id:restartRollback.id,phase:restartRollback.phase,trigger:restartRollback.trigger||'service-restart',failed_phase:restartRollback.failed_phase||null,attempts:restartRollback.attempts,error:restartRollback.error,receipt_sha256:restartRollback.result?restartRollback.result.receipt_sha256:null}};}catch(error){return {schema:1,action:'pending-reconciliation',diagnostics:['inventory unavailable: '+String(error.message).slice(0,160)]};}};
 const api={status,start,stop,holdAdmission,probeObserver,restartInventory,cleanupRestart,canCleanupRestart,operation:(value,data)=>submit(owner=>owner.operation(value,data)),execute:(command,timeout)=>submit(owner=>owner.execute(command,timeout)),resumeNativeActivation:()=>{if(!migration)return Promise.reject(Error('No native migration to reconcile'));return migration.resumeActivation();},canResumeManaged,resumeManagedActivation,returnManaged,rehearseNative,migrateNative};return api;
}
module.exports={createAgent,launchRequest,launchSdk};
