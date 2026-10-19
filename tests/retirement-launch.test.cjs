const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../research/autonomous-root/service/retirement-launch.js'),real=createRequire(source);
const manifest='a'.repeat(64),worker='b'.repeat(64),launcher='c'.repeat(64),observer='d'.repeat(64),token='e'.repeat(64);
function load(candidate={manifest_sha256:manifest,artifacts:{'native-worker':{sha256:worker},'native-app-launcher':{sha256:launcher},'native-process-observer':{sha256:observer}}}){
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,process,require:name=>name==='./native-candidate'?{loadCandidate:()=>candidate}:real(name)});return module.exports;
}
function options(){return {device:'s90d',id:'1'.repeat(32),payload:'/opt/usr/apps/MiniRoot01/res/wgt/payload',manifestSha256:manifest,source:{boot_id:'00000000-0000-0000-0000-000000000001',worker_id:'2'.repeat(32),processes:{worker:{pid:42,start_ticks:'123'},guardian:null}},port:12345,tokenFile:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/retirement-ABC123/token',tokenSha256:token};}
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retirement-launch-'));try{await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('retirement launch pins candidate, loopback, bounded lifetime and scoped launcher layout',()=>{
 const api=load();
 for(const device of ['s90d','qn90a']){
  const {command,record}=api.launchPlan({...options(),device});
  assert.equal(record.worker_sha256,worker);assert.equal(record.launcher_sha256,launcher);assert.equal(record.observer_sha256,observer);
  assert.match(command,/127\.0\.0\.1/);assert.match(command,/Environment=COUCHROOT_NATIVE_LIFETIME_SECONDS=300/);assert.match(command,/RuntimeMaxSec=300s/);assert.match(command,/BindReadOnlyPaths=\/opt\/couchroot-retirement-[a-f0-9]+\/code/);
  assert.match(command,/state\/launcher/);assert.doesNotMatch(command,/code\/launcher|--production/);assert.match(command,/5001:1:600:44/);
  assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);
  assert.equal(record.token_sha256,token);assert.equal(record.phase,'submitting');assert.equal(record.token,undefined);
 }
});
test('untrusted paths identities ports and changed candidates cannot produce a launch',()=>{
 const api=load();for(const patch of [{device:'other'},{id:'1'.repeat(32)+'\n'},{port:0},{port:65536},{port:1234.5},{payload:'/tmp/payload'},{manifestSha256:'f'.repeat(64)},{tokenSha256:token+'\n'},{tokenFile:'/tmp/token'},{tokenFile:options().tokenFile+'\n'},{source:{...options().source,worker_id:'2'.repeat(32)+'\n'}},{source:{...options().source,boot_id:options().source.boot_id+'\n'}}])assert.throws(()=>api.launchPlan({...options(),...patch}));
 assert.throws(()=>load(null).launchPlan(options()));assert.throws(()=>load({manifest_sha256:manifest,artifacts:{}}).launchPlan(options()));
});
test('both durable intents precede the first mutation and all IDs remain single-use',()=>fixture(async journalDirectory=>{
 const api=load(),o=options();let calls=0;
 const execute=async(command,timeout)=>{
  calls++;assert.equal(timeout,25000);assert.equal(fs.readFileSync(path.join(journalDirectory,'retirement-launch.pending'),'utf8'),o.id+'\n');
  const saved=JSON.parse(fs.readFileSync(path.join(journalDirectory,o.id+'.retirement.json')));assert.equal(saved.phase,'submitting');assert.equal(saved.worker_sha256,worker);assert.equal(command,api.launchPlan(o).command);
  return {exit_code:0,timed_out:false,stdout:'RETIREMENT-SUBMITTED\n'};
 };
 const record=await api.submitRetirement({...o,journalDirectory,execute});assert.equal(record.phase,'submitted');assert.equal(record.ready,undefined);
 await assert.rejects(api.submitRetirement({...o,journalDirectory,execute}));await assert.rejects(api.submitRetirement({...o,id:'3'.repeat(32),journalDirectory,execute}));assert.equal(calls,1);
}));
test('lost and unsuccessful launch results preserve unknown ownership without replay',async()=>{
 for(const result of [null,{exit_code:1,stdout:''},{exit_code:0,timed_out:true,stdout:'RETIREMENT-SUBMITTED\n'},{exit_code:0,stdout:'other\n'},'lost'])await fixture(async journalDirectory=>{
  const api=load(),o=options();let calls=0;const execute=async()=>{calls++;if(result==='lost')throw Error('lost response');return result;};
  await assert.rejects(api.submitRetirement({...o,journalDirectory,execute}),e=>e.outcome==='unknown');
  assert.equal(JSON.parse(fs.readFileSync(path.join(journalDirectory,o.id+'.retirement.json'))).phase,'unknown');
  await assert.rejects(api.submitRetirement({...o,journalDirectory,execute}));await assert.rejects(api.submitRetirement({...o,id:'3'.repeat(32),journalDirectory,execute}));assert.equal(calls,1);
 });
});
test('partial intent and non-private journals block submission',()=>fixture(async journalDirectory=>{
 const api=load(),o=options();let calls=0;const execute=async()=>{calls++;};
 const marker=path.join(journalDirectory,'retirement-launch.pending');fs.writeFileSync(marker,o.id+'\n',{mode:0o600});await assert.rejects(api.submitRetirement({...o,journalDirectory,execute}));fs.unlinkSync(marker);
 fs.chmodSync(journalDirectory,0o755);await assert.rejects(api.submitRetirement({...o,journalDirectory,execute}),/Private/);assert.equal(calls,0);
}));
test('source start identity is checked before staging and again before launch',()=>fixture(async directory=>{
 const {command}=load().launchPlan(options());assert.equal(command.split('cat /proc/42/stat').length-1,2);
 assert.ok(command.indexOf('cat /proc/42/stat')<command.indexOf('mkdir '));assert.ok(command.lastIndexOf('cat /proc/42/stat')>command.indexOf('cp '));
 fs.writeFileSync(path.join(directory,'boot'),options().source.boot_id+'\n');
 const guard=command.slice(0,command.indexOf('for p in ')).replaceAll('/proc/sys/kernel/random/boot_id',path.join(directory,'boot')).replaceAll('/proc/42/stat',path.join(directory,'stat'))+'echo GUARDED\n';
 for(const ticks of ['123','124']){
  fs.writeFileSync(path.join(directory,'stat'),'42 (worker ) with\nspaces) S '+Array(18).fill('0').join(' ')+' '+ticks+' 0\n');
  const result=spawnSync('/bin/sh',[],{input:guard,encoding:'utf8'});assert.equal(result.status===0,ticks==='123');assert.equal(result.stdout,ticks==='123'?'GUARDED\n':'');
 }
}));
