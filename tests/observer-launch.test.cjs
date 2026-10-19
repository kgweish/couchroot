const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {launchPlan,submitObserver}=require('../research/autonomous-root/service/observer-launch');
const root='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/observer-ABC123';
const options=()=>({device:'s90d',id:'a'.repeat(32),binary:'/opt/usr/apps/MiniRoot01/res/wgt/payload/native-process-observer',sha256:'b'.repeat(64),manifestSha256:'c'.repeat(64),launch:{socketPath:root+'/control',tokenFile:root+'/token',bootId:'00000000-0000-0000-0000-000000000001',pids:[42,43]},credentials:{uid:5001,gid:100,groups:[201,100,29],label:'User::Pkg::MiniRoot01'}});
async function fixture(fn){const journalDirectory=fs.mkdtempSync('/tmp/cr-launch-');try{await fn(journalDirectory);}finally{fs.rmSync(journalDirectory,{recursive:true,force:true});}}
test('launch plan restricts identity artifact and transport and parses as shell',()=>{
 const plan=launchPlan(options());assert.equal(plan.unit,'couchroot-observer-'+'a'.repeat(32)+'.service');
 assert.match(plan.command,/--service-supervise/);assert.doesNotMatch(plan.command,/\/proc\/self\//);assert.match(plan.command,/NoNewPrivileges=yes/);assert.match(plan.command,/User=0/);assert.match(plan.command,/SmackProcessLabel=System/);assert.doesNotMatch(plan.command,/SupplementaryGroups=/);assert.doesNotMatch(plan.command,/\/bin\/sh -c/);assert.match(plan.command,/AmbientCapabilities=/);assert.match(plan.command,/201:1:755/);
 assert.match(plan.command,/PrivateMounts=yes/);assert.match(plan.command,/BindReadOnlyPaths=\/opt\/couchroot-observer-/);assert.equal(plan.executionDirectory,'/opt/couchroot-observer-'+'a'.repeat(32));
 assert.deepEqual(plan.credentials.groups,[29,100,201]);
 const parsed=spawnSync('/bin/sh',['-n'],{input:plan.command,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);
 for(const patch of [{device:'qn90a'},{id:'a'.repeat(32)+'\n'},{sha256:'b'.repeat(64)+'\n'},{manifestSha256:'c'.repeat(64)+'\n'},{binary:'/tmp/observer'},{credentials:{...options().credentials,uid:0}},{credentials:{...options().credentials,label:'System'}},{credentials:{...options().credentials,groups:[0,100]}}])assert.throws(()=>launchPlan({...options(),...patch}));
 for(const patch of [{pids:[42,42]},{pids:[1]},{bootId:options().launch.bootId+'\n'},{tokenFile:'/tmp/token'},{socketPath:root+'/other'}])assert.throws(()=>launchPlan({...options(),launch:{...options().launch,...patch}}));
});
test('durable exclusive intent precedes submission and acknowledgement is not readiness',()=>fixture(async journalDirectory=>{
 const o=options();let calls=0;
 const execute=async(command,timeout)=>{
  calls++;assert.equal(timeout,25000);assert.equal(command,launchPlan(o).command);
  const record=JSON.parse(fs.readFileSync(path.join(journalDirectory,o.id+'.observer.json')));assert.equal(record.phase,'submitting');assert.equal(record.manifest_sha256,o.manifestSha256);
  return {exit_code:0,timed_out:false,stdout:'OBSERVER-SUBMITTED\n'};
 };
 const result=await submitObserver({...o,journalDirectory,execute});assert.equal(result.phase,'submitted');assert.equal(result.ready,undefined);
 await assert.rejects(submitObserver({...o,journalDirectory,execute}));assert.equal(calls,1);
}));
test('transport errors and ambiguous command results never permit resubmission',async()=>{
 for(const result of [null,{exit_code:1,stdout:''},{exit_code:0,timed_out:true,stdout:'OBSERVER-SUBMITTED\n'},{exit_code:0,stdout:'other\n'},'throw'])await fixture(async journalDirectory=>{
  const o=options();let calls=0;const execute=async()=>{calls++;if(result==='throw')throw Error('lost response');return result;};
  await assert.rejects(submitObserver({...o,journalDirectory,execute}),e=>e.outcome==='unknown');
  const record=JSON.parse(fs.readFileSync(path.join(journalDirectory,o.id+'.observer.json')));assert.equal(record.phase,'unknown');
  await assert.rejects(submitObserver({...o,journalDirectory,execute}));assert.equal(calls,1);
  await assert.rejects(submitObserver({...o,id:'d'.repeat(32),journalDirectory,execute}));assert.equal(calls,1);
 });
});
test('an interrupted intent is retained and a public journal directory is refused',()=>fixture(async journalDirectory=>{
 const o=options(),file=path.join(journalDirectory,o.id+'.observer.json');fs.writeFileSync(file,'partial',{mode:0o600});let calls=0;
 const execute=async()=>{calls++;};await assert.rejects(submitObserver({...o,journalDirectory,execute}));assert.equal(fs.readFileSync(file,'utf8'),'partial');
 fs.unlinkSync(file);fs.chmodSync(journalDirectory,0o755);await assert.rejects(submitObserver({...o,journalDirectory,execute}),/Private/);assert.equal(calls,0);
}));
