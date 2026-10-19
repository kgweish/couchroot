'use strict';
// Read-only exit evidence through an independent executor. Never signal a PID.
const {validateRuntimeLaunch}=require('./production-readiness');
const {processIdentities,observeProcesses}=require('./worker-processes');
const {inspectProductionUnit}=require('./observer-unit');
function check(ok,detail){if(!ok)throw Error('Production exit evidence unavailable'+(detail?': '+detail:''));}
const unitSummary=u=>u.active_state+'/'+u.sub_state+' pid='+u.main_pid+' code='+u.exec_code+' status='+u.exec_status;
async function prepareProductionExit({record,execute}){
 record=JSON.parse(JSON.stringify(record));check(record.phase==='ready'&&typeof execute==='function');
 const {worker_identity,unit_started_monotonic,...launch}=record;validateRuntimeLaunch({...launch,phase:'submitted'});
 const identity=processIdentities({...worker_identity,implementation:'native-prototype',guardian_pid:worker_identity.processes.guardian.pid,capabilities:['worker-process-identity-v1']},worker_identity.processes.worker.pid);
 check(JSON.stringify(identity)===JSON.stringify(worker_identity)&&identity.boot_id===record.boot_id&&/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic));
 const guard='test "$(cat /proc/sys/kernel/random/boot_id)" = '+record.boot_id+'\n';
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\n'+guard+['worker','guardian'].map(name=>{
  const pid=identity.processes[name].pid;
  return 'printf "'+name+':"\nif value=$(cat /proc/'+pid+'/stat 2>/dev/null); then\nprintf %s "$value" | base64 | tr -d "\\n"\nprintf "\\n"\nelif test ! -d /proc/'+pid+'; then printf "absent\\n"; else exit 1; fi\n';
 }).join('')+guard;
 async function observe(){
  const r=await execute(command,5000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string'&&r.stdout.length<=12000,'process read failed (exit '+(r?r.exit_code:'missing')+', timeout '+!!(r&&r.timed_out)+')');
  const lines=r.stdout.split('\n');check(lines.length===3&&lines[2]==='');const files={};
  ['worker','guardian'].forEach((name,i)=>{check(lines[i].startsWith(name+':'));const data=lines[i].slice(name.length+1);
   if(data==='absent')files['/proc/'+identity.processes[name].pid+'/stat']=null;
   else{check(data.length>0&&data.length<=5464&&/^[A-Za-z0-9+/]+={0,2}$/.test(data));const decoded=Buffer.from(data,'base64');check(decoded.length<=4096&&decoded.toString('base64')===data);files['/proc/'+identity.processes[name].pid+'/stat']=decoded.toString('utf8');}
  });
  return observeProcesses(identity,p=>{if(p==='/proc/sys/kernel/random/boot_id')return record.boot_id;check(Object.prototype.hasOwnProperty.call(files,p));if(files[p]===null)throw Object.assign(Error('absent'),{code:'ENOENT'});return files[p];});
 }
 async function unit(){const u=await inspectProductionUnit({unit:record.unit,bootId:record.boot_id,execute});check(u.started_monotonic===unit_started_monotonic,'unit start identity changed');return u;}
 const initial=await observe();check(Object.values(initial.processes).every(p=>p.observation==='present'),'original process absent before shutdown');
 const before=await unit();check(before.active_state==='active'&&before.sub_state==='running'&&before.main_pid===identity.processes.guardian.pid&&before.exec_code===0&&before.exec_status===0,'initial unit '+unitSummary(before));
 let state='bound';
 async function wait(resume){
  check(state===(resume?'interrupted':'bound'),'exit observation is not available');state='observing';
  try{const result=await poll();state='completed';return result;}
  catch(error){state='interrupted';throw error;}
 }
 async function poll(){
  const start=process.hrtime();
  for(;;){
   const observed=await observe(),u=await unit();
   const running=u.active_state==='active'&&u.sub_state==='running'&&u.main_pid===identity.processes.guardian.pid&&u.exec_code===0&&u.exec_status===0;
   const exited=u.active_state==='active'&&u.sub_state==='exited'&&u.main_pid===0&&u.exec_code===1&&u.exec_status===0;
   check(running||exited,'unexpected unit '+unitSummary(u));const elapsed=process.hrtime(start);check(elapsed[0]*1000+elapsed[1]/1000000<10000,'exit deadline expired');
   if(exited&&Object.values(observed.processes).every(p=>p.observation!=='present'))return {record_id:record.id,identity,observation:observed,unit:u};
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
 // Retrying only reads the identities pinned before shutdown. It never binds
 // to replacement processes or repeats the command that initiated shutdown.
 return Object.freeze({identity:Object.freeze(JSON.parse(JSON.stringify(identity))),
  waitForExit:()=>wait(false),resumeExitObservation:()=>wait(true)});
}
module.exports={prepareProductionExit};
