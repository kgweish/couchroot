'use strict';
const {privateDirectory}=require('./private-state');
const fs=require('fs'),path=require('path');
const {atomic}=require('./policy');
const {validateRecord,privateRead}=require('./retirement-readiness');
const {processIdentities}=require('./worker-processes');
const {validateProvider}=require('./observer-retirement');
const crypto=require('crypto');
const {inspectRetirementUnit}=require('./observer-unit');
function check(ok){if(!ok)throw Error('Retirement teardown ownership unavailable');}
function validate(record){
 const {provider_identity,unit_started_monotonic,...launch}=record;
 check(['ready','shutdown-acknowledged','shutdown-observed','staging-retired','complete'].includes(launch.phase));
 validateRecord({...launch,phase:'submitted'});
 check(typeof unit_started_monotonic==='string'&&/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic));
 const p=provider_identity;
 check(p&&p.boot_id===record.boot_id&&p.processes&&p.processes.guardian);
 check(JSON.stringify(processIdentities({...p,capabilities:['worker-process-identity-v1'],implementation:'native-prototype',guardian_pid:p.processes.guardian.pid},p.processes.worker.pid))===JSON.stringify(p));
 check(p.worker_id!==record.source.worker_id&&Object.values(p.processes).every(v=>v.pid>1&&!Object.values(record.source.processes).some(s=>s&&s.pid===v.pid)));
}
function journal(record,directory){
 validate(record);check(typeof directory==='string'&&path.isAbsolute(directory));
 const st=fs.lstatSync(directory);check(privateDirectory(st));
 const file=path.join(directory,record.id+'.retirement.json'),marker=path.join(directory,'retirement-launch.pending');
 const owned=()=>{check(privateRead(file,16384)===JSON.stringify(record));check(privateRead(marker,64)===record.id+'\n');};
 const sync=()=>{const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const intent=kind=>{owned();const f=file+'.'+kind+'.pending',fd=fs.openSync(f,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,record.id+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync();return f;};
 owned();return {file,marker,owned,sync,intent};
}
async function shutdownRetirement({record,journalDirectory,channel}){
 const j=journal(record,journalDirectory);check(record.phase==='ready');
 const peer=channel&&channel._conn;check(peer&&peer.identity&&peer.identity.pid===record.provider_identity.processes.worker.pid);
 const identity=validateProvider(await channel.operation({op:'status'}),peer,{bootId:record.boot_id,launcherSha256:record.launcher_sha256},record.source);
 check(channel._conn===peer&&JSON.stringify(identity)===JSON.stringify(record.provider_identity));
 const intent=j.intent('shutdown');
 try{
  const result=await channel.shutdown();check(result&&result.acknowledged===true&&result.disconnected===true);
  j.owned();check(privateRead(intent,64)===record.id+'\n');
  const next={...record,phase:'shutdown-acknowledged'};atomic(j.file,next);
  fs.unlinkSync(intent);j.sync();return Object.freeze(next);
 }catch(cause){throw Object.assign(Error('Retirement shutdown requires reconciliation'),{outcome:'unknown',cause});}
}
function cleanupCommand(record){
 validate(record);const d=record.directory,s=record.scope,u=record.unit;
 const guard='test "$(cat /proc/sys/kernel/random/boot_id)" = '+record.boot_id+'\n';
 const absent=Object.values(record.provider_identity.processes).map(p=>'if test -e /proc/'+p.pid+'/stat; then line=$(cat /proc/'+p.pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" != '+p.start_ticks+'; fi\n').join('');
 const dir=p=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n';
 const artifact=(p,mode,hash)=>'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\n'+(hash?'test "$(sha256sum '+p+' | cut -d " " -f 1)" = '+hash+'\n':'');
 const count=(p,n)=>'test "$(find '+p+' -mindepth 1 -maxdepth 1 | wc -l)" -eq '+n+'\n';
 return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+guard+absent+
  dir(d)+dir(d+'/code')+dir(s)+dir(s+'/.jobs')+
  artifact(d+'/code/worker','500',record.worker_sha256)+artifact(s+'/launcher','400',record.launcher_sha256)+artifact(s+'/.jobs/lock','600')+
  count(d,2)+count(d+'/code',1)+count(s,2)+count(s+'/.jobs',1)+
  'test ! -e '+s+'/token; test ! -L '+s+'/token\n'+
  'test ! -e '+s+'/.jobs/guardian; test ! -L '+s+'/.jobs/guardian\n'+
  'test "$(systemctl show -p MainPID '+u+')" = MainPID=0\n'+
  'test "$(systemctl show -p ExecMainStartTimestampMonotonic '+u+')" = ExecMainStartTimestampMonotonic='+record.unit_started_monotonic+'\n'+
  'systemctl stop --no-block '+u+'\nstopped=0\nfor attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do\n'+
  'state=$(systemctl show -p LoadState -p ActiveState -p MainPID '+u+')\n'+
  'test "$(printf "%s\\n" "$state" | wc -l)" -eq 3\n'+
  'printf "%s\\n" "$state" | grep -qx "LoadState=\\(loaded\\|not-found\\)"\n'+
  'if printf "%s\\n" "$state" | grep -qx ActiveState=inactive && printf "%s\\n" "$state" | grep -qx MainPID=0; then stopped=1; break; fi\nsleep 0.1\ndone\ntest "$stopped" = 1\n'+guard+absent+
  'rm '+d+'/code/worker '+s+'/launcher '+s+'/.jobs/lock\nrmdir '+s+'/.jobs '+s+' '+d+'/code '+d+'\n'+guard+'printf "RETIREMENT-CLEANED\\n"\n';
}
async function waitRetirementCompletion(record,execute){
 const started=process.hrtime();
 for(;;){
  const unit=await inspectRetirementUnit({unit:record.unit,bootId:record.boot_id,execute});
  check(unit.started_monotonic===record.unit_started_monotonic&&unit.exec_status===0);
  if(unit.active_state==='active'&&unit.sub_state==='exited'&&unit.main_pid===0&&unit.exec_code===1)return unit;
  // BYE belongs to the worker. Its guardian and systemd can still be finishing
  // after that socket closes; observe this known running identity, never signal it.
  check(unit.active_state==='active'&&unit.sub_state==='running'&&unit.main_pid===record.provider_identity.processes.guardian.pid&&unit.exec_code===0);
  const elapsed=process.hrtime(started);check(elapsed[0]*1000+elapsed[1]/1000000<5000);
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}
async function cleanupRetirement({record,journalDirectory,execute,confirmExecutor,executorPid}){
 const j=journal(record,journalDirectory);check(['shutdown-acknowledged','shutdown-observed'].includes(record.phase)&&typeof execute==='function'&&typeof confirmExecutor==='function');
 const confirm=async()=>{const p=processIdentities(await confirmExecutor(),executorPid);check(p.boot_id===record.boot_id&&p.worker_id!==record.provider_identity.worker_id&&Object.values(p.processes).every(v=>!v||!Object.values(record.provider_identity.processes).some(x=>x.pid===v.pid)));return JSON.stringify(p);};
 const executor=await confirm();await waitRetirementCompletion(record,execute);
 check(await confirm()===executor);const intent=j.intent('cleanup');
 try{
  const result=await execute(cleanupCommand(record),5000);
  check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout==='RETIREMENT-CLEANED\n');
  check(await confirm()===executor);j.owned();check(privateRead(intent,64)===record.id+'\n');
  // Keep the launch marker until service-owned token material has also been
  // reconciled. Remote cleanup alone never admits a replacement session.
  const next={...record,phase:'staging-retired'};atomic(j.file,next);fs.unlinkSync(intent);j.sync();return Object.freeze(next);
 }catch(cause){throw Object.assign(Error('Retirement cleanup requires reconciliation'),{outcome:'unknown',cause});}
}
function finishRetirement({record,journalDirectory}){
 const j=journal(record,journalDirectory);check(record.phase==='staging-retired');
 const directory=path.dirname(record.token_file);
 check(path.dirname(directory)===journalDirectory);
 const st=fs.lstatSync(directory);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&(st.mode&0o7777)===0o700);
 check(fs.readdirSync(directory).join('|')==='token');
 check(crypto.createHash('sha256').update(privateRead(record.token_file,44)).digest('hex')===record.token_sha256);
 const intent=j.intent('finish');
 try{
  fs.unlinkSync(record.token_file);fs.rmdirSync(directory);j.sync();j.owned();
  const next={...record,phase:'complete'};atomic(j.file,next);
  check(privateRead(intent,64)===record.id+'\n');check(privateRead(j.marker,64)===record.id+'\n');
  fs.unlinkSync(intent);fs.unlinkSync(j.marker);j.sync();return Object.freeze(next);
 }catch(cause){throw Object.assign(Error('Retirement completion requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={shutdownRetirement,cleanupRetirement,cleanupCommand,finishRetirement,journal,validateTeardownRecord:validate};
