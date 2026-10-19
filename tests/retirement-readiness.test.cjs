const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readyRetirement}=require('../research/autonomous-root/service/retirement-readiness');
const {inspectRetirementUnit}=require('../research/autonomous-root/service/observer-unit');
const boot='00000000-0000-0000-0000-000000000001',id='a'.repeat(32),sha='b'.repeat(64);
const source={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}};
function info(){return {implementation:'native-prototype',boot_id:boot,worker_id:'d'.repeat(32),lifetime_mode:'bounded',lifetime_seconds:300,guardian_pid:76,processes:{worker:{pid:77,start_ticks:'200'},guardian:{pid:76,start_ticks:'199'}},capabilities:['prototype-scoped-files-v1','worker-process-identity-v1','guardian-parent-identity-v1','resource-inventory-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1'],app_launcher:{sha256:sha,independently_staged:true},resources:{schema:1,scope:'worker-owned',jobs:[],transfers:[],helpers:[]}};}
async function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retirement-ready-'));
 const record={schema:1,id,phase:'submitted',device:'s90d',manifest_sha256:sha,worker_sha256:sha,launcher_sha256:sha,observer_sha256:sha,boot_id:boot,source,unit:'couchroot-retirement-'+id+'.service',directory:'/opt/couchroot-retirement-'+id,scope:'/opt/couchroot-retirement-'+id+'/state',token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/retirement-ABC123/token',token_sha256:sha,port:12345};
 const file=path.join(dir,id+'.retirement.json'),marker=path.join(dir,'retirement-launch.pending'),intent=file+'.readiness.pending';
 fs.writeFileSync(file,JSON.stringify(record),{mode:0o600});fs.writeFileSync(marker,id+'\n',{mode:0o600});
 const peer={identity:{pid:77,uid:0,euid:0,gid:0,egid:0,smack:'System'}},channel={_conn:peer,operation:async()=>info(),execute:async()=>{throw Error('Must not execute on maintenance worker to establish unit ownership');}};
 let queries=0;
 const options={record,journalDirectory:dir,channel,confirmSource:async()=>({...source,capabilities:['worker-process-identity-v1']}),execute:async()=>{queries++;return {exit_code:0,stdout:`Id=${record.unit}\nLoadState=loaded\nActiveState=active\nSubState=running\nMainPID=76\nExecMainCode=0\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`};}};
 try{await fn({options,record,file,marker,intent,channel,queries:()=>queries});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('readiness binds native peer to unit guardian and fresh source before durable publication',()=>fixture(async f=>{
 const result=await readyRetirement(f.options),saved=JSON.parse(fs.readFileSync(f.file));assert.equal(saved.phase,'ready');assert.equal(saved.provider_identity.processes.guardian.pid,76);assert.equal(saved.unit_started_monotonic,'123');assert.equal(result.record.phase,'ready');assert.equal(result.provider.identity.worker_id,'d'.repeat(32));assert.equal(fs.existsSync(f.intent),false);assert.equal(fs.readFileSync(f.marker,'utf8'),id+'\n');
 await assert.rejects(readyRetirement(f.options));assert.equal(f.queries(),1);
}));
test('wrong unit guardian, process drift and source replacement retain pending ownership',async()=>{
 for(const mode of ['guardian','unit-failed','native-drift','source-drift','disconnect','unit-timeout'])await fixture(async f=>{
  const execute=f.options.execute;
  if(mode==='guardian'||mode==='unit-failed'||mode==='unit-timeout')f.options.execute=async()=>{const r=await execute();if(mode==='guardian')r.stdout=r.stdout.replace('MainPID=76','MainPID=88');if(mode==='unit-failed')r.stdout=r.stdout.replace('SubState=running','SubState=failed');if(mode==='unit-timeout')r.timed_out=true;return r;};
  let reads=0;f.channel.operation=async()=>{const value=info();if(++reads>1&&mode==='native-drift')value.processes.worker.start_ticks='999';if(reads>1&&mode==='disconnect')f.channel._conn=null;return value;};
  if(mode==='source-drift')f.options.confirmSource=async()=>({...source,worker_id:'e'.repeat(32),capabilities:['worker-process-identity-v1']});
  await assert.rejects(readyRetirement(f.options),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'submitted');assert.equal(fs.existsSync(f.intent),true);const count=f.queries();await assert.rejects(readyRetirement(f.options));assert.equal(f.queries(),count);
 });
});
test('changed ownership and unfinished readiness cannot be adopted',async()=>{
 for(const mode of ['marker','record','intent','symlink'])await fixture(async f=>{
  if(mode==='marker')fs.writeFileSync(f.marker,'f'.repeat(32)+'\n');
  if(mode==='record')fs.writeFileSync(f.file,JSON.stringify({...f.record,phase:'unknown'}));
  if(mode==='intent')fs.writeFileSync(f.intent,id+'\n',{mode:0o600});
  if(mode==='symlink'){fs.unlinkSync(f.marker);fs.symlinkSync(f.file,f.marker);}
  await assert.rejects(readyRetirement(f.options));assert.equal(f.queries(),0);
 });
});
test('journal changes during verification prevent readiness publication',()=>fixture(async f=>{
 f.options.confirmSource=async()=>{fs.writeFileSync(f.marker,'f'.repeat(32)+'\n');return {...source,capabilities:['worker-process-identity-v1']};};
 await assert.rejects(readyRetirement(f.options),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'submitted');assert.equal(fs.existsSync(f.intent),true);
}));
test('retirement unit inspector rejects observer namespace without executing',async()=>{
 let calls=0;await assert.rejects(inspectRetirementUnit({unit:'couchroot-observer-'+id+'.service',bootId:boot,execute:()=>{calls++;}}));assert.equal(calls,0);
});
test('failed readiness publication never returns a usable provider',()=>fixture(async f=>{
 const vm=require('node:vm'),{createRequire}=require('node:module'),file=path.resolve(__dirname,'../research/autonomous-root/service/retirement-readiness.js'),real=createRequire(file),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,require:name=>name==='./policy'?{atomic:()=>{throw Error('publication failed');}}:real(name)});
 await assert.rejects(module.exports.readyRetirement(f.options),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'submitted');assert.equal(fs.existsSync(f.intent),true);
}));
