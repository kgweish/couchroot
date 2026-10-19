const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {activateProduction,providerAbsentCommand}=require('../research/autonomous-root/service/production-activation');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const {withRetirementState}=require('./retirement-test-state.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex'),sha='b'.repeat(64),boot='00000000-0000-0000-0000-000000000001';
const linux={skip:process.platform!=='linux'||!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0};
async function fixture(fn){return withRetirementState(async()=>{
 const dir='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';fs.mkdirSync(dir,{recursive:true,mode:0o700});const selectionFile=dir+'/selection.json',journal=new SelectionJournal(selectionFile);journal.initialize({implementation:'managed',manifest_sha256:'a'.repeat(64)});const id=journal.begin(1,{implementation:'native-prototype',manifest_sha256:sha},'c'.repeat(64)).pending.id;
 const source={boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}},workerIdentity={boot_id:boot,worker_id:'e'.repeat(32),processes:{worker:{pid:87,start_ticks:'300'},guardian:{pid:86,start_ticks:'299'}}},providerIdentity={boot_id:boot,worker_id:'f'.repeat(32),processes:{worker:{pid:77,start_ticks:'200'},guardian:{pid:76,start_ticks:'199'}}};
 const token=Buffer.alloc(32,3).toString('base64'),tokenDir=dir+'/production-ABC123';fs.mkdirSync(tokenDir,{mode:0o700});fs.writeFileSync(tokenDir+'/token',token,{mode:0o600});const installation=JSON.stringify({schema:1,phase:'ready'});
 const record={schema:1,id,phase:'ready',device:'s90d',manifest_sha256:sha,state_receipt_sha256:hash(installation),worker_sha256:sha,launcher_sha256:sha,source,boot_id:boot,unit:'couchroot-worker-'+id+'.service',directory:'/opt/couchroot-worker-'+id,scope:'/opt/couchroot-worker-'+id+'/state',port:12345,token_file:tokenDir+'/token',token_sha256:hash(token),worker_identity:workerIdentity,unit_started_monotonic:'456'};
 const rid='1'.repeat(32),retired={schema:1,id:rid,phase:'complete',device:'s90d',manifest_sha256:sha,worker_sha256:sha,launcher_sha256:sha,observer_sha256:sha,boot_id:boot,source,unit:'couchroot-retirement-'+rid+'.service',directory:'/opt/couchroot-retirement-'+rid,scope:'/opt/couchroot-retirement-'+rid+'/state',token_file:dir+'/retirement-ABC123/token',token_sha256:sha,port:12346,provider_identity:providerIdentity,unit_started_monotonic:'123'};
 journal.advance(2,id,'state-ready',record.state_receipt_sha256);journal.advance(3,id,'trial-ready',hash(JSON.stringify(record)));journal.commit(4,id);
 for(const [name,text] of [[id+'.production.json',JSON.stringify(record)],[rid+'.retirement.json',JSON.stringify(retired)],[id+'.state-install.json',installation],['production-launch.pending',id+'\n'],['state-install.pending',id+'\n']])fs.writeFileSync(dir+'/'+name,text,{mode:0o600});
 const unit=`Id=${retired.unit}\nLoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`;let calls=0;
 const options={record,retired,journalDirectory:dir,selectionFile,confirmNative:async()=>workerIdentity,execute:async command=>{calls++;return {exit_code:0,stdout:command.includes('--property=Id,')?unit:'PROVIDER-ABSENT\n'};}};
 await fn({options,dir,id,journal,record,retired,unit,calls:()=>calls,file:dir+'/'+id+'.activation.json',intent:dir+'/'+id+'.activation.json.pending'});
});}
test('activation verifies provider absence and removes only transition token and markers',linux,()=>fixture(async f=>{
 const result=await activateProduction(f.options);assert.equal(result.phase,'active');assert.equal(hash(fs.readFileSync(f.file)),result.receipt_sha256);assert.equal(fs.existsSync(f.intent),false);assert.equal(fs.existsSync(path.dirname(f.record.token_file)),false);for(const name of ['production-launch.pending','state-install.pending'])assert.equal(fs.existsSync(f.dir+'/'+name),false);
 assert.equal(JSON.parse(fs.readFileSync(f.dir+'/'+f.id+'.production.json')).phase,'ready');assert.equal(f.journal.read().selected.implementation,'native-prototype');assert.equal(f.calls(),2);await assert.rejects(activateProduction(f.options));
}));
test('unfinished cleanup, altered token and changed receipts refuse activation',linux,async()=>{
 for(const mode of ['provider-marker','provider-token','ready-intent','token','state-receipt'])await fixture(async f=>{
  if(mode==='provider-marker')fs.writeFileSync(f.dir+'/retirement-launch.pending','unfinished');
  if(mode==='provider-token')fs.mkdirSync(path.dirname(f.retired.token_file),{mode:0o700});
  if(mode==='ready-intent')fs.writeFileSync(f.dir+'/'+f.id+'.production.json.readiness.pending','unfinished');
  if(mode==='token')fs.writeFileSync(f.record.token_file,'changed');
  if(mode==='state-receipt')fs.writeFileSync(f.dir+'/'+f.id+'.state-install.json','changed');
  await assert.rejects(activateProduction(f.options));assert.equal(f.calls(),0);assert.equal(fs.existsSync(f.file),false);assert.equal(fs.existsSync(f.dir+'/production-launch.pending'),true);
 });
});
test('live or replaced provider and native drift retain activation intent',linux,async()=>{
 for(const mode of ['running','replaced','files','native'])await fixture(async f=>{
  const execute=f.options.execute;f.options.execute=async command=>{const r=await execute(command);if(mode==='running')r.stdout=r.stdout.replace('ActiveState=inactive','ActiveState=active');if(mode==='replaced')r.stdout=r.stdout.replace('Monotonic=123','Monotonic=999');if(mode==='files'&&!command.includes('--property=Id,'))r.exit_code=1;return r;};if(mode==='native')f.options.confirmNative=async()=>({...f.record.worker_identity,worker_id:'0'.repeat(32)});
  await assert.rejects(activateProduction(f.options),e=>e.outcome==='unknown');assert.equal(fs.existsSync(f.intent),true);assert.equal(fs.existsSync(f.file),false);assert.equal(fs.existsSync(f.record.token_file),true);await assert.rejects(activateProduction(f.options));
 });
});
test('provider absence command binds boot, process start identities and staging directory',linux,()=>fixture(async f=>{
 const {spawnSync}=require('node:child_process'),command=providerAbsentCommand(f.retired);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);assert.match(command,/\/proc\/77\/stat/);assert.match(command,/!= 200/);assert.match(command,/\/proc\/76\/stat/);assert.match(command,/test ! -L \/opt\/couchroot-retirement-/);
}));

test('lost activation publication keeps reconciliation intent after token cleanup',linux,()=>fixture(async f=>{
 const vm=require('node:vm'),{createRequire}=require('node:module'),source=path.resolve(__dirname,'../research/autonomous-root/service/production-activation.js'),real=createRequire(source),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,process,require:name=>name==='./policy'?{...real(name),atomic:(file,value)=>{real(name).atomic(file,value);throw Error('publication acknowledgement lost');}}:real(name)});
 await assert.rejects(module.exports.activateProduction(f.options),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'active');assert.equal(fs.existsSync(f.intent),true);assert.equal(fs.existsSync(f.record.token_file),false);assert.equal(fs.existsSync(f.dir+'/production-launch.pending'),false);
 await assert.rejects(activateProduction(f.options));
}));

test('explicit activation resume handles each ordered cleanup window without restarting work',linux,async()=>{
 for(const boundary of ['token','directory','state-marker','launch-marker','publication','intent'])await fixture(async f=>{
  const vm=require('node:vm'),{createRequire}=require('node:module'),source=path.resolve(__dirname,'../research/autonomous-root/service/production-activation.js'),real=createRequire(source),module={exports:{}};let interrupted=false;
  const target=boundary==='token'?f.record.token_file:boundary==='directory'?path.dirname(f.record.token_file):boundary==='state-marker'?f.dir+'/state-install.pending':boundary==='launch-marker'?f.dir+'/production-launch.pending':f.intent;
  const wrapped={...fs,unlinkSync:p=>{fs.unlinkSync(p);if(!interrupted&&boundary!=='directory'&&boundary!=='publication'&&p===target){interrupted=true;throw Error('interrupted after unlink');}},rmdirSync:p=>{fs.rmdirSync(p);if(!interrupted&&boundary==='directory'&&p===target){interrupted=true;throw Error('interrupted after rmdir');}}};
  vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,process,require:name=>name==='fs'?wrapped:name==='./policy'?{...real(name),atomic:(file,value)=>{real(name).atomic(file,value);if(!interrupted&&boundary==='publication'){interrupted=true;throw Error('interrupted publication');}}}:real(name)});
  await assert.rejects(module.exports.activateProduction(f.options),e=>e.outcome==='unknown');assert.equal(interrupted,true);const count=f.calls();
  const result=await activateProduction({...f.options,resume:true});assert.equal(result.phase,'active');assert.equal(f.calls(),count+2);assert.equal(fs.existsSync(f.intent),false);assert.equal(fs.existsSync(path.dirname(f.record.token_file)),false);
  const again=await activateProduction({...f.options,resume:true});assert.equal(again.receipt_sha256,result.receipt_sha256);assert.equal(f.calls(),count+4);
 });
});
test('resume refuses incomplete ownership, foreign entries and changed native identity',linux,async()=>{
 for(const mode of ['missing-intent','wrong-intent','foreign-token','marker','native'])await fixture(async f=>{
  // Fail after durable intent, before any local cleanup.
  await assert.rejects(activateProduction({...f.options,execute:async()=>{throw Error('unavailable');}}));
  fs.unlinkSync(f.record.token_file);
  if(mode==='missing-intent')fs.unlinkSync(f.intent);
  if(mode==='wrong-intent')fs.writeFileSync(f.intent,'{}');
  if(mode==='foreign-token')fs.writeFileSync(path.dirname(f.record.token_file)+'/foreign','keep');
  if(mode==='marker')fs.writeFileSync(f.dir+'/state-install.pending','foreign');
  const options={...f.options,resume:true};if(mode==='native')options.confirmNative=async()=>({...f.record.worker_identity,worker_id:'0'.repeat(32)});
  await assert.rejects(activateProduction(options));assert.equal(fs.existsSync(f.file),false);assert.equal(fs.existsSync(f.dir+'/production-launch.pending'),true);
 });
});
