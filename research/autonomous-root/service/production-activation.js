'use strict';
// Finish local transition ownership only after the temporary provider is gone.
const fs=require('fs'),path=require('path');
const {atomic,hash}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {selectionStatus}=require('./worker-selection');
const {validateLaunch}=require('./production-readiness');
const {validateTeardownRecord}=require('./retirement-teardown');
const {inspectRetirementUnit}=require('./observer-unit');
const {processIdentities}=require('./worker-processes');
function check(ok){if(!ok)throw Error('Production activation evidence unavailable');}
function absent(file){try{fs.lstatSync(file);throw Error('Transition entry still exists');}catch(error){if(error.code!=='ENOENT')throw error;}}
function providerAbsentCommand(retired){
 validateTeardownRecord(retired);check(retired.phase==='complete');
 const guard='test "$(cat /proc/sys/kernel/random/boot_id)" = '+retired.boot_id+'\n';
 return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\n'+guard+Object.values(retired.provider_identity.processes).map(p=>'if test -e /proc/'+p.pid+'/stat; then line=$(cat /proc/'+p.pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" != '+p.start_ticks+'; fi\n').join('')+
  'test ! -e '+retired.directory+'; test ! -L '+retired.directory+'\n'+guard+'printf "PROVIDER-ABSENT\\n"\n';
}
async function activateProduction({record,retired,journalDirectory,selectionFile,execute,confirmNative,resume=false}){
 check(record&&record.phase==='ready');const {worker_identity,unit_started_monotonic,...launch}=record;validateLaunch({...launch,phase:'submitted'});validateTeardownRecord(retired);
 check(worker_identity&&worker_identity.processes&&worker_identity.processes.worker&&worker_identity.processes.guardian&&worker_identity.boot_id===record.boot_id&&/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic));
 check(JSON.stringify(processIdentities({...worker_identity,implementation:'native-prototype',guardian_pid:worker_identity.processes.guardian.pid,capabilities:['worker-process-identity-v1']},worker_identity.processes.worker.pid))===JSON.stringify(worker_identity));

 check([retired.source,retired.provider_identity].every(s=>s.worker_id!==worker_identity.worker_id&&Object.values(worker_identity.processes).every(p=>Object.values(s.processes).every(q=>!q||p.pid!==q.pid))));
 check(retired.phase==='complete'&&retired.id!==record.id&&retired.boot_id===record.boot_id&&retired.device===record.device&&retired.manifest_sha256===record.manifest_sha256&&JSON.stringify(retired.source)===JSON.stringify(record.source));
 check(typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof selectionFile==='string'&&path.dirname(selectionFile)===journalDirectory&&typeof execute==='function'&&typeof confirmNative==='function');
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const tokenDirectory=path.dirname(record.token_file);check(path.dirname(tokenDirectory)===journalDirectory&&record.token_file===tokenDirectory+'/token'&&path.dirname(path.dirname(retired.token_file))===journalDirectory);
 const readiness=hash(JSON.stringify(record)),retirement=hash(JSON.stringify(retired)),selected=selectionStatus(selectionFile),history=selected.history&&selected.history[selected.history.length-1];
 check(selected.phase==='stable'&&selected.selected_implementation==='native-prototype'&&selected.selected_manifest_sha256===record.manifest_sha256&&history&&history.id===record.id&&history.outcome==='committed'&&history.readiness_sha256===readiness&&history.state_sha256===record.state_receipt_sha256);
 const file=path.join(journalDirectory,record.id+'.activation.json'),intent=file+'.pending',productionFile=path.join(journalDirectory,record.id+'.production.json'),retirementFile=path.join(journalDirectory,retired.id+'.retirement.json');
 const launchMarker=path.join(journalDirectory,'production-launch.pending'),stateMarker=path.join(journalDirectory,'state-install.pending');
 const owned=()=>{
  check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selected)&&privateRead(productionFile,16384)===JSON.stringify(record)&&privateRead(retirementFile,16384)===JSON.stringify(retired));
  for(const p of ['retirement-launch.pending',retired.id+'.retirement.json.shutdown.pending',retired.id+'.retirement.json.cleanup.pending',retired.id+'.retirement.json.finish.pending',record.id+'.production.json.readiness.pending'])absent(path.join(journalDirectory,p));
  absent(path.dirname(retired.token_file));check(hash(privateRead(path.join(journalDirectory,record.id+'.state-install.json'),16384))===record.state_receipt_sha256);
 };
 const activation={schema:1,id:record.id,phase:'active',boot_id:record.boot_id,manifest_sha256:record.manifest_sha256,readiness_sha256:readiness,retirement_sha256:retirement,worker_identity},text=JSON.stringify(activation);
 check(typeof resume==='boolean');
 const exists=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const layout=()=>{
  const pending=exists(intent),published=exists(file),state=exists(stateMarker),launch=exists(launchMarker),directory=exists(tokenDirectory);
  if(pending)check(privateRead(intent,16384)===text);if(published)check(privateRead(file,16384)===text);
  if(state)check(privateRead(stateMarker,64)===record.id+'\n');if(launch)check(privateRead(launchMarker,64)===record.id+'\n');
  let tokenState='absent';
  if(directory){const s=fs.lstatSync(tokenDirectory);check(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.geteuid()&&(s.mode&0o7777)===0o700);const entries=fs.readdirSync(tokenDirectory);check(entries.length===0||entries.join('|')==='token');tokenState=entries.length?'present':'empty';if(entries.length)check(hash(privateRead(record.token_file,44))===record.token_sha256);}
  // These are the only ordered cleanup windows. No missing-intent inference
  // authorizes adopting a partially removed token or marker layout.
  check(!state||launch);check(state&&launch||tokenState==='absent');
  check(!published||!state&&!launch&&tokenState==='absent');
  return {pending,published,state,launch,tokenState};
 };
 owned();let initial=layout();
 if(resume)check(initial.pending||initial.published&&!initial.state&&!initial.launch&&initial.tokenState==='absent');
 else{
  check(!initial.pending&&!initial.published&&initial.state&&initial.launch&&initial.tokenState==='present');
  const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}initial=layout();
 }
 const sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};sync();
 const started=process.hrtime(),current=()=>{const t=process.hrtime(started);check(t[0]*1000+t[1]/1000000<15000);owned();check(JSON.stringify(layout())===JSON.stringify(initial));};
 const confirm=async()=>{current();const actual=await confirmNative();current();check(JSON.stringify(actual)===JSON.stringify(worker_identity));};
 try{
  await confirm();
  const unit=await inspectRetirementUnit({unit:retired.unit,bootId:record.boot_id,execute,allowMissing:true});current();
  check(unit.active_state==='inactive'&&unit.sub_state==='dead'&&unit.main_pid===0&&(unit.load_state==='not-found'||unit.started_monotonic===retired.unit_started_monotonic&&unit.exec_code===1&&unit.exec_status===0));
  const result=await execute(providerAbsentCommand(retired),5000);current();check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout==='PROVIDER-ABSENT\n');await confirm();
  if(initial.tokenState==='present')fs.unlinkSync(record.token_file);
  if(initial.tokenState!=='absent')fs.rmdirSync(tokenDirectory);sync();owned();
  if(initial.state)fs.unlinkSync(stateMarker);if(initial.launch)fs.unlinkSync(launchMarker);sync();owned();
  if(!initial.published)atomic(file,activation);check(privateRead(file,16384)===text);
  if(initial.pending){check(privateRead(intent,16384)===text);fs.unlinkSync(intent);}sync();
  return Object.freeze({...activation,receipt_sha256:hash(text)});
 }catch(cause){throw Object.assign(Error('Production activation requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={activateProduction,providerAbsentCommand};
