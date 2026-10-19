'use strict';
// Internal bridge. Callers must supply a verified, staged executable and obtain
// fresh authenticated worker status AFTER BOUND, before submitting SHUTDOWN.
const {spawn}=require('child_process');
const fs=require('fs'),crypto=require('crypto');
const {processIdentities}=require('./worker-processes');

function verifyArtifact(binary,sha256){
 if(typeof binary!=='string'||!binary.startsWith('/')||binary.includes('\0')||typeof sha256!=='string'||sha256.length!==64||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid observer artifact identity');
  // Package/staging owner must keep this executable immutable through spawn.
  // The digest is supplied by that trusted manifest, never by a request body.
  const fd=fs.openSync(binary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
   const stat=fs.fstatSync(fd);
   if(!stat.isFile()||stat.size<1||stat.size>128*1024)throw Error('Invalid observer artifact');
   const bytes=Buffer.alloc(stat.size+1);let used=0;
   while(used<bytes.length){const n=fs.readSync(fd,bytes,used,bytes.length-used,null);if(!n)break;used+=n;}
   if(used!==stat.size||crypto.createHash('sha256').update(bytes.subarray(0,used)).digest('hex')!==sha256)throw Error('Observer artifact digest mismatch');
  }finally{fs.closeSync(fd);}
}
async function probeExecutable({binary,sha256}){
 try{verifyArtifact(binary,sha256);}catch(error){throw Object.assign(error,{outcome:'rejected'});}
 return new Promise((resolve,reject)=>{
  require('child_process').execFile(binary,[],{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:5000,maxBuffer:256,killSignal:'SIGKILL'},(error,stdout,stderr)=>{
   if(error&&error.code===1&&!error.killed&&!error.signal&&stdout===''&&stderr==='observer: invalid arguments\n')resolve({executed:true});
   else reject(Object.assign(Error('Observer executable probe not confirmed'),{outcome:'failed'}));
  });
 });
}

function preparePidfdExit({binary,sha256,bound,confirm}){
 if(typeof binary!=='string'||!binary.startsWith('/')||binary.includes('\0')||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||typeof confirm!=='function')return Promise.reject(Error('Invalid process observer configuration'));
 let identity;
 function normalized(value,confirmation=false){
  const guardian=value&&value.processes&&value.processes.guardian;
  if(guardian&&confirmation){
   if(value.implementation!=='native-prototype'||!Array.isArray(value.capabilities)||!value.capabilities.includes('guardian-parent-identity-v1'))throw Error('Fresh guardian parent confirmation required');
   return processIdentities(value,identity.processes.worker.pid);
  }
  return processIdentities({...value,capabilities:['worker-process-identity-v1'],...(guardian?{implementation:'native-prototype',guardian_pid:guardian.pid}:{})},confirmation?identity.processes.worker.pid:value.processes.worker.pid);
 }
 try{
  identity=normalized(bound);
  verifyArtifact(binary,sha256);
 }catch(e){return Promise.reject(e);}
 const expected=JSON.stringify(identity);
 let readyResolve,readyReject,exitResolve,exitReject,closedResolve;
 const ready=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;});
 const exited=new Promise((yes,no)=>{exitResolve=yes;exitReject=no;});
 exited.catch(()=>{}); // May fail while the caller is awaiting its shutdown ACK.
 const closed=new Promise(yes=>{closedResolve=yes;});
 let child,phase='binding',buffer='',outputBytes=0,errorBytes=0,failed=false,done=false;
 const timer=setTimeout(()=>fail(Error('Process observer deadline expired')),32000);
 function fail(error){
  if(failed||done)return;
  failed=true;clearTimeout(timer);
  if(child)child.kill('SIGKILL'); // Our observer child only, never the target PID.
  readyReject(error);exitReject(error);
 }
 async function cancel(){
  if(!done)fail(Error('Process observation cancelled'));
  let timeout;
  try{await Promise.race([closed,new Promise((_,no)=>{timeout=setTimeout(()=>no(Error('Observer child exit not confirmed')),2000);})]);}
  finally{clearTimeout(timeout);}
 }
 function line(value){
  if(failed)return;
  if(phase==='binding'&&value==='BOUND'){
   phase='confirming';
   Promise.resolve().then(()=>confirm()).then(fresh=>{
    if(failed)return;
    const value=normalized(fresh,true);
    if(JSON.stringify(value)!==expected)throw Error('Worker identity changed after pidfd binding');
    phase='arming';child.stdin.write('ARM\n');
   }).catch(fail);
  }else if(phase==='arming'&&value==='ARMED'){
   phase='waiting';
   readyResolve(Object.freeze({waitForExit:()=>exited,cancel,assertReady:()=>{if(failed||done||phase!=='waiting')throw Error('Process observer is no longer armed');}}));
  }else if(phase==='waiting'&&value==='EXITED')phase='exited';
  else fail(Error('Invalid process observer response'));
 }
 const args=[identity.boot_id,String(identity.processes.worker.pid)];
 if(identity.processes.guardian)args.push(String(identity.processes.guardian.pid));
 try{child=spawn(binary,args,{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C'},stdio:['pipe','pipe','pipe']});}
 catch(e){closedResolve();fail(e);return ready;}
 child.on('error',fail);
 child.stdin.on('error',fail);
 child.stdout.on('error',fail);child.stderr.on('error',fail);
 child.stdout.on('data',bytes=>{
  outputBytes+=bytes.length;
  if(outputBytes>64||bytes.some(b=>b>127)){fail(Error('Invalid process observer output'));return;}
  buffer+=bytes.toString('ascii');
  let index;
  while((index=buffer.indexOf('\n'))!==-1){const value=buffer.slice(0,index);buffer=buffer.slice(index+1);line(value);}
 });
 child.stderr.on('data',bytes=>{errorBytes+=bytes.length;if(errorBytes>256)fail(Error('Process observer diagnostics exceeded limit'));});
 child.on('close',(code,signal)=>{
  closedResolve();clearTimeout(timer);
  if(failed)return;
  if(code!==0||signal||phase!=='exited'||buffer||errorBytes){fail(Error('Process observer did not confirm exit'));return;}
  done=true;
  exitResolve({boot_id:identity.boot_id,worker_id:identity.worker_id,method:'pidfd',processes:{worker:{...identity.processes.worker,observation:'exited'},guardian:identity.processes.guardian?{...identity.processes.guardian,observation:'exited'}:null}});
 });
 return ready;
}
module.exports={preparePidfdExit,probeExecutable};
