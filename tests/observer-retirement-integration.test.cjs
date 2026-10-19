const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
const {processIdentities}=require('../research/autonomous-root/service/worker-processes');
const {withRetirementState}=require('./retirement-test-state.cjs');
for (const bom of [false,true]) test('native retirement channel migrates retained records after managed exit (BOM='+bom+')',{
 skip:process.platform!=='linux'||!process.env.COUCHROOT_PARITY_CONTAINER||!process.env.NATIVE_WORKER||!process.env.MANAGED_PARITY,timeout:20000
},async()=>withRetirementState(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'independent-retirement-')),children=[],servers=[];
 async function start(name,native,existing,production=false,binary=process.env.NATIVE_WORKER){
  const dir=existing||path.join(root,name);if(!existing)fs.mkdirSync(dir,{mode:0o700});const secret=crypto.randomBytes(32),token=path.join(dir,'token');fs.writeFileSync(token,secret.toString('base64'),{mode:0o600});
  let accept;const ready=new Promise(resolve=>{accept=resolve;}),server=new RootAgentServer({secret,onConnect:accept});servers.push(server);await new Promise(resolve=>server.start(resolve));
  let command,args,sha;
  if(native){const launcher=path.join(dir,'launcher');fs.copyFileSync('/bin/true',launcher);fs.chmodSync(launcher,production?0o400:0o600);sha=crypto.createHash('sha256').update(fs.readFileSync(launcher)).digest('hex');command=binary;args=['127.0.0.1',String(server.listeningPort()),token,dir,launcher,sha];if(production)args.push('--production');}
  else{command='dotnet';args=[process.env.MANAGED_PARITY,'--parity-wire',String(server.listeningPort()),dir];}
  const child=spawn(command,args,{stdio:['ignore','ignore','pipe']}),ended=once(child,'exit');let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);});children.push({child,ended});
  const peer=await Promise.race([ready,ended.then(()=>{throw Error(name+' exited early: '+stderr);})]);
  return {server,peer,child,ended,sha,dir,stderr:()=>stderr};
 }
 try{
  const managed=await start('managed',false),native=await start('native',true);
  // This host build stubs Smack and mount setup. Only that credential field is
  // normalized here; firmware profile/staging qualification is separate.
  assert.equal(native.peer.identity.smack,'host-test-without-Smack');native.peer.identity.smack='System';
  const source=processIdentities(await managed.server.operation({op:'status'}),managed.peer.identity.pid);
  const unit='couchroot-observer-'+'a'.repeat(32)+'.service',bound={unit,bootId:source.boot_id,sha256:'b'.repeat(64)};
  const installed=path.join(root,'installed'),retained=path.join(root,'retained'),jobs=path.join(retained,'jobs');fs.mkdirSync(retained,{mode:0o755});fs.mkdirSync(jobs,{mode:0o700});
  const saved=Buffer.from((bom?'\uFEFF':'')+JSON.stringify({id:'retained-job-0001',boot_id:source.boot_id,state:'completed',pid:0,exit_code:7}));fs.writeFileSync(path.join(jobs,'retained-job-0001.json'),saved,{mode:0o600});
  const sourceFile=path.resolve(__dirname,'../research/autonomous-root/service/observer-retirement.js'),real=createRequire(sourceFile),module={exports:{}};
  let commands=0;
  const unitOperations={
   inspectObserverUnit:async o=>{commands++;const r=await o.execute('printf inspected',1000);assert.equal(r.stdout,'inspected');return {unit:o.unit};},
   retireObserverUnit:async o=>{commands++;const r=await o.execute('printf retired',1000);assert.equal(r.stdout,'retired');return {unit:o.unit,boot_id:o.bootId,retired:true};}
  };
  vm.runInNewContext(fs.readFileSync(sourceFile,'utf8'),{module,process,require:name=>name==='./observer-unit'?unitOperations:name==='./retained-state'?{snapshotManagedJobs:options=>real(name).snapshotManagedJobs({...options,execute:(command,timeout)=>options.execute(command.replaceAll('/opt/couchroot-agent',retained),timeout)})}:name==='./retained-install'?{acceptRetainedState:options=>real(name).acceptRetainedState({...options,execute:(command,timeout)=>options.execute(command.replaceAll('/opt/couchroot-agent',retained).replaceAll('/opt/couchroot-worker-'+options.id,installed),timeout)}),installRetainedState:options=>real(name).installRetainedState({...options,execute:(command,timeout)=>options.execute(command.replaceAll('/opt/couchroot-agent',retained).replaceAll('/opt/couchroot-worker-'+options.id,installed),timeout)})}:real(name)});
  const id='a'.repeat(32),record={schema:1,id,phase:'submitted',device:'s90d',manifest_sha256:'b'.repeat(64),worker_sha256:'b'.repeat(64),launcher_sha256:native.sha,observer_sha256:bound.sha256,boot_id:source.boot_id,source,unit:'couchroot-retirement-'+id+'.service',directory:'/opt/couchroot-retirement-'+id,scope:'/opt/couchroot-retirement-'+id+'/state',token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/retirement-ABC123/token',token_sha256:'b'.repeat(64),port:12345};
  const journalDirectory='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';fs.mkdirSync(journalDirectory,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(journalDirectory,id+'.retirement.json'),JSON.stringify(record),{mode:0o600});fs.writeFileSync(path.join(journalDirectory,'retirement-launch.pending'),id+'\n',{mode:0o600});
  const readinessFile=path.resolve(__dirname,'../research/autonomous-root/service/retirement-readiness.js'),readinessRequire=createRequire(readinessFile),readinessModule={exports:{}};
  vm.runInNewContext(fs.readFileSync(readinessFile,'utf8'),{module:readinessModule,process,Buffer,require:name=>name==='./observer-retirement'?{...readinessRequire(name),createObserverRetirement:module.exports.createObserverRetirement}:readinessRequire(name)});
  const {provider,record:readyRecord}=await readinessModule.exports.readyRetirement({record,journalDirectory,channel:native.server,confirmSource:()=>managed.server.operation({op:'status'}),execute:async()=>({exit_code:0,stdout:`Id=${record.unit}\nLoadState=loaded\nActiveState=active\nSubState=running\nMainPID=${native.child.pid}\nExecMainCode=0\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`})});
  assert.equal(JSON.parse(fs.readFileSync(path.join(journalDirectory,id+'.retirement.json'))).phase,'ready');
  assert.notEqual(provider.identity.worker_id,source.worker_id);
  assert.deepEqual(await managed.server.shutdown(),{acknowledged:true,disconnected:true});assert.deepEqual(await managed.ended,[0,null],managed.stderr());
  await assert.rejects(managed.server.execute('must not execute',1000));
  assert.equal((await provider.inspectUnit(bound)).unit,unit);assert.equal((await provider.retireUnit(bound)).retired,true);assert.equal(commands,2);
  const snapshot=await provider.snapshotManagedJobs();assert.equal(snapshot.records.length,1);assert.equal(Buffer.from(snapshot.records[0].base64,'base64').equals(saved),true);assert.equal(fs.readFileSync(path.join(jobs,'retained-job-0001.json')).equals(saved),true);
  const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection'),selectionFile=path.join(journalDirectory,'worker-selection.json'),selection=new SelectionJournal(selectionFile);selection.initialize({implementation:'managed',manifest_sha256:'b'.repeat(64)});const transition=selection.begin(1,{implementation:'native-prototype',manifest_sha256:'b'.repeat(64)},'c'.repeat(64));
  const installation=await provider.installManagedState({id:transition.pending.id,manifestSha256:'b'.repeat(64),journalDirectory,selectionFile});assert.equal(installation.phase,'ready');assert.equal(selection.read().pending.phase,'prepared');
  assert.equal(fs.readFileSync(path.join(installed,'state','.jobs','retained-job-0001.json')).equals(saved),true);
  const accepted=await provider.acceptManagedState({journalDirectory,selectionFile});assert.equal(accepted.pending.phase,'state-ready');assert.equal(accepted.pending.state_sha256,installation.receipt_sha256);assert.equal(accepted.selected.implementation,'managed');
  let productionRecord,production,productionSession;
  const stagedProvider={identity:provider.identity,launchProduction:async options=>{
   // Staging/systemd are fixture boundaries; use the actual session token,
   // listener and worker binary for the production connection.
   fs.mkdirSync(path.join(installed,'code'),{mode:0o700});const binary=path.join(installed,'code','worker');fs.copyFileSync(process.env.NATIVE_WORKER,binary);fs.chmodSync(binary,0o500);
   const scope=path.join(installed,'state'),launcher=path.join(scope,'launcher');fs.copyFileSync('/bin/true',launcher);fs.chmodSync(launcher,0o400);const sha=crypto.createHash('sha256').update(fs.readFileSync(launcher)).digest('hex');
   fs.copyFileSync(options.tokenFile,path.join(scope,'token'));fs.chmodSync(path.join(scope,'token'),0o600);
   productionRecord={schema:1,id:transition.pending.id,phase:'submitted',device:'s90d',manifest_sha256:'b'.repeat(64),state_receipt_sha256:installation.receipt_sha256,worker_sha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),launcher_sha256:sha,source,boot_id:source.boot_id,unit:'couchroot-worker-'+transition.pending.id+'.service',directory:'/opt/couchroot-worker-'+transition.pending.id,scope:'/opt/couchroot-worker-'+transition.pending.id+'/state',port:options.port,token_file:options.tokenFile,token_sha256:options.tokenSha256};
   fs.writeFileSync(path.join(journalDirectory,productionRecord.id+'.production.json'),JSON.stringify(productionRecord),{mode:0o600});fs.writeFileSync(path.join(journalDirectory,'production-launch.pending'),productionRecord.id+'\n',{mode:0o600});
   const child=spawn(binary,['127.0.0.1',String(options.port),path.join(scope,'token'),scope,launcher,sha,'--production'],{stdio:['ignore','ignore','pipe']}),ended=once(child,'exit');let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);});children.push({child,ended});production={child,ended,stderr:()=>stderr};return productionRecord;
  },verifyProduction:options=>require('../research/autonomous-root/service/production-readiness').readyProduction({...options,record:productionRecord,providerIdentity:provider.identity,execute:async(command,timeout)=>{
   if(command.includes('--property=Id,'))return {exit_code:0,stdout:`Id=${productionRecord.unit}\nLoadState=loaded\nActiveState=active\nSubState=running\nMainPID=${production.child.pid}\nExecMainCode=0\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`};
   return native.server.execute(command.replaceAll('/opt/couchroot-agent',retained).replaceAll(productionRecord.directory,installed),timeout);
  }})};
  const sessionFile=path.resolve(__dirname,'../research/autonomous-root/service/production-session.js'),sessionRequire=createRequire(sessionFile),sessionModule={exports:{}};
  class HostServer extends RootAgentServer{constructor(options){super({...options,onConnect:peer=>{assert.equal(peer.identity.smack,'host-test-without-Smack');peer.identity.smack='System';options.onConnect(peer);}});servers.push(this);}}
  vm.runInNewContext(fs.readFileSync(sessionFile,'utf8'),{module:sessionModule,process,Buffer,setTimeout,clearTimeout,require:name=>name==='./vendor/root-agent'?{RootAgentServer:HostServer}:sessionRequire(name)});
  productionSession=await sessionModule.exports.openProductionSession({id:transition.pending.id,journalDirectory,selectionFile,provider:stagedProvider});
  assert.equal(selection.read().pending.phase,'trial-ready');assert.equal(selection.read().selected.implementation,'managed');
  selection.commit(4,transition.pending.id);const productionChannel=await productionSession.takeChannel();
  const retainedStatus=await productionChannel.operation({op:'job.status',id:'retained-job-0001'});assert.equal(retainedStatus.state,'completed');assert.equal(retainedStatus.record.exit_code,7);assert.equal(retainedStatus.output_available,false);
  assert.deepEqual(await productionChannel.shutdown(),{acknowledged:true,disconnected:true});assert.deepEqual(await production.ended,[0,null],production.stderr());productionSession.closeTransport();
  assert.equal(fs.readFileSync(path.join(installed,'state','.jobs','retained-job-0001.json')).equals(saved),true);
  const {receipt_sha256,...installedRecord}=installation;
  const rollbackSnapshot=await require('../research/autonomous-root/service/native-retained-state').snapshotNativeJobs({record:productionSession.record,installation:installedRecord,execute:(command,timeout)=>native.server.execute(command.replaceAll('/opt/couchroot-agent',retained).replaceAll(productionRecord.directory,installed),timeout)});
  assert.equal(rollbackSnapshot.implementation,'native-prototype');assert.equal(rollbackSnapshot.records.length,1);assert.equal(Buffer.from(rollbackSnapshot.records[0].base64,'base64').equals(saved),true);
  const rollbackTransition=selection.begin(selection.read().revision,{implementation:'managed',manifest_sha256:'b'.repeat(64)},'d'.repeat(64));
  const restored=await require('../research/autonomous-root/service/managed-restore').restoreManagedJobs({record:productionSession.record,installation:installedRecord,baseline:snapshot,snapshot:rollbackSnapshot,journalDirectory,selectionFile,execute:(command,timeout)=>native.server.execute(command.replaceAll('/opt/couchroot-agent',retained).replaceAll(productionRecord.directory,installed),timeout)});
  assert.equal(restored.phase,'restored');assert.equal(restored.transition_id,rollbackTransition.pending.id);assert.equal(selection.read().pending.phase,'prepared');assert.equal(selection.read().selected.implementation,'native-prototype');
  assert(fs.readFileSync(path.join(jobs,'retained-job-0001.json')).equals(saved));assert(fs.readFileSync(path.join(retained,'rollback-'+transition.pending.id,'previous','retained-job-0001.json')).equals(saved));
  const rollbackAccepted=await require('../research/autonomous-root/service/managed-restore').acceptManagedRestore({transitionId:restored.transition_id,receiptSha256:restored.receipt_sha256,journalDirectory,selectionFile,execute:(command,timeout)=>native.server.execute(command.replaceAll('/opt/couchroot-agent',retained).replaceAll(productionRecord.directory,installed),timeout)});
  assert.equal(rollbackAccepted.pending.phase,'state-ready');assert.equal(rollbackAccepted.pending.state_sha256,restored.receipt_sha256);assert.equal(rollbackAccepted.selected.implementation,'native-prototype');
  const stopped=await require('../research/autonomous-root/service/retirement-teardown').shutdownRetirement({record:readyRecord,journalDirectory,channel:native.server});assert.equal(stopped.phase,'shutdown-acknowledged');assert.deepEqual(await native.ended,[0,null],native.stderr());
  assert.equal(fs.existsSync(path.join(native.dir,'.jobs','guardian')),false);assert.equal(fs.existsSync(path.join(native.dir,'.views')),false);
  assert.doesNotMatch(native.stderr(),/AddressSanitizer|runtime error:|recovery incomplete/);
 }finally{
  for(const server of servers)server.close();
  for(const {child,ended} of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await ended;}
  fs.rmSync(root,{recursive:true,force:true});
 }
}));
