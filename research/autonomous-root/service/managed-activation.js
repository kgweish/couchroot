'use strict';
// Publish local rollback activation only after combined live completion evidence.
const fs=require('fs'),path=require('path');
const {hash,atomic}=require('./policy');
const {privateRead}=require('./private-state');
const {readRuntime,nativeReadiness}=require('./native-runtime');
const {verifyManagedCompletion}=require('./managed-completion');
const {selectionStatus}=require('./worker-selection');
function check(ok){if(!ok)throw Error('Managed activation ownership unavailable');}
function exists(p){try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function activationRecord(managed,proof){return {schema:1,id:managed.id,phase:'active',boot_id:managed.boot_id,manifest_sha256:managed.manifest_sha256,readiness_sha256:proof.managed_readiness_sha256,production_retirement_sha256:proof.production_retirement_sha256,provider_retirement_sha256:proof.provider_retirement_sha256,worker_identity:managed.worker_identity};}
function cleanupSteps(native,managed,journalDirectory,includeNative){
 for(const record of [native,managed])check(path.dirname(path.dirname(record.token_file))===journalDirectory&&path.basename(record.token_file)==='token');
 const steps=[];if(includeNative)steps.push({kind:'file',path:native.token_file,sha256:native.token_sha256},{kind:'directory',path:path.dirname(native.token_file)},{kind:'file',path:path.join(journalDirectory,'state-install.pending'),sha256:hash(native.id+'\n')},{kind:'file',path:path.join(journalDirectory,'production-launch.pending'),sha256:hash(native.id+'\n')});
 steps.push({kind:'file',path:managed.token_file,sha256:managed.token_sha256},{kind:'directory',path:path.dirname(managed.token_file)},{kind:'file',path:path.join(journalDirectory,'managed-restore.pending'),sha256:hash(managed.id+'\n')},{kind:'file',path:path.join(journalDirectory,'managed-launch.pending'),sha256:hash(managed.id+'\n')});
 return steps;
}
function verifyNativeActivation(native,journalDirectory,selectionFile){
  const active=JSON.parse(privateRead(path.join(journalDirectory,native.id+'.activation.json'),16384)),selected=selectionStatus(selectionFile),readiness=nativeReadiness(journalDirectory,native),original=readRuntime(journalDirectory,native.id).original;
  check(selected.history&&selected.history.some(h=>h.id===native.id&&h.outcome==='committed'&&h.to.implementation==='native-prototype'&&h.to.manifest_sha256===native.manifest_sha256&&h.readiness_sha256===readiness));
  check(active.schema===1&&active.id===native.id&&active.phase==='active'&&active.boot_id===original.boot_id&&active.manifest_sha256===native.manifest_sha256&&active.readiness_sha256===readiness&&JSON.stringify(active.worker_identity)===JSON.stringify(original.worker_identity));
}
async function resumeManaged(options,managed,proof,inputsText,file,intent){
 const {journalDirectory,selectionFile}=options,native=JSON.parse(inputsText).record,activation=activationRecord(managed,proof),text=JSON.stringify(activation);
 const all=cleanupSteps(native,managed,journalDirectory,true),selected=JSON.stringify(selectionStatus(selectionFile));
 const stable=()=>{check(JSON.stringify(selectionStatus(selectionFile))===selected&&privateRead(path.join(journalDirectory,managed.id+'.managed-restore-input.json'),524288)===inputsText&&privateRead(path.join(journalDirectory,managed.id+'.managed-launch.json'),16384)===JSON.stringify(managed));};
 if(!exists(intent)){
  stable();check(privateRead(file,16384)===text&&all.every(step=>!exists(step.path)));
  check(JSON.stringify(await verifyManagedCompletion({...options,managed}))===JSON.stringify(proof));stable();check(privateRead(file,16384)===text&&all.every(step=>!exists(step.path)));
  return Object.freeze({...activation,receipt_sha256:hash(text)});
 }
 const intentText=privateRead(intent,16384),saved=JSON.parse(intentText);
 check(Array.isArray(saved.steps)&&(saved.steps.length===4||saved.steps.length===8));
 const steps=cleanupSteps(native,managed,journalDirectory,saved.steps.length===8);
 check(intentText===JSON.stringify({schema:1,activation,input_sha256:hash(inputsText),steps}));
 const owned=()=>{stable();check(privateRead(intent,16384)===intentText);};
 const layout=()=>{
  owned();if(steps.length===4){check(all.slice(0,4).every(step=>!exists(step.path)));verifyNativeActivation(native,journalDirectory,selectionFile);}
  let remaining=false,first=steps.length;
  steps.forEach((step,i)=>{
   if(!exists(step.path)){check(!remaining);return;}
   if(!remaining){remaining=true;first=i;}
   if(step.kind==='file')check(hash(privateRead(step.path,64))===step.sha256);
   else{const st=fs.lstatSync(step.path),entries=fs.readdirSync(step.path);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&(st.mode&0o7777)===0o700&&entries.join('|')===(exists(step.path+'/token')?'token':''));}
  });
  const published=exists(file);if(published)check(first===steps.length&&privateRead(file,16384)===text);
  return {first,published};
 };
 const initial=layout(),sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 try{
  check(JSON.stringify(await verifyManagedCompletion({...options,managed}))===JSON.stringify(proof));check(JSON.stringify(layout())===JSON.stringify(initial));
  for(let i=initial.first;i<steps.length;i++){
   check(layout().first===i);const step=steps[i];if(step.kind==='file')fs.unlinkSync(step.path);else{check(fs.readdirSync(step.path).length===0);fs.rmdirSync(step.path);}sync();
  }
  owned();check(layout().first===steps.length);if(!initial.published)atomic(file,activation);check(privateRead(file,16384)===text);fs.unlinkSync(intent);sync();
  return Object.freeze({...activation,receipt_sha256:hash(text)});
 }catch(cause){throw Object.assign(Error('Managed activation reconciliation incomplete'),{outcome:'unknown',cause});}
}
async function activateManaged(options){
 check(options.resume===undefined||typeof options.resume==='boolean');
 const {journalDirectory,selectionFile}=options,managed=JSON.parse(JSON.stringify(options.managed));
 const proof=await verifyManagedCompletion({...options,managed});
 const inputsText=privateRead(path.join(journalDirectory,managed.id+'.managed-restore-input.json'),524288),inputs=JSON.parse(inputsText),native=inputs.record;
 const file=path.join(journalDirectory,managed.id+'.managed-activation.json'),intent=file+'.pending';
 if(options.resume)return resumeManaged(options,managed,proof,inputsText,file,intent);
 check(!exists(file)&&!exists(intent));
 const tokenState=record=>{const directory=path.dirname(record.token_file);check(path.dirname(directory)===journalDirectory&&record.token_file===directory+'/token');
  if(!exists(directory))return false;
  const st=fs.lstatSync(directory);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&(st.mode&0o7777)===0o700&&fs.readdirSync(directory).join('|')==='token'&&hash(privateRead(record.token_file,44))===record.token_sha256);return true;};
 const marker=(name,id)=>{const p=path.join(journalDirectory,name);if(!exists(p))return false;check(privateRead(p,64)===id+'\n');return true;};
 check(tokenState(managed)&&marker('managed-restore.pending',managed.id)&&marker('managed-launch.pending',managed.id));
 const nativeToken=tokenState(native),state=marker('state-install.pending',native.id),launch=marker('production-launch.pending',native.id);
 check(nativeToken===state&&state===launch);
 if(!nativeToken){
  // Native activation may already have retired its local ownership. Require
  // its durable receipt; absence alone does not prove completed activation.
  verifyNativeActivation(native,journalDirectory,selectionFile);
 }
 const activation=activationRecord(managed,proof),text=JSON.stringify(activation);
 const steps=cleanupSteps(native,managed,journalDirectory,nativeToken);
 const selected=JSON.stringify(selectionStatus(selectionFile)),ownership={schema:1,activation,input_sha256:hash(inputsText),steps},intentText=JSON.stringify(ownership);
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===selected&&privateRead(path.join(journalDirectory,managed.id+'.managed-restore-input.json'),524288)===inputsText&&privateRead(path.join(journalDirectory,managed.id+'.managed-launch.json'),16384)===JSON.stringify(managed)&&privateRead(intent,16384)===intentText);};
 const sync=()=>{const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const fd=fs.openSync(intent,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,intentText);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync();
 try{
  owned();check(JSON.stringify(await verifyManagedCompletion({...options,managed}))===JSON.stringify(proof));owned();
  for(const step of steps){owned();if(step.kind==='file'){check(hash(privateRead(step.path,64))===step.sha256);fs.unlinkSync(step.path);}else{const st=fs.lstatSync(step.path);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&(st.mode&0o7777)===0o700&&fs.readdirSync(step.path).length===0);fs.rmdirSync(step.path);}sync();}
  owned();atomic(file,activation);check(privateRead(file,16384)===text);fs.unlinkSync(intent);sync();return Object.freeze({...activation,receipt_sha256:hash(text)});
 }catch(cause){throw Object.assign(Error('Managed activation requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={activateManaged};
