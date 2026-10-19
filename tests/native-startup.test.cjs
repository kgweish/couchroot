'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection'),{hash}=require('../research/autonomous-root/service/policy');
const {startupCandidate,launchCommand}=require('../research/autonomous-root/service/native-startup'),{readRuntime}=require('../research/autonomous-root/service/native-runtime');
function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-startup-')),file=dir+'/selection.json',j=new SelectionJournal(file),sha='b'.repeat(64),boot='00000000-0000-0000-0000-000000000001';
 j.initialize({implementation:'managed',manifest_sha256:'a'.repeat(64)});const id=j.begin(1,{implementation:'native-prototype',manifest_sha256:sha},sha).pending.id;
 const source={boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}},identity={boot_id:boot,worker_id:'e'.repeat(32),processes:{worker:{pid:87,start_ticks:'300'},guardian:{pid:86,start_ticks:'299'}}},installation={phase:'ready'};
 const record={schema:1,id,phase:'ready',device:'s90d',manifest_sha256:sha,state_receipt_sha256:hash(JSON.stringify(installation)),worker_sha256:sha,launcher_sha256:sha,source,boot_id:boot,unit:'couchroot-worker-'+id+'.service',directory:'/opt/couchroot-worker-'+id,scope:'/opt/couchroot-worker-'+id+'/state',port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',token_sha256:sha,worker_identity:identity,unit_started_monotonic:'123'};
 const activation={schema:1,id,phase:'active',boot_id:boot,manifest_sha256:sha,readiness_sha256:hash(JSON.stringify(record)),retirement_sha256:sha,worker_identity:identity};
 const write=(name,value)=>fs.writeFileSync(dir+'/'+name,JSON.stringify(value),{mode:0o600});
 write(id+'.production.json',record);write(id+'.activation.json',activation);write(id+'.state-install.json',installation);
 j.advance(2,id,'state-ready',record.state_receipt_sha256);j.advance(3,id,'trial-ready',activation.readiness_sha256);j.commit(4,id);
 try{run({dir,file,id,j,record,activation,write});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('selected startup binds immutable commitment, activation and state',()=>fixture(f=>{assert.equal(startupCandidate(f.file).record.id,f.id);const before=fs.readFileSync(f.file);assert.equal(startupCandidate(f.file).activation.readiness_sha256,f.activation.readiness_sha256);assert.deepEqual(fs.readFileSync(f.file),before);}));
test('replacement receipt changes only process identity and start time',()=>fixture(f=>{
 const next={...f.record,worker_identity:{...f.record.worker_identity,worker_id:'f'.repeat(32),processes:{worker:{pid:97,start_ticks:'400'},guardian:{pid:96,start_ticks:'399'}}},unit_started_monotonic:'456'};
 const receipt={schema:1,id:f.id,phase:'ready',readiness_sha256:f.activation.readiness_sha256,activation_sha256:hash(JSON.stringify(f.activation)),record:next};f.write(f.id+'.runtime.json',receipt);
 assert.deepEqual(startupCandidate(f.file).record,next);assert.equal(readRuntime(f.dir,f.id).readiness_sha256,f.activation.readiness_sha256);
 for(const key of ['directory','manifest_sha256','state_receipt_sha256','source']){f.write(f.id+'.runtime.json',{...receipt,record:{...next,[key]:key==='source'?{...next.source,worker_id:'0'.repeat(32)}:'bad'}});assert.throws(()=>startupCandidate(f.file));}
}));
test('startup rejects changed activation, state, commitment and pending mutations',()=>{
 for(const mode of ['activation','state','history','marker','writer'])fixture(f=>{
  if(mode==='activation')f.write(f.id+'.activation.json',{...f.activation,readiness_sha256:'0'.repeat(64)});
  if(mode==='state')f.write(f.id+'.state-install.json',{phase:'other'});
  if(mode==='history'){const s=f.j.read();s.history[0].readiness_sha256='0'.repeat(64);f.write('selection.json',s);}
  if(mode==='marker')f.write('managed-restore.pending',f.id);
  if(mode==='writer')f.write('selection.json.writer','unfinished');
  if(mode==='writer')assert.equal(startupCandidate(f.file),null);else assert.throws(()=>startupCandidate(f.file));
 });
});
test('restart launch has valid shell syntax and reuses only the committed scope',()=>fixture(f=>{
 const id='1'.repeat(32),a={id,port:12345,token_file:path.dirname(f.record.token_file)+'/restart-'+id,token_sha256:'a'.repeat(64)},command=launchCommand(f.record,a);
 assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);assert.match(command,/--production/);assert.match(command,/sha256sum/);assert.throws(()=>launchCommand(f.record,{...a,token_file:'/tmp/foreign'}));
}));

test('cross-boot runtime retains original commitment and activation without relabeling their source',()=>fixture(f=>{
 const boot='00000000-0000-0000-0000-000000000002';
 const next={...f.record,boot_id:boot,worker_identity:{...f.record.worker_identity,boot_id:boot,worker_id:'f'.repeat(32)},unit_started_monotonic:'456'};
 const receipt={schema:2,id:f.id,phase:'ready',readiness_sha256:f.activation.readiness_sha256,activation_sha256:hash(JSON.stringify(f.activation)),record:next};
 f.write(f.id+'.runtime.json',receipt);
 assert.deepEqual(startupCandidate(f.file).record,next);assert.deepEqual(readRuntime(f.dir,f.id).original,f.record);
 assert.equal(startupCandidate(f.file).activation.boot_id,f.record.boot_id);
 for(const invalid of [{...receipt,schema:1},{...receipt,record:{...next,worker_identity:{...next.worker_identity,boot_id:f.record.boot_id}}},{...receipt,record:{...next,source:{...next.source,boot_id:boot}}},{...receipt,record:f.record}]){
  f.write(f.id+'.runtime.json',invalid);assert.throws(()=>startupCandidate(f.file));
 }
 const {worker_identity,unit_started_monotonic,...launch}=next;
 assert.throws(()=>require('../research/autonomous-root/service/production-readiness').validateLaunch({...launch,phase:'submitted'}));
}));
