const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const sourceFile=path.resolve(__dirname,'../research/autonomous-root/service/native-migration.js'),real=createRequire(sourceFile),managed='a'.repeat(64),native='b'.repeat(64),receipt='c'.repeat(64),readiness='d'.repeat(64);
async function fixture(fail,fn){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-migration-')),selectionFile=directory+'/selection.json',journal=new SelectionJournal(selectionFile),events=[];let released=false,closed=0,id,controller;
 const step=name=>{events.push(name);if(fail===name)throw Error('injected '+name);if(fail&&fail.step===name)throw fail.error;};
 const production={record:{phase:'ready'},readiness_sha256:readiness,closeTransport:()=>{closed++;}};
 const provider={snapshotManagedJobs:async()=>{step('snapshot');return {};},installManagedState:async options=>{step('install');assert.equal(options.id,id);return {id,phase:'ready',receipt_sha256:receipt};},acceptManagedState:async()=>{step('accept');return journal.advance(2,id,'state-ready',receipt);}};
 const retirement={provider,closeTransport:()=>{closed++;}};
 const hold={snapshot:async()=>{step('drain');return {resources:{jobs:fail==='resources'?[{monitor_finished:false,state:'running'}]:[],transfers:[],helpers:[]}};},prepareNative:async value=>{id=value;step('provider');assert.equal(journal.read().pending.phase,'prepared');return retirement;},shutdown:async value=>{step('shutdown');assert.equal(value,id);return {transaction_id:id,inventory_sha256:journal.read().pending.quiescence_sha256};},adoptProduction:async session=>{step('adopt');assert.equal(session,production);assert.equal(journal.read().pending,null);assert.equal(journal.read().selected.implementation,'native-prototype');},completeProduction:async (session,options={})=>{if(!options.resume)step('activate');else events.push('resume-activation');assert.equal(session,retirement);return {transaction_id:id,admission_held:false,worker_id:'e'.repeat(32)};},release:()=>{released=true;}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(sourceFile,'utf8'),{module,process,require:name=>name==='./native-candidate'?{loadCandidate:()=>{step('candidate');return {manifest_sha256:native};}}:name==='./worker-selection'?{...real(name),managedVersion:()=>managed}:name==='./managed-return'?{createManagedReturn:options=>{assert.equal(options.hold,hold);assert.equal(options.retirement,retirement);assert.equal(options.runtimeSha256,'8'.repeat(64));return {run:async()=>{step('return');return {selected_implementation:'managed',admission_held:false};},resumeActivation:async()=>{events.push('resume-return');return {selected_implementation:'managed',admission_held:false};},status:()=>({phase:'return-fixture'}),closeTransport:()=>{closed++;}};}}:name==='./production-session'?{openProductionSession:async options=>{step('production');assert.equal(options.provider,provider);assert.equal(journal.read().pending.phase,'state-ready');journal.advance(3,id,'trial-ready',readiness);if(fail==='stop'){controller.closeTransport();}return production;}}:real(name)});
 controller=module.exports.createNativeMigration({agent:{holdAdmission:()=>{step('hold');return hold;}},device:'s90d',payload:'/fixture/payload',selectionFile});
 try{await fn({controller,directory,journal,events,state:()=>({released,closed,id})});}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('controller orders drained handoff, retained state, production commit, adoption and activation',()=>fixture(null,async f=>{
 const result=await f.controller.run(native);assert.equal(result.selected_implementation,'native-prototype');assert.equal(result.admission_held,false);assert.equal(f.controller.status().phase,'active');assert.deepEqual(f.events,['candidate','hold','drain','provider','shutdown','snapshot','install','accept','production','adopt','activate']);assert.equal(f.state().released,false);assert.equal(f.state().closed,0);
 await assert.rejects(f.controller.run(native));assert.equal(f.events.length,11);f.controller.closeTransport();assert.equal(f.state().closed,2);
}));
test('failure before handoff releases only an acquired hold and never launches',async()=>{
 for(const mode of ['candidate','hold','drain','resources'])await fixture(mode,async f=>{await assert.rejects(f.controller.run(native),e=>e.outcome==='rejected');assert.equal(f.controller.status().phase,'rejected');assert.equal(f.state().released,['drain','resources'].includes(mode));assert.equal(f.events.includes('provider'),false);});
});
test('every uncertain post-begin phase retains transition and session access without replay',async()=>{
 for(const mode of ['provider','shutdown','snapshot','install','accept','production','adopt','activate'])await fixture(mode,async f=>{
  await assert.rejects(f.controller.run(native),e=>e.outcome==='unknown');assert.equal(f.controller.status().phase,'reconciliation-required');assert.equal(f.state().released,false);assert.equal(f.state().closed,0);const count=f.events.length;await assert.rejects(f.controller.run(native));assert.equal(f.events.length,count);assert.ok(f.journal.read().pending||f.journal.read().history.length===1);
 });
});
test('existing unfinished transition refuses draining and listener allocation',()=>fixture(null,async f=>{
 fs.writeFileSync(f.directory+'/production-launch.pending','owned');await assert.rejects(f.controller.run(native),e=>e.outcome==='rejected');assert.deepEqual(f.events,[]);
}));
test('stop while production session is resolving prevents commit and closes returned transports',()=>fixture('stop',async f=>{
 await assert.rejects(f.controller.run(native),e=>e.outcome==='unknown');assert.equal(f.journal.read().pending.phase,'trial-ready');assert.equal(f.events.includes('adopt'),false);assert.equal(f.state().released,false);assert.ok(f.state().closed>=2);
}));

test('controller resumes only failed activation and never replays previous phases',()=>fixture('activate',async f=>{
 await assert.rejects(f.controller.run(native),e=>e.outcome==='unknown');const count=f.events.length;const result=await f.controller.resumeActivation();assert.equal(result.admission_held,false);assert.equal(f.controller.status().phase,'active');assert.deepEqual(f.events.slice(count),['resume-activation']);await assert.rejects(f.controller.resumeActivation());
}));
test('earlier handoff failure cannot use activation recovery',()=>fixture('production',async f=>{
 await assert.rejects(f.controller.run(native));const count=f.events.length;await assert.rejects(f.controller.resumeActivation());assert.equal(f.events.length,count);
}));

test('explicit rehearsal returns to managed before native activation or admission release',()=>fixture(null,async f=>{
 const result=await f.controller.run(native,{returnToManaged:true,runtimeSha256:'8'.repeat(64)});assert.equal(result.selected_implementation,'managed');assert.equal(f.controller.status().phase,'managed-active');assert.deepEqual(f.events.slice(-2),['adopt','return']);assert.equal(f.events.includes('activate'),false);assert.equal(f.state().released,false);
}));
test('rehearsal return failure delegates only managed activation recovery',()=>fixture('return',async f=>{
 await assert.rejects(f.controller.run(native,{returnToManaged:true,runtimeSha256:'8'.repeat(64)}));await assert.rejects(f.controller.resumeActivation());const count=f.events.length;assert.equal((await f.controller.resumeManagedActivation()).selected_implementation,'managed');assert.deepEqual(f.events.slice(count),['resume-return']);await assert.rejects(f.controller.resumeManagedActivation());
}));
test('rehearsal requires pinned managed runtime before acquiring the hold',()=>fixture(null,async f=>{
 await assert.rejects(f.controller.run(native,{returnToManaged:true}),e=>e.outcome==='rejected');assert.deepEqual(f.events,[]);
}));

test('production failure exposes bounded phase and causes without changing held recovery',()=>fixture('production',async f=>{
 await assert.rejects(f.controller.run(native),e=>e.outcome==='unknown');
 const status=f.controller.status();assert.equal(status.failed_phase,'production');assert.equal(status.phase,'reconciliation-required');assert.equal(status.failure[0],'injected production');assert.equal(f.state().released,false);
 status.failure[0]='changed by caller';assert.equal(f.controller.status().failure[0],'injected production');
}));

test('failure diagnostics bound long and cyclic causes',async()=>{
 const error=Error('x'.repeat(1000));error.cause=error;
 await fixture({step:'production',error},async f=>{await assert.rejects(f.controller.run(native));const detail=f.controller.status().failure;assert.equal(detail.length,1);assert.equal(detail[0].length,200);});
 let nested=Error('last');for(let i=0;i<8;i++)nested=Object.assign(Error('wrapper'),{cause:nested});
 await fixture({step:'production',error:nested},async f=>{await assert.rejects(f.controller.run(native));assert.equal(f.controller.status().failure.length,4);});
});
