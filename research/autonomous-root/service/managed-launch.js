'use strict';
// One-shot managed fallback launch from accepted rollback state. No acquisition
// is repeated: the caller supplies the independent, already running provider.
const fs=require('fs'),path=require('path');
const {hash,read,atomic}=require('./policy');
const {privateRead,privateDirectory}=require('./private-state');
const {managedVersion,selectionStatus}=require('./worker-selection');
const {planManagedRestore}=require('./managed-restore-plan');
const {acceptManagedRestore}=require('./managed-restore');
const {planNativeSnapshot}=require('./native-retained-state');
const STATE='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
const PAYLOADS=['/opt/usr/apps/MiniRoot01/res/wgt/payload','/opt/usr/apps/MiniRoot01/payload'];
const hex=(s,n)=>typeof s==='string'&&s.length===n&&/^[a-f0-9]+$/.test(s);
const q=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function check(ok){if(!ok)throw Error('Managed launch evidence unavailable');}
function managedLaunchPlan({transitionId,payload,managedSha256,runtimeSha256,receiptSha256,inputs,port,tokenFile,tokenSha256}){
 check(hex(transitionId,32)&&PAYLOADS.includes(payload)&&hex(managedSha256,64)&&hex(runtimeSha256,64)&&hex(receiptSha256,64)&&hex(tokenSha256,64)&&Number.isInteger(port)&&port>=1024&&port<=65535);
 const restore=planManagedRestore(inputs),native=planNativeSnapshot(inputs.record,inputs.installation);
 check(managedVersion(payload)===managedSha256);
 const manifest=JSON.parse(read(payload+'/manifest.json')),files=['dll','runtimeconfig.json','deps.json'].map(ext=>'SamsungTvRootAgent.'+ext);
 for(const name of files)check(hex(manifest[name],64)&&hash(read(payload+'/'+name,4*1024*1024))===manifest[name]);
 const tokenDirectory=typeof tokenFile==='string'?path.dirname(tokenFile):'';
 check(path.dirname(tokenDirectory)===STATE&&/^managed-[A-Za-z0-9]{6}$/.test(path.basename(tokenDirectory))&&path.basename(tokenDirectory).length===14&&tokenFile===tokenDirectory+'/token');
 const directory='/opt/couchroot-managed-'+transitionId,code=directory+'/code',stage='/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+transitionId,unit='couchroot-managed-'+transitionId+'.service';
 // The unchanged managed entry point accepts the compatibility path only.
 // Bind that alias to the checked canonical tree before passing runtime argv.
 const invocationStage='/home/owner/share/tmp/sdk_tools/managed-'+transitionId;
 const absent=p=>'test ! -e '+q(p)+'; test ! -L '+q(p)+'\n';
 const digest=(p,h)=>'test "$(sha256sum '+q(p)+' | cut -d " " -f1)" = '+q(h)+'\n';
 const parents=[];for(const leaf of [payload,path.dirname(stage)]){let p=leaf;while(p!=='/'){if(!parents.includes(p))parents.unshift(p);p=path.dirname(p);}}
 const copy=(from,to,h,mode)=>absent(to)+'(set -C; cat '+q(from)+' > '+q(to)+')\nchmod '+mode+' '+q(to)+'\ntest "$(stat -c "%u:%h:%a" '+q(to)+')" = 0:1:'+mode+'\n'+digest(to,h);
 const command=restore.verify+'export DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+
  'test "$(systemctl show -p LoadState '+q(unit)+')" = LoadState=not-found\n'+
  "test '/home' -ef '/opt/usr/home'\n"+
  parents.map(p=>'test -d '+q(p)+'; test ! -L '+q(p)+'\n').join('')+
  'test -f /usr/bin/dotnet; test ! -L /usr/bin/dotnet\n'+digest('/usr/bin/dotnet',runtimeSha256)+
  'test -d '+q(tokenDirectory)+'; test ! -L '+q(tokenDirectory)+'; test "$(stat -c "%u:%a" '+q(tokenDirectory)+')" = 5001:700\n'+
  'test -f '+q(tokenFile)+'; test ! -L '+q(tokenFile)+'; test "$(stat -c "%u:%h:%a:%s" '+q(tokenFile)+')" = 5001:1:600:44\n'+digest(tokenFile,tokenSha256)+
  files.map(n=>'test -f '+q(payload+'/'+n)+'; test ! -L '+q(payload+'/'+n)+'; test "$(stat -c "%u:%h" '+q(payload+'/'+n)+')" = 201:1\n'+digest(payload+'/'+n,manifest[n])).join('')+
  absent(directory)+absent(stage)+'mkdir '+q(directory)+' '+q(code)+' '+q(stage)+'\n'+
  files.map(n=>copy(payload+'/'+n,code+'/'+n,manifest[n],'400')).join('')+copy(tokenFile,stage+'/token',tokenSha256,'600')+'sync\n'+native.guard+
  'systemd-run --quiet --unit='+q(unit)+' '+['User=0','Group=0','SmackProcessLabel=System','PrivateMounts=yes','BindReadOnlyPaths='+code,'TimeoutStopSec=5s','RemainAfterExit=yes','KillMode=control-group','StandardOutput=null','StandardError=null'].map(p=>'--property='+q(p)).join(' ')+' '+['/usr/bin/dotnet',code+'/SamsungTvRootAgent.dll','127.0.0.1',String(port),invocationStage+'/token',invocationStage].map(q).join(' ')+'\nprintf "MANAGED-SUBMITTED\\n"\n';
 check(Buffer.byteLength(command)<=65536);
 return {command,record:{schema:1,id:transitionId,phase:'submitting',implementation:'managed',manifest_sha256:managedSha256,runtime_sha256:runtimeSha256,state_receipt_sha256:receiptSha256,origin_id:inputs.record.id,source:inputs.record.worker_identity,boot_id:inputs.record.boot_id,unit,directory,stage,files:files.reduce((out,n)=>{out[n]=manifest[n];return out;},{}),port,token_file:tokenFile,token_sha256:tokenSha256}};
}
async function submitManaged(options){
 const {transitionId,journalDirectory,selectionFile,execute}=options;
 check(hex(transitionId,32)&&typeof execute==='function'&&typeof journalDirectory==='string'&&path.isAbsolute(journalDirectory)&&path.dirname(selectionFile)===journalDirectory);
 const st=fs.lstatSync(journalDirectory);check(privateDirectory(st));
 const saved=path.join(journalDirectory,transitionId+'.managed-restore-input.json'),restored=path.join(journalDirectory,transitionId+'.managed-restore.json'),restoreMarker=path.join(journalDirectory,'managed-restore.pending');
 const inputText=privateRead(saved,524288),restoreText=privateRead(restored,16384),inputs=JSON.parse(inputText),selected=selectionStatus(selectionFile),p=selected.pending;
 check(selected.phase==='reconciliation-required'&&p&&p.id===transitionId&&['rollback-state-ready','state-ready'].includes(p.phase)&&p.state_sha256===options.receiptSha256);
 const target=p.phase==='rollback-state-ready'?p.from:p.to;check(target.implementation==='managed'&&target.manifest_sha256===options.managedSha256);
 const {command,record}=managedLaunchPlan({...options,inputs});
 const owned=()=>{check(JSON.stringify(selectionStatus(selectionFile))===JSON.stringify(selected)&&privateRead(saved,524288)===inputText&&privateRead(restored,16384)===restoreText&&privateRead(restoreMarker,64)===transitionId+'\n');};
 const file=path.join(journalDirectory,transitionId+'.managed-launch.json'),marker=path.join(journalDirectory,'managed-launch.pending');
 for(const name of [file,marker])try{fs.lstatSync(name);throw Error('Managed launch requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}
 owned();await acceptManagedRestore({transitionId,receiptSha256:options.receiptSha256,journalDirectory,selectionFile,execute});owned();
 const create=(name,text)=>{const fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 create(marker,transitionId+'\n');create(file,JSON.stringify(record));const fd=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const launchOwned=()=>{owned();check(privateRead(marker,64)===transitionId+'\n'&&privateRead(file,16384)===JSON.stringify(record));};
 try{launchOwned();const r=await execute(command,25000);launchOwned();check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='RESTORE-READY\nMANAGED-SUBMITTED\n');const submitted={...record,phase:'submitted'};atomic(file,submitted);return Object.freeze(submitted);}
 catch(cause){try{launchOwned();atomic(file,{...record,phase:'unknown'});}catch(_){}throw Object.assign(Error('Managed launch requires reconciliation'),{outcome:'unknown',cause});}
}
module.exports={managedLaunchPlan,submitManaged};
