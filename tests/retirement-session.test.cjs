const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const file=path.resolve(__dirname,'../research/autonomous-root/service/retirement-session.js'),real=createRequire(file);
async function fixture(mode,run){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'retirement-session-'));
 let reconcileRecord={id:'a'.repeat(32),phase:'shutdown-acknowledged'},reconcileCalls=0,instance,launches=0,readiness=0,launchOptions,closed=0,lifecycle=[];const provider={identity:'verified'};
 class Server{
  constructor(options){this.options=options;this._server=new EventEmitter();instance=this;}
  start(callback){if(mode==='listen-error')queueMicrotask(()=>this._server.emit('error',Error('bind failed')));else callback();}
  listeningPort(){return 12345;}
  connect(){this._conn={_socket:{destroy(){}}};this.options.onConnect(this._conn);}
  close(){closed++;this._conn=null;}
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,setTimeout,clearTimeout,require:name=>{
  if(name==='./vendor/root-agent')return {RootAgentServer:Server};
  if(name==='./retirement-launch')return {submitRetirement:async options=>{
   launches++;launchOptions=options;
   const token=fs.readFileSync(options.tokenFile);
   assert.equal(token.length,44);assert.equal(crypto.createHash('sha256').update(token).digest('hex'),options.tokenSha256);
   assert.equal(Buffer.from(token.toString(),'base64').equals(instance.options.secret),true);
   assert.equal(fs.statSync(options.tokenFile).mode&0o777,0o600);
   assert.equal(fs.statSync(path.dirname(options.tokenFile)).mode&0o777,0o700);
   fs.writeFileSync(path.join(directory,'retirement-launch.pending'),'owned');
   if(mode==='launch-error')throw Error('unknown launch');
   instance.connect();if(mode==='disconnect')instance._conn=null;
   return {phase:'submitted'};
  }};
  if(name==='./retirement-teardown')return {
   shutdownRetirement:async options=>{lifecycle.push('shutdown');assert.equal(options.channel,instance);return {phase:'shutdown-acknowledged'};},
   cleanupRetirement:async options=>{lifecycle.push('cleanup');assert.equal(options.record.phase,'shutdown-acknowledged');if(mode==='cleanup-error')throw Error('cleanup uncertain');return {phase:'staging-retired'};},
   finishRetirement:options=>{lifecycle.push('finish');assert.equal(options.record.phase,'staging-retired');return {phase:'complete'};}
  };
  if(name==='./retirement-reconcile')return {reconcileRetirement:async options=>{reconcileCalls++;assert.equal(options.record.phase,'shutdown-acknowledged');assert.equal(options.journalDirectory,directory);return {phase:'complete'};}};
  if(name==='./retirement-readiness')return {privateRead:()=>JSON.stringify(reconcileRecord),readyRetirement:async options=>{readiness++;assert.equal(options.channel,instance);assert.equal(options.record.phase,'submitted');if(mode==='ready-error')throw Error('identity mismatch');return {record:{id:'a'.repeat(32),phase:'ready'},provider};}};
  return real(name);
 }});
 try{await run({directory,provider,changeRecord:value=>{reconcileRecord=value;},open:()=>module.exports.openRetirementSession({journalDirectory:directory}),state:()=>({instance,launches,readiness,launchOptions,closed,lifecycle,reconcileCalls})});}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('session binds private token to loopback listener and requires readiness before returning',()=>fixture('ok',async f=>{
 const session=await f.open(),s=f.state();assert.equal(s.instance.options.bindHost,'127.0.0.1');assert.equal(s.launchOptions.port,12345);assert.equal(s.readiness,1);assert.equal(session.record.phase,'ready');assert.equal(session.provider.identity,'verified');assert.equal(session.channel,undefined);
 session.closeTransport();session.closeTransport();assert.equal(f.state().closed,1);assert.equal(fs.existsSync(s.launchOptions.tokenFile),true);assert.equal(fs.existsSync(path.join(f.directory,'retirement-launch.pending')),true);
 await assert.rejects(f.open(),/reconciliation/);assert.equal(f.state().launches,1);
}));
test('uncertain launch and readiness retain token ownership but close transport',async()=>{
 for(const mode of ['launch-error','disconnect','ready-error'])await fixture(mode,async f=>{
  await assert.rejects(f.open(),e=>e.outcome==='unknown');const s=f.state();assert.equal(s.closed,1);assert.equal(fs.existsSync(s.launchOptions.tokenFile),true);assert.equal(s.readiness,mode==='ready-error'?1:0);
  await assert.rejects(f.open(),/reconciliation/);assert.equal(f.state().launches,1);
 });
});
test('listener failure before submission removes unused token and never launches',()=>fixture('listen-error',async f=>{
 await assert.rejects(f.open(),e=>e.outcome==='rejected');assert.equal(f.state().launches,0);assert.deepEqual(fs.readdirSync(f.directory),[]);
}));
test('existing pending ownership refuses allocation',()=>fixture('ok',async f=>{
 fs.writeFileSync(path.join(f.directory,'retirement-launch.pending'),'previous');await assert.rejects(f.open(),/reconciliation/);assert.equal(f.state().instance,undefined);assert.deepEqual(fs.readdirSync(f.directory),['retirement-launch.pending']);
}));

test('session retires through shutdown, independent cleanup and token completion exactly once',()=>fixture('ok',async f=>{
 const session=await f.open(),result=await session.retire({});assert.equal(result.phase,'complete');assert.deepEqual(f.state().lifecycle,['shutdown','cleanup','finish']);assert.equal(f.state().closed,1);
 await assert.rejects(session.retire({}));await assert.rejects(session.provider.inspectUnit({}));assert.equal(f.state().lifecycle.length,3);
}));
test('uncertain teardown closes transport and cannot be repeated by the session',()=>fixture('cleanup-error',async f=>{
 const session=await f.open();await assert.rejects(session.retire({}),/cleanup uncertain/);assert.deepEqual(f.state().lifecycle,['shutdown','cleanup']);assert.equal(f.state().closed,1);await assert.rejects(session.retire({}));
}));

test('session exposes rollback operations and retains provider ownership while exit evidence is pending',()=>fixture('ok',async f=>{
 const methods=['snapshotNativeJobs','restoreManagedState','acceptManagedRestore','launchManaged','verifyManaged'];
 for(const method of methods)f.provider[method]=async options=>({method,value:options.value});
 let release;f.provider.prepareNativeExit=async record=>{assert.equal(record.id,'native');return {waitForExit:()=>new Promise(resolve=>{release=resolve;})};};
 const session=await f.open();
 for(const method of methods)assert.deepEqual(await session.provider[method]({value:3}),{method,value:3});
 const observer=await session.provider.prepareNativeExit({id:'native'});await assert.rejects(session.retire({}));await assert.rejects(session.provider.prepareNativeExit({id:'native'}));
 const waiting=observer.waitForExit();await assert.rejects(session.retire({}));release({verified:true});assert.equal((await waiting).verified,true);await assert.rejects(observer.waitForExit());
 assert.equal((await session.retire({})).phase,'complete');
 for(const method of methods)await assert.rejects(session.provider[method]({value:3}));
}));
test('failed exit binding or observation keeps provider retirement blocked',async()=>{
 for(const mode of ['bind','wait'])await fixture('ok',async f=>{
  f.provider.prepareNativeExit=async()=>{if(mode==='bind')throw Error('unknown bind');return {waitForExit:async()=>{throw Error('unknown exit');}};};
  const session=await f.open();if(mode==='bind')await assert.rejects(session.provider.prepareNativeExit({}));else{const observer=await session.provider.prepareNativeExit({});await assert.rejects(observer.waitForExit());}
  await assert.rejects(session.retire({}));assert.deepEqual(f.state().lifecycle,[]);session.closeTransport();
 });
});


test('session retains pending exit across explicit recovery and refuses overlap or closed transport',async()=>{
 for(const mode of ['recover','close'])await fixture('ok',async f=>{
  let release,resumes=0;
  f.provider.prepareNativeExit=async()=>({waitForExit:async()=>{throw Error('interrupted');},resumeExitObservation:async()=>{resumes++;return new Promise(resolve=>{release=resolve;});}});
  const session=await f.open(),observer=await session.provider.prepareNativeExit({});
  await assert.rejects(observer.resumeExitObservation());await assert.rejects(observer.waitForExit());await assert.rejects(session.retire({}));
  const pending=observer.resumeExitObservation();await assert.rejects(observer.resumeExitObservation());await assert.rejects(session.retire({}));
  if(mode==='close')session.closeTransport();release({record_id:'native'});
  if(mode==='close')await assert.rejects(pending);else assert.equal((await pending).record_id,'native');
  await assert.rejects(observer.resumeExitObservation());await assert.rejects(observer.waitForExit());assert.equal(resumes,1);session.closeTransport();
 });
});

test('explicit retirement recovery reconciles the bound receipt without repeating shutdown',()=>fixture('cleanup-error',async f=>{
 const session=await f.open();await assert.rejects(session.resumeRetirement({}));
 await assert.rejects(session.retire({}));
 const result=await session.resumeRetirement({});assert.equal(result.phase,'complete');
 assert.deepEqual(f.state().lifecycle,['shutdown','cleanup']);assert.equal(f.state().reconcileCalls,1);
 await assert.rejects(session.resumeRetirement({}));await assert.rejects(session.retire({}));
}));
test('retirement recovery refuses changed ownership before reconciliation',()=>fixture('cleanup-error',async f=>{
 const session=await f.open();await assert.rejects(session.retire({}));
 f.changeRecord({id:'b'.repeat(32),phase:'shutdown-acknowledged'});
 await assert.rejects(session.resumeRetirement({}),/ownership changed/);assert.equal(f.state().reconcileCalls,0);
}));
