'use strict';
// Reconcile only the stopped native state owned by a pending managed return.
// The original snapshot survives uncertain replies; no replacement job runs.
const fs=require('fs'),path=require('path');
const {privateRead}=require('./private-state');
const {atomic,hash}=require('./policy');
const {bootGuard}=require('./worker-processes');
const {snapshotNativeJobs,snapshotNativeRestartJobs,planNativeSnapshot}=require('./native-retained-state');
const {verifyRestartRecords,validateMetadata}=require('./native-restart-metadata');
const {validateRecord}=require('./retained-state');
const check=v=>{if(!v)throw Error('Native return recovery evidence unavailable');};
const hex=(v,n)=>typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v);
const q=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function present(p){try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function recoveryCommand(record,bootId,owner,digest){
 bootGuard(bootId);check(hex(owner,32)&&hex(digest,64));
 check(hex(record.id,32)&&['worker','retirement'].some(kind=>record.directory==='/opt/couchroot-'+kind+'-'+record.id)&&record.scope===record.directory+'/state'&&hex(record.worker_sha256,64));
 const code=record.directory+'/code',binary=code+'/worker';
 const prefix='set -eu\n'+bootGuard(bootId)+'test -d '+code+'; test ! -L '+code+'; test "$(stat -c "%u:%a" '+code+')" = 0:700\n'+
  'test -f '+binary+'; test ! -L '+binary+'; test "$(stat -c "%u:%h:%a" '+binary+')" = 0:1:500\n'+
  'test "$(sha256sum '+binary+' | cut -d " " -f1)" = '+record.worker_sha256+'\n';
 const inner='set -eu\nmount --make-rprivate /\n! grep -q " shared:" /proc/self/mountinfo\nmount --bind '+code+' '+code+'\nmount -o remount,bind,ro '+code+'\nexec '+binary+' --reconcile-state '+record.scope+' '+bootId+' '+owner+' '+digest+'\n';
 return prefix+'/usr/bin/unshare -m /bin/sh -c '+q(inner)+'\n';
}
async function run(execute,command){const r=await execute(command,25000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string');return r.stdout;}
async function journalDigest(execute,prefix,scope){
 const file=scope+'/.jobs/guardian';
 const result=await run(execute,prefix+'if test -e '+file+' || test -L '+file+'; then\ntest -f '+file+'; test ! -L '+file+'; test "$(stat -c "%u:%h:%a" '+file+')" = 0:1:600\nsha256sum '+file+' | cut -d " " -f1\nelse printf "ABSENT\\n"; fi\n');
 check(result==='ABSENT\n'||/^[a-f0-9]{64}\n$/.test(result));return result==='ABSENT\n'?null:result.trim();
}
async function recoverReturnNative({directory,id,record,installation,execute,bootId}){
 const file=path.join(directory,id+'.return-native-recovery.json'),binding=hash(JSON.stringify({record,installation}));let intent;
 if(present(file)){
  intent=JSON.parse(privateRead(file,524288));check(intent.schema===1&&intent.id===id&&intent.origin_id===record.id&&intent.binding_sha256===binding&&['prepared','complete'].includes(intent.phase)&&Array.isArray(intent.recovery_boot_ids)&&intent.recovery_boot_ids.length<=8);
  for(const boot of intent.recovery_boot_ids)bootGuard(boot);
 }else{
  const retained=await snapshotNativeRestartJobs({record,installation,execute,bootId});
  check(!retained.checkpoint_files.length&&retained.reconciliation_worker_id===record.worker_identity.worker_id);
  intent={schema:1,id,origin_id:record.id,binding_sha256:binding,phase:'prepared',retained,recovery_boot_ids:[]};atomic(file,intent);
 }
 const retained=intent.retained,saved=retained.snapshot,{sha256,...body}=saved;
 check(saved.schema===1&&saved.implementation==='native-prototype'&&sha256===hash(JSON.stringify(body))&&JSON.stringify(saved.source)===JSON.stringify(record.worker_identity)&&JSON.stringify(saved.origin)===JSON.stringify({transaction_id:record.id,manifest_sha256:record.manifest_sha256,installation_sha256:record.state_receipt_sha256}));
 check(retained.reconciliation_worker_id===record.worker_identity.worker_id&&Array.isArray(retained.checkpoint_files)&&!retained.checkpoint_files.length&&Array.isArray(saved.records)&&saved.records.length<=64);
 let previous='';for(const entry of saved.records){const bytes=Buffer.from(entry.base64,'base64');check(entry.name>previous&&bytes.toString('base64')===entry.base64&&bytes.length===entry.size&&hash(bytes)===entry.sha256);validateRecord(entry.name,bytes);previous=entry.name;}
 validateMetadata(retained.metadata,saved);
 const prefix=planNativeSnapshot(record,installation,null,[],null,bootId).binding;
 const digest=await journalDigest(execute,prefix,record.scope);
 if(digest){
  check(intent.phase==='prepared'&&digest===intent.retained.guardian_sha256);
  if(!intent.recovery_boot_ids.includes(bootId)){check(intent.recovery_boot_ids.length<8);intent.recovery_boot_ids.push(bootId);atomic(file,intent);}
  check(await run(execute,recoveryCommand(record,bootId,record.worker_identity.worker_id,digest))==='NATIVE-STATE-RECONCILED\n');
 }
 const snapshot=await snapshotNativeJobs({record,installation,execute,bootId}),records=new Map(snapshot.records.map(e=>[e.name.slice(0,-5),JSON.parse(Buffer.from(e.base64,'base64').toString('utf8').replace(/^\uFEFF/,''))]));
 const channel={operation:async request=>{check(request.op==='job.status');return {record:records.get(request.id),output_available:false};}};
 await verifyRestartRecords({retained:intent.retained,record,channel,execute,bootId,recoveryBootIds:intent.recovery_boot_ids.length?intent.recovery_boot_ids:[bootId]});
 if(intent.phase==='complete')check(intent.snapshot_sha256===snapshot.sha256);
 else atomic(file,{...intent,phase:'complete',snapshot_sha256:snapshot.sha256});
 return snapshot;
}
// Return providers never accept public jobs. A residual journal is bound to the
// recorded startup token and boot, even if readiness was never published.
async function recoverReturnProvider({directory,id,provider,execute,bootId}){
 const scope=provider.scope,jobs=scope+'/.jobs',file=path.join(directory,id+'.return-provider-recovery.json');
 bootGuard(provider.boot_id);check(hex(provider.id,32)&&hex(provider.token_sha256,64)&&provider.directory==='/opt/couchroot-retirement-'+provider.id&&scope===provider.directory+'/state');
 const prefix='set -eu\n'+bootGuard(bootId);
 const exists=await run(execute,prefix+'if test -e '+jobs+' || test -L '+jobs+'; then test -d '+jobs+'; test ! -L '+jobs+'; test "$(stat -c "%u:%a" '+jobs+')" = 0:700; printf "PRESENT\\n"; else printf "ABSENT\\n"; fi\n');
 check(['PRESENT\n','ABSENT\n'].includes(exists));if(exists==='ABSENT\n')return;
 const inventory='find '+jobs+' -mindepth 1 -maxdepth 1 | while IFS= read -r entry; do case "$entry" in '+jobs+'/lock|'+jobs+'/guardian) ;; *) exit 1;; esac; done\n';
 check(await run(execute,prefix+inventory)==='');
 const digest=await journalDigest(execute,prefix,scope);if(!digest)return;
 const raw=await run(execute,prefix+'base64 '+jobs+'/guardian\n'),bytes=Buffer.from(raw.replace(/\n/g,''),'base64');check(hash(bytes)===digest);
 const journal=JSON.parse(bytes.toString('utf8'));check(journal.schema===4&&journal.boot_id===provider.boot_id&&journal.startup_token_sha256===provider.token_sha256&&hex(journal.worker_id,32));
 if(provider.provider_identity)check(journal.worker_id===provider.provider_identity.worker_id);
 const intent={schema:1,id,provider_sha256:hash(JSON.stringify(provider)),journal_sha256:digest,owner:journal.worker_id};
 if(present(file))check(privateRead(file,16384)===JSON.stringify(intent));else atomic(file,intent);
 check(await run(execute,recoveryCommand(provider,bootId,journal.worker_id,digest))==='NATIVE-STATE-RECONCILED\n');
 check(await journalDigest(execute,prefix,scope)===null);check(await run(execute,prefix+inventory)==='');
}
module.exports={recoverReturnNative,recoverReturnProvider,recoveryCommand};
