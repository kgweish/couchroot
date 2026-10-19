'use strict';
const {privateDirectory}=require('./private-state');
// Own the private callback for one journaled provider launch. Closing this
// transport is not evidence that the provider or its staging has been retired.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {RootAgentServer}=require('./vendor/root-agent');
const {submitRetirement}=require('./retirement-launch');
const {readyRetirement,privateRead}=require('./retirement-readiness');
const {shutdownRetirement,cleanupRetirement,finishRetirement}=require('./retirement-teardown');
const {reconcileRetirement}=require('./retirement-reconcile');
async function openRetirementSession(options){
 const {journalDirectory}=options;
 if(typeof journalDirectory!=='string'||!path.isAbsolute(journalDirectory))throw Error('Private retirement directory required');
 const parent=fs.lstatSync(journalDirectory);
 if(!privateDirectory(parent))throw Error('Private retirement directory required');
 // Refuse an unfinished launch before creating another token or listener.
 try{fs.lstatSync(path.join(journalDirectory,'retirement-launch.pending'));throw Error('Retirement launch requires reconciliation');}catch(error){if(error.code!=='ENOENT')throw error;}
 const directory=fs.mkdtempSync(path.join(journalDirectory,'retirement-'));
 fs.chmodSync(directory,0o700);
 const secret=crypto.randomBytes(32),token=secret.toString('base64'),tokenFile=path.join(directory,'token');
 let channel,timer,closed=false,submitted=false,settled=false,connected,failed,record;
 const connection=new Promise((resolve,reject)=>{connected=resolve;failed=reject;});connection.catch(()=>{});
 function fail(error){if(!settled){settled=true;failed(error);} }
 function closeTransport(){if(closed)return;closed=true;clearTimeout(timer);if(channel)channel.close();fail(Error('Retirement transport closed'));}
 try{
  const fd=fs.openSync(tokenFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,token);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  for(const p of [directory,journalDirectory]){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  channel=new RootAgentServer({secret,bindHost:'127.0.0.1',port:0,onConnect:peer=>{
   if(closed||settled){peer._socket.destroy();return;}
   settled=true;connected(peer);
  },onClose:error=>{fail(error||Error('Retirement provider disconnected'));closeTransport();}});
  timer=setTimeout(()=>{fail(Error('Retirement connection deadline expired'));closeTransport();},35000);
  await new Promise((resolve,reject)=>{channel.start(resolve);channel._server.once('error',reject);});
  if(closed)throw Error('Retirement listener closed before submission');
  // From this point preserve token material even if submission rejects: only the
  // launch journal can determine whether staging or execution took place.
  submitted=true;
  record=await submitRetirement({...options,port:channel.listeningPort(),tokenFile,tokenSha256:crypto.createHash('sha256').update(token).digest('hex')});
  const peer=await connection;
  if(closed||channel._conn!==peer)throw Error('Retirement connection changed');
  const ready=await readyRetirement({...options,record,channel});
  if(closed||channel._conn!==peer)throw Error('Retirement connection changed during readiness');
  clearTimeout(timer);
  let retiring=false,reconciling=false,retired=false,inUse=0,exitPending=false;
  const call=async(method,request)=>{if(retiring||closed)throw Error('Retirement session is closing');inUse++;try{return await ready.provider[method](request);}finally{inUse--;}};
  const provider=Object.freeze({identity:ready.provider.identity,
   inspectUnit:request=>call('inspectUnit',request),retireUnit:request=>call('retireUnit',request),snapshotManagedJobs:()=>call('snapshotManagedJobs'),installManagedState:options=>call('installManagedState',options),acceptManagedState:options=>call('acceptManagedState',options),launchProduction:options=>call('launchProduction',options),verifyProduction:options=>call('verifyProduction',options),
   snapshotNativeJobs:options=>call('snapshotNativeJobs',options),restoreManagedState:options=>call('restoreManagedState',options),acceptManagedRestore:options=>call('acceptManagedRestore',options),launchManaged:options=>call('launchManaged',options),verifyManaged:options=>call('verifyManaged',options),
   prepareNativeExit:async record=>{
    if(exitPending||retiring||closed)throw Error('Native exit observation already pending');exitPending=true;
    const observer=await call('prepareNativeExit',record);let waited=false,observing=false,interrupted=false;
    async function observe(resume){
     if(observing||!exitPending||retiring||closed||(resume?!interrupted:waited))throw Error('Native exit observation unavailable');
     waited=true;observing=true;inUse++;
     try{
      const result=await (resume?observer.resumeExitObservation():observer.waitForExit());
      if(closed||retiring)throw Error('Native exit observation session closed');
      exitPending=false;interrupted=false;return result;
     }catch(error){interrupted=true;throw error;}
     finally{observing=false;inUse--;}
    }
    return Object.freeze({waitForExit:()=>observe(false),resumeExitObservation:()=>observe(true)});
   }
  });
  const retire=async executor=>{
   if(retiring||closed||inUse||exitPending)throw Error('Retirement session is busy or closing');
   retiring=true;
   try{
    const stopped=await shutdownRetirement({record:ready.record,journalDirectory,channel});
    const cleaned=await cleanupRetirement({...executor,record:stopped,journalDirectory});
    const result=finishRetirement({record:cleaned,journalDirectory});retired=true;return result;
   }finally{closeTransport();}
  };
  const resumeRetirement=async executor=>{
   if(!retiring||!closed||reconciling||retired||inUse||exitPending)throw Error('Retirement reconciliation unavailable');
   reconciling=true;
   try{
    const record=JSON.parse(privateRead(path.join(journalDirectory,ready.record.id+'.retirement.json'),16384));
    const {phase:before,...expected}=ready.record,{phase:after,...actual}=record;
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Retirement ownership changed');
    const result=await reconcileRetirement({...executor,record,journalDirectory});retired=true;return result;
   }finally{reconciling=false;}
  };
  return Object.freeze({record:ready.record,provider,retire,resumeRetirement,closeTransport});
 }catch(error){
  closeTransport();
  if(!submitted){try{fs.unlinkSync(tokenFile);}catch(e){if(e.code!=='ENOENT')throw e;}fs.rmdirSync(directory);}
  throw Object.assign(Error(submitted?'Retirement session requires reconciliation':'Retirement listener unavailable'),{outcome:submitted?'unknown':'rejected',cause:error});
 }
}
module.exports={openRetirementSession};
