'use strict';
const {privateDirectory}=require('./private-state');
// Launch and readiness use the held managed worker. Handoff cleanup must be
// supplied independently; the probe may use the same worker throughout.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {prepareSupervisedExit}=require('./observer-controller');
const {inspectObserverUnit,retireObserverUnit}=require('./observer-unit');
const STATE='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
function observerTransactionId(requestId,purpose='probe'){
 if(!['probe','provider-probe','handoff'].includes(purpose))throw Error('Invalid observer transaction purpose');
 if(typeof requestId!=='string'||requestId.length<16||requestId.length>64||!/^[-a-zA-Z0-9]+$/.test(requestId))throw Error('Persistent observer request identity required');
 return crypto.createHash('sha256').update('observer-'+purpose+':'+requestId).digest('hex').slice(0,32);
}
// Bind kernel records to the explicit task and thread-group IDs. WRT can give
// package threads different credentials from their broker's main thread.
function parseCredentials(status,label,pid,tgid=pid){
 const field=name=>{const rows=status.split('\n').filter(line=>line.startsWith(name+':'));if(rows.length!==1)throw Error('Service credential evidence unavailable');return rows[0].slice(name.length+1).trim();};
 const ids=name=>field(name).split(/\s+/).map(Number);
 const uids=ids('Uid'),gids=ids('Gid'),groups=ids('Groups').sort((a,b)=>a-b);
 const requireMatch=(ok,name)=>{if(!ok)throw Error('Kernel credential mismatch: '+name+' for PID '+pid);};
 requireMatch(field('Pid')===String(pid),'pid');
 requireMatch(field('Tgid')===String(tgid),'thread-group');
 requireMatch(uids.length===4&&uids.every(id=>id===5001),'uids');
 requireMatch(gids.length===4&&gids.every(id=>id===100),'gids');
 requireMatch(groups.length>=1&&groups.length<=32&&groups.every(id=>Number.isInteger(id)&&id>=1&&id<=2147483647)&&new Set(groups).size===groups.length&&groups.includes(100),'groups');
 requireMatch(label==='User::Pkg::MiniRoot01','label');
 requireMatch(field('CapEff')==='0000000000000000','capabilities');
 return {uid:5001,gid:100,groups,label};
}
async function readCredentials(execute,pid,bootId,tgid=pid){
 if(!Number.isInteger(pid)||pid<=1||pid>2147483647||!Number.isInteger(tgid)||tgid<=1||tgid>2147483647||typeof bootId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId)||bootId.length!==36)throw Error('Invalid credential observation identity');
 const base='/proc/'+tgid+(tgid===pid?'':'/task/'+pid);
 const guard='test "$(cat /proc/sys/kernel/random/boot_id)" = '+bootId+'\n';
 const command='set -eu\n'+guard+'cat '+base+'/status\nprintf "OBSERVER-SERVICE-LABEL\\n"\ncat '+base+'/attr/current\n'+guard;
 const result=await execute(command,5000);
 if(!result||result.exit_code!==0||result.timed_out||result.stderr||typeof result.stdout!=='string'||result.stdout.length>16384)throw Error('Service credential observation unavailable');
 const parts=result.stdout.split('OBSERVER-SERVICE-LABEL\n');
 if(parts.length!==2)throw Error('Malformed service credential observation');
 return parseCredentials(parts[0],parts[1].trim(),pid,tgid);
}
async function serviceCredentials(execute,bootId){
 // WRT hosts package-labelled JavaScript threads in a broker whose main
 // thread has a different label and capabilities. Bind the calling thread.
 const self=fs.readlinkSync('/proc/thread-self');
 const match=typeof self==='string'&&self.match(/^([1-9][0-9]{0,9})\/task\/([1-9][0-9]{0,9})$/);
 if(!match||self.trim()!==self)throw Error('Current service thread unavailable');
 const profile=await readCredentials(execute,Number(match[2]),bootId,Number(match[1]));
 if(fs.readlinkSync('/proc/thread-self')!==self)throw Error('Service thread changed during credential capture');
 return profile;
}

function journalDirectory(directory){
 if(directory!==STATE)throw Error('Invalid service observer state path');
 const flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
 const parent=fs.openSync(directory,flags);
 try{
  const st=fs.fstatSync(parent),now=fs.lstatSync(directory);
  if(!privateDirectory(st)||now.dev!==st.dev||now.ino!==st.ino)throw Error('Invalid observer state directory');
  const target=path.join(directory,'observer-launches');let created=false;
  try{fs.mkdirSync(target,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  const fd=fs.openSync(target,flags);
  try{
   const child=fs.fstatSync(fd);
   if(!child.isDirectory()||child.uid!==process.geteuid())throw Error('Invalid observer journal owner');
   if(created)fs.fchmodSync(fd,0o700);
   if(!privateDirectory(fs.fstatSync(fd)))throw Error('Invalid observer journal permissions');
   fs.fsyncSync(fd);fs.fsyncSync(parent);
  }finally{fs.closeSync(fd);}
  return target;
 }finally{fs.closeSync(parent);}
}
async function prepareRuntimeObserver({directory,requestId,staged,bound,confirm,execute,purpose='probe',retirement}){
 // Validate before reading credentials or publishing any launch intent. A
 // handoff must never silently fall back to its departing worker for cleanup.
 if(!['probe','provider-probe','handoff'].includes(purpose))throw Error('Invalid observer runtime purpose');
 if(purpose!=='probe'&&(!retirement||typeof retirement.inspectUnit!=='function'||typeof retirement.retireUnit!=='function'))throw Error('Independent observer retirement required before handoff');
 if(purpose==='probe'&&retirement!==undefined)throw Error('Probe retirement must use its held worker');
 const id=observerTransactionId(requestId,purpose);
 if(!bound||!bound.processes||bound.processes.guardian)throw Error('Managed observer probe requires a single worker');
 const credentials=await serviceCredentials(execute,bound.boot_id);
 const journal=journalDirectory(directory);
 const identity=unit=>Object.freeze({unit,bootId:bound.boot_id,sha256:staged.sha256});
 const unitOptions=unit=>({...identity(unit),execute});
 // Capture trusted callbacks before submission. No departing-worker executor is
 // passed to them; they must establish their own authenticated execution path.
 const inspect=purpose!=='probe'?retirement.inspectUnit.bind(retirement):unit=>inspectObserverUnit(unitOptions(unit.unit));
 const retire=purpose!=='probe'?retirement.retireUnit.bind(retirement):unit=>retireObserverUnit(unitOptions(unit.unit));
 return prepareSupervisedExit({device:'s90d',id,directory,journalDirectory:journal,credentials,
  binary:staged.binary,sha256:staged.sha256,manifestSha256:staged.manifest_sha256,bound,execute,
  confirm:async()=>{
   const unit=await inspectObserverUnit(unitOptions('couchroot-observer-'+id+'.service'));
   if(unit.active_state!=='active'||unit.sub_state!=='running'||unit.main_pid<=1)throw Error('Observer supervisor not running');
   const actual=await readCredentials(execute,unit.main_pid,bound.boot_id);
   if(JSON.stringify(actual)!==JSON.stringify(credentials))throw Error('Observer supervisor credentials changed');
   if(purpose!=='probe'){
    const independent=await inspect(identity(unit.unit));
    if(!independent||['unit','boot_id','active_state','sub_state','main_pid','started_monotonic'].some(key=>independent[key]!==unit[key]))throw Error('Independent observer retirement readiness changed');
   }
   return confirm();
  },
  inspectUnit:unit=>inspect(identity(unit)),retireUnit:unit=>retire(identity(unit))});
}
module.exports={prepareRuntimeObserver,observerTransactionId,serviceCredentials,parseCredentials};
