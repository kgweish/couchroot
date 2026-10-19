'use strict';
// Own one private managed rollback callback. Transport closure is not worker cleanup.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {RootAgentServer}=require('./vendor/root-agent');
const {selectionStatus,SelectionJournal}=require('./worker-selection');
const {privateRead,privateDirectory}=require('./private-state');
const {managedIdentity}=require('./managed-readiness');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function check(ok){if(!ok)throw Error('Managed session ownership unavailable');}
async function openManagedSession(options){
 const {journalDirectory,selectionFile,id,provider}=options;
 check(typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof selectionFile==='string'&&path.dirname(selectionFile)===journalDirectory&&typeof id==='string'&&id.length===32&&/^[a-f0-9]+$/.test(id));
 check(provider&&provider.identity&&typeof provider.launchManaged==='function'&&typeof provider.verifyManaged==='function');
 const parent=fs.lstatSync(journalDirectory);check(privateDirectory(parent));
 const marker=path.join(journalDirectory,'managed-launch.pending');
 try{fs.lstatSync(marker);throw Error('Managed session requires reconciliation');}catch(error){if(error.code!=='ENOENT')throw error;}
 const selection=selectionStatus(selectionFile),pending=selection.pending;
 check(selection.phase==='reconciliation-required'&&pending&&pending.id===id);
 const rollback=pending.phase==='rollback-state-ready';
 check(rollback?pending.from.implementation==='managed'&&pending.to.implementation==='native-prototype':pending.phase==='state-ready'&&pending.from.implementation==='native-prototype'&&pending.to.implementation==='managed');
 const target=rollback?pending.from:pending.to;
 const inputFile=path.join(journalDirectory,id+'.managed-restore-input.json'),inputText=privateRead(inputFile,524288),inputs=JSON.parse(inputText);
 check(inputs&&inputs.record&&inputs.record.source);

 const directory=fs.mkdtempSync(path.join(journalDirectory,'managed-'));fs.chmodSync(directory,0o700);
 const secret=crypto.randomBytes(32),token=secret.toString('base64'),tokenFile=path.join(directory,'token'),tokenSha256=hash(token);
 let channel,timer,closed=false,submitted=false,settled=false,connected,failed,aborted,taken=false;
 const connection=new Promise((resolve,reject)=>{connected=resolve;failed=reject;});connection.catch(()=>{});
 const cancellation=new Promise((_,reject)=>{aborted=reject;});cancellation.catch(()=>{});
 const fail=error=>{if(!settled){settled=true;failed(error);}};
 function closeTransport(){if(closed)return;closed=true;clearTimeout(timer);if(channel)channel.close();fail(Error('Managed transport closed'));aborted(Error('Managed transport closed'));}
 const sync=p=>{const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 try{
  const fd=fs.openSync(tokenFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,token);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(directory);sync(journalDirectory);
  channel=new RootAgentServer({secret,bindHost:'127.0.0.1',port:0,onConnect:peer=>{
   if(closed||settled){peer._socket.destroy();return;}settled=true;connected(peer);
  },onClose:error=>{fail(error||Error('Managed worker disconnected'));closeTransport();}});
  timer=setTimeout(()=>{fail(Error('Managed connection deadline expired'));closeTransport();},35000);
  await Promise.race([new Promise((resolve,reject)=>{channel.start(resolve);channel._server.once('error',reject);}),cancellation]);
  check(!closed&&JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selection));
  submitted=true;
  const record=await Promise.race([provider.launchManaged({...options,transitionId:id,port:channel.listeningPort(),tokenFile,tokenSha256}),cancellation]);
  check(record&&record.id===id&&record.phase==='submitted'&&record.port===channel.listeningPort()&&record.token_file===tokenFile&&record.token_sha256===tokenSha256&&record.state_receipt_sha256===pending.state_sha256&&record.manifest_sha256===target.manifest_sha256);
  const peer=await connection;check(!closed&&channel._conn===peer);clearTimeout(timer);
  timer=setTimeout(()=>closeTransport(),125000);
  const ready=await Promise.race([provider.verifyManaged({...options,record,channel}),cancellation]);clearTimeout(timer);
  check(!closed&&channel._conn===peer&&ready&&ready.record&&ready.record.phase==='ready'&&hash(JSON.stringify(ready.record))===ready.readiness_sha256);
  const {worker_identity,unit_started_monotonic,launcher_sha256,...launch}=ready.record;check(JSON.stringify({...launch,phase:'submitted'})===JSON.stringify(record)&&typeof unit_started_monotonic==='string'&&/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic)&&typeof launcher_sha256==='string'&&launcher_sha256.length===64&&/^[a-f0-9]+$/.test(launcher_sha256));
  check(privateRead(marker,64)===id+'\n'&&hash(privateRead(path.join(journalDirectory,id+'.managed-launch.json'),16384))===ready.readiness_sha256&&hash(privateRead(tokenFile,44))===tokenSha256&&privateRead(inputFile,524288)===inputText);
  check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selection));
  if(!rollback)new SelectionJournal(selectionFile).advance(selection.revision,id,'trial-ready',ready.readiness_sha256);
  const verified=selectionStatus(selectionFile),trial=verified.pending;
  check(verified.phase==='reconciliation-required'&&trial&&trial.id===id&&trial.phase===(rollback?'rollback-state-ready':'trial-ready')&&trial.state_sha256===record.state_receipt_sha256&&(rollback||trial.readiness_sha256===ready.readiness_sha256));
  // The controller can obtain the channel exactly once after committing this
  // exact trial. Until then no caller can issue general managed operations.
  const takeChannel=async()=>{
   check(!closed&&!taken&&channel._conn===peer);taken=true;
   const committed=()=>{
    const s=selectionStatus(selectionFile),h=s.history&&s.history[s.history.length-1];
    check(s.phase==='stable'&&s.selected_implementation==='managed'&&s.selected_manifest_sha256===record.manifest_sha256&&h&&h.id===id&&h.outcome===(rollback?'rolled-back':'committed')&&h.state_sha256===record.state_receipt_sha256&&h.readiness_sha256===ready.readiness_sha256&&h.quiescence_sha256===pending.quiescence_sha256&&JSON.stringify(h.from)===JSON.stringify(pending.from)&&JSON.stringify(h.to)===JSON.stringify(pending.to));
    check(privateRead(marker,64)===id+'\n'&&hash(privateRead(path.join(journalDirectory,id+'.managed-launch.json'),16384))===ready.readiness_sha256&&hash(privateRead(tokenFile,44))===tokenSha256&&privateRead(inputFile,524288)===inputText);
    return JSON.stringify(s);
   };
   try{
    const before=committed(),info=await channel.operation({op:'status'}),identity=managedIdentity(info,peer,record,provider.identity,inputs.record.source);
    check(info.app_launcher&&info.app_launcher.sha256===launcher_sha256);
    check(!closed&&channel._conn===peer&&committed()===before&&JSON.stringify(identity)===JSON.stringify(worker_identity));
    return channel;
   }catch(error){closeTransport();throw Object.assign(Error('Managed adoption requires reconciliation'),{outcome:'unknown',cause:error});}
  };
  return Object.freeze({record:ready.record,readiness_sha256:ready.readiness_sha256,takeChannel,closeTransport});
 }catch(cause){
  closeTransport();
  if(!submitted){try{fs.unlinkSync(tokenFile);}catch(e){if(e.code!=='ENOENT')throw e;}fs.rmdirSync(directory);sync(journalDirectory);}
  throw Object.assign(Error(submitted?'Managed session requires reconciliation':'Managed listener unavailable'),{outcome:submitted?'unknown':'rejected',cause});
 }
}
module.exports={openManagedSession};
