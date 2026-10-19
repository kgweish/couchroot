const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {reconcileRetirement,remainderCommand}=require('../research/autonomous-root/service/retirement-reconcile');
const state='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state',boot='00000000-0000-0000-0000-000000000001',sha='b'.repeat(64),id='f'.repeat(32);
const source={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}};
function record(){return {schema:1,id,phase:'shutdown-acknowledged',device:'s90d',manifest_sha256:sha,worker_sha256:sha,launcher_sha256:sha,observer_sha256:sha,boot_id:boot,source,unit:'couchroot-retirement-'+id+'.service',directory:'/opt/couchroot-retirement-'+id,scope:'/opt/couchroot-retirement-'+id+'/state',token_file:state+'/retirement-ABC123/token',token_sha256:sha,port:12345,provider_identity:{boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:77,start_ticks:'200'},guardian:{pid:76,start_ticks:'199'}}},unit_started_monotonic:'123'};}
const linux={skip:!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0};
async function fixture(fn){return require('./retirement-test-state.cjs').withRetirementState(async()=>{
 fs.mkdirSync(state,{recursive:true,mode:0o700});const directory=fs.mkdtempSync(state+'/retirement-'),r=record(),token=crypto.randomBytes(32).toString('base64');r.token_file=directory+'/token';r.token_sha256=crypto.createHash('sha256').update(token).digest('hex');
 const file=state+'/'+id+'.retirement.json',marker=state+'/retirement-launch.pending',commands=[];
 const save=()=>fs.writeFileSync(file,JSON.stringify(r),{mode:0o600});
 fs.writeFileSync(r.token_file,token,{mode:0o600,flag:'wx'});fs.writeFileSync(marker,id+'\n',{mode:0o600,flag:'wx'});save();
 const intent=k=>fs.writeFileSync(file+'.'+k+'.pending',id+'\n',{mode:0o600,flag:'wx'});
 let unit='exited';
 const options={record:r,journalDirectory:state,executorPid:42,confirmExecutor:async()=>({...source,capabilities:['worker-process-identity-v1']}),execute:async command=>{
  commands.push(command);
  if(command.includes('--property=Id,'))return {exit_code:0,stdout:`Id=${r.unit}\nLoadState=${unit==='missing'?'not-found':'loaded'}\nActiveState=${unit==='missing'?'inactive':'active'}\nSubState=${unit==='missing'?'dead':unit}\nMainPID=${unit==='running'?'76':'0'}\nExecMainCode=${unit==='missing'?'0':'1'}\nExecMainStatus=0\nExecMainStartTimestampMonotonic=${unit==='missing'?'0':'123'}\n`};
  if(command.includes('EXIT-OBSERVED'))return {exit_code:0,stdout:'EXIT-OBSERVED\n'};
  return {exit_code:0,stdout:command.includes('RETIREMENT-RECONCILED')?'RETIREMENT-RECONCILED\n':'RETIREMENT-CLEANED\n'};
 }};
 try{await fn({r,file,marker,directory,save,intent,options,commands,setUnit:v=>{unit=v;}});}finally{
  fs.rmSync(directory,{recursive:true,force:true});for(const p of [file,marker,...['shutdown','cleanup','finish','readiness'].map(k=>file+'.'+k+'.pending')])fs.rmSync(p,{force:true});
 }
});}
test('lost shutdown response is reconciled by observed exit, without replaying shutdown',linux,()=>fixture(async f=>{
 f.r.phase='ready';f.save();f.intent('shutdown');
 const result=await reconcileRetirement(f.options);assert.equal(result.phase,'complete');assert.ok(f.commands.some(c=>c.includes('EXIT-OBSERVED')));assert.equal(fs.existsSync(f.marker),false);assert.equal(fs.existsSync(f.directory),false);assert.ok(f.commands.every(c=>!c.includes('SHUTDOWN')));
}));
test('interrupted cleanup resumes only from completed or missing unit evidence',linux,async()=>{
 for(const unit of ['exited','missing'])await fixture(async f=>{f.intent('cleanup');f.setUnit(unit);const r=await reconcileRetirement(f.options);assert.equal(r.phase,'complete');assert.ok(f.commands.some(c=>c.includes(unit==='missing'?'RETIREMENT-RECONCILED':'RETIREMENT-CLEANED')));});
});
test('token and completion publication crash windows release only their matching marker',linux,async()=>{
 for(const mode of ['token','empty-dir','absent-dir','complete-with-intent','complete-marker'])await fixture(async f=>{
  f.r.phase=mode.startsWith('complete')?'complete':'staging-retired';f.save();if(mode!=='token'&&mode!=='complete-marker')f.intent('finish');
  if(mode!=='token'){fs.unlinkSync(f.r.token_file);if(mode!=='empty-dir')fs.rmdirSync(f.directory);}
  const result=await reconcileRetirement(f.options);assert.equal(result.phase,'complete');assert.equal(fs.existsSync(f.marker),false);assert.equal(f.commands.length,0);
 });
});
test('live provider, missing unit without cleanup intent and unfinished readiness retain ownership',linux,async()=>{
 for(const mode of ['running','missing','readiness'])await fixture(async f=>{
  f.r.phase='ready';f.save();f.intent('shutdown');if(mode==='readiness')f.intent('readiness');else f.setUnit(mode);
  await assert.rejects(reconcileRetirement(f.options));assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(f.r.token_file),true);assert.ok(f.commands.every(c=>c.includes('--property=Id,')));
 });
});
test('unexpected token content, missing token without intent and replaced marker cannot finish',linux,async()=>{
 for(const mode of ['token','extra','missing','marker'])await fixture(async f=>{
  f.r.phase='staging-retired';f.save();
  if(mode==='token')fs.writeFileSync(f.r.token_file,'different');if(mode==='extra')fs.writeFileSync(f.directory+'/extra','preserve');if(mode==='missing')fs.unlinkSync(f.r.token_file);if(mode==='marker')fs.writeFileSync(f.marker,'e'.repeat(32)+'\n');
  await assert.rejects(reconcileRetirement(f.options));assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(f.directory),true);
 });
});
test('lost reconciliation response leaves cleanup intent for a later independently observed pass',linux,()=>fixture(async f=>{
 f.intent('cleanup');f.setUnit('missing');const execute=f.options.execute;
 f.options.execute=async command=>{const r=await execute(command);if(command.includes('RETIREMENT-RECONCILED'))throw Error('response lost');return r;};
 await assert.rejects(reconcileRetirement(f.options),e=>e.outcome==='unknown');assert.equal(fs.existsSync(f.file+'.cleanup.pending'),true);assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'shutdown-acknowledged');
 f.options.execute=execute;assert.equal((await reconcileRetirement(f.options)).phase,'complete');
}));
test('remainder shell accepts partial removal but preserves unknown or replaced artifacts',linux,async()=>{
 for(const mode of ['all','partial','absent','extra','symlink','hash','live','active']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retire-remainder-')),r=record(),d=root+'/owned',s=d+'/state';
  try{
   for(const p of [d,d+'/code',s,s+'/.jobs',root+'/bin',root+'/proc'])fs.mkdirSync(p,{mode:0o700});
   for(const [p,mode] of [[d+'/code/worker',0o500],[s+'/launcher',0o400],[s+'/.jobs/lock',0o600]])fs.writeFileSync(p,'',{mode});
   r.worker_sha256=r.launcher_sha256=crypto.createHash('sha256').update('').digest('hex');fs.writeFileSync(root+'/boot',boot+'\n');
   fs.writeFileSync(root+'/bin/systemctl',`#!/bin/sh\ntest "$1" = show || exit 99\nprintf 'LoadState=not-found\\nActiveState=${mode==='active'?'active':'inactive'}\\nMainPID=0\\n'\n`,{mode:0o700});
   if(mode==='partial'){fs.unlinkSync(d+'/code/worker');fs.rmdirSync(d+'/code');fs.unlinkSync(s+'/.jobs/lock');}
   if(mode==='absent')fs.rmSync(d,{recursive:true});
   if(mode==='extra')fs.writeFileSync(s+'/extra','preserve');
   if(mode==='symlink'){fs.unlinkSync(s+'/launcher');fs.symlinkSync(root+'/boot',s+'/launcher');}
   if(mode==='hash')fs.writeFileSync(s+'/launcher','changed');
   if(mode==='live'){fs.mkdirSync(root+'/proc/77');fs.writeFileSync(root+'/proc/77/stat','77 (worker) S '+Array(18).fill('0').join(' ')+' 200 0\n');}
   const command=remainderCommand(r).replaceAll(r.directory,d).replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot').replaceAll('/proc/77/stat',root+'/proc/77/stat').replaceAll('/proc/76/stat',root+'/proc/76/stat').replace('PATH=/usr/bin:/bin','PATH='+root+'/bin:/usr/bin:/bin');
   const result=spawnSync('/bin/sh',[],{input:command,encoding:'utf8'}),ok=['all','partial','absent'].includes(mode);assert.equal(result.status===0,ok,result.stderr);assert.equal(fs.existsSync(d),!ok);
   if(!ok)assert.equal(fs.existsSync(d+'/code/worker'),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
