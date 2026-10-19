'use strict';
// Install byte-preserved records into a fresh native scope. A pending marker
// keeps native startup closed until all records and the source are rechecked.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {atomic}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {validateRecord,sourceExitGuard,snapshotManagedJobs}=require('./retained-state');
const {SelectionJournal,selectionStatus}=require('./worker-selection');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(ok){if(!ok)throw Error('Retained state installation evidence unavailable');}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.slice().sort().join('|');}
function validateSnapshot(value){
 check(exact(value,['schema','implementation','source','records','sha256'])&&value.schema===1&&value.implementation==='managed');sourceExitGuard(value.source);
 check(Array.isArray(value.records)&&value.records.length<=64);let previous='';
 for(const r of value.records){
  check(exact(r,['name','size','sha256','base64'])&&typeof r.base64==='string'&&r.base64.length<=2732&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&r.sha256.length===64);
  const bytes=Buffer.from(r.base64,'base64');check(bytes.toString('base64')===r.base64&&bytes.length===r.size&&hash(bytes)===r.sha256&&r.name>previous);validateRecord(r.name,bytes);previous=r.name;
 }
 const {sha256,...body}=value;check(typeof sha256==='string'&&sha256.length===64&&hash(Buffer.from(JSON.stringify(body)))===sha256);
 return value;
}
function planInstallation({snapshot,id,manifestSha256}){
 validateSnapshot(snapshot);check(typeof id==='string'&&id.length===32&&/^[a-f0-9]+$/.test(id)&&typeof manifestSha256==='string'&&manifestSha256.length===64&&/^[a-f0-9]+$/.test(manifestSha256));
 const directory='/opt/couchroot-worker-'+id,scope=directory+'/state',jobs=scope+'/.jobs',pending=jobs+'/.import-pending',committed=jobs+'/.import-manifest';
 const manifest={schema:1,id,implementation:'native-prototype',manifest_sha256:manifestSha256,source:snapshot.source,snapshot_sha256:snapshot.sha256,records:snapshot.records.map(({name,size,sha256})=>({name,size,sha256}))};
 const bytes=Buffer.from(JSON.stringify(manifest)),manifestHash=hash(bytes);
 const prefix='set -eu\nPATH=/usr/bin:/bin\nexport PATH\numask 077\ntest -d /opt; test ! -L /opt\n'+sourceExitGuard(snapshot.source);
 const dir=p=>'test ! -L '+p+'; test -d '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n';
 const file=(p,sha)=>'test ! -L '+p+'; test -f '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:600\n'+(sha?'test "$(sha256sum '+p+' | cut -d " " -f1)" = '+sha+'\n':'');
 const layout=dir(directory)+dir(scope)+dir(jobs)+
  'test "$(find '+directory+' -mindepth 1 -maxdepth 1 | wc -l)" -eq 1\ntest "$(find '+scope+' -mindepth 1 -maxdepth 1 | wc -l)" -eq 1\n'+
  'test "$(find '+jobs+' -mindepth 1 -maxdepth 1 '+['.import-pending','.import-manifest','.import-record',...snapshot.records.map(r=>r.name)].map(n=>'! -name '+n).join(' ')+ ' | wc -l)" -eq 0\n';
 const pendingGuard=layout+file(pending,manifestHash)+'test ! -e '+committed+'; test ! -L '+committed+'\n';
 const create=(p,data)=>'(set -C; printf %s '+data.toString('base64')+' | base64 -d > '+p+')\n';
 const recordsGuard=snapshot.records.map(r=>file(jobs+'/'+r.name,r.sha256)).join('');
 const readyGuard=layout+file(committed,manifestHash)+'test ! -e '+pending+'; test ! -L '+pending+'\ntest ! -e '+jobs+'/.import-record; test ! -L '+jobs+'/.import-record\n'+recordsGuard;
 const inspect=prefix+'if test ! -e '+directory+'; then test ! -L '+directory+'; printf "STATE-ABSENT\\n"; else\n'+
  'if test -e '+committed+'; then\n'+readyGuard+'printf "STATE-READY\\n"\nelse\n'+pendingGuard+
  'if test -e '+jobs+'/.import-record || test -L '+jobs+'/.import-record; then\n'+file(jobs+'/.import-record')+'test "$(stat -c %s '+jobs+'/.import-record)" -lt 2048\nfi\nprintf "STATE-PENDING\\n"\nfi\nfi\n'+sourceExitGuard(snapshot.source);
 const begin=prefix+'test ! -e '+directory+'; test ! -L '+directory+'\nmkdir '+directory+' '+scope+' '+jobs+'\n'+create(pending,bytes)+'sync\n'+pendingGuard+'printf "STATE-PENDING\\n"\n';
 const copies=snapshot.records.map(r=>prefix+pendingGuard+
  'if test -e '+jobs+'/'+r.name+' || test -L '+jobs+'/'+r.name+'; then\n'+file(jobs+'/'+r.name,r.sha256)+'else\n'+
  'if test -e '+jobs+'/.import-record || test -L '+jobs+'/.import-record; then\n'+file(jobs+'/.import-record')+'test "$(stat -c %s '+jobs+'/.import-record)" -lt 2048\nrm '+jobs+'/.import-record\nfi\n'+
  create(jobs+'/.import-record',Buffer.from(r.base64,'base64'))+file(jobs+'/.import-record',r.sha256)+
  'test ! -e '+jobs+'/'+r.name+'; test ! -L '+jobs+'/'+r.name+'\nmv '+jobs+'/.import-record '+jobs+'/'+r.name+'\nfi\nprintf "STATE-RECORD\\n"\n');
 const commit=prefix+pendingGuard+recordsGuard+'test ! -e '+jobs+'/.import-record; test ! -L '+jobs+'/.import-record\nsync\n'+sourceExitGuard(snapshot.source)+
  'mv '+pending+' '+committed+'\nsync\n'+sourceExitGuard(snapshot.source)+'printf "STATE-READY\\n"\n';
 const discardScratch=prefix+pendingGuard+'if test -e '+jobs+'/.import-record || test -L '+jobs+'/.import-record; then\n'+file(jobs+'/.import-record')+'test "$(stat -c %s '+jobs+'/.import-record)" -lt 2048\nrm '+jobs+'/.import-record\nfi\nprintf "STATE-SCRATCH-CLEAR\\n"\n';
 const record={schema:1,id,phase:'pending',source:snapshot.source,snapshot_sha256:snapshot.sha256,manifest_sha256:manifestSha256,installed_manifest_sha256:manifestHash,directory,scope};
 const verifyReady=prefix+readyGuard+sourceExitGuard(snapshot.source)+'printf "STATE-READY\\n"\n';
 for(const command of [inspect,verifyReady,begin,commit,discardScratch,...copies])check(Buffer.byteLength(command)<=65536);
 return {record,inspect,verifyReady,begin,copies,commit,discardScratch};
}
async function installRetainedState(options){
 const {journalDirectory,selectionFile,execute}=options;
 check(typeof execute==='function'&&typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof selectionFile==='string'&&path.dirname(selectionFile)===journalDirectory);
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const snapshot=JSON.parse(JSON.stringify(options.snapshot)),plan=planInstallation({...options,snapshot}),{id}=plan.record;
 const selected=()=>{const s=selectionStatus(selectionFile),p=s.pending;check(s.phase==='reconciliation-required'&&p&&p.id===id&&p.phase==='prepared'&&p.from.implementation==='managed'&&p.to.implementation==='native-prototype'&&p.to.manifest_sha256===options.manifestSha256);return p.quiescence_sha256;};
 const quiescence=selected(),file=path.join(journalDirectory,id+'.state-install.json'),saved=path.join(journalDirectory,id+'.retained-snapshot.json'),marker=path.join(journalDirectory,'state-install.pending');
 const record={...plan.record,quiescence_sha256:quiescence},serialized=JSON.stringify(record),snapshotText=JSON.stringify(snapshot);
 const sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const create=(p,data)=>{const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 let localText=serialized;
 if(options.resume===true){localText=privateRead(file,16384);check(privateRead(marker,64)===id+'\n'&&[serialized,JSON.stringify({...record,phase:'ready'})].includes(localText)&&privateRead(saved,262144)===snapshotText);}
 else{check(options.resume===undefined||options.resume===false);for(const p of [marker,file,saved])try{fs.lstatSync(p);throw Error('State installation requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}create(marker,id+'\n');create(saved,snapshotText);create(file,serialized);sync();}
 const owned=()=>{check(selected()===quiescence&&privateRead(marker,64)===id+'\n'&&privateRead(file,16384)===localText&&privateRead(saved,262144)===snapshotText);};
 const started=process.hrtime();
 const run=async command=>{owned();const r=await execute(command,25000),t=process.hrtime(started);owned();check(t[0]*1000+t[1]/1000000<120000&&r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string');return r.stdout;};
 try{
  const before=await snapshotManagedJobs({source:snapshot.source,execute:async(c,t)=>{owned();const r=await execute(c,t);owned();return r;}});check(before.sha256===snapshot.sha256);
  let phase=await run(plan.inspect);check(['STATE-ABSENT\n','STATE-PENDING\n','STATE-READY\n'].includes(phase));
  if(phase==='STATE-ABSENT\n'){check(!options.resume);phase=await run(plan.begin);check(phase==='STATE-PENDING\n');}
  if(phase==='STATE-PENDING\n'){check(await run(plan.discardScratch)==='STATE-SCRATCH-CLEAR\n');for(const command of plan.copies)check(await run(command)==='STATE-RECORD\n');}
  const after=await snapshotManagedJobs({source:snapshot.source,execute:async(c,t)=>{owned();const r=await execute(c,t);owned();return r;}});check(after.sha256===snapshot.sha256);
  if(phase!=='STATE-READY\n')check(await run(plan.commit)==='STATE-READY\n');
  check(await run(plan.inspect)==='STATE-READY\n');owned();
  const ready={...record,phase:'ready'};atomic(file,ready);
  // The controller must consume this receipt before releasing the transition
  // marker or changing selection. A state copy does not authorize native launch.
  return Object.freeze({...ready,receipt_sha256:hash(Buffer.from(JSON.stringify(ready)))});
 }catch(cause){throw Object.assign(Error('Retained state installation requires reconciliation'),{outcome:'unknown',cause});}
}
// Consume a durable installation receipt only after independently reading both
// inventories again. Selection remains pending; this is not launch readiness.
async function acceptRetainedState({id,manifestSha256,receiptSha256,journalDirectory,selectionFile,execute}){
 check(typeof execute==='function'&&typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof selectionFile==='string'&&path.dirname(selectionFile)===journalDirectory);
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 check(typeof id==='string'&&/^[a-f0-9]{32}$/.test(id)&&id.length===32&&typeof receiptSha256==='string'&&/^[a-f0-9]{64}$/.test(receiptSha256)&&receiptSha256.length===64);
 const file=path.join(journalDirectory,id+'.state-install.json'),saved=path.join(journalDirectory,id+'.retained-snapshot.json'),marker=path.join(journalDirectory,'state-install.pending');
 const snapshotText=privateRead(saved,262144),snapshot=validateSnapshot(JSON.parse(snapshotText));
 const plan=planInstallation({snapshot,id,manifestSha256}),text=privateRead(file,16384),record=JSON.parse(text);
 const expected={...plan.record,quiescence_sha256:record.quiescence_sha256,phase:'ready'};
 check(text===JSON.stringify(expected)&&hash(Buffer.from(text))===receiptSha256);
 const initial=selectionStatus(selectionFile),p=initial.pending;
 check(initial.phase==='reconciliation-required'&&p&&p.id===id&&['prepared','state-ready'].includes(p.phase)&&p.from.implementation==='managed'&&p.to.implementation==='native-prototype'&&p.to.manifest_sha256===manifestSha256&&p.quiescence_sha256===record.quiescence_sha256);
 if(p.phase==='state-ready')check(p.state_sha256===receiptSha256);
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(initial)&&privateRead(marker,64)===id+'\n'&&privateRead(file,16384)===text&&privateRead(saved,262144)===snapshotText);};
 owned();
 const started=process.hrtime(),within=()=>{const elapsed=process.hrtime(started);check(elapsed[0]*1000+elapsed[1]/1000000<120000);};
 const checkedExecute=async(command,timeout)=>{within();owned();const result=await execute(command,timeout);within();owned();return result;};
 const before=await snapshotManagedJobs({source:snapshot.source,execute:checkedExecute});check(before.sha256===snapshot.sha256);
 const installed=await checkedExecute(plan.inspect,25000);check(installed&&installed.exit_code===0&&!installed.timed_out&&!installed.stderr&&installed.stdout==='STATE-READY\n');
 const after=await snapshotManagedJobs({source:snapshot.source,execute:checkedExecute});check(after.sha256===snapshot.sha256);owned();
 if(p.phase==='state-ready')return new SelectionJournal(selectionFile).read();
 try{return new SelectionJournal(selectionFile).advance(initial.revision,id,'state-ready',receiptSha256);}
 catch(cause){throw Object.assign(Error('Retained state acceptance requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={installRetainedState,acceptRetainedState,planInstallation,validateSnapshot};
