const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {processIdentities,observeProcesses,waitForProcessExit,startTicks}=require('../research/autonomous-root/service/worker-processes');
const BOOT='00000000-0000-0000-0000-000000000001';
const stat=(pid,ticks,state='S')=>pid+' (name ) with\n spaces) '+[state,...Array(18).fill('0'),ticks,'0'].join(' ');
function info(){return {boot_id:BOOT,worker_id:'b'.repeat(32),capabilities:['worker-process-identity-v1'],processes:{worker:{pid:42,start_ticks:'123'},guardian:null}};}
const absent=()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});};
test('process identities bind authenticated worker PID and native guardian',()=>{
 const v=info();assert.deepEqual(processIdentities(v,42).processes,v.processes);
 assert.throws(()=>processIdentities(v,43));
 for(const change of [v=>v.capabilities=[],v=>v.processes.worker.start_ticks=123,v=>v.processes.worker.pid=0,v=>v.processes.worker.extra=1,v=>v.processes.guardian={pid:43,start_ticks:'321'}]){const v=info();change(v);assert.throws(()=>processIdentities(v,42));}
 const n={...info(),implementation:'native-prototype',guardian_pid:43};
 assert.throws(()=>processIdentities(n,42));n.processes.guardian={pid:43,start_ticks:'321'};assert.equal(processIdentities(n,42).processes.guardian.pid,43);
 n.processes.guardian.pid=42;assert.throws(()=>processIdentities(n,42));
});
test('proc stat parsing preserves large tick strings and unusual comm text',()=>{
 assert.equal(startTicks(stat(42,'18446744073709551615'),42),'18446744073709551615');
 for(const value of [stat(41,'123'),stat(42,'-1'),stat(42,'01'),'42 (bad) R 1','42 bad R 1'])assert.throws(()=>startTicks(value,42));
});
test('exit observations distinguish matching zombies absent and reused PIDs',()=>{
 const bound=processIdentities(info(),42);
 for(const [value,expected] of [[stat(42,'123'),'present'],[stat(42,'123','Z'),'present'],[stat(42,'124'),'reused'],[null,'absent']]){
  const result=observeProcesses(bound,p=>p.endsWith('boot_id')?BOOT:value===null?absent():value);
  assert.equal(result.processes.worker.observation,expected);
  assert.equal(result.processes.worker.observed_start_ticks,expected==='absent'?null:expected==='reused'?'124':'123');
 }
});
test('permission failures malformed stat and boot changes never imply exit',()=>{
 const bound=processIdentities(info(),42);
 for(const reader of [p=>p.endsWith('boot_id')?BOOT:(()=>{throw Object.assign(Error('denied'),{code:'EACCES'});})(),p=>p.endsWith('boot_id')?BOOT:'broken',()=>BOOT.replace(/1$/,'2')])assert.throws(()=>observeProcesses(bound,reader));
 let boots=0;assert.throws(()=>observeProcesses(bound,p=>p.endsWith('boot_id')?(++boots===1?BOOT:BOOT.replace(/1$/,'2')):absent()),/Boot changed/);
});
test('exit wait requires both worker and guardian gone and has a bounded deadline',async()=>{
 const n={...info(),implementation:'native-prototype',guardian_pid:43};n.processes.guardian={pid:43,start_ticks:'321'};
 const bound=processIdentities(n,42);
 await assert.rejects(waitForProcessExit(bound,{timeoutMs:1,read:p=>p.endsWith('boot_id')?BOOT:p.includes('/43/')?stat(43,'321'):absent()}),/still present/);
 const result=await waitForProcessExit(bound,{timeoutMs:1,read:p=>p.endsWith('boot_id')?BOOT:absent()});
 assert.equal(result.processes.guardian.observation,'absent');
 for(const timeoutMs of [0,30001,NaN])await assert.rejects(waitForProcessExit(bound,{timeoutMs}),/deadline/);
});
test('Linux observation waits for a real owned child process to exit',{skip:process.platform!=='linux'},async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 await once(child,'spawn');const ended=once(child,'exit');
 try{
  const v=info();v.boot_id=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  v.processes.worker={pid:child.pid,start_ticks:startTicks(fs.readFileSync('/proc/'+child.pid+'/stat','utf8'),child.pid)};
  const bound=processIdentities(v,child.pid);assert.equal(observeProcesses(bound).processes.worker.observation,'present');
  await assert.rejects(waitForProcessExit(bound,{timeoutMs:1}),/still present/);
  child.kill('SIGTERM');await ended;
  assert.equal((await waitForProcessExit(bound)).processes.worker.observation,'absent');
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await ended;}}
});
