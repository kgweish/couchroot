'use strict';
// Explicit cleanup after a committed restart rollback. Each owned unit must be
// idle with an empty cgroup, and every staging entry must match its recorded
// type, mode and digest. Unknown entries, live processes and unsupported
// observer remnants leave the transaction pending; nothing unknown is deleted.
const fs=require('fs'),path=require('path');
const {privateRead,privateDirectory}=require('./private-state');
const {recoverObserver}=require('./observer-recovery');
const {SelectionJournal}=require('./worker-selection');
const {hash,atomic}=require('./policy');
const {loadEvidence,observeCommand,parseObservation}=require('./restart-rollback');
const {processIdentities}=require('./worker-processes');
const {validateReadiness,validateResourceInventory}=require('./worker-readiness');
const ID=/^[a-f0-9]{32}$/,HEX=/^[a-f0-9]{64}$/,INTENT='.restart-cleanup.pending',RECEIPT='.restart-cleanup.json';
function check(ok,detail){if(!ok)throw Object.assign(Error('Restart cleanup unavailable'+(detail?': '+detail:'')),{outcome:'rejected'});}
function present(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function sync(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
// Every entry is optional; a present entry must match exactly and nothing else may exist.
function tree(root,entries){
 const dirs=entries.filter(e=>e[1]==='dir').map(e=>e[0]),files=entries.filter(e=>e[1]==='file');
 const inspect=entries.map(([p,type,mode,sha])=>'if test -e '+p+' || test -L '+p+'; then test ! -L '+p+'\n'+(type==='dir'?'test -d '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n':'test -f '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\n'+(sha?'test "$(sha256sum '+p+' | cut -d " " -f1)" = '+sha+'\n':'test "$(stat -c %s '+p+')" -lt 2048\n'))+'fi\n').join('');
 return 'if test -e '+root+' || test -L '+root+'; then\n'+inspect+
  'find '+root+' -mindepth 1 | while IFS= read -r entry; do case "$entry" in '+(entries.length>1?entries.filter(e=>e[0]!==root).map(e=>e[0]).join('|')+') ;; ':'')+'*) exit 1;; esac; done\n'+
  (files.length?'for file in '+files.map(e=>e[0]).join(' ')+'; do if test -e "$file"; then rm "$file"; fi; done\n':'')+
  'for directory in '+dirs.slice().sort((a,b)=>b.length-a.length).join(' ')+'; do if test -d "$directory"; then rmdir "$directory"; fi; done\nfi\ntest ! -e '+root+'; test ! -L '+root+'\n';
}
function cleanupPlan(e,{bootId=e.boot_id,knownBootId=e.boot_id,requireAbsentUnits=false}={}){
 const {id,provider_id:obs,provider:p,production:n,installation:i,snapshot}=e;
 const pd='/opt/couchroot-retirement-'+obs,ps=pd+'/state',nd='/opt/couchroot-worker-'+id,ns=nd+'/state',nj=ns+'/.jobs';
 check(p.directory===pd&&p.scope===ps&&[p.worker_sha256,p.launcher_sha256,p.token_sha256].every(v=>HEX.test(v)),'provider staging record incomplete');
 const provider=[[pd,'dir'],[pd+'/code','dir'],[pd+'/code/worker','file','500',p.worker_sha256],[ps,'dir'],[ps+'/launcher','file','400',p.launcher_sha256],[ps+'/token','file','600',p.token_sha256],[ps+'/.jobs','dir'],[ps+'/.jobs/lock','file','600',null]];
 let native=[[nd,'dir']];
 if(i){
  check(i.directory===nd&&i.scope===ns&&HEX.test(i.installed_manifest_sha256),'state installation record incomplete');
  native=native.concat([[ns,'dir'],[nj,'dir'],[nj+'/lock','file','600',null],[nj+'/.import-manifest','file','600',i.installed_manifest_sha256],[nj+'/.import-pending','file','600',i.installed_manifest_sha256],[nj+'/.import-record','file','600',null],...snapshot.records.map(r=>[nj+'/'+r.name,'file','600',r.sha256])]);
  if(n){check(n.directory===nd&&n.scope===ns&&[n.worker_sha256,n.launcher_sha256,n.token_sha256].every(v=>HEX.test(v)),'production staging record incomplete');native=native.concat([[nd+'/code','dir'],[nd+'/code/worker','file','500',n.worker_sha256],[ns+'/launcher','file','400',n.launcher_sha256],[ns+'/token','file','600',n.token_sha256]]);}
 }
 // Units are stopped only when idle with an empty cgroup; stopping such a unit signals nothing.
 const units=e.units.map(u=>requireAbsentUnits?'test \"$(systemctl show -p LoadState '+u+')\" = LoadState=not-found\n':'state=$(systemctl show -p LoadState -p ActiveState -p SubState -p MainPID -p ControlGroup '+u+')\n'+
  'printf "%s\\n" "$state" | grep -qx MainPID=0\ncg=$(printf "%s\\n" "$state" | sed -n "s/^ControlGroup=//p")\n'+
  'case "$cg" in "") ;; /system.slice/couchroot-*.service) if test -e "/sys/fs/cgroup/systemd$cg/cgroup.procs"; then test "$(wc -l < "/sys/fs/cgroup/systemd$cg/cgroup.procs")" -eq 0; fi;; *) exit 1;; esac\n'+
  'if printf "%s\\n" "$state" | grep -qx ActiveState=active; then printf "%s\\n" "$state" | grep -qx SubState=exited; systemctl stop --no-block '+u+'\n'+
  'stopped=0; for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do if systemctl show -p ActiveState '+u+' | grep -qx ActiveState=inactive; then stopped=1; break; fi; sleep 0.1; done; test "$stopped" = 1\n'+
  'elif printf "%s\\n" "$state" | grep -qx ActiveState=failed; then systemctl reset-failed '+u+'\nelse printf "%s\\n" "$state" | grep -qx ActiveState=inactive; fi\n').join('');
 const observe=observeCommand(e,{bootId,knownBootId}),prefix=observe.slice(0,observe.indexOf('for unit in '));
 const command=prefix+units+'test ! -e /opt/couchroot-observer-'+obs+'; test ! -L /opt/couchroot-observer-'+obs+'\n'+tree(pd,provider)+tree(nd,native)+'sync\n'+prefix.slice(prefix.indexOf('test "$(cat /proc/sys/kernel/random/boot_id)"'))+'printf "RESTART-CLEANED\\n"\n';
 check(Buffer.byteLength(command)<=65536,'cleanup command too large');
 return command;
}
async function cleanupRestartRollback({selectionFile,id,executor}){
 const directory=path.dirname(selectionFile);
 check(typeof id==='string'&&ID.test(id)&&privateDirectory(fs.lstatSync(directory))&&!present(selectionFile+'.writer'),'private journal and transaction required');
 check(executor&&typeof executor.status==='function'&&typeof executor.execute==='function'&&Number.isInteger(executor.pid),'held executor required');
 const state=new SelectionJournal(selectionFile).read(),h=state&&state.history.find(x=>x.id===id);
 check(state&&!state.pending&&state.selected.implementation==='managed'&&h&&h.outcome==='rolled-back','no committed restart rollback for this transaction');
 const receiptFile=path.join(directory,id+'.restart-rollback.json');check(present(receiptFile)&&hash(privateRead(receiptFile,65536))===h.state_sha256&&!present(path.join(directory,id+'.restart-rollback.pending')),'restart rollback receipt missing or unfinished');
 const intent=path.join(directory,id+INTENT),receipt=path.join(directory,id+RECEIPT);
 if(present(receipt)&&!present(intent))return Object.freeze({id,already_clean:true,receipt_sha256:hash(privateRead(receipt,65536))});
 const e=loadEvidence(directory,id,null),obs=e.provider_id;
 check(!present(path.join(directory,obs+'.observer.json'))&&!present(path.join(directory,'observer-launch.pending')),'external observer remnants require separate reconciliation');
 const command=cleanupPlan(e);
 const confirm=async()=>{
  const info=await executor.status();validateReadiness(info,{implementation:'managed',bootId:e.boot_id});validateResourceInventory(info);
  const own=processIdentities(info,executor.pid);check(own.worker_id!==e.source.worker_id&&!e.known.some(([,p])=>p.pid===own.processes.worker.pid&&p.start_ticks===own.processes.worker.start_ticks),'executor is a recorded process');return own;
 };
 const first=JSON.stringify(await confirm());
 const run=async(c,t)=>{const r=await executor.execute(c,t);check(JSON.stringify(await confirm())===first,'executor changed');return r;};
 const quiet=await run(observeCommand(e),10000);check(quiet&&quiet.exit_code===0&&!quiet.timed_out&&!quiet.stderr,'remnant observation failed');parseObservation(quiet.stdout,e.units);
 const tokens=[e.provider,e.production].filter(Boolean).map(r=>{const t=path.dirname(r.token_file);check(path.dirname(t)===directory&&/^(retirement|production)-[A-Za-z0-9]{6}$/.test(path.basename(t))&&r.token_file===t+'/token','token path outside the journal');return {dir:t,file:r.token_file,sha256:r.token_sha256};});
 if(present(intent))check(privateRead(intent,64)===id+'\n','cleanup intent changed');
 else{const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,id+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(directory);}
 try{
  await recoverObserver({directory,evidence:e,execute:run});
  const r=await run(command,25000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='RESTART-CLEANED\n','remote staging did not match its records ('+(r?(r.timed_out?'timeout':'exit '+r.exit_code)+': '+String(r.stderr||r.stdout||'').slice(-120).replace(/[^\x20-\x7e]+/g,' '):'no result')+')');
  const removed=[];
  for(const t of tokens)if(present(t.dir)){
   check(privateDirectory(fs.lstatSync(t.dir)),'token directory not private');const names=fs.readdirSync(t.dir);check(names.every(n=>n==='token'),'token directory has unknown entries');
   if(names.length){check(hash(privateRead(t.file,64))===t.sha256,'token changed');fs.unlinkSync(t.file);}fs.rmdirSync(t.dir);removed.push(path.basename(t.dir));
  }
  for(const name of [obs+'.retirement.json.readiness.pending',id+'.production.json.readiness.pending','production-launch.pending','state-install.pending','retirement-launch.pending']){
   const file=path.join(directory,name);if(!present(file))continue;
   if(name.endsWith('launch.pending')||name==='state-install.pending')check(privateRead(file,64)===(name==='retirement-launch.pending'?obs:id)+'\n','marker changed');else privateRead(file,4096);
   fs.unlinkSync(file);removed.push(name);
  }
  sync(directory);
  const result={schema:1,id,outcome:'restart-cleanup',restart_rollback_sha256:h.state_sha256,units:e.units,staging:['/opt/couchroot-retirement-'+obs,'/opt/couchroot-worker-'+id],local:removed};
  atomic(receipt,result);sync(directory);fs.unlinkSync(intent);sync(directory);
  return Object.freeze({id,receipt_sha256:hash(JSON.stringify(result)),local:removed});
 }catch(cause){throw Object.assign(Error('Restart cleanup requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={cleanupRestartRollback,cleanupPlan};
