'use strict';
// Synthetic historical boot for the disposable restart integration fixture.
// This rewrites only fixture receipts before the system under test restarts;
// subsequent assertions require those original receipts to remain immutable.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function historicalBoot(state,id){
 const read=name=>JSON.parse(fs.readFileSync(state+'/'+name));
 const write=(name,value)=>fs.writeFileSync(state+'/'+name,JSON.stringify(value),{mode:0o600});
 const boot='00000000-0000-0000-0000-000000000001',record=read(id+'.production.json');
 if(record.boot_id===boot)throw Error('Synthetic historical boot must differ');
 const stat=fs.readFileSync('/proc/self/stat','utf8'),ticks=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];
 const source={...record.source,boot_id:boot,processes:{worker:{pid:process.pid,start_ticks:ticks},guardian:null}};
 const snapshot=read(id+'.retained-snapshot.json');snapshot.source=source;delete snapshot.sha256;snapshot.sha256=hash(JSON.stringify(snapshot));write(id+'.retained-snapshot.json',snapshot);
 const installation=read(id+'.state-install.json');installation.source=source;installation.snapshot_sha256=snapshot.sha256;write(id+'.state-install.json',installation);
 record.source=source;record.boot_id=boot;record.state_receipt_sha256=hash(JSON.stringify(installation));record.worker_identity.boot_id=boot;
 record.worker_identity.processes.guardian={pid:process.pid,start_ticks:ticks};write(id+'.production.json',record);
 const activation=read(id+'.activation.json');activation.boot_id=boot;activation.worker_identity=record.worker_identity;activation.readiness_sha256=hash(JSON.stringify(record));write(id+'.activation.json',activation);
 const selection=read('selection.json'),entry=selection.history.find(e=>e.id===id);entry.readiness_sha256=activation.readiness_sha256;entry.state_sha256=record.state_receipt_sha256;write('selection.json',selection);
 const journalFile=record.scope+'/.jobs/guardian';if(fs.existsSync(journalFile)){const journal=JSON.parse(fs.readFileSync(journalFile));journal.boot_id=boot;journal.pid=process.pid;journal.process_start=ticks;fs.writeFileSync(journalFile,JSON.stringify(journal));}
 const live=record.scope+'/.jobs/native-live-00001.json';if(fs.existsSync(live)){const job=JSON.parse(fs.readFileSync(live));job.boot_id=boot;fs.writeFileSync(live,JSON.stringify(job));}
 return {record,committed:fs.readFileSync(state+'/'+id+'.production.json'),activation:fs.readFileSync(state+'/'+id+'.activation.json'),history:JSON.stringify(selection.history)};
}
// Model a fenced bootstrap whose authenticated readiness was persisted on the
// previous boot. Real filesystem cleanup runs during the coordinator recovery;
// this fixture does not claim a kernel reboot or a live previous-boot process.
function historicalBootstrap(state,record){
 const id=crypto.randomBytes(8).toString('hex').repeat(2),directory='/opt/couchroot-bootstrap-'+id,scope=directory+'/state',fence='/opt/couchroot-bootstrap-fence-'+id;
 for(const p of [directory,directory+'/code',scope,scope+'/.jobs',fence])fs.mkdirSync(p,{mode:0o700});
 const copy=(from,to,mode)=>{fs.copyFileSync(from,to);fs.chmodSync(to,mode);};
 copy(record.directory+'/code/worker',directory+'/code/worker',0o500);copy(record.scope+'/launcher',scope+'/launcher',0o400);
 fs.writeFileSync(scope+'/.jobs/lock','',{mode:0o600});fs.writeFileSync(scope+'/token','historical bootstrap token\n',{mode:0o600});
 fs.writeFileSync(fence+'/lock','',{mode:0o600});fs.writeFileSync(fence+'/started',id+'\n',{mode:0o600});
 const result={schema:2,id,phase:'ready',boot_id:record.boot_id,directory,scope,unit:'couchroot-bootstrap-'+id+'.service',fence,file:state+'/'+id+'.bootstrap.json',selection_sha256:hash(fs.readFileSync(state+'/selection.json')),worker_sha256:record.worker_sha256,launcher_sha256:record.launcher_sha256,token_sha256:hash(fs.readFileSync(scope+'/token')),worker_identity:{...record.worker_identity,worker_id:crypto.randomBytes(16).toString('hex')},unit_started_monotonic:'123'};
 fs.writeFileSync(result.file,JSON.stringify(result),{mode:0o600});fs.symlinkSync(id+'.bootstrap.json',state+'/bootstrap-launch.pending');return result;
}

function historicalReturn(state,id,returnId,{cutover=false}={}){
 const historical=historicalBoot(state,id),record=historical.record,boot=record.boot_id;
 const read=name=>JSON.parse(fs.readFileSync(state+'/'+name)),write=(name,value)=>fs.writeFileSync(state+'/'+name,JSON.stringify(value),{mode:0o600});
 const rid=require('../research/autonomous-root/service/restart-inventory').providerId(returnId),providerFile=rid+'.retirement.json';
 if(fs.existsSync(state+'/'+providerFile)){
  const p=read(providerFile);p.boot_id=boot;p.source=record.worker_identity;
  if(p.provider_identity)p.provider_identity.boot_id=boot;write(providerFile,p);
  const file=p.scope+'/.jobs/guardian';if(fs.existsSync(file)){const j=JSON.parse(fs.readFileSync(file));j.boot_id=boot;fs.writeFileSync(file,JSON.stringify(j));}
 }
 const inputFile=returnId+'.managed-restore-input.json',selection=read('selection.json');
 if(cutover){fs.renameSync('/opt/couchroot-agent/jobs','/opt/couchroot-agent/rollback-'+id+'/next');selection.pending.phase='prepared';selection.pending.state_sha256=null;selection.pending.readiness_sha256=null;}
 if(fs.existsSync(state+'/'+inputFile)){
  const inputs=read(inputFile);inputs.record=record;inputs.installation=read(id+'.state-install.json');inputs.baseline=read(id+'.retained-snapshot.json');
  inputs.snapshot.source=record.worker_identity;inputs.snapshot.origin.installation_sha256=record.state_receipt_sha256;delete inputs.snapshot.sha256;inputs.snapshot.sha256=hash(JSON.stringify(inputs.snapshot));write(inputFile,inputs);
  const receipt=read(returnId+'.managed-restore.json'),plan=require('../research/autonomous-root/service/managed-restore-plan').planManagedRestore(inputs);
  Object.assign(receipt,plan.receipt,{phase:cutover?'pending':receipt.phase,input_sha256:hash(JSON.stringify(inputs))});write(returnId+'.managed-restore.json',receipt);if(selection.pending.phase!=='prepared')selection.pending.state_sha256=hash(JSON.stringify(receipt));
  fs.writeFileSync(plan.receipt.directory+'/manifest',JSON.stringify(plan.receipt));
  const launchFile=returnId+'.managed-launch.json';if(fs.existsSync(state+'/'+launchFile)){
   const r=read(launchFile);r.boot_id=boot;r.source=record.worker_identity;r.state_receipt_sha256=selection.pending.state_sha256;
   if(r.worker_identity)r.worker_identity.boot_id=boot;write(launchFile,r);if(selection.pending.phase==='trial-ready')selection.pending.readiness_sha256=hash(JSON.stringify(r));
  }
 }
 write('selection.json',selection);return historical;
}
module.exports={historicalBoot,historicalBootstrap,historicalReturn};
