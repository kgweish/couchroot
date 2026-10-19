'use strict';
// Retire only a terminal, receipt-bound S90D handoff observer. A private checkpoint
// precedes remote removal; reconnect/resume verifies remaining bytes, never launch.
const fs=require('fs'),path=require('path');
const {privateRead,privateDirectory}=require('./private-state');
const {hash,atomic}=require('./policy');
const {observeCommand,parseObservation}=require('./restart-rollback');
const q=v=>"'"+v.replace(/'/g,"'\\''")+"'";
const SHA=/^[a-f0-9]{64}$/;
function check(ok,why){if(!ok)throw Error('Observer recovery unavailable: '+why);}
function present(p){try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function sync(p){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function validateRecord(text,e,directory){
 const r=JSON.parse(text),c=r.credentials;
 check(e.provider.device==='s90d'&&r.schema===1&&r.id===e.provider_id&&['submitting','submitted','unknown','cleanup-verified','unit-retired','completed','cancelled'].includes(r.phase),'record identity');
 check(r.boot_id===e.boot_id&&r.manifest_sha256===e.provider.manifest_sha256&&r.observer_sha256===e.provider.observer_sha256&&SHA.test(r.observer_sha256),'artifact or boot binding');
 check(r.unit==='couchroot-observer-'+r.id+'.service'&&r.execution_directory==='/opt/couchroot-observer-'+r.id&&typeof r.root==='string'&&path.dirname(r.root)===directory&&/^observer-[A-Za-z0-9]{6}$/.test(path.basename(r.root)),'scope binding');
 check(Array.isArray(r.pids)&&r.pids.length===1&&r.pids[0]===e.source.processes.worker.pid&&!e.source.processes.guardian,'source binding');
 check(c&&c.uid===5001&&c.gid===100&&c.label==='User::Pkg::MiniRoot01'&&Array.isArray(c.groups)&&c.groups.length>0&&c.groups.length<=32&&c.groups.includes(100)&&new Set(c.groups).size===c.groups.length&&c.groups.every(g=>Number.isInteger(g)&&g>0&&g<=2147483647),'credential binding');
 return r;
}
function terminal(text,r){
 const v=JSON.parse(text);
 check(v&&Object.keys(v).sort().join('|')==='boot_id|exit_code|guardian_pid|observer_pid|schema|signal|worker_pid'&&v.schema===1&&v.boot_id===r.boot_id&&v.worker_pid===r.pids[0]&&v.guardian_pid===null,'terminal receipt binding');
 check(Number.isInteger(v.observer_pid)&&v.observer_pid>1&&v.observer_pid<=2147483647&&v.observer_pid!==v.worker_pid,'observer process');
 check(v.signal===null&&Number.isInteger(v.exit_code)&&v.exit_code>=0&&v.exit_code<=255||v.exit_code===null&&Number.isInteger(v.signal)&&v.signal>=1&&v.signal<=64,'terminal result');return v;
}
function metadata(p,socket=false){
 const st=fs.lstatSync(p);check(!st.isSymbolicLink()&&st.uid===process.geteuid()&&st.nlink===1&&(st.mode&0o7777)===0o600&&(socket?st.isSocket():st.isFile()),'scope entry metadata');
 return {dev:st.dev,ino:st.ino,...(socket?{}:{size:st.size})};
}
function capture(r){
 check(privateDirectory(fs.lstatSync(r.root)),'scope directory');
 const names=fs.readdirSync(r.root);check(names.includes('token')&&names.includes('result')&&names.every(n=>['token','result','control'].includes(n)),'scope entries or publication pending');
 const token=privateRead(r.root+'/token',64),receipt=privateRead(r.root+'/result',512);check(/^[a-f0-9]{64}$/.test(token)&&token.length===64,'token');terminal(receipt,r);
 const files={token:{...metadata(r.root+'/token'),sha256:hash(token)},result:{...metadata(r.root+'/result'),sha256:hash(receipt)}};
 if(names.includes('control'))files.control=metadata(r.root+'/control',true);
 const st=fs.lstatSync(r.root);return {receipt,files,scope_identity:{dev:st.dev,ino:st.ino}};
}
function verifyScope(r,cp){
 if(!present(r.root)){check(cp.phase!=='prepared','scope vanished before local retirement');return;}
 const scope=fs.lstatSync(r.root);check(privateDirectory(scope)&&cp.scope_identity&&scope.dev===cp.scope_identity.dev&&scope.ino===cp.scope_identity.ino,'scope directory changed');
 const names=fs.readdirSync(r.root);check(names.every(n=>Object.prototype.hasOwnProperty.call(cp.files,n)),'unknown scope entry');
 if(cp.phase==='prepared')check(['token','result'].every(n=>names.includes(n)),'scope bytes vanished');
 for(const n of names){const expected=cp.files[n],actual=metadata(r.root+'/'+n,n==='control');check(['dev','ino',...(n==='control'?[]:['size'])].every(k=>actual[k]===expected[k]),'scope identity changed');if(n!=='control')check(hash(privateRead(r.root+'/'+n,n==='token'?64:512))===expected.sha256,'scope bytes changed');}
}
function quietCommand(e,r,receipt){
 return observeCommand(e)+(receipt?'test ! -e /proc/'+receipt.observer_pid+'/stat\n':'')+
  "awk -v p="+q(r.root+'/control')+" '$8 == p { found=1 } END { exit found ? 1 : 0 }' /proc/net/unix\n"+
  'printf "OBSERVER-RECOVERY-QUIET\\n"\n';
}
function remotePlan(e,r,receipt){
 const dir=r.execution_directory,binary=dir+'/observer';
 return quietCommand(e,r,receipt)+'state=$(systemctl show -p ActiveState '+r.unit+')\n'+
  // Recheck idleness in the same remote command that can stop the unit. The
  // preceding observation is parsed by the host but cannot close this race.
  'idle_state=$(systemctl show -p MainPID -p SubState -p ControlGroup '+r.unit+')\n'+
  'printf "%s\\n" "$idle_state" | grep -qx MainPID=0\n'+
  'cg=$(printf "%s\\n" "$idle_state" | sed -n "s/^ControlGroup=//p")\n'+
  'case "$cg" in "") ;; /system.slice/'+r.unit+') if test -e "/sys/fs/cgroup/systemd$cg/cgroup.procs"; then test "$(wc -l < "/sys/fs/cgroup/systemd$cg/cgroup.procs")" -eq 0; fi;; *) exit 1;; esac\n'+
  'case "$state" in ActiveState=active) printf "%s\\n" "$idle_state" | grep -qx SubState=exited; systemctl stop --no-block '+r.unit+';; ActiveState=failed) systemctl reset-failed '+r.unit+';; ActiveState=inactive) ;; *) exit 1;; esac\n'+
  'idle=0; for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do if test "$(systemctl show -p ActiveState '+r.unit+')" = ActiveState=inactive; then idle=1; break; fi; sleep .1; done; test "$idle" = 1\n'+
  'if test -e '+dir+' || test -L '+dir+'; then\n'+
  'test -d '+dir+'; test ! -L '+dir+'; test "$(stat -c "%u:%a" '+dir+')" = 0:700\n'+
  'find '+dir+' -mindepth 1 | while IFS= read -r entry; do test "$entry" = '+binary+'; done\n'+
  'if test -e '+binary+' || test -L '+binary+'; then test -f '+binary+'; test ! -L '+binary+'; test "$(stat -c "%u:%h:%a" '+binary+')" = 0:1:500\n'+
  'test "$(sha256sum '+binary+' | cut -d " " -f1)" = '+r.observer_sha256+'; rm '+binary+'; fi\nrmdir '+dir+'\nfi\n'+
  'test ! -e '+dir+'; test ! -L '+dir+'\nsync\nprintf "OBSERVER-RECOVERY-RETIRED\\n"\n';
}
async function recoverObserver({directory,evidence:e,execute}){
 const nested=path.join(directory,'observer-launches');if(!present(nested))return null;
 check(privateDirectory(fs.lstatSync(nested)),'observer journal directory');
 const file=path.join(nested,e.provider_id+'.observer.json'),marker=path.join(nested,'observer-launch.pending'),checkpoint=path.join(nested,e.provider_id+'.recovery.json');
 if(present(marker))check(privateRead(marker,64)===e.provider_id+'\n','another observer is pending');
 if(!present(file)){check(!present(marker)&&!present(checkpoint),'observer record missing');return null;}
 let text=privateRead(file,16384),cp=present(checkpoint)?JSON.parse(privateRead(checkpoint,32768)):null;
 const original=cp?cp.record_text:text,r=validateRecord(original,e,directory),sourceHash=hash(JSON.stringify(e.source));
 const completed=c=>JSON.stringify({...r,phase:'cancelled',observer_receipt:JSON.parse(c.receipt),receipt_sha256:hash(c.receipt),recovery_evidence_sha256:hash(JSON.stringify({record_text:c.record_text,source_sha256:c.source_sha256,files:c.files,receipt:c.receipt,scope_identity:c.scope_identity}))});
 const quiet=async receipt=>{const result=await execute(quietCommand(e,r,receipt),10000);check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout.endsWith('OBSERVER-RECOVERY-QUIET\n'),'process, unit or listener still active');parseObservation(result.stdout.slice(0,-24),e.units);};
 if(!cp&&!present(marker)&&['completed','cancelled'].includes(r.phase)){
  check(!present(r.root),'completed observer scope remains');await quiet(null);
  const result=await execute('set -eu\ntest ! -e '+r.execution_directory+'; test ! -L '+r.execution_directory+'\n',5000);check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr,'completed observer executable remains');return null;
 }
 if(cp){
  check(cp.schema===1&&cp.id===e.provider_id&&cp.transaction_id===e.id&&cp.source_sha256===sourceHash&&['prepared','remote-retired','complete'].includes(cp.phase),'checkpoint binding');
  check(cp.files&&Object.keys(cp.files).every(n=>['token','result','control'].includes(n))&&['token','result'].every(n=>cp.files[n]&&SHA.test(cp.files[n].sha256)),'checkpoint files');
  check(text===original||text===completed(cp),'observer journal changed');
  check(present(marker)||text===completed(cp),'observer marker vanished');
 }else{
  check(present(marker),'unfinished observer has no marker');const saved=capture(r);cp={schema:1,id:e.provider_id,transaction_id:e.id,source_sha256:sourceHash,record_text:text,...saved,phase:'prepared'};
 }
 const receipt=terminal(cp.receipt,r);check(cp.files.token.size===64&&cp.files.result.size===Buffer.byteLength(cp.receipt)&&cp.files.result.sha256===hash(cp.receipt),'checkpoint receipt');
 verifyScope(r,cp);await quiet(receipt);verifyScope(r,cp);check([original,completed(cp)].includes(privateRead(file,16384)),'observer journal changed during observation');
 if(present(marker))check(privateRead(marker,64)===e.provider_id+'\n','observer marker changed during observation');else check(privateRead(file,16384)===completed(cp),'observer marker vanished during observation');
 if(!present(checkpoint)){atomic(checkpoint,cp);sync(nested);}
 if(cp.phase==='prepared'){
  const result=await execute(remotePlan(e,r,receipt),10000);check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout.endsWith('OBSERVER-RECOVERY-RETIRED\n'),'remote observer retirement uncertain');
  check(privateRead(file,16384)===original,'observer journal changed during retirement');verifyScope(r,cp);cp.phase='remote-retired';atomic(checkpoint,cp);sync(nested);
 }
 if(cp.phase!=='prepared'){const absent=await execute('set -eu\ntest ! -e '+r.execution_directory+'; test ! -L '+r.execution_directory+'\n',5000);check(absent&&absent.exit_code===0&&!absent.timed_out&&!absent.stderr,'retired observer executable reappeared');}
 // A lost local publication may leave any exact prefix removed. Nothing outside
 // the captured entries is accepted, and a new active Unix listener blocks resume.
 verifyScope(r,cp);check([original,completed(cp)].includes(privateRead(file,16384)),'observer journal changed before local retirement');
 if(present(r.root)){for(const n of fs.readdirSync(r.root))fs.unlinkSync(path.join(r.root,n));sync(r.root);fs.rmdirSync(r.root);sync(directory);}
 const finalText=completed(cp);if(privateRead(file,16384)!==finalText){atomic(file,JSON.parse(finalText));sync(nested);}
 if(present(marker)){check(privateRead(marker,64)===e.provider_id+'\n','observer marker changed');fs.unlinkSync(marker);sync(nested);}
 if(cp.phase!=='complete'){cp.phase='complete';atomic(checkpoint,cp);sync(nested);}
 return {id:e.provider_id,receipt_sha256:hash(finalText)};
}
module.exports={recoverObserver,validateRecord,terminal,quietCommand,remotePlan};
