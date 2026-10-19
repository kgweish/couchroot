'use strict';
// Internal controller. Does not select a worker or restart a pending launch.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {atomic}=require('./policy');
const {createExternalObserver}=require('./external-observer');
const {submitObserver}=require('./observer-launch');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function privateRead(file,limit=16384){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==process.geteuid()||st.nlink!==1||(st.mode&0o7777)!==0o600||st.size<1||st.size>limit)throw Error('Invalid observer journal evidence');
  const b=Buffer.alloc(st.size+1);let at=0;while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,null);if(!n)break;at+=n;}if(at!==st.size)throw Error('Observer evidence changed');return b.subarray(0,at);
 }finally{fs.closeSync(fd);}
}
function terminationEvidence(value,record){
 if(!value||Object.keys(value).sort().join('|')!=='active_state|boot_id|exec_code|exec_status|main_pid|started_monotonic|sub_state|unit'||value.unit!==record.unit||value.boot_id!==record.boot_id||(value.active_state!=='active'||value.sub_state!=='exited')||value.main_pid!==0||value.exec_code!==1||value.exec_status!==0||typeof value.started_monotonic!=='string'||value.started_monotonic.trim()!==value.started_monotonic||!/^[1-9][0-9]{0,19}$/.test(value.started_monotonic))throw Error('Supervisor unit termination not established');
 return {...value};
}
async function prepareSupervisedExit(options){
 const {directory,journalDirectory,id,bound,confirm,execute,inspectUnit,retireUnit}=options;
 if(typeof confirm!=='function'||typeof execute!=='function'||typeof inspectUnit!=='function'||typeof retireUnit!=='function'||typeof journalDirectory!=='string'||!path.isAbsolute(journalDirectory)||typeof id!=='string'||id.length!==32||!/^[a-f0-9]+$/.test(id))throw Error('Observer controller configuration incomplete');
 const marker=path.join(journalDirectory,'observer-launch.pending'),file=path.join(journalDirectory,id+'.observer.json');
 for(const p of [marker,file]){try{fs.lstatSync(p);throw Error('Observer launch requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}}
 let acceptedYes,acceptedNo;
 const accepted=new Promise((a,b)=>{acceptedYes=a;acceptedNo=b;});accepted.catch(()=>{});
 const observer=await createExternalObserver({directory,bound,confirm:async()=>{await accepted;return confirm();}});
 let enteredSubmission=false,record;
 try{
  record=await submitObserver({...options,launch:observer.launch,execute:async(...args)=>{enteredSubmission=true;return execute(...args);}});
  acceptedYes();
 }catch(error){
  acceptedNo(error);observer.cancel();
  if(!enteredSubmission)await observer.discardUnlaunched();
  throw error;
 }
 // Read only the native supervisor's published receipt. Protocol completion and
 // process completion are separate; the listener enforces both for success.
 const receipts=(async()=>{
  const started=process.hrtime();
  while(process.hrtime(started)[0]<40){if(observer.readPublishedExit())return;await pause(50);}
  throw Error('Observer termination receipt deadline expired');
 })();
 receipts.catch(()=>observer.cancel());
 let armed;
 try{armed=await observer.ready;}catch(error){observer.cancel();throw Object.assign(error,{outcome:'unknown'});}
 let observed=false,cleaning=null;
 const result=observer.exited.then(value=>{observed=true;return value;});result.catch(()=>{});
 async function cleanup(){
  observer.cancel();await receipts;
  let timeout;
  const evidence=await Promise.race([Promise.resolve().then(()=>inspectUnit(record.unit)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Supervisor inspection deadline expired')),10000);})]).finally(()=>clearTimeout(timeout));
  const unit=terminationEvidence(evidence,record);
  if(privateRead(marker,64).toString()!==id+'\n'||privateRead(file).toString()!==JSON.stringify(record))throw Error('Observer submission journal changed before cleanup');
  const receipt=privateRead(path.join(record.root,'result'),512),digest=crypto.createHash('sha256').update(receipt).digest('hex');
  const checkpoint={...record,phase:'cleanup-verified',observer_receipt:JSON.parse(receipt),receipt_sha256:digest,unit_termination:unit};
  atomic(file,checkpoint);
  const retired=await Promise.race([Promise.resolve().then(()=>retireUnit(record.unit)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Supervisor retirement deadline expired')),10000);})]).finally(()=>clearTimeout(timeout));
  if(!retired||Object.keys(retired).sort().join('|')!=='boot_id|retired|unit'||retired.unit!==record.unit||retired.boot_id!==record.boot_id||retired.retired!==true)throw Error('Supervisor unit retirement not established');
  atomic(file,{...checkpoint,phase:'unit-retired'});
  await observer.dispose();
  atomic(file,{...checkpoint,phase:observed?'completed':'cancelled'});
  if(privateRead(marker,64).toString()!==id+'\n')throw Error('Observer pending ownership changed');
  fs.unlinkSync(marker);
  const parent=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }
 return Object.freeze({
  assertReady:armed.assertReady,
  waitForExit:()=>result,
  cancel:()=>{if(!cleaning)cleaning=cleanup();return cleaning;},
  transactionId:id
 });
}
module.exports={prepareSupervisedExit,terminationEvidence};
