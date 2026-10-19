'use strict';
// Read-only, single-attempt query. Caller chooses a live, authenticated executor;
// a disconnected worker cannot establish its former supervisor's unit state.
const UNITS={bootstrap:/^couchroot-bootstrap-[a-f0-9]{32}\.service$/,managed:/^couchroot-managed-[a-f0-9]{32}\.service$/,worker:/^couchroot-worker-[a-f0-9]{32}\.service$/,observer:/^couchroot-observer-[a-f0-9]{32}\.service$/,retirement:/^couchroot-retirement-[a-f0-9]{32}\.service$/};
const BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
async function inspectOwnedUnit({unit,bootId,execute,allowMissing=false},kind){
 if(typeof unit!=='string'||unit.length!==('couchroot-'+kind+'-').length+40||!UNITS[kind].test(unit)||typeof bootId!=='string'||bootId.length!==36||!BOOT.test(bootId)||typeof execute!=='function')throw Error('Invalid observer unit inspection');
 const guard='test "$(cat /proc/sys/kernel/random/boot_id)" = '+bootId+'\n';
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+guard+
  'systemctl show --property=Id,LoadState,ActiveState,SubState,MainPID,ExecMainCode,ExecMainStatus,ExecMainStartTimestampMonotonic '+unit+'\n'+guard;
 const r=await execute(command,5000);
 if(!r||r.exit_code!==0||r.timed_out||r.stderr||typeof r.stdout!=='string'||r.stdout.length>2048)throw Error('Observer unit inspection unavailable');
 const values=Object.create(null);
 for(const line of r.stdout.trimEnd().split('\n')){
  const i=line.indexOf('=');if(i<1||Object.prototype.hasOwnProperty.call(values,line.slice(0,i)))throw Error('Malformed observer unit inspection');
  values[line.slice(0,i)]=line.slice(i+1);
 }
 if(Object.keys(values).sort().join('|')!=='ActiveState|ExecMainCode|ExecMainStartTimestampMonotonic|ExecMainStatus|Id|LoadState|MainPID|SubState'||values.Id!==unit||(values.LoadState!=='loaded'&&!(kind==='retirement'&&allowMissing&&values.LoadState==='not-found'))||!['inactive','active','activating','deactivating','failed','reloading'].includes(values.ActiveState))throw Error('Observer unit identity unavailable');
 for(const key of ['MainPID','ExecMainCode','ExecMainStatus','ExecMainStartTimestampMonotonic'])if(!/^(0|[1-9][0-9]{0,19})$/.test(values[key])||values[key].trim()!==values[key])throw Error('Invalid observer unit counter');
 const pid=Number(values.MainPID),code=Number(values.ExecMainCode),status=Number(values.ExecMainStatus);
 if(!Number.isSafeInteger(pid)||pid>2147483647||code>3||status>255)throw Error('Observer unit counter exceeds limits');
 if(values.LoadState==='not-found'&&!(values.ActiveState==='inactive'&&values.SubState==='dead'&&pid===0&&code===0&&status===0&&values.ExecMainStartTimestampMonotonic==='0'))throw Error('Missing retirement unit has inconsistent state');
 return {...(values.LoadState==='not-found'?{load_state:'not-found'}:{}),unit,boot_id:bootId,active_state:values.ActiveState,sub_state:values.SubState,main_pid:pid,exec_code:code,exec_status:status,started_monotonic:values.ExecMainStartTimestampMonotonic};
}
const inspectObserverUnit=options=>inspectOwnedUnit(options,'observer');
const inspectRetirementUnit=options=>inspectOwnedUnit(options,'retirement');
const inspectManagedUnit=options=>inspectOwnedUnit(options,'managed');
const inspectProductionUnit=options=>inspectOwnedUnit(options,'worker');
async function retireObserverUnit(options){
 const {unit,bootId,execute,sha256}=options;
 if(typeof sha256!=='string'||sha256.length!==64||!/^[a-f0-9]+$/.test(sha256))throw Error('Invalid observer staged artifact digest');
 const directory='/opt/'+unit.slice(0,-8),binary=directory+'/observer';
 const evidence=await inspectObserverUnit(options);
 require('./observer-controller').terminationEvidence(evidence,{unit,boot_id:bootId});
 const guard='test "$(cat /proc/sys/kernel/random/boot_id)" = '+bootId+'\n';
 const command='set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\n'+guard+
  'step=stop\ntrap \'result=$?; if test "$result" -ne 0; then printf "OBSERVER-RETIRE-FAILED:%s\\n" "$step" >&2; fi\' EXIT\n'+
  'systemctl stop --no-block '+unit+'\nstep=state\nretired=0\n'+
  'for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do\n'+
  'state=$(systemctl show -p LoadState -p ActiveState -p MainPID '+unit+')\n'+
  'test "$(printf "%s\\n" "$state" | wc -l)" -eq 3\n'+
  'printf "%s\\n" "$state" | grep -qx "LoadState=\\(loaded\\|not-found\\)"\n'+
  'if printf "%s\\n" "$state" | grep -qx ActiveState=inactive && printf "%s\\n" "$state" | grep -qx MainPID=0; then retired=1; break; fi\n'+
  'sleep 0.1\ndone\ntest "$retired" = 1\n'+guard+
  'step=artifact\n'+
  'test -d '+directory+'; test ! -L '+directory+'\n'+
  'test "$(stat -c "%u:%a" '+directory+')" = 0:700\n'+
  'test -f '+binary+'; test ! -L '+binary+'\n'+
  'test "$(stat -c "%u:%h:%a" '+binary+')" = 0:1:500\n'+
  'test "$(sha256sum '+binary+' | cut -d " " -f 1)" = '+sha256+'\n'+
  'test "$(find '+directory+' -mindepth 1 -maxdepth 1 | wc -l)" -eq 1\n'+
  'step=remove\n'+
  'rm '+binary+'\nrmdir '+directory+'\n'+guard+
  'printf "OBSERVER-UNIT-RETIRED\\n"\n';
 const r=await execute(command,5000);
 if(!r||r.exit_code!==0||r.timed_out||r.stdout!=='OBSERVER-UNIT-RETIRED\n')throw Error('Observer unit retirement requires reconciliation: '+(r&&r.timed_out?'timeout':r&&typeof r.stderr==='string'&&r.stderr.match(/OBSERVER-RETIRE-FAILED:([a-z]+)/)?r.stderr.match(/OBSERVER-RETIRE-FAILED:([a-z]+)/)[1]:'response')+' (exit '+(r?r.exit_code:'missing')+')');
 return {unit,boot_id:bootId,retired:true};
}
module.exports={inspectBootstrapUnit:options=>inspectOwnedUnit(options,'bootstrap'),inspectManagedUnit,inspectObserverUnit,inspectRetirementUnit,inspectProductionUnit,retireObserverUnit};
