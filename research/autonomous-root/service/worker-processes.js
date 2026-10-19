'use strict';
// Observe Linux process identities; never signal a PID or infer mount cleanup.
const fs=require('fs');
const BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function identity(v){
 return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')==='pid|start_ticks'&&
  Number.isInteger(v.pid)&&v.pid>0&&v.pid<=2147483647&&typeof v.start_ticks==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v.start_ticks);
}
function bootGuard(boot){
 if(typeof boot!=='string'||boot.length!==36||!BOOT.test(boot))throw Error('Invalid observed boot identity');
 return 'test "$(cat /proc/sys/kernel/random/boot_id)" = '+boot+'\n';
}
// Explicitly bind observation to the authenticated executor's boot. A saved
// PID/start pair has meaning only within its own boot; never inspect a recycled
// current-boot PID as evidence about a process from an earlier boot.
function processAbsenceGuard(p,identityBoot,observedBoot=identityBoot){
 if(!identity(p)||p.pid<=1)throw Error('Invalid absent process identity');
 bootGuard(identityBoot);const guard=bootGuard(observedBoot);
 return guard+(identityBoot===observedBoot?'if test -e /proc/'+p.pid+'/stat; then line=$(cat /proc/'+p.pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" != '+p.start_ticks+'; fi\n':'');
}
function processIdentities(info,authenticatedPid){
 const p=info&&info.processes,native=info&&['native-prototype','native-bootstrap'].includes(info.implementation);
 if(!info||!BOOT.test(info.boot_id)||typeof info.worker_id!=='string'||!/^[a-f0-9]{32}$/.test(info.worker_id)||
  !Array.isArray(info.capabilities)||!info.capabilities.includes('worker-process-identity-v1')||
  !p||Object.keys(p).sort().join('|')!=='guardian|worker'||!identity(p.worker)||p.worker.pid!==authenticatedPid||
  (native?(!identity(p.guardian)||p.guardian.pid!==info.guardian_pid||p.guardian.pid===p.worker.pid):p.guardian!==null))
  throw Error('Worker process identity unavailable or invalid');
 return JSON.parse(JSON.stringify({boot_id:info.boot_id,worker_id:info.worker_id,processes:p}));
}
function readProc(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const bytes=Buffer.alloc(4097);let at=0;
  while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,null);if(!n)break;at+=n;}
  if(at===bytes.length)throw Error('Oversized process identity');
  return bytes.subarray(0,at).toString('utf8');
 }finally{fs.closeSync(fd);}
}
function startTicks(stat,pid){
 // comm may contain spaces, parentheses and newlines. Numeric fields follow
 // the final ')'; starttime is field 22, index 19 after comm.
 const end=stat.lastIndexOf(')'),prefix=pid+' (';
 if(!stat.startsWith(prefix)||end<prefix.length||stat[end+1]!==' ')throw Error('Invalid process stat');
 const fields=stat.slice(end+2).trim().split(/\s+/),ticks=fields[19];
 if(fields.length<20||!/^[A-Za-z]$/.test(fields[0])||!ticks||!/^(0|[1-9][0-9]{0,19})$/.test(ticks))throw Error('Invalid process start identity');
 return ticks;
}
function observeProcesses(bound,read=readProc){
 if(!bound||!BOOT.test(bound.boot_id)||!bound.processes||!identity(bound.processes.worker)||
  (bound.processes.guardian!==null&&!identity(bound.processes.guardian)))throw Error('Invalid bound process identities');
 const boot=()=>{if(read('/proc/sys/kernel/random/boot_id').trim()!==bound.boot_id)throw Error('Boot changed during process observation');};
 boot();const observations={};
 for(const name of ['worker','guardian']){
  const p=bound.processes[name];if(!p){observations[name]=null;continue;}
  let stat,observation,observedTicks=null;
  try{stat=read('/proc/'+p.pid+'/stat');}catch(e){if(e.code!=='ENOENT')throw e;observation='absent';}
  if(stat!==undefined){observedTicks=startTicks(stat,p.pid);observation=observedTicks===p.start_ticks?'present':'reused';}
  observations[name]={...p,observation,observed_start_ticks:observedTicks};
 }
 boot();return {boot_id:bound.boot_id,worker_id:bound.worker_id,processes:observations};
}
async function waitForProcessExit(bound,options={}){
 const timeout=options.timeoutMs===undefined?10000:options.timeoutMs;
 if(!Number.isInteger(timeout)||timeout<1||timeout>30000)throw Error('Invalid exit observation deadline');
 const clock=()=>{const t=process.hrtime();return t[0]*1000+t[1]/1000000;};
 const deadline=clock()+timeout;
 for(;;){
  const result=observeProcesses(bound,options.read||readProc);
  if(Object.values(result.processes).every(p=>p===null||p.observation!=='present'))return result;
  const left=deadline-clock();
  if(left<=0)throw Error('Worker processes still present at exit deadline');
  await new Promise(resolve=>setTimeout(resolve,Math.min(100,left)));
 }
}
// A provider that returns a native trial to managed is bound either to the
// trial's original managed source (held rehearsal) or, after native activation
// retired that provider, to the active native worker it replaces.
function returnProviderSource(source,record){const s=JSON.stringify(source);return !!record&&(s===JSON.stringify(record.source)||!!record.worker_identity&&s===JSON.stringify(record.worker_identity));}
module.exports={processIdentities,observeProcesses,waitForProcessExit,startTicks,returnProviderSource,bootGuard,processAbsenceGuard};
