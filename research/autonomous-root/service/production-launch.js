'use strict';
// One-shot launch from accepted retained state. Never selects or declares ready.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {atomic}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {selectionStatus}=require('./worker-selection');
const {planInstallation}=require('./retained-install');
const {sourceExitGuard}=require('./retained-state');
const {loadCandidate}=require('./native-candidate');
const STATE='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
const PAYLOADS=['/opt/usr/apps/MiniRoot01/res/wgt/payload','/opt/usr/apps/MiniRoot01/payload'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const hex=(v,n)=>typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v);
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function check(ok){if(!ok)throw Error('Production launch evidence unavailable');}
function productionPlan({device,id,payload,manifestSha256,receiptSha256,snapshot,installation,port,tokenFile,tokenSha256}){
 check(['s90d','qn90a'].includes(device)&&hex(id,32)&&hex(manifestSha256,64)&&hex(receiptSha256,64)&&hex(tokenSha256,64)&&PAYLOADS.includes(payload)&&Number.isInteger(port)&&port>=1024&&port<=65535);
 const imported=planInstallation({snapshot,id,manifestSha256});
 check(installation&&hex(installation.quiescence_sha256,64));
 const expected={...imported.record,quiescence_sha256:installation.quiescence_sha256,phase:'ready'};
 check(JSON.stringify(installation)===JSON.stringify(expected)&&hash(JSON.stringify(expected))===receiptSha256);
 const tokenDirectory=typeof tokenFile==='string'?path.dirname(tokenFile):'';
 check(path.dirname(tokenDirectory)===STATE&&path.basename(tokenDirectory).length===17&&/^production-[a-zA-Z0-9]{6}$/.test(path.basename(tokenDirectory))&&tokenFile===tokenDirectory+'/token');
 const candidate=loadCandidate(payload,device);check(candidate&&candidate.manifest_sha256===manifestSha256);
 const worker=candidate.artifacts['native-worker'],launcher=candidate.artifacts['native-app-launcher'];check(worker&&launcher&&hex(worker.sha256,64)&&hex(launcher.sha256,64));
 const {directory,scope}=installation,code=directory+'/code',unit='couchroot-worker-'+id+'.service';
 const digest=(file,sha)=>'test "$(sha256sum '+quote(file)+' | cut -d " " -f1)" = '+quote(sha)+'\n';
 const parents=[];let parent=payload;while(parent!=='/'){parents.unshift(parent);parent=path.dirname(parent);}
 const command=imported.verifyReady+'export DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+
  'test "$(systemctl show -p LoadState '+quote(unit)+')" = LoadState=not-found\n'+
  'for p in '+parents.map(quote).join(' ')+'; do test -d "$p"; test ! -L "$p"; done\n'+
  'test -d '+quote(tokenDirectory)+'; test ! -L '+quote(tokenDirectory)+'\ntest "$(stat -c "%u:%a" '+quote(tokenDirectory)+')" = 5001:700\n'+
  'test -f '+quote(tokenFile)+'; test ! -L '+quote(tokenFile)+'\ntest "$(stat -c "%u:%h:%a:%s" '+quote(tokenFile)+')" = 5001:1:600:44\n'+digest(tokenFile,tokenSha256)+
  [['native-worker',worker.sha256],['native-app-launcher',launcher.sha256]].map(([name,sha])=>'test -f '+quote(payload+'/'+name)+'; test ! -L '+quote(payload+'/'+name)+'\ntest "$(stat -c "%u:%h" '+quote(payload+'/'+name)+')" = 201:1\n'+digest(payload+'/'+name,sha)).join('')+
  'test ! -e '+quote(code)+'; test ! -L '+quote(code)+'\nmkdir '+quote(code)+'\n'+
  [[payload+'/native-worker',code+'/worker','500',worker.sha256],[payload+'/native-app-launcher',scope+'/launcher','400',launcher.sha256],[tokenFile,scope+'/token','600',tokenSha256]].map(([from,to,mode,sha])=>'test ! -e '+quote(to)+'; test ! -L '+quote(to)+'\n(set -C; cat '+quote(from)+' > '+quote(to)+')\nchmod '+mode+' '+quote(to)+'\ntest "$(stat -c "%u:%h:%a" '+quote(to)+')" = 0:1:'+mode+'\n'+digest(to,sha)).join('')+
  'sync\n'+sourceExitGuard(snapshot.source)+
  'systemd-run --quiet --unit='+quote(unit)+' '+['User=0','Group=0','SmackProcessLabel=System','PrivateMounts=yes','BindReadOnlyPaths='+code,'TimeoutStopSec=5s','RemainAfterExit=yes','KillMode=control-group','NoNewPrivileges=yes','AmbientCapabilities=','StandardOutput=null','StandardError=null'].map(p=>'--property='+quote(p)).join(' ')+' '+[code+'/worker','127.0.0.1',String(port),scope+'/token',scope,scope+'/launcher',launcher.sha256,'--production'].map(quote).join(' ')+'\nprintf "PRODUCTION-SUBMITTED\\n"\n';
 check(Buffer.byteLength(command)<=65536);
 return {command,record:{schema:1,id,phase:'submitting',device,manifest_sha256:manifestSha256,state_receipt_sha256:receiptSha256,worker_sha256:worker.sha256,launcher_sha256:launcher.sha256,source:snapshot.source,boot_id:snapshot.source.boot_id,unit,directory,scope,port,token_file:tokenFile,token_sha256:tokenSha256}};
}
async function submitProduction(options){
 const {journalDirectory,selectionFile,id,execute}=options;
 check(typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&typeof selectionFile==='string'&&path.dirname(selectionFile)===journalDirectory&&hex(id,32)&&typeof execute==='function');
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const installationFile=path.join(journalDirectory,id+'.state-install.json'),snapshotFile=path.join(journalDirectory,id+'.retained-snapshot.json'),stateMarker=path.join(journalDirectory,'state-install.pending');
 const installationText=privateRead(installationFile,16384),snapshotText=privateRead(snapshotFile,262144);
 const installation=JSON.parse(installationText),snapshot=JSON.parse(snapshotText);
 const {command,record}=productionPlan({...options,installation,snapshot});
 const selected=selectionStatus(selectionFile),p=selected.pending;
 check(selected.phase==='reconciliation-required'&&p&&p.id===id&&p.phase==='state-ready'&&p.from.implementation==='managed'&&p.to.implementation==='native-prototype'&&p.to.manifest_sha256===record.manifest_sha256&&p.state_sha256===record.state_receipt_sha256&&p.quiescence_sha256===installation.quiescence_sha256);
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selected)&&privateRead(installationFile,16384)===installationText&&privateRead(snapshotFile,262144)===snapshotText&&privateRead(stateMarker,64)===id+'\n');};
 owned();
 const file=path.join(journalDirectory,id+'.production.json'),marker=path.join(journalDirectory,'production-launch.pending');
 for(const target of [file,marker])try{fs.lstatSync(target);throw Error('Production launch requires reconciliation');}catch(error){if(error.code!=='ENOENT')throw error;}
 const exclusive=(target,text)=>{const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 exclusive(marker,id+'\n');exclusive(file,JSON.stringify(record));
 const parent=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 const launchOwned=()=>{owned();check(privateRead(marker,64)===id+'\n'&&privateRead(file,16384)===JSON.stringify(record));};
 try{
  launchOwned();const result=await execute(command,25000);launchOwned();
  check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout==='STATE-READY\nPRODUCTION-SUBMITTED\n');
  const next={...record,phase:'submitted'};atomic(file,next);return Object.freeze(next);
 }catch(cause){
  // Preserve the pre-submission record if ownership changed. Never overwrite a
  // newer journal merely to label this caller's result unknown.
  try{launchOwned();atomic(file,{...record,phase:'unknown'});}catch(_){}
  throw Object.assign(Error('Production launch requires reconciliation'),{outcome:'unknown',cause});
 }
}
module.exports={productionPlan,submitProduction};
