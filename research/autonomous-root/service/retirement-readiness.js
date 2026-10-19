'use strict';
// Turn an acknowledged launch into a usable provider only after independent
// identity checks. A failed check leaves durable ownership for reconciliation.
const fs=require('fs'),path=require('path');
const {atomic}=require('./policy');
const {createObserverRetirement,validateProvider}=require('./observer-retirement');
const {inspectRetirementUnit}=require('./observer-unit');
const {processIdentities}=require('./worker-processes');
function check(ok){if(!ok)throw Error('Retirement readiness ownership unavailable');}
const {privateRead,privateDirectory}=require('./private-state');
function validateRecord(record){
 check(record&&Object.keys(record).sort().join('|')==='boot_id|device|directory|id|launcher_sha256|manifest_sha256|observer_sha256|phase|port|schema|scope|source|token_file|token_sha256|unit|worker_sha256');
 check(record.schema===1&&record.phase==='submitted'&&typeof record.id==='string'&&record.id.length===32&&/^[a-f0-9]+$/.test(record.id)&&['s90d','qn90a'].includes(record.device));
 for(const key of ['worker_sha256','launcher_sha256','observer_sha256','manifest_sha256','token_sha256'])check(typeof record[key]==='string'&&record[key].length===64&&/^[a-f0-9]+$/.test(record[key]));
 check(record.unit==='couchroot-retirement-'+record.id+'.service'&&record.directory==='/opt/couchroot-retirement-'+record.id&&record.scope===record.directory+'/state');
 check(Number.isInteger(record.port)&&record.port>=1024&&record.port<=65535&&typeof record.token_file==='string'&&record.token_file.endsWith('/token')&&/^\/opt\/usr\/home\/owner\/apps_rw\/MiniRoot01\/data\/worker-state\/retirement-[a-zA-Z0-9]{6}\/token$/.test(record.token_file));
 const s=record.source;check(s&&s.processes&&s.processes.worker&&record.boot_id===s.boot_id&&typeof record.boot_id==='string'&&record.boot_id.length===36&&typeof s.worker_id==='string'&&s.worker_id.length===32);
 const normalized=processIdentities({...s,capabilities:['worker-process-identity-v1'],...(s.processes.guardian?{implementation:'native-prototype',guardian_pid:s.processes.guardian.pid}:{})},s.processes.worker.pid);
 check(JSON.stringify(normalized)===JSON.stringify(s)&&Object.values(s.processes).every(p=>p===null||p.pid>1));
}
async function readyRetirement({record,journalDirectory,channel,execute,confirmSource}){
 validateRecord(record);check(typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof execute==='function'&&typeof confirmSource==='function');
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const file=path.join(journalDirectory,record.id+'.retirement.json'),marker=path.join(journalDirectory,'retirement-launch.pending'),intent=file+'.readiness.pending',serialized=JSON.stringify(record);
 const owned=()=>{check(privateRead(file,16384)===serialized);check(privateRead(marker,64)===record.id+'\n');};
 owned();
 const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,record.id+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const sync=()=>{const parent=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}};sync();
 const peer=channel&&channel._conn,start=process.hrtime();
 const timely=()=>{const t=process.hrtime(start);check(t[0]*1000+t[1]/1000000<15000);};
 try{
  const provider=await createObserverRetirement({channel,source:record.source,bound:{unit:'couchroot-observer-'+record.id+'.service',bootId:record.boot_id,sha256:record.observer_sha256},launcherSha256:record.launcher_sha256});
  timely();const unit=await inspectRetirementUnit({unit:record.unit,bootId:record.boot_id,execute});timely();
  check(unit.active_state==='active'&&unit.sub_state==='running'&&unit.main_pid===provider.identity.processes.guardian.pid&&unit.exec_code===0&&unit.exec_status===0&&/^[1-9][0-9]{0,19}$/.test(unit.started_monotonic));
  const fresh=await channel.operation({op:'status'});timely();check(channel._conn===peer);
  const identity=validateProvider(fresh,peer,{bootId:record.boot_id,launcherSha256:record.launcher_sha256},record.source);
  check(JSON.stringify(identity)===JSON.stringify(provider.identity));
  const source=await confirmSource();timely();check(channel._conn===peer);
  check(JSON.stringify(processIdentities(source,record.source.processes.worker.pid))===JSON.stringify(record.source));
  owned();check(privateRead(intent,64)===record.id+'\n');
  const ready={...record,phase:'ready',provider_identity:identity,unit_started_monotonic:unit.started_monotonic};
  atomic(file,ready);timely();check(channel._conn===peer);fs.unlinkSync(intent);sync();timely();check(channel._conn===peer);
  return Object.freeze({record:Object.freeze(ready),provider});
 }catch(error){throw Object.assign(Error('Retirement readiness requires reconciliation'),{outcome:'unknown',cause:error});}
}
module.exports={readyRetirement,validateRecord,privateRead};
