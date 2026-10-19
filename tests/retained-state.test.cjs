const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {snapshotManagedJobs,validateRecord,manifestCommand}=require('../research/autonomous-root/service/retained-state');
const boot='00000000-0000-0000-0000-000000000001',source={boot_id:boot,worker_id:'a'.repeat(32),processes:{worker:{pid:42,start_ticks:'123'},guardian:null}},name='retained-job-0001.json';
const bytes=Buffer.from(JSON.stringify({id:name.slice(0,-5),boot_id:boot,state:'completed',pid:0,exit_code:7,process_start:null})),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=()=>`${name} ${bytes.length} ${hash(bytes)}\nSNAPSHOT-END\n`;
test('record validation preserves supported legacy fields and rejects ambiguous identities',()=>{
 assert.equal(validateRecord(name,bytes).exit_code,7);
 for(const data of [bytes.toString().replace('"pid":0','"pid":0.0'),bytes.toString().replace('"pid":0','"pid":0e0'),bytes.toString().replace('"pid":0','"pid":false'),bytes.toString().replace('"pid":0','"pid":0,"p\\u0069d":0'),bytes.toString().replace('"pid":0','"pid":-1'),bytes.toString().replace('"pid":0','"pid":2147483648'),bytes.toString().replace('"pid":0','"extra":{"a":1,"a":2}'),bytes.toString()+' {}','{}','[]',bytes.toString()+'\0'])assert.throws(()=>validateRecord(name,Buffer.from(data)));
 assert.throws(()=>validateRecord('retained-job-0001\n.json',bytes));
 const metadata=JSON.parse(bytes);metadata.extra={value:'brackets {} [] and escaped " quote',array:[1,{x:true}]};assert.deepEqual(validateRecord(name,Buffer.from(JSON.stringify(metadata))),metadata);
});
test('snapshot reads bounded records and rechecks the complete manifest',async()=>{
 const commands=[];const result=await snapshotManagedJobs({source,execute:async command=>{commands.push(command);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);return {exit_code:0,stdout:command.includes('SNAPSHOT-END')?manifest():bytes.toString('base64')+'\n'};}});
 assert.equal(commands.length,3);assert.equal(result.records[0].base64,bytes.toString('base64'));assert.equal(result.records[0].sha256,hash(bytes));const {sha256,...record}=result;assert.equal(sha256,hash(Buffer.from(JSON.stringify(record))));
 assert.ok(commands.every(c=>c.includes('/proc/42/stat')));
});
test('changed files, manifests and uncertain transport never produce a snapshot',async()=>{
 for(const mode of ['hash','manifest','exit','stderr','timeout','base64']){
  let manifests=0;
  await assert.rejects(snapshotManagedJobs({source,execute:async command=>{
   if(command.includes('SNAPSHOT-END'))return {exit_code:0,stdout:++manifests>1&&mode==='manifest'?'SNAPSHOT-END\n':manifest()};
   return {exit_code:mode==='exit'?1:0,stderr:mode==='stderr'?'warning':'',timed_out:mode==='timeout',stdout:mode==='hash'?'eA==\n':mode==='base64'?bytes.toString('base64')+'!!!':bytes.toString('base64')+'\n'};
  }}));
 }
});
test('invalid and oversized listings fail before any record read',async()=>{
 for(const output of [manifest()+manifest(),manifest().replace(name,'../'+name),Array(65).fill(manifest().split('\n')[0]).join('\n')+'\nSNAPSHOT-END\n',manifest().replace(' '+bytes.length+' ',' 2048 '),manifest().replace('SNAPSHOT-END','incomplete')]){
  let calls=0;await assert.rejects(snapshotManagedJobs({source,execute:async()=>{calls++;return {exit_code:0,stdout:output};}}));assert.equal(calls,1);
 }
});
test('snapshot shell refuses live source, links, permissions and unfinished entries',{skip:!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0},async()=>{
 for(const mode of ['record','empty','absent','live','reused','symlink','permissions','pending','overflow']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retained-snapshot-')),base=root+'/agent',jobs=base+'/jobs';
  try{
   fs.mkdirSync(base,{mode:0o700});if(mode!=='absent')fs.mkdirSync(jobs,{mode:0o700});
   fs.writeFileSync(root+'/boot',boot+'\n');fs.mkdirSync(root+'/proc');
   if(!['absent','empty'].includes(mode))fs.writeFileSync(jobs+'/'+name,bytes,{mode:0o600});
   if(mode==='live'||mode==='reused'){fs.mkdirSync(root+'/proc/42');fs.writeFileSync(root+'/proc/42/stat','42 (worker) S '+Array(18).fill('0').join(' ')+' '+(mode==='live'?'123':'124')+' 0\n');}
   if(mode==='symlink'){fs.unlinkSync(jobs+'/'+name);fs.symlinkSync(root+'/boot',jobs+'/'+name);}
   if(mode==='permissions')fs.chmodSync(jobs+'/'+name,0o644);
   if(mode==='pending')fs.writeFileSync(jobs+'/.import-pending','unknown',{mode:0o600});
   if(mode==='overflow')for(let i=0;i<65;i++)fs.writeFileSync(jobs+'/retained-extra-'+String(i).padStart(4,'0')+'.json',bytes,{mode:0o600});
   let calls=0;
   const operation=snapshotManagedJobs({source,execute:async command=>{calls++;const script=command.replaceAll('/opt/couchroot-agent',base).replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot').replaceAll('/proc/42/stat',root+'/proc/42/stat');const r=spawnSync('/bin/sh',[],{input:script,encoding:'utf8'});return {exit_code:r.status,stdout:r.stdout,stderr:r.stderr};}});
   if(['record','empty','absent','reused'].includes(mode)){const r=await operation;assert.equal(r.records.length,['empty','absent'].includes(mode)?0:1);if(r.records.length)assert.equal(Buffer.from(r.records[0].base64,'base64').equals(bytes),true);}
   else{await assert.rejects(operation);assert.equal(calls,1);}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
