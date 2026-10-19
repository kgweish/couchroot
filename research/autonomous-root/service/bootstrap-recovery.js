'use strict';
// Fence an interrupted bootstrap before inspecting/retiring it. Never replay its
// launch or signal a process. A fresh held executor supplies independent evidence.
const fs=require('fs'),path=require('path');
const {privateRead,privateDirectory}=require('./private-state');
const {hash,atomic}=require('./policy');
const {processIdentities,bootGuard,processAbsenceGuard}=require('./worker-processes');
const {fenceCommand}=require('./launch-fence');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const ID=/^[a-f0-9]{32}$/,SHA=/^[a-f0-9]{64}$/,BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const check=v=>{if(!v)throw Error('Bootstrap recovery evidence unavailable');};
const q=v=>"'"+v.replace(/'/g,"'\\''")+"'";
function present(p){try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function markerId(marker){
 const st=fs.lstatSync(marker);
 if(st.isSymbolicLink()){const target=fs.readlinkSync(marker);check(/^[a-f0-9]{32}\.bootstrap\.json$/.test(target));return target.slice(0,32);}
 // Legacy launches have no fencing contract and remain an independent-inspection boundary.
 const id=privateRead(marker,33);check(/^[a-f0-9]{32}\n$/.test(id));return id.trim();
}
function validateRecord(r,directory){
 check(r&&r.schema===2&&ID.test(r.id)&&r.id.slice(0,16)===r.id.slice(16)&&BOOT.test(r.boot_id)&&['submitted','ready','retired'].includes(r.phase));
 check(r.directory==='/opt/couchroot-bootstrap-'+r.id&&r.scope===r.directory+'/state'&&r.unit==='couchroot-bootstrap-'+r.id+'.service'&&r.fence==='/opt/couchroot-bootstrap-fence-'+r.id&&r.file===path.join(directory,r.id+'.bootstrap.json'));
 for(const k of ['worker_sha256','launcher_sha256','token_sha256','selection_sha256'])check(typeof r[k]==='string'&&SHA.test(r[k]));
 if(r.phase==='ready'||r.worker_identity){
  const i=r.worker_identity;check(i&&i.boot_id===r.boot_id&&SHA.test(r.worker_sha256)&&/^[1-9][0-9]{0,19}$/.test(r.unit_started_monotonic));
  processIdentities({...i,implementation:'native-bootstrap',guardian_pid:i.processes&&i.processes.guardian&&i.processes.guardian.pid,capabilities:['worker-process-identity-v1','guardian-parent-identity-v1']},i.processes&&i.processes.worker&&i.processes.worker.pid);
 }
 return r;
}
function recoveryCandidate(selectionFile,bootId){
 const directory=path.dirname(selectionFile),marker=path.join(directory,'bootstrap-launch.pending');
 if(!present(marker))return null;
 if(typeof bootId==='function')bootId=bootId();
 bootGuard(bootId);
 check(privateDirectory(fs.lstatSync(directory)));const id=markerId(marker),file=path.join(directory,id+'.bootstrap.json');
 const record=validateRecord(JSON.parse(privateRead(file,16384)),directory);
 check(record.id===id&&hash(privateRead(selectionFile,65536))===record.selection_sha256);
 return record;
}
function recoveryCommand(r,{bootId=r.boot_id}={}){
 bootGuard(r.boot_id);bootGuard(bootId);
 const d=r.directory,s=r.scope,u=r.unit;
 const crossed=bootId!==r.boot_id,absent='test "$(systemctl show -p LoadState '+u+')" = LoadState=not-found\n';
 // Transient units do not survive reboot. A current unit with the same name
 // has no ownership proof from the old receipt, even if its PID is zero.
 let body=(crossed?absent:'')+'test "$(systemctl show -p MainPID '+u+')" = MainPID=0\n'+
  'cg=$(systemctl show -p ControlGroup '+u+' | sed -n "s/^ControlGroup=//p")\ncase "$cg" in "") ;; /system.slice/'+u+') if test -e "/sys/fs/cgroup/systemd$cg/cgroup.procs"; then test "$(wc -l < "/sys/fs/cgroup/systemd$cg/cgroup.procs")" -eq 0; fi;; *) exit 1;; esac\n';
 if(r.worker_identity)for(const p of Object.values(r.worker_identity.processes))body+=processAbsenceGuard(p,r.boot_id,bootId);
 if(!crossed&&r.unit_started_monotonic)body+='if test \"$(systemctl show -p LoadState '+u+')\" != LoadState=not-found; then test \"$(systemctl show -p ExecMainStartTimestampMonotonic '+u+')\" = ExecMainStartTimestampMonotonic='+r.unit_started_monotonic+'; fi\n';
 // Check the complete remaining inventory before deleting anything. Repeating
 // cleanup after a lost reply only accepts an absent file or its exact bytes.
 const dirs=[d,d+'/code',s,s+'/.jobs'];
 const files=[[d+'/code/worker','500',r.worker_sha256],[s+'/launcher','400',r.launcher_sha256],[s+'/token','600',r.token_sha256],[s+'/.jobs/lock','600',hash('')]];
 for(const dir of dirs)body+='if test -e '+dir+' || test -L '+dir+'; then test -d '+dir+'; test ! -L '+dir+'; test "$(stat -c "%u:%a" '+dir+')" = 0:700; fi\n';
 body+='if test -d '+d+'; then find '+d+' -mindepth 1 | while IFS= read -r name; do case "$name" in '+dirs.slice(1).concat(files.map(f=>f[0])).join('|')+') ;; *) exit 1;; esac; done; fi\n';
 for(const [file,mode,sha] of files)body+='if test -e '+file+' || test -L '+file+'; then test -f '+file+'; test ! -L '+file+'; test "$(stat -c "%u:%h:%a" '+file+')" = 0:1:'+mode+'; test "$(sha256sum '+file+' | cut -d " " -f1)" = '+sha+'; fi\n';
 // No stop is submitted while a unit owns processes. The fence prevents the
 // original command from starting it after this inspection.
 if(!crossed)body+='if test "$(systemctl show -p LoadState '+u+')" != LoadState=not-found; then systemctl stop --no-block '+u+'; fi\n'+
  'if test \"$(systemctl show -p ActiveState '+u+')\" = ActiveState=failed; then systemctl reset-failed '+u+'; fi\n'+
  'for attempt in 1 2 3 4 5 6 7 8 9 10; do test "$(systemctl show -p ActiveState '+u+')" = ActiveState=inactive && break; sleep 0.1; done\n'+
  'test "$(systemctl show -p ActiveState '+u+')" = ActiveState=inactive\ntest "$(systemctl show -p MainPID '+u+')" = MainPID=0\n';
 if(crossed)body+=absent;
 body+=bootGuard(bootId);
 for(const [file] of files)body+='if test -e '+file+'; then rm '+file+'; fi\n';
 for(const dir of dirs.reverse())body+='if test -d '+dir+'; then rmdir '+dir+'; fi\n';
 body+='printf "BOOTSTRAP-RECONCILED\\n"\n';return fenceCommand(r,body,{seal:true,bootId});
}
function clearMarker(record){
 const directory=path.dirname(record.file),marker=path.join(directory,'bootstrap-launch.pending');check(markerId(marker)===record.id);fs.unlinkSync(marker);
 const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
async function reconcileBootstrap({selectionFile,bootId,executor}){
 const record=recoveryCandidate(selectionFile,bootId);check(record);
 const bound=()=>check(JSON.stringify(recoveryCandidate(selectionFile,bootId))===JSON.stringify(record));
 const confirm=async()=>{bound();const info=await executor.status();validateReadiness(info,{implementation:'managed',bootId});const own=processIdentities(info,executor.pid),resources=validateResourceInventory(info);check(!resources.jobs.length&&!resources.helpers.length&&!resources.transfers.length);return own;};
 const own=await confirm();check(!record.worker_identity||record.worker_identity.worker_id!==own.worker_id);
 const result=await executor.execute(recoveryCommand(record,{bootId}),10000);check(JSON.stringify(await confirm())===JSON.stringify(own));
 check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout==='BOOTSTRAP-RECONCILED\n');
 atomic(record.file,{...record,phase:'retired',reconciled:true,reconciled_boot_id:bootId});clearMarker(record);
 return {id:record.id,phase:'complete',launch_replayed:false};
}
module.exports={markerId,validateRecord,recoveryCandidate,fenceCommand,recoveryCommand,clearMarker,reconcileBootstrap};
