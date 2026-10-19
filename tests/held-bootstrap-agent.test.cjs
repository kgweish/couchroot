'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const boot='00000000-0000-0000-0000-000000000001',sha='a'.repeat(64),id='b'.repeat(32),flush=()=>new Promise(r=>setImmediate(r));
for(const outcome of ['retired','uncertain','stopped','managed-fallback','recovery','recovery-uncertain'])test('native bootstrap handoff keeps admission held through '+outcome,async()=>{
 const recovering=outcome.startsWith('recovery');
 const source=path.resolve(__dirname,'../research/autonomous-root/service/agent.js'),real=createRequire(source),channels=[];
 const held={implementation:'native-bootstrap',boot_id:boot,uptime_seconds:1,worker_id:'c'.repeat(32),lifetime_mode:'held-bootstrap',lifetime_seconds:300,guardian_pid:20,processes:{worker:{pid:21,start_ticks:'10'},guardian:{pid:20,start_ticks:'9'}},app_launcher:{sha256:sha,independently_staged:true},resources:{schema:1,scope:'worker-owned',jobs:[],helpers:[],transfers:[]},capabilities:['held-bootstrap-v1','resource-inventory-v1','worker-process-identity-v1','guardian-parent-identity-v1']};
 if(outcome==='managed-fallback'||recovering)Object.assign(held,{implementation:'managed',capabilities:['file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1','resource-inventory-v1','worker-process-identity-v1'],app_launcher:{sha256:sha,implementation:'native'},processes:{worker:{pid:21,start_ticks:'10'},guardian:null}});
 const selected={phase:'stable',selected_implementation:'native-prototype',selected_manifest_sha256:sha,launch_allowed:false,history:[{id,outcome:'committed',readiness_sha256:sha}]};
 let finish,retiring=false,submitted=0;
 class Channel{
  constructor(options){this.options=options;this._server=new EventEmitter();this._conn=null;channels.push(this);}
  start(cb){cb();}listeningPort(){return 12345;}
  connect(){this._conn={identity:{uid:0,euid:0,gid:0,egid:0,pid:21,smack:'System'},operation:async()=>held,_socket:{destroy:()=>this.close()}};this.options.onConnect(this._conn);}
  operation(){return Promise.resolve(held);}execute(){throw Error('Unexpected public executor');}
  close(){if(this._conn){this._conn=null;if(this.options.onClose)this.options.onClose();}}
 }
 const next={_conn:{identity:{uid:0,euid:0,gid:0,egid:0,pid:31,smack:'System'}},execute:async()=>({stdout:'public'}),close(){this._conn=null;}};
 const bytes=Buffer.from('payload'),manifest={};for(const n of ['SamsungTvArchiveRoot','SamsungTvRootAgent'])for(const suffix of ['dll','deps.json','runtimeconfig.json'])manifest[n+'.'+suffix]=real('./policy').hash(bytes);
 const mockfs={...fs,mkdirSync:()=>{},readdirSync:()=>[],writeFileSync:()=>{},chmodSync:()=>{},rmdirSync:()=>{},existsSync:()=>false,lstatSync:()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});}};
 const modules={fs:mockfs,'./policy':{...real('./policy'),read:p=>p.endsWith('/manifest.json')?Buffer.from(JSON.stringify(manifest)):p==='/etc/passwd'?Buffer.from('owner:x:5001:100:Owner:/home/owner/:/bin/sh\n'):bytes,sdkRuntimeGuard:()=>'',verifyFirmware:()=>{}},
  './vendor/root-agent':{RootAgentServer:Channel},'./vendor/sdb':{connect:async()=>({}),close:()=>{},exec:async()=>{submitted++;channels[0].connect();return '';}},
  './native-candidate':{candidateStatus:()=>({state:'verified'})},'./worker-selection':{selectionStatus:()=>selected,managedVersion:()=>sha},
  './restart-inventory':{abandonUnsubmitted:()=>({abandoned:false}),inventoryRestart:()=>({})},'./restart-rollback':{restartRollbackCandidate:()=>null},'./restart-return':{restartReturnCandidate:()=>null},
  './service-acquisition':{loadAcquisition:()=>({}),stageAcquisition:()=>{}},
  './native-startup':{startupCandidate:()=>({record:{id}}),startSelectedNative:async o=>{assert.equal(o.executor.implementation,outcome==='managed-fallback'||recovering?'managed':'native-bootstrap');assert.equal((await o.executor.status()).implementation,held.implementation);return {channel:next,record:{id,manifest_sha256:sha},activation:{readiness_sha256:sha},info:{...held,implementation:'native-prototype',worker_id:'d'.repeat(32)},selection:JSON.stringify(selected)};}},
  './bootstrap-recovery':{recoveryCandidate:()=>recovering?{id}:null,reconcileBootstrap:async()=>{retiring=true;await new Promise((yes,no)=>{finish=outcome==='recovery-uncertain'?()=>no(Error('recovery unconfirmed')):yes;});return {id,phase:'complete',launch_replayed:false};}},
  './held-bootstrap':{...real('./held-bootstrap'),prepareBootstrap:()=>({record:{id,launcher_sha256:sha},command:'true\n'}),bindBootstrap:async r=>r,retireBootstrap:async(r,owner)=>{retiring=true;owner.close();await new Promise((yes,no)=>{finish=outcome==='uncertain'?()=>no(Error('cleanup unconfirmed')):yes;});}}
 };
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,exports:module.exports,__dirname:path.dirname(source),process,Buffer,setTimeout:()=>0,clearTimeout:()=>{},require:n=>modules[n]||real(n)});
 const agent=module.exports.createAgent({device:'qn90a',...(outcome==='managed-fallback'?{service_acquisition:'managed'}:{})},{selectionFile:'/private/selection.json',verifyFirmware:()=>{},readBootId:()=>boot});agent.start();
 try{
  if(outcome==='managed-fallback'){for(let n=0;!agent.status().worker_ready&&n<20;n++)await flush();assert.equal(agent.status().worker_ready,true,agent.status().last_error);assert.equal(agent.status().root_acquisition,'managed');assert.equal(retiring,false);assert.equal((await agent.execute('permitted',1000)).stdout,'public');return;}
  for(let n=0;!retiring&&n<20;n++)await flush();assert(retiring);assert.equal(submitted,1);assert.equal(agent.status().worker_ready,false);await assert.rejects(agent.execute('must not run',1000),e=>e.outcome==='rejected');
  if(outcome==='stopped')agent.stop();finish();await flush();await flush();
  if(outcome==='retired'||outcome==='recovery'){assert.equal(agent.status().worker_ready,true,agent.status().last_error);if(recovering)assert.equal(agent.restartInventory().bootstrap_recovery.phase,'complete');else assert.equal(agent.restartInventory().native_startup.bootstrap.phase,'retired');assert.equal((await agent.execute('permitted',1000)).stdout,'public');}
  else {assert.equal(agent.status().worker_ready,false);if(!recovering)assert.equal(next._conn,null);await assert.rejects(agent.execute('must not run',1000));}
  assert.equal(submitted,1);
 }finally{agent.stop();}
});
