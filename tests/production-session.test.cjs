const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const file=path.resolve(__dirname,'../research/autonomous-root/service/production-session.js'),real=createRequire(file),hash=s=>crypto.createHash('sha256').update(s).digest('hex'),sha='b'.repeat(64);
async function fixture(mode,run){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'production-session-')),selectionFile=directory+'/selection.json',journal=new SelectionJournal(selectionFile);journal.initialize({implementation:'managed',manifest_sha256:'a'.repeat(64)});const id=journal.begin(1,{implementation:'native-prototype',manifest_sha256:sha},'c'.repeat(64)).pending.id;journal.advance(2,id,'state-ready','d'.repeat(64));
 let instance,launches=0,readiness=0,launchOptions,closed=0;const identity={worker_id:'e'.repeat(32)};
 class Server{
  constructor(options){this.options=options;this._server=new EventEmitter();instance=this;}
  start(callback){if(mode==='listen-error')queueMicrotask(()=>this._server.emit('error',Error('bind failed')));else callback();}
  listeningPort(){return 12345;}
  connect(){this._conn={_socket:{destroy(){}}};this.options.onConnect(this._conn);}
  close(){closed++;this._conn=null;}
  async operation(request){assert.equal(request.op,'status');return mode==='adoption-drift'?{worker_id:'f'.repeat(32)}:identity;}
 }
 let record;
 const provider={identity:{worker_id:'1'.repeat(32)},launchProduction:async options=>{
  launches++;launchOptions=options;assert.equal(instance.options.bindHost,'127.0.0.1');assert.equal(options.port,12345);
  const token=fs.readFileSync(options.tokenFile);assert.equal(token.length,44);assert.equal(hash(token),options.tokenSha256);assert.equal(Buffer.from(token.toString(),'base64').equals(instance.options.secret),true);assert.equal(fs.statSync(options.tokenFile).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(options.tokenFile)).mode&0o777,0o700);
  fs.writeFileSync(directory+'/production-launch.pending',id+'\n',{mode:0o600});
  if(mode==='launch-error')throw Error('unknown launch');
  record={id,phase:'submitted',port:options.port,token_file:options.tokenFile,token_sha256:options.tokenSha256,state_receipt_sha256:'d'.repeat(64),manifest_sha256:sha};
  if(mode!=='no-connect')instance.connect();if(mode==='disconnect')instance._conn=null;return record;
 },verifyProduction:async options=>{
  readiness++;assert.equal(options.channel,instance);if(mode==='ready-error')throw Error('readiness mismatch');
  const ready={...record,phase:'ready',worker_identity:identity,unit_started_monotonic:'123'},digest=hash(JSON.stringify(ready));fs.writeFileSync(directory+'/'+id+'.production.json',JSON.stringify(ready),{mode:0o600});
  const selection=journal.advance(3,id,'trial-ready',digest);return {record:ready,readiness_sha256:digest,selection};
 }};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,setTimeout:(fn,ms)=>setTimeout(fn,mode==='no-connect'?20:ms),clearTimeout,require:name=>name==='./vendor/root-agent'?{RootAgentServer:Server}:name==='./production-readiness'?{productionIdentity:info=>info}:real(name)});
 const open=()=>module.exports.openProductionSession({journalDirectory:directory,selectionFile,id,provider});
 try{await run({open,directory,id,journal,state:()=>({instance,launches,readiness,launchOptions,closed})});}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('session binds launch and readiness and exposes no channel before committed adoption',()=>fixture('ok',async f=>{
 const session=await f.open();assert.equal(session.record.phase,'ready');assert.equal(session.channel,undefined);assert.equal(f.state().readiness,1);assert.equal(f.journal.read().selected.implementation,'managed');
 f.journal.commit(4,f.id);const channel=await session.takeChannel();assert.equal(channel,f.state().instance);await assert.rejects(session.takeChannel());assert.equal(f.state().closed,0);
 session.closeTransport();session.closeTransport();assert.equal(f.state().closed,1);assert.equal(fs.existsSync(f.state().launchOptions.tokenFile),true);
 await assert.rejects(f.open(),/reconciliation/);assert.equal(f.state().launches,1);
}));
test('precommit or changed-identity adoption closes transport and retains evidence',async()=>{
 for(const mode of ['precommit','adoption-drift'])await fixture(mode,async f=>{const session=await f.open();if(mode==='adoption-drift')f.journal.commit(4,f.id);await assert.rejects(session.takeChannel(),e=>e.outcome==='unknown');assert.equal(f.state().closed,1);assert.equal(fs.existsSync(f.state().launchOptions.tokenFile),true);await assert.rejects(session.takeChannel());});
});
test('unknown launch and failed readiness keep token and launch ownership',async()=>{
 for(const mode of ['launch-error','disconnect','ready-error','no-connect'])await fixture(mode,async f=>{await assert.rejects(f.open(),e=>e.outcome==='unknown');assert.equal(f.state().closed,1);assert.equal(fs.existsSync(f.state().launchOptions.tokenFile),true);await assert.rejects(f.open(),/reconciliation/);assert.equal(f.state().launches,1);});
});
test('listener failure removes unused private material without starting a worker',()=>fixture('listen-error',async f=>{
 await assert.rejects(f.open(),e=>e.outcome==='rejected');assert.equal(f.state().launches,0);assert.deepEqual(fs.readdirSync(f.directory),['selection.json']);
}));
test('existing pending launch or wrong transition refuses listener allocation',async()=>{
 for(const mode of ['pending','selection'])await fixture('ok',async f=>{
  if(mode==='pending')fs.writeFileSync(f.directory+'/production-launch.pending','old');else f.journal.advance(3,f.id,'rollback-required','f'.repeat(64));
  await assert.rejects(f.open());assert.equal(f.state().instance,undefined);assert.equal(f.state().launches,0);
 });
});
test('disconnect after readiness closes transport without pretending process cleanup',()=>fixture('ok',async f=>{
 const session=await f.open();f.state().instance.options.onClose(Error('disconnected'));assert.equal(f.state().closed,1);await assert.rejects(session.takeChannel());assert.equal(fs.existsSync(f.directory+'/production-launch.pending'),true);assert.equal(f.journal.read().pending.phase,'trial-ready');
}));
