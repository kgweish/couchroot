const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {shutdownRetirement,cleanupRetirement,cleanupCommand,finishRetirement}=require('../research/autonomous-root/service/retirement-teardown');
const boot='00000000-0000-0000-0000-000000000001',id='a'.repeat(32),sha='b'.repeat(64),state='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
const source={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}};
const identity={boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:77,start_ticks:'200'},guardian:{pid:76,start_ticks:'199'}}};
function status(){return {...identity,implementation:'native-prototype',lifetime_mode:'bounded',lifetime_seconds:300,guardian_pid:76,capabilities:['prototype-scoped-files-v1','worker-process-identity-v1','guardian-parent-identity-v1','resource-inventory-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1'],app_launcher:{sha256:sha,independently_staged:true},resources:{schema:1,scope:'worker-owned',jobs:[],transfers:[],helpers:[]}};}
function record(){return {schema:1,id,phase:'ready',device:'s90d',manifest_sha256:sha,worker_sha256:sha,launcher_sha256:sha,observer_sha256:sha,boot_id:boot,source,unit:'couchroot-retirement-'+id+'.service',directory:'/opt/couchroot-retirement-'+id,scope:'/opt/couchroot-retirement-'+id+'/state',token_file:state+'/retirement-ABC123/token',token_sha256:sha,port:12345,provider_identity:identity,unit_started_monotonic:'123'};}
async function fixture(fn){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'retirement-teardown-')),r=record(),file=path.join(directory,id+'.retirement.json'),marker=path.join(directory,'retirement-launch.pending');
 const save=()=>fs.writeFileSync(file,JSON.stringify(r),{mode:0o600});save();fs.writeFileSync(marker,id+'\n',{mode:0o600});
 let calls=0;const peer={identity:{pid:77,uid:0,euid:0,gid:0,egid:0,smack:'System'}};
 const channel={_conn:peer,operation:async()=>status(),shutdown:async()=>{calls++;return {acknowledged:true,disconnected:true};}};
 const options={record:r,journalDirectory:directory,channel};
 const unit=`Id=${r.unit}\nLoadState=loaded\nActiveState=active\nSubState=exited\nMainPID=0\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`;
 try{await fn({directory,r,file,marker,save,channel,options,unit,calls:()=>calls});}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('shutdown validates current provider and journals before the request',()=>fixture(async f=>{
 f.channel.shutdown=async()=>{assert.equal(fs.readFileSync(f.file+'.shutdown.pending','utf8'),id+'\n');return {acknowledged:true,disconnected:true};};
 const next=await shutdownRetirement(f.options);assert.equal(next.phase,'shutdown-acknowledged');assert.equal(fs.existsSync(f.file+'.shutdown.pending'),false);assert.equal(fs.existsSync(f.marker),true);await assert.rejects(shutdownRetirement(f.options));
}));
test('lost shutdown acknowledgement retains intent and prohibits replay',()=>fixture(async f=>{
 f.channel.shutdown=async()=>{throw Error('disconnected');};await assert.rejects(shutdownRetirement(f.options),e=>e.outcome==='unknown');assert.equal(fs.existsSync(f.file+'.shutdown.pending'),true);assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'ready');await assert.rejects(shutdownRetirement(f.options));
}));
test('changed peer, process identity or nonempty inventory prevents shutdown',async()=>{
 for(const mode of ['peer','process','job'])await fixture(async f=>{
  f.channel.operation=async()=>{const info=status();if(mode==='peer')f.channel._conn=null;if(mode==='process')info.worker_id='e'.repeat(32);if(mode==='job')info.resources.helpers=[id];return info;};
  await assert.rejects(shutdownRetirement(f.options));assert.equal(f.calls(),0);assert.equal(fs.existsSync(f.file+'.shutdown.pending'),false);
 });
});
test('cleanup uses independent executor and completed matching unit before removing staging',()=>fixture(async f=>{
 f.r.phase='shutdown-acknowledged';f.save();let commands=0;
 const next=await cleanupRetirement({...f.options,executorPid:42,confirmExecutor:async()=>({...source,capabilities:['worker-process-identity-v1']}),execute:async command=>{
  if(++commands===1)return {exit_code:0,stdout:f.unit};
  assert.equal(fs.existsSync(f.file+'.cleanup.pending'),true);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);
  assert.ok(command.indexOf('/proc/77/stat')<command.indexOf('systemctl stop'));assert.ok(command.indexOf('sha256sum')<command.indexOf('systemctl stop'));assert.ok(command.indexOf('ActiveState=inactive')<command.indexOf('\nrm '));return {exit_code:0,stdout:'RETIREMENT-CLEANED\n'};
 }});
 assert.equal(next.phase,'staging-retired');assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(f.file+'.cleanup.pending'),false);
}));
test('running, restarted or failed unit and provider executor cannot authorize cleanup',async()=>{
 for(const mode of ['running','restarted','failed','provider'])await fixture(async f=>{
  f.r.phase='shutdown-acknowledged';f.save();let calls=0;
  await assert.rejects(cleanupRetirement({...f.options,executorPid:mode==='provider'?77:42,confirmExecutor:async()=>mode==='provider'?status():({...source,capabilities:['worker-process-identity-v1']}),execute:async()=>{calls++;return {exit_code:0,stdout:f.unit.replace(mode==='running'?'SubState=exited':mode==='restarted'?'Monotonic=123':'ExecMainStatus=0',mode==='running'?'SubState=running':mode==='restarted'?'Monotonic=456':'ExecMainStatus=1')};}}));
  assert.ok(calls<=1);assert.equal(fs.existsSync(f.file+'.cleanup.pending'),false);
 });
});
test('lost cleanup response preserves intent and marker without automatic retry',()=>fixture(async f=>{
 f.r.phase='shutdown-acknowledged';f.save();let calls=0;
 const options={...f.options,executorPid:42,confirmExecutor:async()=>({...source,capabilities:['worker-process-identity-v1']}),execute:async()=>{if(++calls===1)return {exit_code:0,stdout:f.unit};throw Error('response lost');}};
 await assert.rejects(cleanupRetirement(options),e=>e.outcome==='unknown');assert.equal(fs.existsSync(f.file+'.cleanup.pending'),true);assert.equal(fs.existsSync(f.marker),true);assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'shutdown-acknowledged');
}));
test('completion removes only the bound service token before releasing pending ownership',{skip:!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0},async()=>require('./retirement-test-state.cjs').withRetirementState(async()=>{
 fs.mkdirSync(state,{recursive:true,mode:0o700});const directory=fs.mkdtempSync(state+'/retirement-'),r=record(),token=crypto.randomBytes(32).toString('base64');
 r.phase='staging-retired';r.token_file=directory+'/token';r.token_sha256=crypto.createHash('sha256').update(token).digest('hex');
 const file=state+'/'+id+'.retirement.json',marker=state+'/retirement-launch.pending';
 try{
  fs.writeFileSync(r.token_file,token,{mode:0o600,flag:'wx'});fs.writeFileSync(file,JSON.stringify(r),{mode:0o600,flag:'wx'});fs.writeFileSync(marker,id+'\n',{mode:0o600,flag:'wx'});
  const next=finishRetirement({record:r,journalDirectory:state});assert.equal(next.phase,'complete');assert.equal(fs.existsSync(directory),false);assert.equal(fs.existsSync(marker),false);assert.equal(JSON.parse(fs.readFileSync(file)).phase,'complete');
 }finally{fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(file,{force:true});fs.rmSync(marker,{force:true});}
}));
test('cleanup shell rejects live processes and unexpected artifacts before deleting anything',{skip:!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0},async()=>{
 for(const mode of ['clean','live','extra','hash','guardian','bad-state']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retire-shell-')),r=record(),d=root+'/owned',scope=d+'/state';
  try{
   for(const p of [d,d+'/code',scope,scope+'/.jobs',root+'/bin',root+'/proc'])fs.mkdirSync(p,{mode:0o700});
   for(const [p,mode] of [[d+'/code/worker',0o500],[scope+'/launcher',0o400],[scope+'/.jobs/lock',0o600]])fs.writeFileSync(p,'',{mode});
   r.worker_sha256=r.launcher_sha256=crypto.createHash('sha256').update('').digest('hex');
   fs.writeFileSync(root+'/boot',boot+'\n');
   fs.writeFileSync(root+'/bin/systemctl',`#!/bin/sh
if test "$1" = stop; then exit 0; fi
case "$3" in
 MainPID) echo MainPID=0;;
 ExecMainStartTimestampMonotonic) echo ExecMainStartTimestampMonotonic=123;;
 *) printf 'LoadState=not-found\\nActiveState=inactive\\nMainPID=${mode==='bad-state'?'88':'0'}\\n';;
esac
`,{mode:0o700});
   if(mode==='extra')fs.writeFileSync(scope+'/unowned','preserve');
   if(mode==='guardian')fs.writeFileSync(scope+'/.jobs/guardian','preserve');
   if(mode==='hash')fs.writeFileSync(scope+'/launcher','changed');
   if(mode==='live'){fs.mkdirSync(root+'/proc/77');fs.writeFileSync(root+'/proc/77/stat','77 (worker) S '+Array(18).fill('0').join(' ')+' 200 0\n');}
   const command=cleanupCommand(r).replaceAll(r.directory,d).replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot').replaceAll('/proc/77/stat',root+'/proc/77/stat').replaceAll('/proc/76/stat',root+'/proc/76/stat').replace('PATH=/usr/bin:/bin','PATH='+root+'/bin:/usr/bin:/bin');
   const result=spawnSync('/bin/sh',[],{input:command,encoding:'utf8'});
   assert.equal(result.status===0,mode==='clean',result.stderr);
   assert.equal(fs.existsSync(d),mode!=='clean');if(mode!=='clean')assert.equal(fs.existsSync(d+'/code/worker'),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('shutdown acknowledgement can precede guardian and systemd completion',()=>fixture(async f=>{
 f.r.phase='shutdown-acknowledged';f.save();let inspections=0,cleanups=0;
 const next=await cleanupRetirement({...f.options,executorPid:42,confirmExecutor:async()=>({...source,capabilities:['worker-process-identity-v1']}),execute:async command=>{
  if(command.includes('--property=Id,')){inspections++;return {exit_code:0,stdout:inspections<3?f.unit.replace('SubState=exited','SubState=running').replace('MainPID=0','MainPID=76').replace('ExecMainCode=1','ExecMainCode=0'):f.unit};}
  cleanups++;assert.equal(inspections,3);return {exit_code:0,stdout:'RETIREMENT-CLEANED\n'};
 }});
 assert.equal(next.phase,'staging-retired');assert.equal(cleanups,1);
}));
