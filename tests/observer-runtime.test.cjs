'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const runtime=require('../research/autonomous-root/service/observer-runtime');
test('observer transaction is stable and rejects absent or ambiguous request identities',()=>{
 const id=runtime.observerTransactionId('request-identity-001');assert.match(id,/^[a-f0-9]{32}$/);
 assert.equal(runtime.observerTransactionId('request-identity-001'),id);assert.notEqual(runtime.observerTransactionId('request-identity-002'),id);
 for(const input of [undefined,'','short','x'.repeat(65),'request-identity-001\n','request/identity-001'])assert.throws(()=>runtime.observerTransactionId(input));
});
function credentials(change={}){
 const source=path.resolve(__dirname,'../research/autonomous-root/service/observer-runtime.js'),real=createRequire(source),module={exports:{}};
 const defaults={Pid:'42',Tgid:'41',Uid:'5001 5001 5001 5001',Gid:'100 100 100 100',Groups:'29 100 201',CapEff:'0000000000000000',...change};
 const links=change.links&&change.links.slice();
 const fakeFs={readlinkSync:()=>links?links.shift():change.self||'41/task/42',readFileSync:file=>file.endsWith('status')?['Pid','Tgid','Uid','Gid','Groups','CapEff'].map(key=>key+':\t'+defaults[key]).join('\n'):(change.label||'User::Pkg::MiniRoot01')};
 const fakeProcess={pid:9999,getuid:()=>5001,geteuid:()=>5001,getgid:()=>100,getegid:()=>100,getgroups:()=>{throw Error('Do not consult WRT credential getters');}};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,process:fakeProcess,require:name=>name==='fs'?fakeFs:real(name)});
 if(change.capture)return module.exports.serviceCredentials(change.capture,'00000000-0000-0000-0000-000000000001');
 return module.exports.parseCredentials(fakeFs.readFileSync('/proc/self/status'),fakeFs.readFileSync('/proc/self/attr/current'),42,41);
}
test('observer captures exact service identity and refuses altered credentials',()=>{
 assert.equal(JSON.stringify(credentials()),JSON.stringify({uid:5001,gid:100,groups:[29,100,201],label:'User::Pkg::MiniRoot01'}));
 for(const change of [{Pid:'43'},{Uid:'5001 0 5001 5001'},{Gid:'100 100 100 0'},{CapEff:'0000000000000001'},{Groups:'29 100 100'},{Groups:'0 100 201'},{label:'User'},{Groups:'29 201'},{Uid:'5001'}])assert.throws(()=>credentials(change));
});

test('service credential capture uses the held executor and rejects incomplete evidence',async()=>{
 const stdout='Pid: 42\nTgid: 41\nUid: 5001 5001 5001 5001\nGid: 100 100 100 100\nGroups: 29 100 201\nCapEff: 0000000000000000\nOBSERVER-SERVICE-LABEL\nUser::Pkg::MiniRoot01\n';
 let calls=0;
 const result=await credentials({capture:async(command,timeout)=>{calls++;assert.match(command,/cat \/proc\/41\/task\/42\/status/);assert.doesNotMatch(command,/\/proc\/self\//);assert.equal(timeout,5000);return {exit_code:0,stdout};}});
 assert.equal(result.uid,5001);assert.equal(calls,1);
 await assert.rejects(credentials({links:['41/task/42','41/task/43'],capture:async()=>({exit_code:0,stdout})}),/thread changed/);
 for(const self of ['0','../42','41/task/42\n','2147483648/task/42','41/task/2147483648'])await assert.rejects(credentials({self,capture:async()=>{throw Error('Must not submit invalid PID');}}));
 for(const response of [{exit_code:1,stdout},{exit_code:0,stdout,timed_out:true},{exit_code:0,stdout,stderr:'denied'},{exit_code:0,stdout:stdout.replace('Pid: 42','Pid: 43')},{exit_code:0,stdout:stdout.replace('OBSERVER-SERVICE-LABEL','missing')}])await assert.rejects(credentials({capture:async()=>response}));
});

test('runtime confirms actual supervisor credentials before fresh worker confirmation',async()=>{
 for(const failure of [false,'credentials','not-running','handoff','provider-probe','handoff-mismatch']){
  const source=path.resolve(__dirname,'../research/autonomous-root/service/observer-runtime.js'),real=createRequire(source),module={exports:{}},events=[];
  let departed=false;
  const boot='00000000-0000-0000-0000-000000000001';
  const stat=()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:5001,mode:0o42700,dev:1,ino:2});
  const fakeFs={readlinkSync:()=> '41/task/42',constants:fs.constants,openSync:()=>7,closeSync:()=>{},fstatSync:stat,lstatSync:stat,mkdirSync:()=>{},fchmodSync:()=>{},fsyncSync:()=>{}};
  const fakeProcess={pid:9999,getuid:()=>5001,geteuid:()=>5001,getgid:()=>100,getegid:()=>100,getgroups:()=>[29,100,201]};
  const unitModule={inspectObserverUnit:async o=>{events.push('inspect');assert.equal(o.bootId,boot);return {unit:o.unit,boot_id:boot,started_monotonic:'1',active_state:'active',sub_state:failure==='not-running'?'exited':'running',main_pid:77};},retireObserverUnit:async()=>{throw Error('Unexpected retirement');}};
  const privateModule={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(path.dirname(source),'private-state.js'),'utf8'),{module:privateModule,process:fakeProcess,require:real});
  vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,process:fakeProcess,require:name=>name==='./private-state'?privateModule.exports:name==='fs'?fakeFs:name==='./observer-controller'?{prepareSupervisedExit:async o=>o}:name==='./observer-unit'?unitModule:real(name)});
  const retirement={inspectUnit:async identity=>{if(!departed){events.push('provider-ready');return {unit:identity.unit,boot_id:identity.bootId,started_monotonic:'1',active_state:'active',sub_state:'running',main_pid:failure==='handoff-mismatch'?78:77};}assert.equal(identity.execute,undefined);assert.equal(identity.sha256,'a'.repeat(64));events.push('independent-inspect');return 'independent';},retireUnit:async identity=>{assert.equal(departed,true);assert.equal(identity.execute,undefined);events.push('independent-retire');return 'retired';}};
  const options=await module.exports.prepareRuntimeObserver({...((String(failure).startsWith('handoff')||failure==='provider-probe')?{purpose:failure==='provider-probe'?'provider-probe':'handoff',retirement}:{}),directory:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state',requestId:'runtime-probe-identity',staged:{binary:'/fixture',sha256:'a'.repeat(64),manifest_sha256:'b'.repeat(64)},bound:{boot_id:boot,processes:{worker:{pid:123},guardian:null}},confirm:async()=>{events.push('fresh-worker');return 'fresh';},execute:async command=>{
   assert.equal(departed,false,'departed worker must never execute cleanup');
   const pid=command.includes('/proc/77/status')?77:42;events.push('credentials-'+pid);
   const label=failure==='credentials'&&pid===77?'User':'User::Pkg::MiniRoot01';
   return {exit_code:0,stdout:'Pid: '+pid+'\nTgid: '+(pid===42?41:pid)+'\nUid: 5001 5001 5001 5001\nGid: 100 100 100 100\nGroups: 29 100 201\nCapEff: 0000000000000000\nOBSERVER-SERVICE-LABEL\n'+label+'\n'};
  }});
  assert.equal(options.credentials.uid,5001);assert.equal(options.manifestSha256,'b'.repeat(64));
  if(failure==='credentials'||failure==='not-running'||failure==='handoff-mismatch'){await assert.rejects(options.confirm());assert.equal(events.includes('fresh-worker'),false);}
  else{assert.equal(await options.confirm(),'fresh');assert.deepEqual(events,['credentials-42','inspect','credentials-77',...((failure==='handoff'||failure==='provider-probe')?['provider-ready']:[]),'fresh-worker']);
   if(failure==='handoff'||failure==='provider-probe'){departed=true;assert.equal(await options.inspectUnit('unit'),'independent');assert.equal(await options.retireUnit('unit'),'retired');}
  }
 }
});

test('privileged broker credentials never replace package thread credentials',()=>{
 const context={label:'System::Privileged',CapEff:'0000000200000000'};
 assert.throws(()=>credentials(context),/label/);
 assert.throws(()=>credentials({...context,label:'User::Pkg::MiniRoot01'}),/capabilities/);
 assert.throws(()=>credentials({Tgid:'9999'}),/thread-group/);
});

test('handoff rejects incomplete independent cleanup before any worker use',async()=>{
 let calls=0;const execute=()=>{calls++;throw Error('must not execute');};
 for(const retirement of [undefined,{}, {inspectUnit:()=>{}}, {retireUnit:()=>{}}])await assert.rejects(runtime.prepareRuntimeObserver({purpose:'handoff',retirement,execute}),/Independent observer retirement/);
 await assert.rejects(runtime.prepareRuntimeObserver({purpose:'probe',retirement:{},execute}),/Probe retirement/);
 assert.equal(calls,0);
 assert.notEqual(runtime.observerTransactionId('same-transaction-identity','handoff'),runtime.observerTransactionId('same-transaction-identity','probe'));
});

test('provider probe has its own transaction namespace and requires independent callbacks',async()=>{
 const request='provider-probe-identity';assert.equal(new Set(['probe','provider-probe','handoff'].map(p=>runtime.observerTransactionId(request,p))).size,3);
 await assert.rejects(runtime.prepareRuntimeObserver({purpose:'provider-probe',retirement:{}}),/Independent observer retirement/);
});
