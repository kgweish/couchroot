'use strict';
const {privateDirectory}=require('./private-state');
// One-shot native maintenance launch. Submission is not readiness or cleanup.
const fs=require('fs'),path=require('path');
const {atomic}=require('./policy');
const {loadCandidate}=require('./native-candidate');
const {processIdentities}=require('./worker-processes');
const STATE='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
const PAYLOADS=['/opt/usr/apps/MiniRoot01/res/wgt/payload','/opt/usr/apps/MiniRoot01/payload'];
const hex=(v,n)=>typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v);
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function launchPlan({device,id,payload,manifestSha256,source,port,tokenFile,tokenSha256}){
 if(!['s90d','qn90a'].includes(device)||!hex(id,32)||!hex(manifestSha256,64)||!hex(tokenSha256,64)||!PAYLOADS.includes(payload)||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid retirement launch binding');
 if(!source||!source.processes||!source.processes.worker)throw Error('Retirement source identity required');
 const identity=processIdentities({...source,capabilities:['worker-process-identity-v1'],...(source.processes.guardian?{implementation:'native-prototype',guardian_pid:source.processes.guardian.pid}:{})},source.processes.worker.pid);
 if(identity.boot_id.length!==36||identity.worker_id.length!==32||Object.values(identity.processes).some(p=>p&&p.pid<=1))throw Error('Invalid retirement source identity');
 const tokenDirectory=typeof tokenFile==='string'?path.dirname(tokenFile):'';
 if(path.dirname(tokenDirectory)!==STATE||!/^retirement-[a-zA-Z0-9]{6}$/.test(path.basename(tokenDirectory))||tokenFile!==tokenDirectory+'/token')throw Error('Private retirement token required');
 const candidate=loadCandidate(payload,device);
 if(!candidate||candidate.manifest_sha256!==manifestSha256)throw Error('Retirement candidate manifest changed');
 const hashes={};for(const name of ['native-worker','native-app-launcher','native-process-observer']){
  const artifact=candidate.artifacts[name];if(!artifact||!hex(artifact.sha256,64))throw Error('Retirement candidate artifact missing');hashes[name]=artifact.sha256;
 }
 const directory='/opt/couchroot-retirement-'+id,code=directory+'/code',scope=directory+'/state',unit='couchroot-retirement-'+id+'.service';
 const parents=[];let parent=payload;while(parent!=='/'){parents.unshift(parent);parent=path.dirname(parent);}
 const boot='test "$(cat /proc/sys/kernel/random/boot_id)" = '+quote(identity.boot_id)+'\n';
 const sourceGuard=Object.values(identity.processes).filter(Boolean).map(p=>'line=$(cat /proc/'+p.pid+'/stat)\nrest=${line##*) }; set -- $rest; test \"$#\" -ge 20; shift 19; test \"$1\" = '+quote(p.start_ticks)+'\n').join('');
 const digest=(file,sha)=>'test "$(sha256sum '+quote(file)+' | cut -d " " -f 1)" = '+quote(sha)+'\n';
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\numask 077\n'+boot+sourceGuard+
  'for p in '+parents.map(quote).join(' ')+'; do test -d "$p"; test ! -L "$p"; done\n'+
  'test -d '+quote(tokenDirectory)+'; test ! -L '+quote(tokenDirectory)+'\n'+
  'test "$(stat -c "%u:%a" '+quote(tokenDirectory)+')" = 5001:700\n'+
  'test -f '+quote(tokenFile)+'; test ! -L '+quote(tokenFile)+'\n'+
  'test "$(stat -c "%u:%h:%a:%s" '+quote(tokenFile)+')" = 5001:1:600:44\n'+digest(tokenFile,tokenSha256)+
  Object.keys(hashes).map(name=>'test -f '+quote(payload+'/'+name)+'; test ! -L '+quote(payload+'/'+name)+'\n'+'test "$(stat -c "%u:%h" '+quote(payload+'/'+name)+')" = 201:1\n'+digest(payload+'/'+name,hashes[name])).join('')+
  'test ! -e '+quote(directory)+'; test ! -L '+quote(directory)+'\nmkdir '+[directory,code,scope].map(quote).join(' ')+'\n'+
  [[payload+'/native-worker',code+'/worker','500',hashes['native-worker']],[payload+'/native-app-launcher',scope+'/launcher','400',hashes['native-app-launcher']],[tokenFile,scope+'/token','600',tokenSha256]].map(([from,to,mode,sha])=>'cp '+quote(from)+' '+quote(to)+'\nchmod '+mode+' '+quote(to)+'\ntest "$(stat -c "%u:%h:%a" '+quote(to)+')" = 0:1:'+mode+'\n'+digest(to,sha)).join('')+boot+sourceGuard+
  'systemd-run --quiet --unit='+quote(unit)+' '+['User=0','Group=0','SmackProcessLabel=System','PrivateMounts=yes','BindReadOnlyPaths='+code,'RuntimeMaxSec=300s','TimeoutStopSec=5s','RemainAfterExit=yes','KillMode=control-group','NoNewPrivileges=yes','AmbientCapabilities=','StandardOutput=null','StandardError=null','Environment=COUCHROOT_NATIVE_LIFETIME_SECONDS=300'].map(p=>'--property='+quote(p)).join(' ')+' '+[code+'/worker','127.0.0.1',String(port),scope+'/token',scope,scope+'/launcher',hashes['native-app-launcher']].map(quote).join(' ')+'\nprintf "RETIREMENT-SUBMITTED\\n"\n';
 return {command,record:{schema:1,id,phase:'submitting',device,manifest_sha256:manifestSha256,worker_sha256:hashes['native-worker'],launcher_sha256:hashes['native-app-launcher'],observer_sha256:hashes['native-process-observer'],boot_id:identity.boot_id,source:identity,unit,directory,scope,token_file:tokenFile,token_sha256:tokenSha256,port}};
}
async function submitRetirement(options){
 const {command,record}=launchPlan(options),{journalDirectory,execute,id}=options;
 if(typeof execute!=='function'||typeof journalDirectory!=='string'||!path.isAbsolute(journalDirectory))throw Error('Retirement launch journal required');
 const st=fs.lstatSync(journalDirectory);
 if(!privateDirectory(st))throw Error('Private retirement journal required');
 const file=path.join(journalDirectory,id+'.retirement.json'),marker=path.join(journalDirectory,'retirement-launch.pending');
 for(const target of [file,marker])try{fs.lstatSync(target);throw Error('Retirement launch requires reconciliation');}catch(error){if(error.code!=='ENOENT')throw error;}
 const exclusive=(target,data)=>{const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 exclusive(marker,id+'\n');exclusive(file,JSON.stringify(record));
 const parent=fs.openSync(journalDirectory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 try{
  const result=await execute(command,25000);
  if(!result||result.exit_code!==0||result.timed_out||result.stdout!=='RETIREMENT-SUBMITTED\n')throw Error('Retirement launch was not acknowledged');
  record.phase='submitted';atomic(file,record);return Object.freeze(record);
 }catch(error){record.phase='unknown';try{atomic(file,record);}catch(_){}throw Object.assign(Error('Retirement launch requires reconciliation'),{outcome:'unknown',cause:error});}
}
module.exports={launchPlan,submitRetirement};
