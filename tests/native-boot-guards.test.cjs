'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {bootGuard,processAbsenceGuard}=require('../research/autonomous-root/service/worker-processes');
const {eligible}=require('../research/autonomous-root/service/native-startup-journal');
const old='00000000-0000-0000-0000-000000000001',current='00000000-0000-0000-0000-000000000002';
test('old PID collision is excluded only by an explicit matching current boot',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'boot-guard-'));
 try{
  fs.writeFileSync(root+'/boot',current+'\n');fs.writeFileSync(root+'/stat','42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0\n');
  const run=command=>spawnSync('/bin/sh',[],{input:'set -eu\n'+command.replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot').replaceAll('/proc/42/stat',root+'/stat'),encoding:'utf8'}).status;
  const p={pid:42,start_ticks:'123'};
  assert.notEqual(run(processAbsenceGuard(p,old)),0);
  assert.notEqual(run(processAbsenceGuard(p,current)),0);
  assert.equal(run(processAbsenceGuard(p,old,current)),0);
  fs.writeFileSync(root+'/boot',old+'\n');assert.notEqual(run(processAbsenceGuard(p,old,current)),0);
  for(const bad of [null,old+'\n','bad'])assert.throws(()=>bootGuard(bad));
  for(const bad of [{pid:1,start_ticks:'1'},{pid:42,start_ticks:'1; true'}, {pid:42,start_ticks:'123',extra:1}])assert.throws(()=>processAbsenceGuard(bad,old,current));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('cross-boot checkpoint attempts bind the last accepted runtime and the new launch boot separately',()=>{
 const id='a'.repeat(32),record={id:'b'.repeat(32),boot_id:old,worker_identity:{worker_id:'c'.repeat(32)}};
 const attempt={schema:3,id,phase:'submitted',origin_id:record.id,boot_id:current,source_boot_id:old,source_worker_id:record.worker_identity.worker_id,token_sha256:'d'.repeat(64),fence:'/opt/couchroot-startup-fence-'+id};
 assert.equal(eligible(attempt,record),true);
 for(const changed of [{schema:2},{source_boot_id:current},{source_worker_id:'e'.repeat(32)},{boot_id:'bad'},{phase:'ready'},{origin_id:'e'.repeat(32)}])assert.equal(eligible({...attempt,...changed},record),false);
 assert.equal(eligible({...attempt,schema:2,boot_id:old},record),true);
});

test('managed return excludes current source PIDs but permits a historical source PID collision',()=>{
 const {managedIdentity}=require('../research/autonomous-root/service/managed-readiness');
 const info={boot_id:current,worker_id:'a'.repeat(32),uptime_seconds:1,capabilities:['file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1','worker-process-identity-v1','resource-inventory-v1'],app_launcher:{implementation:'native',sha256:'f'.repeat(64)},processes:{worker:{pid:42,start_ticks:'100'},guardian:null},resources:{schema:1,scope:'worker-owned',jobs:[],transfers:[],helpers:[]}};
 const peer={identity:{uid:0,euid:0,gid:0,egid:0,smack:'User',pid:42}},native={boot_id:current,worker_id:'b'.repeat(32),processes:{worker:{pid:52,start_ticks:'200'},guardian:{pid:51,start_ticks:'199'}}};
 const provider={boot_id:current,worker_id:'c'.repeat(32),processes:{worker:{pid:62,start_ticks:'300'},guardian:{pid:61,start_ticks:'299'}}};
 const original={boot_id:old,worker_id:'d'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}},record={boot_id:current,source:native};
 assert.equal(managedIdentity(info,peer,record,provider,original).worker_id,info.worker_id);
 assert.throws(()=>managedIdentity(info,peer,record,provider,{...original,boot_id:current}));
 assert.throws(()=>managedIdentity(info,peer,record,{...provider,processes:{...provider.processes,worker:{pid:42,start_ticks:'100'}}},original));
});
