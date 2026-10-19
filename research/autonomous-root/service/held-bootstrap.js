'use strict';
const fs=require('fs'),path=require('path');
const {read,hash,atomic}=require('./policy');
const {privateRead}=require('./private-state');
const {loadCandidate}=require('./native-candidate');
const {validateResourceInventory}=require('./worker-readiness');
const {processIdentities}=require('./worker-processes');
const {inspectBootstrapUnit}=require('./observer-unit');
const {fenceCommand,markerId,clearMarker}=require('./bootstrap-recovery');
const q=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const check=v=>{if(!v)throw Error('Held native bootstrap evidence unavailable');};
function validateBootstrap(info,{bootId,launcherSha256}){
 check(info&&info.implementation==='native-bootstrap'&&info.boot_id===bootId&&Number.isFinite(info.uptime_seconds)&&info.uptime_seconds>=0&&info.lifetime_mode==='held-bootstrap'&&info.lifetime_seconds===300&&Array.isArray(info.capabilities)&&info.capabilities.slice().sort().join('|')===['held-bootstrap-v1','resource-inventory-v1','worker-process-identity-v1','guardian-parent-identity-v1'].sort().join('|'));
 check(info.app_launcher&&info.app_launcher.sha256===launcherSha256&&info.app_launcher.independently_staged===true);
 const r=validateResourceInventory(info);check(!r.jobs.length&&!r.transfers.length&&!r.helpers.length);
 processIdentities(info,info.processes.worker.pid);return info;
}
function prepareBootstrap({payload,device,stage,port,bootId,journalDirectory,selectionFile}){
 check(/^\/home\/owner\/share\/tmp\/sdk_tools\/archive-root-[a-f0-9]{16}$/.test(stage)&&Number.isInteger(port)&&port>=1024&&port<=65535&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId));
 const candidate=loadCandidate(payload,device);check(candidate);
 const id=path.basename(stage).slice(13).repeat(2),d='/opt/couchroot-bootstrap-'+id,s=d+'/state',unit='couchroot-bootstrap-'+id+'.service';
 for(const n of ['native-worker','native-app-launcher']){const b=read(payload+'/'+n,4*1024*1024);check(hash(b)===candidate.artifacts[n].sha256);fs.writeFileSync(stage+'/code/'+n,b,{mode:0o644,flag:'wx'});}
 const record={schema:2,selection_sha256:hash(privateRead(selectionFile,65536)),fence:'/opt/couchroot-bootstrap-fence-'+id,id,phase:'submitted',boot_id:bootId,directory:d,scope:s,unit,worker_sha256:candidate.artifacts['native-worker'].sha256,launcher_sha256:candidate.artifacts['native-app-launcher'].sha256,token_sha256:hash(read(stage+'/root-agent.token')),file:path.join(journalDirectory,id+'.bootstrap.json')};
 const marker=path.join(journalDirectory,'bootstrap-launch.pending');
 // Persist the complete receipt before publishing an atomic, exclusive pointer.
 // A crash cannot expose an empty marker or permit a launch without its receipt.
 atomic(record.file,record);fs.symlinkSync(id+'.bootstrap.json',marker);
 const fd=fs.openSync(journalDirectory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}

 const copy=(src,dest,sha,mode)=>'test -f '+q(src)+'; test ! -L '+q(src)+'\ntest "$(sha256sum '+q(src)+' | cut -d " " -f1)" = '+sha+'\n(set -C; cat '+q(src)+' > '+dest+')\nchmod '+mode+' '+dest+'\ntest "$(sha256sum '+dest+' | cut -d " " -f1)" = '+sha+'\n';
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\numask 077\n'+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+bootId+'\ntest ! -e '+d+'; test ! -L '+d+'\nmkdir '+d+' '+d+'/code '+s+'\n'+
  copy(stage+'/code/native-worker',d+'/code/worker',record.worker_sha256,'500')+copy(stage+'/code/native-app-launcher',s+'/launcher',record.launcher_sha256,'400')+copy(stage+'/root-agent.token',s+'/token',record.token_sha256,'600')+
  'systemd-run --quiet --unit='+unit+' '+['User=0','Group=0','SmackProcessLabel=System','PrivateMounts=yes','BindReadOnlyPaths='+d+'/code','TimeoutStopSec=5s','RemainAfterExit=yes','KillMode=control-group','NoNewPrivileges=yes','AmbientCapabilities=','StandardOutput=null','StandardError=null'].map(p=>'--property='+q(p)).join(' ')+' /usr/bin/env -i PATH=/usr/bin:/bin DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus '+[d+'/code/worker','127.0.0.1',String(port),s+'/token',s,s+'/launcher',record.launcher_sha256,'--held-bootstrap'].map(q).join(' ')+'\n';
 return {record,command:fenceCommand(record,command)};
}
async function bindBootstrap(record,channel,bootId){
 check(record.boot_id===bootId);const peer=channel._conn;check(peer&&['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)&&peer.identity.smack==='System');
 const info=validateBootstrap(await channel.operation({op:'status'}),{bootId,launcherSha256:record.launcher_sha256}),identity=processIdentities(info,peer.identity.pid);
 const u=await inspectBootstrapUnit({unit:record.unit,bootId,execute:(c,t)=>channel.execute(c,t)});
 check(channel._conn===peer&&u.active_state==='active'&&u.sub_state==='running'&&u.main_pid===identity.processes.guardian.pid&&u.exec_code===0&&u.exec_status===0&&u.started_monotonic!=='0');
 const next={...record,phase:'ready',worker_identity:identity,unit_started_monotonic:u.started_monotonic};atomic(record.file,next);return next;
}
function cleanupCommand(r){
 check(r.phase==='ready'&&/^[a-f0-9]{32}$/.test(r.id)&&r.directory==='/opt/couchroot-bootstrap-'+r.id&&r.scope===r.directory+'/state'&&r.unit==='couchroot-bootstrap-'+r.id+'.service');
 const d=r.directory,s=r.scope,absent=Object.values(r.worker_identity.processes).map(p=>'if test -e /proc/'+p.pid+'/stat; then line=$(cat /proc/'+p.pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" != '+p.start_ticks+'; fi\n').join('');
 const dir=(p,n)=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\ntest "$(find '+p+' -mindepth 1 -maxdepth 1 | wc -l)" -eq '+n+'\n';
 const file=(p,mode,sha)=>'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\n'+(sha?'test "$(sha256sum '+p+' | cut -d " " -f1)" = '+sha+'\n':'');
 return 'set -eu\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\ntest "$(cat /proc/sys/kernel/random/boot_id)" = '+r.boot_id+'\n'+absent+
  'test "$(systemctl show -p MainPID '+r.unit+')" = MainPID=0\ntest "$(systemctl show -p ExecMainStartTimestampMonotonic '+r.unit+')" = ExecMainStartTimestampMonotonic='+r.unit_started_monotonic+'\n'+
  dir(d,2)+dir(d+'/code',1)+dir(s,2)+dir(s+'/.jobs',1)+file(d+'/code/worker','500',r.worker_sha256)+file(s+'/launcher','400',r.launcher_sha256)+file(s+'/.jobs/lock','600')+
  'systemctl stop --no-block '+r.unit+'\nstopped=0\nfor attempt in 1 2 3 4 5 6 7 8 9 10; do\nstate=$(systemctl show -p ActiveState -p MainPID '+r.unit+')\nif printf "%s\\n" "$state" | grep -qx ActiveState=inactive && printf "%s\\n" "$state" | grep -qx MainPID=0; then stopped=1; break; fi\nsleep 0.1\ndone\ntest "$stopped" = 1\n'+absent+'rm '+d+'/code/worker '+s+'/launcher '+s+'/.jobs/lock\nrmdir '+s+'/.jobs '+s+' '+d+'/code '+d+'\nprintf "BOOTSTRAP-RETIRED\\n"\n';
}
async function retireBootstrap(record,owner,next){
 const marker=path.join(path.dirname(record.file),'bootstrap-launch.pending');
 check(privateRead(record.file,16384)===JSON.stringify(record)&&markerId(marker)===record.id);
 const result=await owner.shutdown();check(result.acknowledged&&result.disconnected);
 for(let i=0;;i++){
  const u=await inspectBootstrapUnit({unit:record.unit,bootId:record.boot_id,execute:(c,t)=>next.execute(c,t)});
  check(u.started_monotonic===record.unit_started_monotonic&&u.exec_status===0);
  if(u.main_pid===0&&u.active_state==='active'&&u.sub_state==='exited'&&u.exec_code===1)break;
  check(i<50&&u.main_pid===record.worker_identity.processes.guardian.pid);await new Promise(r=>setTimeout(r,100));
 }
 const cleanup=cleanupCommand(record);
 const r=await next.execute(record.schema===2?fenceCommand(record,cleanup,{seal:true}):cleanup,5000);check(r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='BOOTSTRAP-RETIRED\n');atomic(record.file,{...record,phase:'retired'});clearMarker(record);
}
module.exports={validateBootstrap,prepareBootstrap,bindBootstrap,retireBootstrap,cleanupCommand};
