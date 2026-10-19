const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {prepareSupervisedExit,terminationEvidence}=require('../research/autonomous-root/service/observer-controller');
const {startTicks}=require('../research/autonomous-root/service/worker-processes');
const BOOT='00000000-0000-0000-0000-000000000001';
const unitEvidence=(unit,boot)=>({unit,boot_id:boot,active_state:'active',sub_state:'exited',main_pid:0,exec_code:1,exec_status:0,started_monotonic:'123'});
test('supervisor completion evidence must bind exact unit boot and successful execution',()=>{
 const record={unit:'fixture.service',boot_id:BOOT},valid=unitEvidence(record.unit,BOOT);
 assert.deepEqual(terminationEvidence(valid,record),valid);
 for(const patch of [{unit:'other'},{boot_id:'other'},{active_state:'inactive'},{sub_state:'running'},{main_pid:42},{exec_code:0},{exec_status:1},{started_monotonic:'0'},{extra:true}])assert.throws(()=>terminationEvidence({...valid,...patch},record));
});
const enabled=process.platform==='linux'&&process.env.COUCHROOT_PARITY_CONTAINER==='1'&&!!process.env.PROCESS_OBSERVER;
const APP='/opt/usr/home/owner/apps_rw/MiniRoot01',STATE=APP+'/data/worker-state';
async function fixture(fn,mode='normal'){return require('./retirement-test-state.cjs').withRetirementState(async()=>{
 assert.equal(fs.existsSync(APP),false,'isolated app directory required');fs.mkdirSync(STATE,{recursive:true,mode:0o700});fs.chmodSync(STATE,0o700);
 const journalDirectory=path.join(STATE,'launches');fs.mkdirSync(journalDirectory,{mode:0o700});
 const target=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(target,'spawn');const targetExit=once(target,'exit');
 let supervisor,supervisorExit,observer,calls=0;const events=[];
 const bound={boot_id:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),worker_id:'a'.repeat(32),capabilities:['worker-process-identity-v1'],processes:{worker:{pid:target.pid,start_ticks:startTicks(fs.readFileSync('/proc/'+target.pid+'/stat','utf8'),target.pid)},guardian:null}};
 const id=crypto.randomBytes(16).toString('hex'),file=path.join(journalDirectory,id+'.observer.json'),marker=path.join(journalDirectory,'observer-launch.pending');
 const options={device:'s90d',id,directory:STATE,journalDirectory,bound,credentials:{uid:5001,gid:100,groups:[100],label:'User::Pkg::MiniRoot01'},binary:'/opt/usr/apps/MiniRoot01/res/wgt/payload/native-process-observer',sha256:'b'.repeat(64),manifestSha256:'c'.repeat(64),
  confirm:()=>{events.push('confirm');assert.equal(JSON.parse(fs.readFileSync(file)).phase,'submitted');return bound;},
  execute:async command=>{
   calls++;events.push('execute');assert.match(command,/systemd-run/);assert.equal(JSON.parse(fs.readFileSync(file)).phase,'submitting');assert.equal(fs.readFileSync(marker,'utf8'),id+'\n');
   const root=path.join(STATE,fs.readdirSync(STATE).find(n=>n.startsWith('observer-')));
   supervisor=spawn(process.env.PROCESS_OBSERVER,['--supervise',root+'/control',root+'/token',bound.boot_id,String(target.pid)],{stdio:'ignore'});supervisorExit=once(supervisor,'exit');
   await new Promise(r=>setTimeout(r,25));events.push('ack');
   if(mode==='unknown')throw Error('reply lost');
   return {exit_code:0,timed_out:false,stdout:'OBSERVER-SUBMITTED\n'};
  },
  retireUnit:async unit=>{events.push('retire');if(mode==='retire-unknown')throw Error('retirement response lost');return {unit,boot_id:bound.boot_id,retired:true};},
  inspectUnit:async unit=>{assert.deepEqual(await supervisorExit,[0,null]);return {...unitEvidence(unit,bound.boot_id),...(mode==='active'?{sub_state:'running'}:{})};}
 };
 try{await fn({options,file,marker,bound,events,target,targetExit,supervisorEnded:()=>supervisorExit,calls:()=>calls,prepare:async extra=>{observer=await prepareSupervisedExit({...options,...extra});return observer;}});}
 finally{
  if(observer)try{await observer.cancel();}catch(_){}
  if(supervisor&&supervisor.exitCode===null&&supervisor.signalCode===null){supervisor.kill('SIGKILL');await supervisorExit;}
  if(target.exitCode===null&&target.signalCode===null){target.kill('SIGKILL');await targetExit;}
  fs.rmSync(APP,{recursive:true,force:true});
 }
});}
test('controller completes real observation and archives evidence before releasing pending ownership',{skip:!enabled,timeout:10000},()=>fixture(async f=>{
 const observer=await f.prepare();observer.assertReady();assert.deepEqual(f.events,['execute','ack','confirm']);
 f.target.kill('SIGTERM');await f.targetExit;const exit=await observer.waitForExit();assert.equal(exit.processes.worker.pid,f.target.pid);
 await observer.cancel();const record=JSON.parse(fs.readFileSync(f.file));assert.equal(record.phase,'completed');assert.equal(record.observer_receipt.exit_code,0);
 assert.match(record.receipt_sha256,/^[a-f0-9]{64}$/);assert.equal(fs.existsSync(record.root),false);assert.equal(fs.existsSync(f.marker),false);
 await assert.rejects(f.prepare());assert.equal(f.calls(),1);
}));
test('cancellation reaps observer and releases ownership without signalling target',{skip:!enabled,timeout:10000},()=>fixture(async f=>{
 const observer=await f.prepare();await observer.cancel();await assert.rejects(observer.waitForExit(),/cancelled/);
 assert.equal(f.target.exitCode,null);const record=JSON.parse(fs.readFileSync(f.file));assert.equal(record.phase,'cancelled');assert.equal(record.observer_receipt.exit_code,1);assert.equal(fs.existsSync(f.marker),false);
}));
test('lost submission response retains all evidence and blocks a different transaction ID',{skip:!enabled,timeout:10000},()=>fixture(async f=>{
 await assert.rejects(f.prepare(),e=>e.outcome==='unknown');assert.deepEqual(await f.supervisorEnded(),[0,null]);
 const record=JSON.parse(fs.readFileSync(f.file));assert.equal(record.phase,'unknown');assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(path.join(record.root,'result')),true);
 await assert.rejects(f.prepare({id:'d'.repeat(32)}),/reconciliation/);assert.equal(f.calls(),1);assert.equal(f.target.exitCode,null);
},'unknown'));
test('active unit evidence cannot release pending marker or delete receipts',{skip:!enabled,timeout:10000},()=>fixture(async f=>{
 const observer=await f.prepare();await assert.rejects(observer.cancel(),/termination not established/);
 const record=JSON.parse(fs.readFileSync(f.file));assert.equal(record.phase,'submitted');assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(path.join(record.root,'result')),true);assert.equal(f.target.exitCode,null);
},'active'));
test('pre-submission rejection discards only the unlaunched listener',{skip:!enabled,timeout:10000},()=>fixture(async f=>{
 await assert.rejects(f.prepare({device:'qn90a'}),/S90D-only/);assert.equal(f.calls(),0);assert.deepEqual(fs.readdirSync(STATE),['launches']);assert.equal(fs.existsSync(f.marker),false);
}));

test('lost unit retirement preserves archived receipt and does not repeat cleanup', {skip:!enabled,timeout:10000},()=>fixture(async f=>{
 const observer=await f.prepare();await assert.rejects(observer.cancel(),/response lost/);
 const record=JSON.parse(fs.readFileSync(f.file));assert.equal(record.phase,'cleanup-verified');assert.equal(record.observer_receipt.exit_code,1);
 assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(path.join(record.root,'result')),true);
 await assert.rejects(observer.cancel(),/response lost/);assert.equal(f.events.filter(e=>e==='retire').length,1);
 assert.equal(f.target.exitCode,null);
},'retire-unknown'));
