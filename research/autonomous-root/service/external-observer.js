'use strict';
// Private listener only: the external launcher must independently report the
// observer's termination. A socket message or EOF can never supply that receipt.
const fs=require('fs'),path=require('path'),net=require('net'),crypto=require('crypto');
const {processIdentities}=require('./worker-processes');
async function createExternalObserver({directory,bound,confirm,timeoutMs=32000}){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof confirm!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>35000)throw Error('Invalid external observer configuration');
 const normalize=(value,fresh=false)=>{
  const guardian=value&&value.processes&&value.processes.guardian;
  if(fresh&&guardian&&(!Array.isArray(value.capabilities)||!value.capabilities.includes('guardian-parent-identity-v1')||value.implementation!=='native-prototype'))throw Error('Fresh guardian confirmation required');
  return processIdentities(fresh?value:{...value,capabilities:['worker-process-identity-v1'],...(guardian?{implementation:'native-prototype',guardian_pid:guardian.pid}:{})},bound.processes.worker.pid);
 };
 const identity=normalize(bound),expected=JSON.stringify(identity),parent=fs.lstatSync(directory);
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.geteuid()||(parent.mode&0o077))throw Error('Private observer directory required');
 const root=fs.mkdtempSync(path.join(directory,'observer-'));fs.chmodSync(root,0o700);
 const rootIdentity=fs.lstatSync(root);
 const socketPath=path.join(root,'control'),tokenFile=path.join(root,'token');
 if(Buffer.byteLength(socketPath)>103){fs.rmdirSync(root);throw Error('Observer socket path too long');}
 const token=crypto.randomBytes(32).toString('hex');
 try{fs.writeFileSync(tokenFile,token,{mode:0o600,flag:'wx'});}catch(error){fs.rmdirSync(root);throw error;}
 let readyYes,readyNo,exitYes,exitNo;
 const ready=new Promise((a,b)=>{readyYes=a;readyNo=b;}),exited=new Promise((a,b)=>{exitYes=a;exitNo=b;});
 ready.catch(()=>{});exited.catch(()=>{});
 let socket=null,phase='auth',buffer='',bytes=0,failure=null,ended=false,receipt=null,reportIdentity=null,disposed=false;
 const server=net.createServer(connection=>{
  if(socket||failure){connection.destroy();return;}
  socket=connection;
  connection.on('error',fail);
  connection.on('data',data=>{
   if(failure)return;
   bytes+=data.length;
   if(bytes>128||data.some(b=>b>127)){fail(Error('Invalid external observer output'));return;}
   buffer+=data.toString('ascii');let index;
   while(!failure&&(index=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);consume(line);}
  });
  connection.on('end',()=>{ended=true;if(phase!=='exited'||buffer)fail(Error('Incomplete external observer protocol'));else finish();});
  connection.on('close',()=>{if(!ended&&!failure)fail(Error('Observer socket closed without EOF'));});
 });
 server.on('error',fail);
 const timer=setTimeout(()=>fail(Error('External observer deadline expired')),timeoutMs);
 function fail(error){if(failure||disposed)return;failure=error;clearTimeout(timer);if(socket)socket.destroy();server.close();readyNo(error);exitNo(error);}
 function finish(){
  if(failure||!ended||!receipt)return;
  if(receipt.exit_code!==0||receipt.signal!==null){fail(Error('Observer process did not exit successfully'));return;}
  clearTimeout(timer);server.close();
  exitYes({boot_id:identity.boot_id,worker_id:identity.worker_id,method:'pidfd-external',processes:{worker:{...identity.processes.worker,observation:'exited'},guardian:identity.processes.guardian?{...identity.processes.guardian,observation:'exited'}:null}});
 }
 function consume(line){
  if(phase==='auth'){
   const expectedAuth=Buffer.from('AUTH '+token),actual=Buffer.from(line);
   if(actual.length!==expectedAuth.length||!crypto.timingSafeEqual(actual,expectedAuth)){fail(Error('Observer authentication failed'));return;}
   phase='binding';
  }else if(phase==='binding'&&line==='BOUND'){
   phase='confirming';
   Promise.resolve().then(()=>confirm()).then(fresh=>{
    if(failure)return;
    if(JSON.stringify(normalize(fresh,true))!==expected)throw Error('Worker changed after observer binding');
    phase='arming';socket.write('ARM\n');
   }).catch(fail);
  }else if(phase==='arming'&&line==='ARMED'){
   phase='waiting';readyYes({assertReady:()=>{if(failure||ended||receipt||phase!=='waiting')throw Error('Observer is not armed');},waitForExit:()=>exited});
  }else if(phase==='waiting'&&line==='EXITED')phase='exited';
  else fail(Error('Invalid external observer sequence'));
 }
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.removeListener('error',reject);resolve();});});
  fs.chmodSync(socketPath,0o600);
 }catch(error){clearTimeout(timer);server.close();fs.unlinkSync(tokenFile);try{fs.unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}fs.rmdirSync(root);throw error;}
 function recordExit(value){
  if(receipt||disposed||!value||Object.keys(value).sort().join('|')!=='exit_code|signal'||!((Number.isInteger(value.exit_code)&&value.exit_code>=0&&value.exit_code<=255&&value.signal===null)||(value.exit_code===null&&typeof value.signal==='string'&&/^SIG[A-Z0-9]+$/.test(value.signal))))throw Error('Invalid or duplicate observer termination receipt');
  receipt={...value};if(value.exit_code!==0||value.signal!==null)fail(Error('Observer process did not exit successfully'));else finish();
 }
 function sameRoot(){
  const current=fs.lstatSync(root);
  if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==rootIdentity.dev||current.ino!==rootIdentity.ino)throw Error('Observer directory changed before cleanup');
 }
 function intentExists(){try{fs.lstatSync(path.join(root,'result.next'));return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}}
 return Object.freeze({
  launch:Object.freeze({socketPath,tokenFile,bootId:identity.boot_id,pids:Object.freeze([identity.processes.worker.pid,...(identity.processes.guardian?[identity.processes.guardian.pid]:[])])}),
  ready,exited,
  recordExit,
  readPublishedExit:()=>{
   if(receipt||disposed)throw Error('Observer termination already recorded');
   sameRoot();if(intentExists())return false;
   let fd;try{fd=fs.openSync(path.join(root,'result'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return false;throw e;}
   let st,value;
   try{
    st=fs.fstatSync(fd);
    if(!st.isFile()||st.uid!==process.geteuid()||st.nlink!==1||(st.mode&0o7777)!==0o600||st.size<1||st.size>512)throw Error('Invalid observer receipt file');
    const data=Buffer.alloc(st.size+1);let at=0;
    while(at<data.length){const n=fs.readSync(fd,data,at,data.length-at,null);if(!n)break;at+=n;}
    if(at!==st.size)throw Error('Observer receipt changed during read');
    value=JSON.parse(data.subarray(0,at));
   }finally{fs.closeSync(fd);}
   if(!value||Object.keys(value).sort().join('|')!=='boot_id|exit_code|guardian_pid|observer_pid|schema|signal|worker_pid'||value.schema!==1||value.boot_id!==identity.boot_id||value.worker_pid!==identity.processes.worker.pid||value.guardian_pid!==(identity.processes.guardian?identity.processes.guardian.pid:null)||!Number.isInteger(value.observer_pid)||value.observer_pid<=1||value.observer_pid>2147483647||[value.worker_pid,value.guardian_pid].includes(value.observer_pid)||!((Number.isInteger(value.exit_code)&&value.exit_code>=0&&value.exit_code<=255&&value.signal===null)||(value.exit_code===null&&Number.isInteger(value.signal)&&value.signal>=1&&value.signal<=64)))throw Error('Observer receipt identity or result mismatch');
   sameRoot();if(intentExists())return false;
   reportIdentity=st;
   recordExit({exit_code:value.exit_code,signal:value.signal===null?null:'SIG'+value.signal});return true;
  },
  cancel:()=>fail(Error('External observation cancelled')),
  discardUnlaunched:async()=>{
   // Trusted caller may use this only before entering its launch submission.
   if(socket||receipt||disposed||phase!=='auth')throw Error('Observer may already have launched');
   fail(Error('Observer launch abandoned'));
   await new Promise(resolve=>server.close(resolve));sameRoot();
   for(const file of [tokenFile,socketPath])try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
   fs.rmdirSync(root);disposed=true;
  },
  dispose:async()=>{
   if(disposed)return;
   if(!receipt)throw Error('Observer termination must be established before cleanup');
   if(!failure&&(!ended||phase!=='exited'))fail(Error('Observation disposed before completion'));
   await new Promise(resolve=>server.close(resolve));
   sameRoot();
   if(reportIdentity){
    const file=path.join(root,'result'),now=fs.lstatSync(file);
    if(!now.isFile()||now.dev!==reportIdentity.dev||now.ino!==reportIdentity.ino)throw Error('Observer receipt changed before cleanup');
    fs.unlinkSync(file);
   }
   // Only our two exact files; unknown entries prevent directory removal.
   for(const file of [tokenFile,socketPath])try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
   fs.rmdirSync(root);disposed=true;clearTimeout(timer);
  }
 });
}
module.exports={createExternalObserver};
