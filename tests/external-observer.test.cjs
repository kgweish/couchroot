const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {createExternalObserver}=require('../research/autonomous-root/service/external-observer');
const {startTicks}=require('../research/autonomous-root/service/worker-processes');
const BOOT='00000000-0000-0000-0000-000000000001';
const bound={boot_id:BOOT,worker_id:'a'.repeat(32),capabilities:['worker-process-identity-v1'],processes:{worker:{pid:42,start_ticks:'123'},guardian:null}};
const pause=()=>new Promise(r=>setTimeout(r,30));
async function fixture(fn,options={}){
 const directory=fs.mkdtempSync('/tmp/cr-ext-');let observer,socket;
 try{
  observer=await createExternalObserver({directory,bound,confirm:()=>bound,timeoutMs:2000,...options});
  socket=net.connect(observer.launch.socketPath);socket.on('error',()=>{});await once(socket,'connect');
  const token=fs.readFileSync(observer.launch.tokenFile,'utf8');
  await fn({observer,socket,token,directory});
 }finally{
  if(socket)socket.destroy();
  if(observer){observer.cancel();try{observer.recordExit({exit_code:1,signal:null});}catch(_){}await observer.dispose();}
  fs.rmSync(directory,{recursive:true,force:true});
 }
}
async function arm(socket,token,observer){
 const data=once(socket,'data');socket.write('AUTH '+token+'\nBOUND\n');
 assert.equal((await data)[0].toString(),'ARM\n');socket.write('ARMED\n');return observer.ready;
}
test('external listener binds identity and requires independent exit receipt after EOF',()=>fixture(async({observer,socket,token})=>{
 const armed=await arm(socket,token,observer);armed.assertReady();
 let done=false;observer.exited.then(()=>{done=true;});socket.end('EXITED\n');await pause();
 assert.equal(done,false);await assert.rejects(observer.dispose(),/termination must be established/);
 observer.recordExit({exit_code:0,signal:null});const result=await armed.waitForExit();
 assert.equal(result.method,'pidfd-external');assert.equal(result.processes.worker.start_ticks,'123');
 assert.equal(result.processes.worker.observation,'exited');
 assert.throws(()=>observer.recordExit({exit_code:0,signal:null}),/duplicate/);
}));
test('authentication failure refuses confirmation and permits cleanup only after process receipt',async()=>{
 let confirmations=0;
 await fixture(async({observer,socket})=>{
  socket.write('AUTH '+'b'.repeat(64)+'\nBOUND\n');await assert.rejects(observer.ready,/authentication/);
  assert.equal(confirmations,0);await assert.rejects(observer.dispose(),/termination/);
 },{confirm:()=>{confirmations++;return bound;}});
});
test('changed worker identity refuses ARM',()=>fixture(async({observer,socket,token})=>{
 socket.write('AUTH '+token+'\nBOUND\n');await assert.rejects(observer.ready,/Worker changed/);
},{confirm:()=>({...bound,worker_id:'b'.repeat(32)})}));
test('premature and extra protocol messages fail closed',async()=>{
 for(const input of ['BOUND\n','AUTH TOKEN\nARMED\n','AUTH TOKEN\nBOUND\nEXITED\n','AUTH TOKEN\n'+'x'.repeat(129)]){
  await fixture(async({observer,socket,token})=>{
   socket.write(input.replace('TOKEN',token));await assert.rejects(observer.ready);
  });
 }
});
test('nonzero observer exit invalidates otherwise complete observation',()=>fixture(async({observer,socket,token})=>{
 await arm(socket,token,observer);socket.end('EXITED\n');await pause();
 observer.recordExit({exit_code:1,signal:null});await assert.rejects(observer.exited,/did not exit successfully/);
}));
test('cancellation and deadlines retain files until termination is established',async()=>{
 await fixture(async({observer,socket,token})=>{
  await arm(socket,token,observer);observer.cancel();await assert.rejects(observer.exited,/cancelled/);
  assert.equal(fs.existsSync(observer.launch.tokenFile),true);await assert.rejects(observer.dispose(),/termination/);
 });
 await fixture(async({observer})=>{await assert.rejects(observer.ready,/deadline/);},{timeoutMs:100});
});
test('private directory and bounded socket path are required',async()=>{
 const directory=fs.mkdtempSync('/tmp/cr-ext-');
 try{fs.chmodSync(directory,0o755);await assert.rejects(createExternalObserver({directory,bound,confirm:()=>bound}),/Private/);}
 finally{fs.rmdirSync(directory);}
});
test('ordinary native socket observer completes against real process identity',{
 skip:process.platform!=='linux'||!process.env.PROCESS_OBSERVER||process.env.COUCHROOT_PARITY_CONTAINER!=='1',timeout:10000
},async()=>{
 const directory=fs.mkdtempSync('/tmp/cr-ext-');let observer,child;
 const target=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(target,'spawn');const targetExit=once(target,'exit');
 try{
  const identity={...bound,boot_id:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),processes:{worker:{pid:target.pid,start_ticks:startTicks(fs.readFileSync('/proc/'+target.pid+'/stat','utf8'),target.pid)},guardian:null}};
  observer=await createExternalObserver({directory,bound:identity,confirm:()=>identity});
  const l=observer.launch;child=spawn(process.env.PROCESS_OBSERVER,['--connect',l.socketPath,l.tokenFile,l.bootId,...l.pids.map(String)],{stdio:['ignore','ignore','pipe']});
  child.on('close',(code,signal)=>observer.recordExit({exit_code:code,signal}));
  const armed=await observer.ready;armed.assertReady();target.kill('SIGTERM');await targetExit;
  const result=await observer.exited;assert.equal(result.processes.worker.pid,target.pid);
  await observer.dispose();assert.deepEqual(fs.readdirSync(directory),[]);
 }finally{
  if(target.exitCode===null&&target.signalCode===null){target.kill('SIGKILL');await targetExit;}
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'close');}
  if(observer){observer.cancel();try{await observer.dispose();}catch(_){}}
  fs.rmSync(directory,{recursive:true,force:true});
 }
});

test('published supervisor receipt is bound to this launch and waits for intent removal',()=>fixture(async({observer,socket,token})=>{
 await arm(socket,token,observer);socket.end('EXITED\n');await pause();
 const root=path.dirname(observer.launch.tokenFile),file=path.join(root,'result'),intent=path.join(root,'result.next');
 const report={schema:1,boot_id:BOOT,worker_pid:42,guardian_pid:null,observer_pid:99,exit_code:0,signal:null};
 fs.writeFileSync(file,JSON.stringify({...report,worker_pid:43}),{mode:0o600});
 assert.throws(()=>observer.readPublishedExit(),/mismatch/);fs.unlinkSync(file);
 fs.writeFileSync(file,JSON.stringify(report),{mode:0o600});fs.writeFileSync(intent,'',{mode:0o600});
 assert.equal(observer.readPublishedExit(),false);fs.unlinkSync(intent);
 assert.equal(observer.readPublishedExit(),true);assert.equal((await observer.exited).method,'pidfd-external');
}));
test('receipt symlinks public permissions and malformed contents are refused',()=>fixture(async({observer})=>{
 const root=path.dirname(observer.launch.tokenFile),file=path.join(root,'result');
 fs.symlinkSync(observer.launch.tokenFile,file);assert.throws(()=>observer.readPublishedExit());fs.unlinkSync(file);
 fs.writeFileSync(file,'{}',{mode:0o644});assert.throws(()=>observer.readPublishedExit(),/receipt file/);fs.chmodSync(file,0o600);
 assert.throws(()=>observer.readPublishedExit(),/mismatch/);fs.unlinkSync(file);
 assert.equal(observer.readPublishedExit(),false);
}));
test('native supervisor supplies reaped-child receipt to the real socket listener',{
 skip:process.platform!=='linux'||!process.env.PROCESS_OBSERVER||process.env.COUCHROOT_PARITY_CONTAINER!=='1',timeout:10000
},async()=>{
 const directory=fs.mkdtempSync('/tmp/cr-ext-');let observer,supervisor;
 const target=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(target,'spawn');const targetExit=once(target,'exit');
 try{
  const identity={...bound,boot_id:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),processes:{worker:{pid:target.pid,start_ticks:startTicks(fs.readFileSync('/proc/'+target.pid+'/stat','utf8'),target.pid)},guardian:null}};
  observer=await createExternalObserver({directory,bound:identity,confirm:()=>identity});
  const l=observer.launch;supervisor=spawn(process.env.PROCESS_OBSERVER,['--supervise',l.socketPath,l.tokenFile,l.bootId,...l.pids.map(String)],{stdio:'ignore'});
  const supervisorExit=once(supervisor,'exit');
  const armed=await observer.ready;armed.assertReady();assert.equal(observer.readPublishedExit(),false);
  target.kill('SIGTERM');await targetExit;assert.deepEqual(await supervisorExit,[0,null]);
  assert.equal(observer.readPublishedExit(),true);
  assert.equal((await observer.exited).processes.worker.pid,target.pid);
  await observer.dispose();assert.deepEqual(fs.readdirSync(directory),[]);
 }finally{
  if(target.exitCode===null&&target.signalCode===null){target.kill('SIGKILL');await targetExit;}
  if(supervisor&&supervisor.exitCode===null&&supervisor.signalCode===null){supervisor.kill('SIGKILL');await once(supervisor,'exit');}
  if(observer){observer.cancel();try{await observer.dispose();}catch(_){}}
  fs.rmSync(directory,{recursive:true,force:true});
 }
});
