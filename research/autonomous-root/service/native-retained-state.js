'use strict';
// Read a stopped production worker's records for managed rollback. No mutation.
const {hash}=require('./policy');
const {validateRuntimeLaunch}=require('./production-readiness');
const {processIdentities,processAbsenceGuard}=require('./worker-processes');
const {metadataCommand,parseMetadata,metadataGuard,validateMetadata}=require('./native-restart-metadata');
const {validateRecord,parseManifest,sourceExitGuard}=require('./retained-state');
const {eligible,inspectStartupJournal,checkpointGuard}=require('./native-startup-journal');
function check(ok){if(!ok)throw Error('Native rollback snapshot unavailable');}
function planNativeSnapshot(record,installation,guardianSha256=null,metadata=[],checkpoint=null,bootId=record.boot_id){
 check(guardianSha256===null||/^[a-f0-9]{64}$/.test(guardianSha256));
 check(record&&record.phase==='ready');const {worker_identity,unit_started_monotonic,...launch}=record;validateRuntimeLaunch({...launch,phase:'submitted'});
 check(typeof unit_started_monotonic==='string'&&/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic)&&unit_started_monotonic.trim()===unit_started_monotonic);
 check(worker_identity&&worker_identity.processes&&worker_identity.processes.guardian&&worker_identity.boot_id===record.boot_id);
 check(JSON.stringify(processIdentities({...worker_identity,implementation:'native-prototype',guardian_pid:worker_identity.processes.guardian.pid,capabilities:['worker-process-identity-v1']},worker_identity.processes.worker.pid))===JSON.stringify(worker_identity));
 check(Object.values(worker_identity.processes).every(p=>p.pid>1));
 check(installation&&installation.schema===1&&installation.phase==='ready'&&installation.id===record.id&&installation.directory===record.directory&&installation.scope===record.scope&&installation.manifest_sha256===record.manifest_sha256&&JSON.stringify(installation.source)===JSON.stringify(record.source)&&hash(JSON.stringify(installation))===record.state_receipt_sha256);
 check(typeof installation.installed_manifest_sha256==='string'&&installation.installed_manifest_sha256.length===64&&/^[a-f0-9]+$/.test(installation.installed_manifest_sha256));
 const root=record.scope+'/.jobs';
 const guard=sourceExitGuard(record.source,bootId)+Object.values(worker_identity.processes).map(p=>processAbsenceGuard(p,worker_identity.boot_id,bootId)).join('')+(checkpoint?checkpoint.guard:'');
 const linked=metadata.filter(e=>e.links===2).map(e=>root+'/'+e.id+'.json');
 const fileGuard=p=>'test -f '+p+'; test ! -L '+p+'; '+(linked.length?'case '+p+' in '+linked.join('|')+') test "$(stat -c "%u:%h:%a" '+p+')" = 0:2:600;; *) test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:600;; esac\n':'test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:600\n');
 const binding='set -eu\nPATH=/usr/bin:/bin\nexport PATH\n'+guard+
  [record.directory,record.scope,root].map(p=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n').join('')+
  fileGuard(root+'/lock')+'test "$(stat -c %s '+root+'/lock)" -eq 0\n'+fileGuard(root+'/.import-manifest')+'test "$(sha256sum '+root+'/.import-manifest | cut -d " " -f1)" = '+installation.installed_manifest_sha256+'\n';
 const prefix=binding+(checkpoint?checkpointGuard(root,checkpoint):(guardianSha256===null?'test ! -e '+root+'/guardian; test ! -L '+root+'/guardian\n':fileGuard(root+'/guardian')+'test "$(sha256sum '+root+'/guardian | cut -d " " -f1)" = '+guardianSha256+'\n'))+metadataGuard(root,metadata);
 const journalNames=checkpoint?checkpoint.files.map(e=>e.name):guardianSha256?['guardian']:[];
 const manifest=prefix+'listing=$(find '+root+' -mindepth 1 -maxdepth 1 ! -name lock ! -name .import-manifest '+journalNames.map(n=>'! -name '+n+' ').join('')+metadata.map(e=>'! -name '+e.name+' ').join('')+'-print)\nif test -n "$listing"; then printf "%s\\n" "$listing" | (count=0; while IFS= read -r file; do\ncount=$((count+1)); test "$count" -le 64\nname=${file##*/}; id=${name%.json}; test "$name" != "$id"\ncase "$id" in *[!a-zA-Z0-9-]*) exit 1;; esac\ntest "${#id}" -ge 16; test "${#id}" -le 64\n'+fileGuard('"$file"')+'size=$(stat -c %s "$file"); test "$size" -ge 1; test "$size" -lt 2048\nsum=$(sha256sum "$file"); printf "%s %s %s\\n" "$name" "$size" "${sum%% *}"\ndone)\nfi\n'+guard+'printf "SNAPSHOT-END\\n"\n';
 return {root,guard,binding,prefix,manifest,fileGuard,journalNames};
}
async function snapshotWithPlan({record,execute},plan){
 check(typeof execute==='function');const started=process.hrtime();
 const run=async command=>{const r=await execute(command,5000),t=process.hrtime(started);check(t[0]*1000+t[1]/1000000<60000&&r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string'&&r.stdout.length<=12000);return r.stdout;};
 const before=parseManifest(await run(plan.manifest)),records=[];
 for(const entry of before){
  const file=plan.root+'/'+entry.name,command=plan.prefix+plan.fileGuard(file)+'test "$(stat -c %s '+file+')" -eq '+entry.size+'\ntest "$(sha256sum '+file+' | cut -d " " -f1)" = '+entry.sha256+'\nbase64 '+file+'\n'+plan.guard;
  const compact=(await run(command)).replace(/\n/g,'');check(/^[A-Za-z0-9+/]+={0,2}$/.test(compact));const bytes=Buffer.from(compact,'base64');check(bytes.toString('base64')===compact&&bytes.length===entry.size&&hash(bytes)===entry.sha256);validateRecord(entry.name,bytes);records.push({...entry,base64:compact});
 }
 check(JSON.stringify(parseManifest(await run(plan.manifest)))===JSON.stringify(before));
 const value={schema:1,implementation:'native-prototype',source:JSON.parse(JSON.stringify(record.worker_identity)),origin:{transaction_id:record.id,manifest_sha256:record.manifest_sha256,installation_sha256:record.state_receipt_sha256},records};
 return {...value,sha256:hash(JSON.stringify(value))};
}
async function snapshotNativeJobs(options){return snapshotWithPlan(options,planNativeSnapshot(options.record,options.installation,null,[],null,options.bootId===undefined?options.record.boot_id:options.bootId));}
// Selected-native restart is different from export to managed: the ordinary
// native binary owns reconciliation of an unclean guardian journal. Admit only
// a complete journal bound to this last accepted runtime; never remove it here.
// Every read pins its digest and any supported persistence debris. Unknown
// metadata and incomplete guardian ownership still hold admission.
async function snapshotNativeRestartJobs(options){
 const {record,installation,execute}=options,bootId=options.bootId===undefined?record.boot_id:options.bootId,plan=planNativeSnapshot(record,installation,null,[],null,bootId),file=plan.root+'/guardian';
 const command=plan.binding+'if test -e '+file+' || test -L '+file+'; then\n'+plan.fileGuard(file)+'size=$(stat -c %s '+file+'); test "$size" -gt 0; test "$size" -lt 4096\nbase64 '+file+'\nelse printf "ABSENT\\n"; fi\n'+plan.guard;
 const r=await execute(command,5000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string'&&r.stdout.length<6000);
 let digest=null,checkpoint=null;
 if(r.stdout!=='ABSENT\n'){
  const compact=r.stdout.replace(/\n/g,''),bytes=Buffer.from(compact,'base64');check(bytes.toString('base64')===compact);
  const journal=JSON.parse(bytes.toString('utf8')),identity=record.worker_identity;
  const accepted=journal.schema===4&&journal.phase==='ready'&&journal.prepared===true&&journal.worker_id===identity.worker_id&&journal.boot_id===identity.boot_id&&journal.pid===identity.processes.guardian.pid&&journal.process_start===identity.processes.guardian.start_ticks;
  if(accepted)digest=hash(bytes);
  else {check(eligible(options.attempt,record));checkpoint=await inspectStartupJournal(options,plan);check(checkpoint);}
 }else if(eligible(options.attempt,record))checkpoint=await inspectStartupJournal(options,plan);
 if(checkpoint){const base=checkpoint.files.find(e=>e.name==='guardian');digest=base?base.sha256:null;}
 let metadata=[];
 if(digest||checkpoint){
  const result=await execute(metadataCommand(planNativeSnapshot(record,installation,digest,[],checkpoint,bootId)),5000);
  check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr);metadata=parseMetadata(result.stdout,record.worker_identity.worker_id);
  // No public job or command can have run in an unaccepted startup. Its only
  // admissible unfinished metadata is the native startup checkpoint itself.
  check(!checkpoint||!metadata.length);
 }
 const snapshot=await snapshotWithPlan(options,planNativeSnapshot(record,installation,digest,metadata,checkpoint,bootId));validateMetadata(metadata,snapshot);
 if(checkpoint&&checkpoint.owner)check(snapshot.records.every(e=>JSON.parse(Buffer.from(e.base64,'base64').toString('utf8').replace(/^\uFEFF/,'' )).worker_id!==checkpoint.owner));
 return {snapshot,guardian_sha256:digest,metadata,reconciliation_required:!!(digest||checkpoint),reconciliation_worker_id:checkpoint?checkpoint.owner:record.worker_identity.worker_id,checkpoint_files:checkpoint?checkpoint.files.filter(e=>e.name!=='guardian'):[]};
}
module.exports={snapshotNativeJobs,snapshotNativeRestartJobs,planNativeSnapshot};
