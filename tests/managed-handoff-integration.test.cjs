const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events'),{createRequire}=require('node:module');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
for(const mode of ['proc','pidfd','pidfd-bad-digest','probe-qn90a','probe-s90d'])test('managed handoff with '+mode+' preserves retained records and admission ownership',{
 skip:process.platform!=='linux'||!process.env.COUCHROOT_PARITY_CONTAINER||!process.env.MANAGED_PARITY||(mode!=='proc'&&!process.env.PROCESS_OBSERVER),
 timeout:20000
},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'managed-handoff-'));fs.chmodSync(root,0o700);
 const file=path.join(root,'selection.json'),journal=new SelectionJournal(file),version='a'.repeat(64);
 journal.initialize({implementation:'managed',manifest_sha256:version});
 const source=path.resolve(__dirname,'../research/autonomous-root/service/agent.js'),realRequire=createRequire(source),channels=[];
 class Channel extends RootAgentServer{constructor(options){super(options);channels.push(this);}}
 const module={exports:{}};let probeStages=0;
 // Package permission staging is tested separately on ARM package bytes. Here
 // substitute only that boundary to run the host observer through a real peer.
 const stageFixture={stageObserver:async input=>{
  probeStages++;assert.equal(input.expectedManifest,'c'.repeat(64));
  const result=await input.execute('printf stage-confirmed',1000);assert.equal(result.stdout,'stage-confirmed');
  const binary=process.env.PROCESS_OBSERVER;
  return {binary,sha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),manifest_sha256:input.expectedManifest};
 }};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,exports:module.exports,__dirname:path.dirname(source),process,Buffer,setTimeout,clearTimeout,
  require:name=>mode.startsWith('probe')&&name==='./observer-stage'?stageFixture:name==='./vendor/root-agent'?{RootAgentServer:Channel}:name==='./vendor/sdb'?{connect:()=>new Promise(()=>{}),close:()=>{}}:realRequire(name)});
 const observer=mode.startsWith('pidfd')?{binary:process.env.PROCESS_OBSERVER,sha256:mode==='pidfd-bad-digest'?'0'.repeat(64):crypto.createHash('sha256').update(fs.readFileSync(process.env.PROCESS_OBSERVER)).digest('hex')}:undefined;
 const agent=module.exports.createAgent({device:mode==='probe-s90d'?'s90d':'qn90a'},{verifyFirmware:()=>{},selectionFile:file,managedVersion:()=>version,processObserver:observer,
  ...(mode==='pidfd'?{readProcessFile:()=>{throw Object.assign(Error('proc denied'),{code:'EACCES'});}}:{})});
 let child,ended,stderr='';const id='handoff-'+crypto.randomBytes(12).toString('hex'),record='/opt/couchroot-agent/jobs/'+id+'.json';
 const until=async predicate=>{const deadline=Date.now()+5000;while(!await predicate()){if(Date.now()>deadline)throw Error('Condition deadline: '+stderr);await pause();}};
 try{
  agent.start();await until(()=>channels[0]&&channels[0].listeningPort());const channel=channels[0];
  fs.writeFileSync(path.join(root,'token'),channel.secret.toString('base64'),{mode:0o600});
  child=spawn('dotnet',[process.env.MANAGED_PARITY,'--parity-wire',String(channel.listeningPort()),root],{stdio:['ignore','ignore','pipe']});ended=once(child,'exit');
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);});
  await until(()=>agent.status().worker_ready);
  await agent.operation({op:'job.start',id,profile:'root',timeout_ms:1000,command:'exit 7'});
  await until(async()=>{const info=await agent.operation({op:'status'});return info.resources.jobs[0].monitor_finished;});
  const retained=fs.readFileSync(record);
  if(mode.startsWith('probe')){
   const before=agent.status(),request=agent.execute('sleep 0.1; printf drained',1000);
   const probing=agent.probeObserver('c'.repeat(64));assert.equal((await request).stdout,'drained');
   const result=await probing;assert.equal(result.worker_stopped,false);assert.equal(result.verified,true);assert.equal(probeStages,1);
   assert.equal(agent.status().worker_id,before.worker_id);assert.equal(agent.status().worker_ready,true);assert.equal(agent.status().admission_held,false);
   assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.deepEqual(fs.readFileSync(record),retained);
   assert.equal(journal.read().pending,null);assert.equal((await agent.execute('printf still-ready',1000)).stdout,'still-ready');
   return;
  }
  const request=agent.execute('sleep 0.1; printf drained',1000),hold=agent.holdAdmission();
  const inventory=await hold.snapshot();assert.equal((await request).stdout,'drained');
  assert.equal(inventory.processes.worker.pid,child.pid);assert.equal(inventory.resources.jobs[0].state,'completed');
  const digest=crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
  const prepared=journal.begin(1,{implementation:'native-prototype',manifest_sha256:'c'.repeat(64)},digest);
  if(mode==='pidfd-bad-digest'){
   await assert.rejects(hold.shutdown(prepared.pending.id),/digest mismatch/);
   assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
   assert.equal((await channel.operation({op:'status'})).worker_id,inventory.worker_id);
   assert.equal(agent.status().admission_held,true);assert.equal(journal.read().pending.phase,'prepared');
   assert.deepEqual(fs.readFileSync(record),retained);
   return;
  }
  const stopped=await hold.shutdown(prepared.pending.id);
  assert.equal(stopped.exited.processes.worker.observation,mode==='pidfd'?'exited':'absent');assert.equal(stopped.exited.processes.guardian,null);
  assert.deepEqual(await ended,[0,null],stderr);assert.deepEqual(fs.readFileSync(record),retained);
  assert.equal(agent.status().admission_held,true);assert.equal(agent.status().attempts,1);
  await assert.rejects(agent.execute('must not start',100),e=>e.outcome==='rejected');
  assert.equal(journal.read().pending.phase,'prepared');
 }finally{
  agent.stop();
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await ended;}
  fs.rmSync(record,{force:true});fs.rmSync(root,{recursive:true,force:true});
 }
});
