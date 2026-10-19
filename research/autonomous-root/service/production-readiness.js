'use strict';
// Observe a submitted production peer; keep admission and selection pending.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {atomic}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {selectionStatus,SelectionJournal}=require('./worker-selection');
const {planInstallation}=require('./retained-install');
const {sourceExitGuard,validateRecord}=require('./retained-state');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const {processIdentities,bootGuard}=require('./worker-processes');
const {inspectProductionUnit}=require('./observer-unit');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const hex=(v,n)=>typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v);
function check(ok){if(!ok)throw Error('Production readiness evidence unavailable');}
function validateLaunch(record){validateLaunchFields(record,false);}
// Effective runtime records retain the original managed source while binding
// the current native processes to a later boot. Initial launches stay strict.
function validateRuntimeLaunch(record){validateLaunchFields(record,true);}
function validateLaunchFields(record,runtime){
 check(record&&Object.keys(record).sort().join('|')==='boot_id|device|directory|id|launcher_sha256|manifest_sha256|phase|port|schema|scope|source|state_receipt_sha256|token_file|token_sha256|unit|worker_sha256');
 check(record.schema===1&&record.phase==='submitted'&&hex(record.id,32)&&['s90d','qn90a'].includes(record.device));
 for(const k of ['manifest_sha256','state_receipt_sha256','token_sha256','worker_sha256','launcher_sha256'])check(hex(record[k],64));
 check(record.directory==='/opt/couchroot-worker-'+record.id&&record.scope===record.directory+'/state'&&record.unit==='couchroot-worker-'+record.id+'.service');
 sourceExitGuard(record.source);bootGuard(record.boot_id);check(runtime||record.boot_id===record.source.boot_id);
 check(Number.isInteger(record.port)&&record.port>=1024&&record.port<=65535&&typeof record.token_file==='string'&&/^\/opt\/usr\/home\/owner\/apps_rw\/MiniRoot01\/data\/worker-state\/production-[a-zA-Z0-9]{6}\/token$/.test(record.token_file)&&!record.token_file.includes('\n'));
}
function productionIdentity(info,peer,record,provider){
 check(peer&&peer.identity&&['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)&&peer.identity.smack==='System');
 validateReadiness(info,{implementation:'native-prototype',bootId:record.boot_id,launcherSha256:record.launcher_sha256});
 const identity=processIdentities(info,peer.identity.pid),resources=validateResourceInventory(info);
 check(!resources.jobs.length&&!resources.helpers.length&&!resources.transfers.length);
 check(provider&&provider.processes&&provider.processes.guardian&&provider.boot_id===record.boot_id);
 const normalized=processIdentities({...provider,implementation:'native-prototype',guardian_pid:provider.processes.guardian.pid,capabilities:['worker-process-identity-v1']},provider.processes.worker.pid);
 check(JSON.stringify(normalized)===JSON.stringify(provider));
 const excluded=[record.source,provider];check(excluded.every(s=>s.worker_id!==identity.worker_id));
 check(Object.values(identity.processes).every(p=>p.pid>1&&excluded.every(s=>Object.values(s.processes).every(x=>!x||x.pid!==p.pid))));
 return identity;
}
function runtimeCommand(record,identity,snapshot,installation){
 const d=record.directory,s=record.scope,j=s+'/.jobs';
 const dir=p=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n';
 const file=(p,mode,sha)=>'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\n'+(sha?'test "$(sha256sum '+p+' | cut -d " " -f1)" = '+sha+'\n':'');
 // Private bind mounts can report /worker instead of the staging pathname.
 // Require the same executable inode; the staged file hash is verified below.
 const processGuard=Object.values(identity.processes).map(p=>'line=$(cat /proc/'+p.pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" = '+p.start_ticks+'\ntest /proc/'+p.pid+'/exe -ef '+d+'/code/worker\n').join('');
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\n'+sourceExitGuard(record.source)+processGuard+dir(d)+dir(d+'/code')+dir(s)+dir(j)+
  file(d+'/code/worker','500',record.worker_sha256)+file(s+'/launcher','400',record.launcher_sha256)+file(j+'/.import-manifest','600',installation.installed_manifest_sha256)+file(j+'/lock','600')+file(j+'/guardian','600')+
  'test ! -e '+s+'/token; test ! -L '+s+'/token\n'+
  'test "$(find '+j+' -mindepth 1 -maxdepth 1 '+['.import-manifest','lock','guardian',...snapshot.records.map(r=>r.name)].map(n=>'! -name '+n).join(' ')+ ' | wc -l)" -eq 0\n'+
  'test ! -L /opt/couchroot-agent; test ! -L /opt/couchroot-agent/jobs\nif test -e /opt/couchroot-agent/jobs; then\n'+dir('/opt/couchroot-agent/jobs')+
  'test "$(find /opt/couchroot-agent/jobs -mindepth 1 -maxdepth 1 | wc -l)" -eq '+snapshot.records.length+'\nelse test '+snapshot.records.length+' -eq 0; fi\n'+
  'record_file() { test -f "$1"; test ! -L "$1"; test "$(stat -c "%u:%h:%a" "$1")" = 0:1:600; test "$(sha256sum "$1" | cut -d " " -f1)" = "$2"; }\n'+
  'cd '+j+'\n'+snapshot.records.map(r=>'record_file '+r.name+' '+r.sha256+'\nrecord_file /opt/couchroot-agent/jobs/'+r.name+' '+r.sha256+'\n').join('')+
  sourceExitGuard(record.source)+processGuard+'printf "PRODUCTION-VERIFIED\\n"\n';
 check(Buffer.byteLength(command)<=65536);return command;
}
async function readyProduction({record,journalDirectory,selectionFile,channel,execute,providerIdentity}){
 validateLaunch(record);check(typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof selectionFile==='string'&&path.dirname(selectionFile)===journalDirectory&&typeof execute==='function');
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const file=path.join(journalDirectory,record.id+'.production.json'),marker=path.join(journalDirectory,'production-launch.pending'),intent=file+'.readiness.pending';
 const saved=path.join(journalDirectory,record.id+'.retained-snapshot.json'),installed=path.join(journalDirectory,record.id+'.state-install.json'),stateMarker=path.join(journalDirectory,'state-install.pending');
 const snapshotText=privateRead(saved,262144),snapshot=JSON.parse(snapshotText),installationText=privateRead(installed,16384),installation=JSON.parse(installationText);
 const plan=planInstallation({snapshot,id:record.id,manifestSha256:record.manifest_sha256});check(installationText===JSON.stringify({...plan.record,quiescence_sha256:installation.quiescence_sha256,phase:'ready'})&&hash(installationText)===record.state_receipt_sha256&&JSON.stringify(snapshot.source)===JSON.stringify(record.source));
 const selected=selectionStatus(selectionFile),p=selected.pending;check(selected.phase==='reconciliation-required'&&p&&p.id===record.id&&p.phase==='state-ready'&&p.from.implementation==='managed'&&p.to.implementation==='native-prototype'&&p.to.manifest_sha256===record.manifest_sha256&&p.state_sha256===record.state_receipt_sha256&&p.quiescence_sha256===installation.quiescence_sha256);
 let serialized=JSON.stringify(record);const owned=()=>{check(privateRead(file,16384)===serialized&&privateRead(marker,64)===record.id+'\n'&&privateRead(stateMarker,64)===record.id+'\n'&&privateRead(saved,262144)===snapshotText&&privateRead(installed,16384)===installationText&&JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selected));};
 owned();const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,record.id+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};sync();
 const peer=channel&&channel._conn,started=process.hrtime();
 const current=()=>{const elapsed=process.hrtime(started);check(elapsed[0]*1000+elapsed[1]/1000000<120000&&peer&&channel._conn===peer);owned();check(privateRead(intent,64)===record.id+'\n');};
 const operation=async request=>{current();const result=await channel.operation(request);current();return result;};
 const run=async(c,t)=>{current();const result=await execute(c,t);current();return result;};
 try{
  const identity=productionIdentity(await operation({op:'status'}),peer,record,providerIdentity);
  const unit=await inspectProductionUnit({unit:record.unit,bootId:record.boot_id,execute:run});
  check(unit.active_state==='active'&&unit.sub_state==='running'&&unit.main_pid===identity.processes.guardian.pid&&unit.exec_code===0&&unit.exec_status===0&&/^[1-9][0-9]{0,19}$/.test(unit.started_monotonic));
  const command=runtimeCommand(record,identity,snapshot,installation);
  const verifyFiles=async()=>{const r=await run(command,25000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='PRODUCTION-VERIFIED\n');};
  await verifyFiles();
  for(const entry of snapshot.records){
   const saved=validateRecord(entry.name,Buffer.from(entry.base64,'base64')),result=await operation({op:'job.status',id:saved.id});
   const terminal=['completed','cancelled','timed_out','interrupted'].includes(saved.state),state=terminal?saved.state:saved.boot_id===record.boot_id?'unknown':'interrupted';
   check(result&&result.id===saved.id&&result.boot_id===saved.boot_id&&result.state===state&&result.output_available===false&&JSON.stringify(result.record)===JSON.stringify(saved));
  }
  check(JSON.stringify(productionIdentity(await operation({op:'status'}),peer,record,providerIdentity))===JSON.stringify(identity));
  check(JSON.stringify(await inspectProductionUnit({unit:record.unit,bootId:record.boot_id,execute:run}))===JSON.stringify(unit));await verifyFiles();current();
  const ready={...record,phase:'ready',worker_identity:identity,unit_started_monotonic:unit.started_monotonic};
  atomic(file,ready);serialized=JSON.stringify(ready);current();
  const receipt=hash(serialized),selection=new SelectionJournal(selectionFile).advance(selected.revision,record.id,'trial-ready',receipt);
  check(channel._conn===peer&&privateRead(file,16384)===serialized&&privateRead(intent,64)===record.id+'\n');
  fs.unlinkSync(intent);sync();check(channel._conn===peer);
  return Object.freeze({record:Object.freeze(ready),readiness_sha256:receipt,selection});
 }catch(cause){throw Object.assign(Error('Production readiness requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={readyProduction,validateLaunch,validateRuntimeLaunch,productionIdentity,runtimeCommand};
