const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {stageObserver,stageCommand}=require('../research/autonomous-root/service/observer-stage');
const ROOT='/opt/usr/apps/MiniRoot01',PAYLOAD=ROOT+'/res/wgt/payload';
const enabled=process.platform==='linux'&&process.geteuid()===0&&process.env.COUCHROOT_PARITY_CONTAINER==='1'&&!!process.env.NATIVE_CANDIDATE_BUILD;
test('staging command accepts only fixed package members and canonical identities',()=>{
 const boot='00000000-0000-0000-0000-000000000001',digest='a'.repeat(64);
 assert.match(stageCommand(PAYLOAD+'/native-process-observer',digest,boot),/chmod 755/);
 for(const file of ['/tmp/native-process-observer',PAYLOAD+'/../native-process-observer',PAYLOAD+'/native-worker',PAYLOAD+"/native-process-observer'; true #"])assert.throws(()=>stageCommand(file,digest,boot));
 assert.throws(()=>stageCommand(PAYLOAD+'/native-process-observer',digest+'x',boot));
 assert.throws(()=>stageCommand(PAYLOAD+'/native-process-observer',digest,boot+'\n'));
});
async function fixture(fn){
 assert.equal(fs.existsSync(ROOT),false,'isolated container package path must be absent');
 fs.mkdirSync(PAYLOAD,{recursive:true});
 try{
  const candidate=process.env.NATIVE_CANDIDATE_BUILD;
  const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'native-manifest.json')));
  const index={};
  for(const n of ['native-manifest.json',...Object.keys(manifest.artifacts)]){
   const bytes=fs.readFileSync(path.join(candidate,n)),file=path.join(PAYLOAD,n);
   fs.writeFileSync(file,bytes,{mode:0o644});fs.chownSync(file,201,0);
   index[n]=crypto.createHash('sha256').update(bytes).digest('hex');
  }
  fs.writeFileSync(path.join(PAYLOAD,'manifest.json'),JSON.stringify(index));
  const bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  const binary=path.join(PAYLOAD,'native-process-observer');
  const execute=async command=>{const r=spawnSync('/bin/sh',['-c',command],{encoding:'utf8',timeout:30000});if(r.error)throw r.error;return {exit_code:r.status,timed_out:false,stdout:r.stdout,stderr:r.stderr};};
  await fn({binary,bootId,execute,options:{payload:PAYLOAD,device:'s90d',bootId,expectedManifest:index['native-manifest.json'],execute}});
 }finally{fs.rmSync(ROOT,{recursive:true,force:true});}
}
test('verified package member becomes executable without changing bytes owner or inode',{skip:!enabled},async()=>fixture(async({binary,options})=>{
 const bytes=fs.readFileSync(binary),before=fs.statSync(binary);
 const receipt=await stageObserver(options),after=fs.statSync(binary);
 assert.equal(receipt.prior_mode,'644');assert.equal(receipt.mode,'755');assert.equal(after.mode&0o7777,0o755);
 assert.equal(after.ino,before.ino);assert.equal(after.uid,201);assert.deepEqual(fs.readFileSync(binary),bytes);
 assert.equal((await stageObserver(options)).prior_mode,'755');
}));
test('wrong owner hardlinks modes and boot mismatch refuse before chmod',{skip:!enabled},async()=>{
 for(const kind of ['owner','link','mode','boot'])await fixture(async({binary,options})=>{
  if(kind==='owner')fs.chownSync(binary,0,0);
  if(kind==='link')fs.linkSync(binary,binary+'.other');
  if(kind==='mode')fs.chmodSync(binary,0o666);
  if(kind==='boot')options.bootId='00000000-0000-0000-0000-000000000001';
  const before=fs.statSync(binary);
  await assert.rejects(stageObserver(options),e=>e.outcome==='failed');assert.equal(fs.statSync(binary).mode,before.mode);
 });
});
test('changed package or ambiguous root result never triggers automatic retry',{skip:!enabled},async()=>fixture(async({binary,options,execute})=>{
 let calls=0;
 await assert.rejects(stageObserver({...options,expectedManifest:'0'.repeat(64),execute:async()=>{calls++;}}),e=>e.outcome==='rejected');assert.equal(calls,0);
 await assert.rejects(stageObserver({...options,execute:async command=>{calls++;await execute(command);throw Error('lost reply');}}),/lost reply/);
 assert.equal(calls,1);assert.equal(fs.statSync(binary).mode&0o777,0o755);
 calls=0;
 await assert.rejects(stageObserver({...options,execute:async command=>{calls++;const result=await execute(command);fs.appendFileSync(binary,'changed');return result;}}));
 assert.equal(calls,1);
}));
