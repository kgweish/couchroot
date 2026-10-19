'use strict';
// Internal S90D submission boundary. Caller owns the listener and must still
// validate readiness and a supervisor receipt; successful submission is neither.
const fs=require('fs'),path=require('path');
const {atomic}=require('./policy');
const HEX=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/,BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PAYLOADS=['/opt/usr/apps/MiniRoot01/res/wgt/payload','/opt/usr/apps/MiniRoot01/payload'];
const STATE='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function launchPlan({device,id,binary,sha256,manifestSha256,launch,credentials}){
 if(device!=='s90d')throw Error('External observer launch is S90D-only');
 if(typeof id!=='string'||id.length!==32||!ID.test(id)||typeof sha256!=='string'||sha256.length!==64||!HEX.test(sha256)||typeof manifestSha256!=='string'||manifestSha256.length!==64||!HEX.test(manifestSha256)||!PAYLOADS.some(p=>binary===p+'/native-process-observer'))throw Error('Invalid observer launch artifact');
 if(!launch||typeof launch.bootId!=='string'||launch.bootId.length!==36||!BOOT.test(launch.bootId)||!Array.isArray(launch.pids)||launch.pids.length<1||launch.pids.length>2||launch.pids.some(p=>!Number.isInteger(p)||p<=1||p>2147483647)||new Set(launch.pids).size!==launch.pids.length)throw Error('Invalid observer launch identities');
 const root=typeof launch.tokenFile==='string'?path.dirname(launch.tokenFile):'';
 if(path.dirname(root)!==STATE||!/^observer-[a-zA-Z0-9]{6}$/.test(path.basename(root))||launch.tokenFile!==root+'/token'||launch.socketPath!==root+'/control')throw Error('Invalid observer launch paths');
 if(!credentials||credentials.uid!==5001||credentials.gid!==100||credentials.label!=='User::Pkg::MiniRoot01'||!Array.isArray(credentials.groups)||credentials.groups.length<1||credentials.groups.length>32||credentials.groups.some(g=>!Number.isInteger(g)||g<1||g>2147483647)||!credentials.groups.includes(100)||new Set(credentials.groups).size!==credentials.groups.length)throw Error('Invalid observer service credentials');
 const groups=credentials.groups.slice().sort((a,b)=>a-b),unit='couchroot-observer-'+id+'.service';
 const parents=[];let parent=path.dirname(binary);while(parent!=='/'){parents.unshift(parent);parent=path.dirname(parent);}
 const executionDirectory='/opt/couchroot-observer-'+id,executable=executionDirectory+'/observer';
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+quote(launch.bootId)+'\n'+
  'for p in '+parents.map(quote).join(' ')+'; do test -d "$p"; test ! -L "$p"; done\n'+
  'test -d '+quote(root)+'; test ! -L '+quote(root)+'\n'+
  'test "$(stat -c "%u:%a" '+quote(root)+')" = 5001:700\n'+
  'test -f '+quote(launch.tokenFile)+'; test ! -L '+quote(launch.tokenFile)+'\n'+
  'test "$(stat -c "%u:%h:%a:%s" '+quote(launch.tokenFile)+')" = 5001:1:600:64\n'+
  'test -S '+quote(launch.socketPath)+'; test ! -L '+quote(launch.socketPath)+'\n'+
  'test -f '+quote(binary)+'; test ! -L '+quote(binary)+'\n'+
  'test "$(stat -c "%u:%h:%a" '+quote(binary)+')" = 201:1:755\n'+
  'test "$(sha256sum '+quote(binary)+' | cut -d " " -f 1)" = '+quote(sha256)+'\n'+
  'umask 077\ntest ! -e '+quote(executionDirectory)+'; test ! -L '+quote(executionDirectory)+'\n'+
  'mkdir '+quote(executionDirectory)+'\ncp '+quote(binary)+' '+quote(executable)+'\nchmod 500 '+quote(executable)+'\n'+
  'test "$(stat -c "%u:%h:%a" '+quote(executable)+')" = 0:1:500\n'+
  'test "$(sha256sum '+quote(executable)+' | cut -d " " -f 1)" = '+quote(sha256)+'\n'+
  'systemd-run --unit='+quote(unit)+' '+['User=0','Group=0','SmackProcessLabel=System','WorkingDirectory=/','StandardOutput=null','StandardError=null','KillMode=control-group','RemainAfterExit=yes','NoNewPrivileges=yes','AmbientCapabilities=','PrivateMounts=yes','BindReadOnlyPaths='+executionDirectory].map(p=>'--property='+quote(p)).join(' ')+' '+[executable,'--service-supervise',groups.join(','),launch.socketPath,launch.tokenFile,launch.bootId,...launch.pids.map(String)].map(quote).join(' ')+'\n'+
  'printf "OBSERVER-SUBMITTED\\n"\n';
 return {unit,command,root,executionDirectory,credentials:{...credentials,groups}};
}
async function submitObserver(options){
 const plan=launchPlan(options),{journalDirectory,execute,id}=options;
 if(typeof execute!=='function'||typeof journalDirectory!=='string'||!path.isAbsolute(journalDirectory))throw Error('Observer submission journal required');
 const st=fs.lstatSync(journalDirectory);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.geteuid()||(st.mode&0o077))throw Error('Private observer journal required');
 const file=path.join(journalDirectory,id+'.observer.json');
 const record={schema:1,id,phase:'submitting',manifest_sha256:options.manifestSha256,observer_sha256:options.sha256,boot_id:options.launch.bootId,pids:options.launch.pids.slice(),unit:plan.unit,root:plan.root,execution_directory:plan.executionDirectory,credentials:plan.credentials};
 try{fs.lstatSync(file);throw Error('Observer transaction already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 // A different request ID must not evade an unfinished launch. This marker is
 // retained until a reconciler verifies termination and cleanup, including when
 // publication or submission fails. Never infer expiry from its age or PID.
 const pending=fs.openSync(path.join(journalDirectory,'observer-launch.pending'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(pending,id+'\n');fs.fsyncSync(pending);}finally{fs.closeSync(pending);}
 // Exclusive creation prevents repeating this submission after any outcome,
 // including a crash before the response or before journal publication.
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 let response;
 try{
  response=await execute(plan.command,25000);
  if(!response||response.exit_code!==0||response.timed_out||response.stdout!=='OBSERVER-SUBMITTED\n')throw Error('Observer submission not acknowledged');
  record.phase='submitted';atomic(file,record);return Object.freeze({...record});
 }catch(error){
  record.phase='unknown';try{atomic(file,record);}catch(_){} // Existing intent still blocks retry.
  throw Object.assign(Error('Observer submission outcome requires reconciliation'),{outcome:'unknown',cause:error});
 }
}
module.exports={launchPlan,submitObserver};
