const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {readyProduction,runtimeCommand}=require('../research/autonomous-root/service/production-readiness');
const {planInstallation}=require('../research/autonomous-root/service/retained-install');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const {inspectProductionUnit}=require('../research/autonomous-root/service/observer-unit');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex'),sha='b'.repeat(64),boot='00000000-0000-0000-0000-000000000001';
const source={boot_id:boot,worker_id:'a'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}},provider={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:77,start_ticks:'200'},guardian:{pid:76,start_ticks:'199'}}};
function info(){return {implementation:'native-prototype',boot_id:boot,worker_id:'d'.repeat(32),uptime_seconds:1,lifetime_mode:'production',lifetime_seconds:0,guardian_pid:86,processes:{worker:{pid:87,start_ticks:'300'},guardian:{pid:86,start_ticks:'299'}},capabilities:['worker-process-identity-v1','guardian-parent-identity-v1','resource-inventory-v1','prototype-production-files-v1','binary-upload-v1','binary-download-v1','prototype-app-exec-v1','prototype-jobs-v1','prototype-helper-lifecycle-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1','prototype-command-fault-diagnostics-v1'],app_launcher:{sha256:sha,independently_staged:true},resources:{schema:1,scope:'worker-owned',jobs:[],transfers:[],helpers:[]}};}
async function fixture(fn,count=1){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'production-ready-')),selectionFile=dir+'/selection.json',journal=new SelectionJournal(selectionFile);journal.initialize({implementation:'managed',manifest_sha256:'e'.repeat(64)});const pending=journal.begin(1,{implementation:'native-prototype',manifest_sha256:sha},'f'.repeat(64)).pending,id=pending.id;
 const records=Array.from({length:count},(_,i)=>{const id=('retained-job-'+String(i).padStart(4,'0')).padEnd(64,'x'),bytes=Buffer.from(JSON.stringify({id,boot_id:boot,state:'completed',pid:0,exit_code:7}));return {name:id+'.json',size:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};}),body={schema:1,implementation:'managed',source,records},snapshot={...body,sha256:hash(JSON.stringify(body))};
 const installation={...planInstallation({snapshot,id,manifestSha256:sha}).record,quiescence_sha256:pending.quiescence_sha256,phase:'ready'},receipt=hash(JSON.stringify(installation));journal.advance(2,id,'state-ready',receipt);
 const record={schema:1,id,phase:'submitted',device:'s90d',manifest_sha256:sha,state_receipt_sha256:receipt,worker_sha256:sha,launcher_sha256:sha,source,boot_id:boot,unit:'couchroot-worker-'+id+'.service',directory:'/opt/couchroot-worker-'+id,scope:'/opt/couchroot-worker-'+id+'/state',port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',token_sha256:sha};
 const file=dir+'/'+id+'.production.json',marker=dir+'/production-launch.pending',intent=file+'.readiness.pending';for(const [p,value] of [[file,JSON.stringify(record)],[marker,id+'\n'],[dir+'/state-install.pending',id+'\n'],[dir+'/'+id+'.state-install.json',JSON.stringify(installation)],[dir+'/'+id+'.retained-snapshot.json',JSON.stringify(snapshot)]])fs.writeFileSync(p,value,{mode:0o600});
 const channel={_conn:{identity:{pid:87,uid:0,euid:0,gid:0,egid:0,smack:'System'}},operation:async request=>request.op==='status'?info():{...JSON.parse(Buffer.from(records.find(r=>r.name===request.id+'.json').base64,'base64')),output_available:false,record:JSON.parse(Buffer.from(records.find(r=>r.name===request.id+'.json').base64,'base64'))}};
 let calls=0;const unit=`Id=${record.unit}\nLoadState=loaded\nActiveState=active\nSubState=running\nMainPID=86\nExecMainCode=0\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n`;
 const options={record,journalDirectory:dir,selectionFile,channel,providerIdentity:provider,execute:async command=>{calls++;return {exit_code:0,stdout:command.includes('--property=Id,')?unit:'PRODUCTION-VERIFIED\n'};}};
 try{await fn({options,record,file,marker,intent,channel,journal,unit,snapshot,installation,calls:()=>calls});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('readiness binds peer, retained state, unit and pending trial without changing selection',()=>fixture(async f=>{
 const result=await readyProduction(f.options);assert.equal(result.record.phase,'ready');assert.equal(result.record.worker_identity.processes.worker.pid,87);assert.equal(result.selection.pending.phase,'trial-ready');assert.equal(result.selection.pending.readiness_sha256,result.readiness_sha256);assert.equal(result.selection.selected.implementation,'managed');assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(f.intent),false);assert.equal(f.calls(),4);
 await assert.rejects(readyProduction(f.options));assert.equal(f.calls(),4);
}));
test('runtime evidence covers all 64 retained records within command bounds',()=>fixture(async f=>{
 const value=info(),identity={boot_id:boot,worker_id:value.worker_id,processes:value.processes},command=runtimeCommand(f.record,identity,f.snapshot,f.installation);assert.ok(Buffer.byteLength(command)<=65536);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);assert.match(command,/test \/proc\/87\/exe -ef/);assert.match(command,/\.import-manifest/);assert.match(command,/\/opt\/couchroot-agent\/jobs/);await readyProduction(f.options);
},64));
test('identity, resources, retained output and remote evidence failures retain intent',async()=>{
 for(const mode of ['profile','source','provider','bounded','resources','job','guardian','unit-drift','files','disconnect'])await fixture(async f=>{
  const op=f.channel.operation,execute=f.options.execute;let reads=0,units=0;
  f.channel.operation=async request=>{const value=await op(request);if(request.op==='status'){
   reads++;if(mode==='profile')f.channel._conn.identity.smack='User';if(mode==='source'){value.processes.worker.pid=42;f.channel._conn.identity.pid=42;}if(mode==='provider'){value.processes.worker.pid=77;f.channel._conn.identity.pid=77;}if(mode==='bounded')value.lifetime_mode='bounded';if(mode==='resources')value.resources.helpers=['a'.repeat(32)];if(mode==='disconnect'&&reads>1)f.channel._conn=null;
  }else if(mode==='job')value.record.exit_code=0;return value;};
  f.options.execute=async command=>{const r=await execute(command);if(command.includes('--property=Id,')){units++;if(mode==='guardian')r.stdout=r.stdout.replace('MainPID=86','MainPID=99');if(mode==='unit-drift'&&units>1)r.stdout=r.stdout.replace('Monotonic=123','Monotonic=456');}else if(mode==='files')r.exit_code=1;return r;};
  await assert.rejects(readyProduction(f.options),e=>e.outcome==='unknown');assert.equal(f.journal.read().pending.phase,'state-ready');assert.equal(fs.existsSync(f.intent),true);assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'submitted');
 });
});
test('changed local ownership during remote await cannot publish readiness',()=>fixture(async f=>{
 const execute=f.options.execute;f.options.execute=async c=>{const r=await execute(c);fs.writeFileSync(f.marker,'foreign');return r;};await assert.rejects(readyProduction(f.options));assert.equal(f.journal.read().pending.phase,'state-ready');
}));
test('unfinished readiness and wrong unit namespaces refuse work',()=>fixture(async f=>{
 fs.writeFileSync(f.intent,f.record.id+'\n',{mode:0o600});await assert.rejects(readyProduction(f.options));assert.equal(f.calls(),0);
 await assert.rejects(inspectProductionUnit({unit:'couchroot-retirement-'+f.record.id+'.service',bootId:boot,execute:f.options.execute}));assert.equal(f.calls(),0);
}));

test('uncertain ready-record publication keeps the transition and readiness intent',()=>fixture(async f=>{
 const vm=require('node:vm'),{createRequire}=require('node:module'),sourceFile=path.resolve(__dirname,'../research/autonomous-root/service/production-readiness.js'),real=createRequire(sourceFile),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(sourceFile,'utf8'),{module,process,Buffer,require:name=>name==='./policy'?{atomic:(file,value)=>{real(name).atomic(file,value);throw Error('lost publication acknowledgement');}}:real(name)});
 await assert.rejects(module.exports.readyProduction(f.options),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'ready');assert.equal(f.journal.read().pending.phase,'state-ready');assert.equal(fs.existsSync(f.intent),true);
 await assert.rejects(readyProduction(f.options));
}));

test('executable binding accepts alternate paths to the same inode and rejects equal bytes on a different inode',()=>fixture(async f=>{
 const value=info(),identity={boot_id:boot,worker_id:value.worker_id,processes:value.processes};
 const command=runtimeCommand(f.record,identity,f.snapshot,f.installation);
 const line=command.split('\n').find(l=>l.startsWith('test /proc/87/exe -ef '));assert(line);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'executable-binding-'));
 try{
  fs.writeFileSync(dir+'/staged','identical bytes');fs.linkSync(dir+'/staged',dir+'/alternate');fs.symlinkSync(dir+'/alternate',dir+'/exe');
  const check=line.replace('/proc/87/exe',dir+'/exe').replace(f.record.directory+'/code/worker',dir+'/staged');
  assert.equal(spawnSync('/bin/sh',['-c',check]).status,0);
  fs.unlinkSync(dir+'/alternate');fs.writeFileSync(dir+'/alternate','identical bytes');assert.notEqual(spawnSync('/bin/sh',['-c',check]).status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}));
