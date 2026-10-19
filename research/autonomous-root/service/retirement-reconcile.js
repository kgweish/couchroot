'use strict';
// Reconcile a previously verified provider; never replay launch or shutdown.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {atomic}=require('./policy');
const {privateRead}=require('./retirement-readiness');
const {journal,cleanupRetirement,cleanupCommand}=require('./retirement-teardown');
const {inspectRetirementUnit}=require('./observer-unit');
const {processIdentities}=require('./worker-processes');
function check(ok){if(!ok)throw Error('Retirement reconciliation evidence unavailable');}
function present(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function pending(j,record,kind){const file=j.file+'.'+kind+'.pending';if(!present(file))return null;check(privateRead(file,64)===record.id+'\n');return file;}
function processGuard(record){return Object.values(record.provider_identity.processes).map(p=>'if test -e /proc/'+p.pid+'/stat; then line=$(cat /proc/'+p.pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" != '+p.start_ticks+'; fi\n').join('');}
function prefix(record){return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\ntest "$(cat /proc/sys/kernel/random/boot_id)" = '+record.boot_id+'\n'+processGuard(record);}
function remainderCommand(record){
 // The durable cleanup intent proves completion was inspected before the first
 // removal. Missing owned entries are allowed; replacements and extras are not.
 const d=record.directory,s=record.scope,u=record.unit;
 const dirs=[d,d+'/code',s,s+'/.jobs'],files=[[d+'/code/worker','500',record.worker_sha256],[s+'/launcher','400',record.launcher_sha256],[s+'/.jobs/lock','600',null]];
 const allowed=dirs.slice(1).concat(files.map(f=>f[0]));
 return prefix(record)+
  dirs.map(p=>'test ! -L '+p+'\nif test -e '+p+'; then test -d '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700; fi\n').join('')+
  files.map(([p,mode,sha])=>'test ! -L '+p+'\nif test -e '+p+'; then test -f '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\n'+(sha?'test "$(sha256sum '+p+' | cut -d " " -f 1)" = '+sha+'\n':'')+'fi\n').join('')+
  'if test -d '+d+'; then test "$(find '+d+' -mindepth 1 '+allowed.map(p=>'! -path '+p).join(' ')+ ' | wc -l)" -eq 0; fi\n'+
  // No signal is sent here. A previous nonblocking stop must finish before a
  // second pass can remove anything; expired observations do not repeat stop.
  'state=$(systemctl show -p LoadState -p ActiveState -p MainPID '+u+')\n'+
  'test "$(printf "%s\\n" "$state" | wc -l)" -eq 3\n'+
  'printf "%s\\n" "$state" | grep -qx "LoadState=\\(loaded\\|not-found\\)"\n'+
  'printf "%s\\n" "$state" | grep -qx ActiveState=inactive\n'+
  'printf "%s\\n" "$state" | grep -qx MainPID=0\n'+processGuard(record)+
  files.map(([p])=>'if test -e '+p+'; then rm '+p+'; fi\n').join('')+
  dirs.slice().reverse().map(p=>'if test -d '+p+'; then rmdir '+p+'; fi\n').join('')+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+record.boot_id+'\nprintf "RETIREMENT-RECONCILED\\n"\n';
}
async function reconcileRetirement(options){
 let {record}=options;const {journalDirectory,execute,confirmExecutor,executorPid}=options;
 let j=journal(record,journalDirectory);
 const intents={};for(const kind of ['shutdown','cleanup','finish'])intents[kind]=pending(j,record,kind);
 check(!present(j.file+'.readiness.pending'));
 const remote=async command=>{const r=await execute(command,5000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr);return r.stdout;};
 const confirm=async()=>{const p=processIdentities(await confirmExecutor(),executorPid);check(p.boot_id===record.boot_id&&p.worker_id!==record.provider_identity.worker_id&&Object.values(p.processes).every(v=>!v||!Object.values(record.provider_identity.processes).some(x=>x.pid===v.pid)));return JSON.stringify(p);};
 const update=next=>{j.owned();atomic(j.file,next);record=next;j=journal(record,journalDirectory);};
 try{
  if(['ready','shutdown-acknowledged','shutdown-observed'].includes(record.phase)){
   check(typeof execute==='function'&&typeof confirmExecutor==='function'&&!intents.finish);
   const executor=await confirm(),unit=await inspectRetirementUnit({unit:record.unit,bootId:record.boot_id,execute,allowMissing:!!intents.cleanup});
   check(await confirm()===executor);
   if(record.phase==='ready'){
    check(intents.shutdown&&!intents.cleanup&&unit.active_state==='active'&&unit.sub_state==='exited'&&unit.main_pid===0&&unit.exec_code===1&&unit.exec_status===0&&unit.started_monotonic===record.unit_started_monotonic);
    check(await remote(prefix(record)+'printf "EXIT-OBSERVED\\n"\n')==='EXIT-OBSERVED\n');check(await confirm()===executor);
    update({...record,phase:'shutdown-observed'});
   }
   if(intents.shutdown){fs.unlinkSync(intents.shutdown);j.sync();intents.shutdown=null;}
   if(!intents.cleanup){
    const next=await cleanupRetirement({...options,record});record=next;j=journal(record,journalDirectory);
   }else{
    const completed=unit.active_state==='active'&&unit.sub_state==='exited'&&unit.main_pid===0&&unit.exec_code===1&&unit.exec_status===0&&unit.started_monotonic===record.unit_started_monotonic;
    check(completed||(unit.active_state==='inactive'&&unit.main_pid===0&&(unit.load_state==='not-found'||unit.started_monotonic===record.unit_started_monotonic)));
    // If the first cleanup never stopped the completed unit, all original
    // artifacts must still pass the normal full-layout check before stop.
    j.owned();check(await remote(completed?cleanupCommand(record):remainderCommand(record))===(completed?'RETIREMENT-CLEANED\n':'RETIREMENT-RECONCILED\n'));check(await confirm()===executor);
    update({...record,phase:'staging-retired'});fs.unlinkSync(intents.cleanup);j.sync();intents.cleanup=null;
   }
  }
  check(['staging-retired','complete'].includes(record.phase));
  // Cleanup publication can precede deletion of its intent by one crash window.
  if(intents.cleanup){check(record.phase==='staging-retired');fs.unlinkSync(intents.cleanup);j.sync();}
  check(!intents.shutdown);
  const directory=path.dirname(record.token_file);check(path.dirname(directory)===journalDirectory);
  const exists=present(directory);
  if(exists){
   const st=fs.lstatSync(directory);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&(st.mode&0o7777)===0o700);
   const names=fs.readdirSync(directory);check(names.length===0||(names.length===1&&names[0]==='token'));
   if(names.length){check(record.phase==='staging-retired');check(crypto.createHash('sha256').update(privateRead(record.token_file,44)).digest('hex')===record.token_sha256);}
   else check(intents.finish);
  }else check(intents.finish||record.phase==='complete');
  if(!intents.finish&&record.phase!=='complete')intents.finish=j.intent('finish');
  j.owned();if(present(record.token_file))fs.unlinkSync(record.token_file);if(exists)fs.rmdirSync(directory);j.sync();
  if(record.phase!=='complete')update({...record,phase:'complete'});
  if(intents.finish){check(privateRead(intents.finish,64)===record.id+'\n');fs.unlinkSync(intents.finish);}
  j.owned();fs.unlinkSync(j.marker);j.sync();return Object.freeze(record);
 }catch(cause){throw Object.assign(Error('Retirement reconciliation incomplete'),{outcome:'unknown',cause});}
}
module.exports={reconcileRetirement,remainderCommand};
