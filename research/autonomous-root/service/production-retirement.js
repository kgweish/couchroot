'use strict';
// Retire stopped native production staging only after its exact job inventory
// has been restored to managed state. Keep local launch/token ownership pending.
const fs=require('fs'),path=require('path');
const {atomic,hash}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {runtimeRead,nativeReadiness}=require('./native-runtime');
const {selectionStatus}=require('./worker-selection');
const {planManagedRestore}=require('./managed-restore-plan');
const {planNativeSnapshot}=require('./native-retained-state');
const {validateManagedLaunch}=require('./managed-readiness');
const {processIdentities}=require('./worker-processes');
function check(ok){if(!ok)throw Error('Production retirement evidence unavailable');}
function productionRetirementPlan(inputs){
 const restored=planManagedRestore(inputs),{record,installation,snapshot}=inputs,native=planNativeSnapshot(record,installation),d=record.directory,s=record.scope,j=s+'/.jobs',u=record.unit;
 const dir=p=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n';
 const file=(p,mode,sha)=>'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\ntest "$(sha256sum '+p+' | cut -d " " -f1)" = '+sha+'\n';
 const count=(p,n)=>'test "$(find '+p+' -mindepth 1 -maxdepth 1 | wc -l)" -eq '+n+'\n';
 const verify=native.prefix+dir(d+'/code')+file(d+'/code/worker','500',record.worker_sha256)+file(s+'/launcher','400',record.launcher_sha256)+count(d,2)+count(d+'/code',1)+count(s,2)+count(j,snapshot.records.length+2)+
  'retire_record() { test -f "$1"; test ! -L "$1"; test "$(stat -c "%u:%h:%a" "$1")" = 0:1:600; test "$(sha256sum "$1" | cut -d " " -f1)" = "$2"; }\n'+snapshot.records.map(r=>'retire_record '+j+'/'+r.name+' '+r.sha256+'\n').join('');
 const command=restored.verify+'verify_native() {\n'+verify+'}\nverify_native\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+
  [['LoadState','loaded'],['ActiveState','active'],['SubState','exited'],['MainPID','0'],['ExecMainCode','1'],['ExecMainStatus','0'],['ExecMainStartTimestampMonotonic',record.unit_started_monotonic]].map(([key,value])=>'test "$(systemctl show -p '+key+' '+u+')" = '+key+'='+value+'\n').join('')+
  'systemctl stop --no-block '+u+'\nstopped=0\nfor attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do\nstate=$(systemctl show -p LoadState -p ActiveState -p MainPID '+u+')\n'+
  'test "$(printf "%s\\n" "$state" | wc -l)" -eq 3\nprintf "%s\\n" "$state" | grep -qx "LoadState=\\(loaded\\|not-found\\)"\n'+
  'if printf "%s\\n" "$state" | grep -qx ActiveState=inactive && printf "%s\\n" "$state" | grep -qx MainPID=0; then stopped=1; break; fi\nsleep 0.1\ndone\ntest "$stopped" = 1\nverify_native\n'+
  'rm '+[d+'/code/worker',s+'/launcher',j+'/lock',j+'/.import-manifest',...snapshot.records.map(r=>j+'/'+r.name)].join(' ')+'\nrmdir '+j+' '+s+' '+d+'/code '+d+'\nsync\n'+native.guard+'test ! -e '+d+'; test ! -L '+d+'\nprintf "PRODUCTION-RETIRED\\n"\n';
 const inactive='state=$(systemctl show -p LoadState -p ActiveState -p MainPID '+u+')\ntest "$(printf "%s\\n" "$state" | wc -l)" -eq 3\nprintf "%s\\n" "$state" | grep -qx ActiveState=inactive\nprintf "%s\\n" "$state" | grep -qx MainPID=0\n'+
  'if printf "%s\\n" "$state" | grep -qx LoadState=loaded; then\n'+[['ExecMainStartTimestampMonotonic',record.unit_started_monotonic],['ExecMainCode','1'],['ExecMainStatus','0']].map(([key,value])=>'test "$(systemctl show -p '+key+' '+u+')" = '+key+'='+value+'\n').join('')+
  'else printf "%s\\n" "$state" | grep -qx LoadState=not-found; fi\n';
 const prefix=restored.verify+'export DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+native.guard+inactive;
 const absent='test ! -e '+d+'; test ! -L '+d+'\n';
 const verifyRetired=prefix+absent+native.guard+'printf "PRODUCTION-ABSENT\\n"\n';
 const remaining=[[d+'/code/worker','500',record.worker_sha256],[s+'/launcher','400',record.launcher_sha256],[j+'/lock','600',hash('')],[j+'/.import-manifest','600',installation.installed_manifest_sha256],...snapshot.records.map(r=>[j+'/'+r.name,'600',r.sha256])];
 const optionalDir=(p,names)=>'if test -e '+p+' || test -L '+p+'; then\n'+dir(p)+'test "$(find '+p+' -mindepth 1 -maxdepth 1 '+names.map(n=>'! -name '+n).join(' ')+' | wc -l)" -eq 0\nfi\n';
 const partialInventory=optionalDir(d,['code','state'])+optionalDir(d+'/code',['worker'])+optionalDir(s,['launcher','.jobs'])+optionalDir(j,['lock','.import-manifest',...snapshot.records.map(r=>r.name)])+
  'remaining_file() { if test -e "$1" || test -L "$1"; then test -f "$1"; test ! -L "$1"; test "$(stat -c "%u:%h:%a" "$1")" = "0:1:$2"; test "$(sha256sum "$1" | cut -d " " -f1)" = "$3"; fi; }\n'+remaining.map(([p,m,h])=>'remaining_file '+p+' '+m+' '+h+'\n').join('');
 const finishPartial=prefix+partialInventory+native.guard+
  'for file in '+remaining.map(r=>r[0]).join(' ')+'; do if test -e "$file"; then rm "$file"; fi; done\n'+
  'for directory in '+[j,s,d+'/code',d].join(' ')+'; do if test -d "$directory"; then rmdir "$directory"; fi; done\nsync\n'+inactive+native.guard+absent+'printf "PRODUCTION-ABSENT\\n"\n';
 check(Buffer.byteLength(command)<=65536&&Buffer.byteLength(verifyRetired)<=65536&&Buffer.byteLength(finishPartial)<=65536);return {command,verifyRetired,finishPartial,record:{schema:1,id:record.id,phase:'staging-retired',boot_id:record.boot_id,worker_identity:record.worker_identity,unit:u,unit_started_monotonic:record.unit_started_monotonic,snapshot_sha256:snapshot.sha256,installation_sha256:record.state_receipt_sha256}};
}
async function retireProduction({managed,journalDirectory,selectionFile,execute,confirmManaged,resume=false,finishPartial=false,verifyOnly=false}){
 check(typeof verifyOnly==='boolean'&&(!verifyOnly||!resume&&!finishPartial)&&typeof resume==='boolean'&&typeof finishPartial==='boolean'&&(!finishPartial||resume)&&managed&&managed.phase==='ready');const {worker_identity,launcher_sha256,unit_started_monotonic,...launch}=managed;validateManagedLaunch({...launch,phase:'submitted'});
 check(typeof execute==='function'&&typeof confirmManaged==='function'&&typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&path.dirname(selectionFile)===journalDirectory);
 check(typeof launcher_sha256==='string'&&launcher_sha256.length===64&&/^[a-f0-9]+$/.test(launcher_sha256)&&typeof unit_started_monotonic==='string'&&/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic));
 check(worker_identity&&JSON.stringify(processIdentities({...worker_identity,capabilities:['worker-process-identity-v1']},worker_identity.processes.worker.pid))===JSON.stringify(worker_identity)&&worker_identity.boot_id===managed.boot_id);
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const inputFile=path.join(journalDirectory,managed.id+'.managed-restore-input.json'),inputText=privateRead(inputFile,524288),inputs=JSON.parse(inputText),plan=productionRetirementPlan(inputs);
 check(inputs.record.id===managed.origin_id&&JSON.stringify(inputs.record.worker_identity)===JSON.stringify(managed.source));
 const selected=selectionStatus(selectionFile),h=selected.history&&selected.history[selected.history.length-1],rollback=managed.id===managed.origin_id;
 check(selected.phase==='stable'&&selected.selected_implementation==='managed'&&selected.selected_manifest_sha256===managed.manifest_sha256&&h&&h.id===managed.id&&h.outcome===(rollback?'rolled-back':'committed')&&h.readiness_sha256===hash(JSON.stringify(managed))&&h.state_sha256===managed.state_receipt_sha256);
 const refs=[[managed.origin_id+'.production.json',JSON.stringify(inputs.record)],[managed.id+'.managed-launch.json',JSON.stringify(managed)],[managed.origin_id+'.state-install.json',JSON.stringify(inputs.installation)]];
 const restoreFile=path.join(journalDirectory,managed.id+'.managed-restore.json'),restoreText=privateRead(restoreFile,16384),expectedRestore={...planManagedRestore(inputs).receipt,transition_id:managed.id,quiescence_sha256:h.quiescence_sha256,input_sha256:hash(inputText)};check(hash(restoreText)===managed.state_receipt_sha256&&restoreText===JSON.stringify(expectedRestore));
 check(h.from.implementation===(rollback?'managed':'native-prototype')&&h.to.implementation===(rollback?'native-prototype':'managed')&&h.from.manifest_sha256===(rollback?managed.manifest_sha256:inputs.record.manifest_sha256)&&h.to.manifest_sha256===(rollback?inputs.record.manifest_sha256:managed.manifest_sha256));
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selected)&&privateRead(inputFile,524288)===inputText&&privateRead(restoreFile,16384)===restoreText&&(verifyOnly||privateRead(path.join(journalDirectory,'managed-restore.pending'),64)===managed.id+'\n'&&privateRead(path.join(journalDirectory,'managed-launch.pending'),64)===managed.id+'\n'));for(const [name,text] of refs)check(runtimeRead(path.join(journalDirectory,name),262144)===text);};
 const confirm=async()=>{owned();const identity=await confirmManaged();owned();check(JSON.stringify(identity)===JSON.stringify(worker_identity)&&identity.worker_id!==managed.source.worker_id&&Object.values(managed.source.processes).every(p=>p.pid!==identity.processes.worker.pid));};
 await confirm();const file=path.join(journalDirectory,managed.origin_id+'.production-retirement.json'),intent=file+'.pending';
 const receipt={...plan.record,transition_id:managed.id,managed_readiness_sha256:hash(JSON.stringify(managed))};
 const sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const optional=name=>{try{return privateRead(name,16384);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 if(verifyOnly){
  // Completed evidence is independently verifiable after activation removes
  // launch markers. This mode cannot publish, reconcile or delete anything.
  const text=JSON.stringify(receipt),verified=()=>{owned();check(optional(intent)===null&&optional(file)===text);};
  verified();const r=await execute(plan.verifyRetired,10000);await confirm();verified();
  check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='RESTORE-READY\nPRODUCTION-ABSENT\n');
  return Object.freeze({...receipt,receipt_sha256:hash(text)});
 }
 if(resume){
  const pending=optional(intent),published=optional(file),text=JSON.stringify(receipt);check((pending===text||published===text)&&(pending===null||pending===text)&&(published===null||published===text));
  if(finishPartial)check(pending===text&&published===null);
  const recoveryOwned=()=>{owned();check(optional(intent)===pending&&optional(file)===published);};
  try{
   recoveryOwned();const r=await execute(finishPartial?plan.finishPartial:plan.verifyRetired,10000);await confirm();recoveryOwned();
   check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='RESTORE-READY\nPRODUCTION-ABSENT\n');
   if(published===null)atomic(file,receipt);if(pending!==null)fs.unlinkSync(intent);sync();
   return Object.freeze({...receipt,receipt_sha256:hash(text)});
  }catch(cause){throw Object.assign(Error('Production retirement reconciliation incomplete'),{outcome:'unknown',cause});}
 }
 for(const name of [file,intent])try{fs.lstatSync(name);throw Error('Production retirement requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}
 const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(receipt));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 sync();
 try{await confirm();check(privateRead(intent,16384)===JSON.stringify(receipt));const r=await execute(plan.command,10000);await confirm();check(privateRead(intent,16384)===JSON.stringify(receipt)&&r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='RESTORE-READY\nPRODUCTION-RETIRED\n');atomic(file,receipt);fs.unlinkSync(intent);sync();return Object.freeze({...receipt,receipt_sha256:hash(JSON.stringify(receipt))});}
 catch(cause){throw Object.assign(Error('Production retirement requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={productionRetirementPlan,retireProduction};
