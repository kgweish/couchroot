const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {preparePidfdExit:prepare,probeExecutable}=require('../research/autonomous-root/service/pidfd-observer');
const digest=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const preparePidfdExit=options=>prepare({sha256:digest(options.binary),...options});
const {startTicks}=require('../research/autonomous-root/service/worker-processes');
const binary=process.env.PROCESS_OBSERVER;
const enabled=process.platform==='linux'&&!!binary&&process.env.COUCHROOT_PARITY_CONTAINER==='1';
test('executable probe runs the exact native artifact without a target PID',{skip:!enabled},async()=>{
 assert.deepEqual(await probeExecutable({binary,sha256:digest(binary)}),{executed:true});
 await assert.rejects(probeExecutable({binary,sha256:'0'.repeat(64)}),/digest mismatch/);
});
async function fixture(fn){
 const target=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 await once(target,'spawn');const ended=once(target,'exit');
 const bound={boot_id:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),worker_id:'b'.repeat(32),processes:{worker:{pid:target.pid,start_ticks:startTicks(fs.readFileSync('/proc/'+target.pid+'/stat','utf8'),target.pid)},guardian:null}};
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'couchroot-observer-'));
 function script(code){const file=path.join(tmp,'observer');fs.writeFileSync(file,'#!'+process.execPath+'\n'+code,{mode:0o700});return file;}
 try{await fn({target,ended,bound,script});}
 finally{if(target.exitCode===null&&target.signalCode===null)target.kill('SIGKILL');await ended;fs.rmSync(tmp,{recursive:true,force:true});}
}
test('pidfd bridge confirms identity after binding and waits for real exit',{skip:!enabled},async()=>fixture(async({target,ended,bound})=>{
 let confirmations=0;
 const observer=await preparePidfdExit({binary,bound,confirm:async()=>{confirmations++;return bound;}});
 try{
  assert.equal(confirmations,1);assert.equal(target.exitCode,null);
  let settled=false;observer.waitForExit().then(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,50));assert.equal(settled,false);
  target.kill('SIGTERM');await ended;
  const result=await observer.waitForExit();
  assert.equal(result.method,'pidfd');assert.equal(result.processes.worker.observation,'exited');
  assert.equal(result.processes.worker.start_ticks,bound.processes.worker.start_ticks);
 }finally{await observer.cancel();}
}));
test('changed or failed identity confirmation refuses arm without signalling target',{skip:!enabled},async()=>fixture(async({target,bound})=>{
 for(const confirm of [()=>({...bound,worker_id:'c'.repeat(32)}),()=>({...bound,processes:{worker:{...bound.processes.worker,start_ticks:'0'},guardian:null}}),()=>{throw Error('status transport failed');}]){
  await assert.rejects(preparePidfdExit({binary,bound,confirm}));
  assert.equal(target.signalCode,null);assert.equal(target.exitCode,null);
 }
}));
test('observer cancellation reaps only its own child',{skip:!enabled},async()=>fixture(async({target,bound})=>{
 const observer=await preparePidfdExit({binary,bound,confirm:()=>bound});
 await observer.cancel();await assert.rejects(observer.waitForExit(),/cancelled/);
 assert.equal(target.signalCode,null);assert.equal(target.exitCode,null);
}));
test('observer bridge rejects boot mismatch and invalid pair confirmation',{skip:!enabled},async()=>fixture(async({bound})=>{
 let called=false;
 await assert.rejects(preparePidfdExit({binary,bound:{...bound,boot_id:'00000000-0000-0000-0000-000000000001'},confirm:()=>{called=true;return bound;}}));
 assert.equal(called,false);
 await assert.rejects(preparePidfdExit({binary,bound:{...bound,processes:{...bound.processes,guardian:{pid:42,start_ticks:'2'}}},confirm:()=>bound}));
}));
test('pair bridge requires fresh parent capability and unchanged guardian identity',{skip:!enabled},async()=>fixture(async({bound,target})=>fixture(async({bound:other,target:guardian})=>{
 const pair={...bound,processes:{...bound.processes,guardian:other.processes.worker}};
 const fresh={...pair,implementation:'native-prototype',guardian_pid:guardian.pid,capabilities:['worker-process-identity-v1','guardian-parent-identity-v1']};
 for(const confirm of [()=>pair,()=>({...fresh,capabilities:['worker-process-identity-v1']}),()=>({...fresh,processes:{...fresh.processes,guardian:{...fresh.processes.guardian,start_ticks:'0'}}})]){
  await assert.rejects(preparePidfdExit({binary,bound:pair,confirm}));
  assert.equal(target.signalCode,null);assert.equal(guardian.signalCode,null);
 }
 const observer=await preparePidfdExit({binary,bound:pair,confirm:()=>fresh});
 try{
  observer.assertReady();const workerEnded=once(target,'exit');target.kill('SIGTERM');await workerEnded;
  let settled=false;observer.waitForExit().then(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,50));assert.equal(settled,false);
  const guardianEnded=once(guardian,'exit');guardian.kill('SIGTERM');await guardianEnded;
  const result=await observer.waitForExit();
  assert.equal(result.processes.worker.observation,'exited');assert.equal(result.processes.guardian.observation,'exited');
  assert.equal(result.processes.guardian.start_ticks,other.processes.worker.start_ticks);
 }finally{await observer.cancel();}
})));
test('observer bridge refuses altered or linked artifacts before confirmation',{skip:!enabled},async()=>fixture(async({bound,script})=>{
 let called=false;const confirm=()=>{called=true;return bound;};
 await assert.rejects(preparePidfdExit({binary,sha256:'0'.repeat(64),bound,confirm}),/digest mismatch/);
 const link=script('');fs.unlinkSync(link);fs.symlinkSync(binary,link);
 await assert.rejects(preparePidfdExit({binary:link,bound,confirm}));
 assert.equal(called,false);
}));
test('bridge requires exact sequencing bounded output clean EOF and zero exit',{skip:!enabled},async()=>fixture(async({bound,script})=>{
 const bad=[
  "process.stdout.write('EXITED\\n');process.exit(0)",
  "process.stdout.write('BOUND\\nARMED\\n');setInterval(()=>{},1000)",
  "process.stdout.write('x'.repeat(65));setInterval(()=>{},1000)",
  "process.stdout.write('BOUND\\n');process.stdin.once('data',()=>{process.stdout.write('ARMED\\nEXITED\\n');process.exit(1)})",
  "process.stdout.write('BOUND\\n');process.stdin.once('data',()=>{process.stdout.write('ARMED\\nEXITED\\nextra');process.exit(0)})",
  "process.stdout.write('BOUND\\n');process.stdin.once('data',()=>{process.stdout.write('ARMED\\nEXITED\\nEXITED\\n');process.exit(0)})",
  "process.stdout.write('BOUND\\n');process.stdin.once('data',()=>{process.stdout.write('ARMED\\nEXITED\\n');process.stderr.write('error');process.exit(0)})"
 ];
 for(const code of bad)await assert.rejects((async()=>{
  const observer=await preparePidfdExit({binary:script(code),bound,confirm:()=>bound});
  try{await observer.waitForExit();}finally{await observer.cancel();}
 })());
}));
