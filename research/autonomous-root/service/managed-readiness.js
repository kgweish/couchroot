'use strict';
// Readiness is evidence only. The controller still owns admission and must
// retire the independent provider before committing/releasing managed service.
const fs=require('fs'),path=require('path');
const {hash,atomic}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {selectionStatus}=require('./worker-selection');
const {acceptManagedRestore}=require('./managed-restore');
const {planManagedRestore}=require('./managed-restore-plan');
const {validateRecord}=require('./retained-state');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const {processIdentities}=require('./worker-processes');
const {inspectManagedUnit}=require('./observer-unit');
const hex=(s,n)=>typeof s==='string'&&s.length===n&&/^[a-f0-9]+$/.test(s);
function check(ok){if(!ok)throw Error('Managed readiness evidence unavailable');}
function validateManagedLaunch(r){
 check(r&&Object.keys(r).sort().join('|')==='boot_id|directory|files|id|implementation|manifest_sha256|origin_id|phase|port|runtime_sha256|schema|source|stage|state_receipt_sha256|token_file|token_sha256|unit');
 check(r.schema===1&&r.phase==='submitted'&&r.implementation==='managed'&&hex(r.id,32)&&hex(r.origin_id,32));
 for(const key of ['manifest_sha256','runtime_sha256','state_receipt_sha256','token_sha256'])check(hex(r[key],64));
 check(r.directory==='/opt/couchroot-managed-'+r.id&&r.stage==='/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+r.id&&r.unit==='couchroot-managed-'+r.id+'.service');
 check(r.files&&Object.keys(r.files).sort().join('|')==='SamsungTvRootAgent.deps.json|SamsungTvRootAgent.dll|SamsungTvRootAgent.runtimeconfig.json'&&Object.values(r.files).every(h=>hex(h,64)));
 check(Number.isInteger(r.port)&&r.port>=1024&&r.port<=65535&&typeof r.token_file==='string'&&/^\/opt\/usr\/home\/owner\/apps_rw\/MiniRoot01\/data\/worker-state\/managed-[A-Za-z0-9]{6}\/token$/.test(r.token_file)&&!r.token_file.includes('\n'));
 const s=r.source;check(s&&s.processes&&s.processes.guardian&&s.boot_id===r.boot_id);
 check(JSON.stringify(processIdentities({...s,implementation:'native-prototype',guardian_pid:s.processes.guardian.pid,capabilities:['worker-process-identity-v1']},s.processes.worker.pid))===JSON.stringify(s));
}
function managedIdentity(info,peer,record,provider,original){
 // The shipped managed runtime reports User on both supported TVs.
 // Native production workers have a separate System-label contract.
 check(peer&&peer.identity&&['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)&&peer.identity.smack==='User');
 validateReadiness(info,{implementation:'managed',bootId:record.boot_id});
 const identity=processIdentities(info,peer.identity.pid),r=validateResourceInventory(info);
 check(!r.jobs.length&&!r.helpers.length&&!r.transfers.length&&identity.processes.worker.pid>1&&hex(identity.worker_id,32));
 check(provider&&provider.processes&&provider.processes.guardian&&provider.boot_id===record.boot_id);
 check(JSON.stringify(processIdentities({...provider,implementation:'native-prototype',guardian_pid:provider.processes.guardian.pid,capabilities:['worker-process-identity-v1']},provider.processes.worker.pid))===JSON.stringify(provider));
 for(const source of [record.source,provider,original])check(source.worker_id!==identity.worker_id&&(source.boot_id!==identity.boot_id||Object.values(source.processes).every(p=>!p||p.pid!==identity.processes.worker.pid)));
 return identity;
}
function managedRuntimeCommand(record,identity,inputs,launcherSha256){
 validateManagedLaunch(record);check(hex(launcherSha256,64));
 check(hex(identity.worker_id,32)&&JSON.stringify(processIdentities({...identity,capabilities:['worker-process-identity-v1']},identity.processes.worker.pid))===JSON.stringify(identity)&&identity.boot_id===record.boot_id&&identity.processes.worker.pid>1);
 const restore=planManagedRestore(inputs),pid=identity.processes.worker.pid,code=record.directory+'/code',launcher='/opt/couchroot-agent/launchers/'+identity.worker_id;
 const dir=p=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n';
 const file=(p,mode,h)=>'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\ntest "$(sha256sum '+p+' | cut -d " " -f1)" = '+h+'\n';
 const live='line=$(cat /proc/'+pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" = '+identity.processes.worker.start_ticks+'\n';
 const invocationStage='/home/owner/share/tmp/sdk_tools/managed-'+record.id;
 const argv=['/usr/bin/dotnet',code+'/SamsungTvRootAgent.dll','127.0.0.1',String(record.port),invocationStage+'/token',invocationStage].join('\0')+'\0';
 const command=restore.verify+"test '/home' -ef '/opt/usr/home'\n"+live+'test "$(readlink /proc/'+pid+'/exe)" = /usr/bin/dotnet\n'+
  'test "$(sha256sum /proc/'+pid+'/exe | cut -d " " -f1)" = '+record.runtime_sha256+'\n'+
  'test "$(sha256sum /proc/'+pid+'/cmdline | cut -d " " -f1)" = '+hash(argv)+'\n'+
  'test "$(readlink /proc/'+pid+'/ns/mnt)" != "$(readlink /proc/1/ns/mnt)"\n'+
  [code,launcher].map(p=>'awk \'$5 == "'+p+'" && $6 ~ /(^|,)ro(,|$)/ { found=1 } END { exit !found }\' /proc/'+pid+'/mountinfo\n').join('')+
  dir(record.directory)+dir(code)+dir(record.stage)+Object.keys(record.files).map(n=>file(code+'/'+n,'400',record.files[n])).join('')+
  dir('/opt/couchroot-agent/launchers')+dir(launcher)+file(launcher+'/app-launcher','500',launcherSha256)+
  'test ! -e '+record.stage+'/token; test ! -L '+record.stage+'/token\n'+live+'printf "MANAGED-VERIFIED\\n"\n';
 check(Buffer.byteLength(command)<=65536);return command;
}
async function readyManaged({record,journalDirectory,selectionFile,channel,execute,providerIdentity}){
 validateManagedLaunch(record);check(typeof execute==='function'&&typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&path.dirname(selectionFile)===journalDirectory);
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const file=path.join(journalDirectory,record.id+'.managed-launch.json'),marker=path.join(journalDirectory,'managed-launch.pending'),intent=file+'.readiness.pending';
 const saved=path.join(journalDirectory,record.id+'.managed-restore-input.json'),restored=path.join(journalDirectory,record.id+'.managed-restore.json'),restoreMarker=path.join(journalDirectory,'managed-restore.pending');
 const inputText=privateRead(saved,524288),restoreText=privateRead(restored,16384),inputs=JSON.parse(inputText),selected=selectionStatus(selectionFile),p=selected.pending;
 check(selected.phase==='reconciliation-required'&&p&&p.id===record.id&&['state-ready','rollback-state-ready'].includes(p.phase)&&p.state_sha256===record.state_receipt_sha256&&hash(restoreText)===record.state_receipt_sha256&&inputs.record.id===record.origin_id&&JSON.stringify(inputs.record.worker_identity)===JSON.stringify(record.source));
 const target=p.phase==='rollback-state-ready'?p.from:p.to;check(target.implementation==='managed'&&target.manifest_sha256===record.manifest_sha256);
 let serialized=JSON.stringify(record);
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selected)&&privateRead(file,16384)===serialized&&privateRead(marker,64)===record.id+'\n'&&privateRead(saved,524288)===inputText&&privateRead(restored,16384)===restoreText&&privateRead(restoreMarker,64)===record.id+'\n');};
 owned();await acceptManagedRestore({transitionId:record.id,receiptSha256:record.state_receipt_sha256,journalDirectory,selectionFile,execute});owned();
 const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,record.id+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};sync();
 const peer=channel&&channel._conn,started=process.hrtime();
 const current=()=>{const t=process.hrtime(started);check(t[0]*1000+t[1]/1000000<120000&&peer&&channel._conn===peer);owned();check(privateRead(intent,64)===record.id+'\n');};
 const op=async request=>{current();const r=await channel.operation(request);current();return r;};
 const run=async(c,t)=>{current();const r=await execute(c,t);current();return r;};
 try{
  const info=await op({op:'status'}),identity=managedIdentity(info,peer,record,providerIdentity,inputs.record.source),launcherSha=info.app_launcher.sha256;
  const unit=await inspectManagedUnit({unit:record.unit,bootId:record.boot_id,execute:run});
  check(unit.active_state==='active'&&unit.sub_state==='running'&&unit.main_pid===identity.processes.worker.pid&&unit.exec_code===0&&unit.exec_status===0&&/^[1-9][0-9]{0,19}$/.test(unit.started_monotonic));
  const command=managedRuntimeCommand(record,identity,inputs,launcherSha),verify=async()=>{const r=await run(command,25000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='RESTORE-READY\nMANAGED-VERIFIED\n');};
  await verify();
  for(const entry of inputs.snapshot.records){const saved=validateRecord(entry.name,Buffer.from(entry.base64,'base64')),r=await op({op:'job.status',id:saved.id}),terminal=['completed','cancelled','timed_out','interrupted'].includes(saved.state),state=terminal?saved.state:saved.boot_id===record.boot_id?'unknown':'interrupted';check(r&&r.id===saved.id&&r.boot_id===saved.boot_id&&r.state===state&&r.output_available===false&&JSON.stringify(r.record)===JSON.stringify(saved));}
  const after=await op({op:'status'});check(JSON.stringify(managedIdentity(after,peer,record,providerIdentity,inputs.record.source))===JSON.stringify(identity)&&after.app_launcher.sha256===launcherSha);
  check(JSON.stringify(await inspectManagedUnit({unit:record.unit,bootId:record.boot_id,execute:run}))===JSON.stringify(unit));await verify();current();
  const ready={...record,phase:'ready',worker_identity:identity,launcher_sha256:launcherSha,unit_started_monotonic:unit.started_monotonic};atomic(file,ready);serialized=JSON.stringify(ready);current();
  fs.unlinkSync(intent);sync();owned();check(channel._conn===peer);
  return Object.freeze({record:Object.freeze(ready),readiness_sha256:hash(serialized)});
 }catch(cause){throw Object.assign(Error('Managed readiness requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={readyManaged,validateManagedLaunch,managedIdentity,managedRuntimeCommand};
