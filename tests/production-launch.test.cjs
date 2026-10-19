const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const {planInstallation,installRetainedState,acceptRetainedState}=require('../research/autonomous-root/service/retained-install');
const file=path.resolve(__dirname,'../research/autonomous-root/service/production-launch.js'),real=createRequire(file),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest='a'.repeat(64),worker=Buffer.from('worker fixture'),launcher=Buffer.from('launcher fixture'),token=Buffer.alloc(32,7).toString('base64');
const source={boot_id:'00000000-0000-0000-0000-000000000001',worker_id:'2'.repeat(32),processes:{worker:{pid:42,start_ticks:'123'},guardian:null}};
function snapshot(count=1){const records=Array.from({length:count},(_,i)=>{const id=('retained-'+String(i).padStart(4,'0')).padEnd(64,'x'),bytes=Buffer.from(JSON.stringify({id,boot_id:source.boot_id,state:'completed',pid:0,exit_code:7}));return {name:id+'.json',size:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};});const value={schema:1,implementation:'managed',source,records};return {...value,sha256:hash(JSON.stringify(value))};}
function load(candidate={manifest_sha256:manifest,artifacts:{'native-worker':{sha256:hash(worker)},'native-app-launcher':{sha256:hash(launcher)}}}){const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,require:name=>name==='./native-candidate'?{loadCandidate:()=>candidate}:real(name)});return module.exports;}
function options(count=1){const id='1'.repeat(32),value=snapshot(count),installation={...planInstallation({snapshot:value,id,manifestSha256:manifest}).record,quiescence_sha256:'e'.repeat(64),phase:'ready'};return {device:'s90d',id,payload:'/opt/usr/apps/MiniRoot01/res/wgt/payload',manifestSha256:manifest,receiptSha256:hash(JSON.stringify(installation)),snapshot:value,installation,port:12345,tokenFile:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',tokenSha256:hash(token)};}
test('production plan binds accepted state, full retention, packaged bytes and unbounded production lifetime',()=>{
 for(const device of ['qn90a','s90d']){const {command,record}=load().productionPlan({...options(64),device});assert.ok(Buffer.byteLength(command)<=65536);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);assert.match(command,/--production/);assert.doesNotMatch(command,/RuntimeMaxSec|COUCHROOT_NATIVE_LIFETIME_SECONDS/);assert.match(command,/LoadState=not-found/);assert.match(command,/BindReadOnlyPaths=/);assert.equal(record.phase,'submitting');assert.equal(record.state_receipt_sha256,options(64).receiptSha256);assert.equal(record.token,undefined);}
});
test('invalid identity, receipt, paths, token and candidate cannot produce a launch',()=>{
 const o=options();for(const patch of [{id:o.id+'\n'},{receiptSha256:'f'.repeat(64)},{tokenSha256:'bad'},{tokenFile:'/tmp/token'},{tokenFile:o.tokenFile.replace('ABC123','ABC123\n')},{payload:'/tmp/payload'},{port:0},{device:'other'},{installation:{...o.installation,phase:'pending'}}])assert.throws(()=>load().productionPlan({...o,...patch}));assert.throws(()=>load(null).productionPlan(o));
});
const linux={skip:process.platform!=='linux'||!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0};
async function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-launch-')),journalDirectory=root+'/journal',selectionFile=journalDirectory+'/worker-selection.json',bin=root+'/bin';fs.mkdirSync(journalDirectory,{mode:0o700});fs.mkdirSync(bin,{mode:0o700});
 const journal=new SelectionJournal(selectionFile);journal.initialize({implementation:'managed',manifest_sha256:'d'.repeat(64)});const transition=journal.begin(1,{implementation:'native-prototype',manifest_sha256:manifest},'e'.repeat(64));
 const o={...options(),id:transition.pending.id,journalDirectory,selectionFile};delete o.installation;delete o.snapshot;
 const map=p=>root+p;const jobs=map('/opt/couchroot-agent/jobs');fs.mkdirSync(jobs,{recursive:true,mode:0o700});fs.mkdirSync(root+'/proc',{mode:0o700});fs.writeFileSync(root+'/boot',source.boot_id+'\n');
 const value=snapshot();for(const r of value.records)fs.writeFileSync(jobs+'/'+r.name,Buffer.from(r.base64,'base64'),{mode:0o600});
 fs.mkdirSync(map(o.payload),{recursive:true,mode:0o700});for(const [name,bytes] of [['native-worker',worker],['native-app-launcher',launcher]]){const p=map(o.payload+'/'+name);fs.writeFileSync(p,bytes,{mode:0o600});fs.chownSync(p,201,201);}
 fs.mkdirSync(path.dirname(map(o.tokenFile)),{recursive:true,mode:0o700});fs.chownSync(path.dirname(map(o.tokenFile)),5001,100);fs.writeFileSync(map(o.tokenFile),token,{mode:0o600});fs.chownSync(map(o.tokenFile),5001,100);
 fs.writeFileSync(bin+'/systemctl','#!/bin/sh\necho LoadState=not-found\n',{mode:0o700});fs.writeFileSync(bin+'/systemd-run','#!/bin/sh\nprintf "%s\\n" "$@" > '+root+'/submitted\n',{mode:0o700});
 const commands=[],execute=async command=>{commands.push(command);const mapped=command.replaceAll('/opt',root+'/opt').replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot').replaceAll('/proc/42/stat',root+'/proc/42/stat').replaceAll('PATH=/usr/bin:/bin','PATH='+bin+':/usr/bin:/bin');const r=spawnSync('/bin/sh',[],{input:mapped,encoding:'utf8'});return {exit_code:r.status,stdout:r.stdout,stderr:r.stderr};};o.execute=execute;
 try{const receipt=await installRetainedState({...o,snapshot:value});o.receiptSha256=receipt.receipt_sha256;await acceptRetainedState(o);commands.length=0;await fn({o,root,map,journal,execute,commands,api:load(),launchFile:journalDirectory+'/'+o.id+'.production.json',marker:journalDirectory+'/production-launch.pending',value});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('journal precedes staging and acknowledged production submission leaves managed selected',linux,()=>fixture(async f=>{
 const result=await f.api.submitProduction({...f.o,execute:async command=>{assert.equal(JSON.parse(fs.readFileSync(f.launchFile)).phase,'submitting');assert.equal(fs.readFileSync(f.marker,'utf8'),f.o.id+'\n');return f.execute(command);}});
 assert.equal(result.phase,'submitted');assert.equal(f.journal.read().pending.phase,'state-ready');assert.equal(f.journal.read().selected.implementation,'managed');assert.match(fs.readFileSync(f.root+'/submitted','utf8'),/--production/);
 assert.deepEqual(fs.readFileSync(f.map(result.directory+'/code/worker')),worker);assert.deepEqual(fs.readFileSync(f.map(result.scope+'/launcher')),launcher);
 for(const r of f.value.records)assert.equal(hash(fs.readFileSync(f.map(result.scope+'/.jobs/'+r.name))),r.sha256);
 await assert.rejects(f.api.submitProduction(f.o));assert.equal(f.commands.length,1);
}));
test('lost submission result retains unknown intent and never launches twice',linux,()=>fixture(async f=>{
 await assert.rejects(f.api.submitProduction({...f.o,execute:async c=>{const result=await f.execute(c);assert.equal(result.exit_code,0,result.stderr);throw Error('lost reply');}}),e=>e.outcome==='unknown');
 assert.equal(JSON.parse(fs.readFileSync(f.launchFile)).phase,'unknown');assert.equal(fs.existsSync(f.marker),true);assert.equal(fs.existsSync(f.root+'/submitted'),true);
 await assert.rejects(f.api.submitProduction(f.o));assert.equal(f.commands.length,1);
}));
test('changed content, active unit and source resurrection refuse launch',linux,async()=>{
 for(const mode of ['record','token','worker','unit','source'])await fixture(async f=>{
  if(mode==='record')fs.writeFileSync(f.map('/opt/couchroot-worker-'+f.o.id+'/state/.jobs/'+f.value.records[0].name),'{}');
  if(mode==='token')fs.writeFileSync(f.map(f.o.tokenFile),'changed');
  if(mode==='worker')fs.writeFileSync(f.map(f.o.payload+'/native-worker'),'changed');
  if(mode==='unit')fs.writeFileSync(f.root+'/bin/systemctl','#!/bin/sh\necho LoadState=loaded\n');
  if(mode==='source'){fs.mkdirSync(f.root+'/proc/42');fs.writeFileSync(f.root+'/proc/42/stat','42 (worker) S '+Array(18).fill('0').join(' ')+' 123 0\n');}
  await assert.rejects(f.api.submitProduction(f.o),e=>e.outcome==='unknown');assert.equal(fs.existsSync(f.root+'/submitted'),false);assert.equal(f.journal.read().pending.phase,'state-ready');
 });
});
test('selection drift across submission preserves newer ownership',linux,()=>fixture(async f=>{
 await assert.rejects(f.api.submitProduction({...f.o,execute:async c=>{const r=await f.execute(c);f.journal.advance(3,f.o.id,'rollback-required','f'.repeat(64));return r;}}),e=>e.outcome==='unknown');assert.equal(f.journal.read().pending.phase,'rollback-required');assert.equal(JSON.parse(fs.readFileSync(f.launchFile)).phase,'submitting');
}));

test('unaccepted or changed local evidence cannot submit a remote command',linux,async()=>{
 for(const mode of ['receipt','marker','writer','selection'])await fixture(async f=>{
  if(mode==='receipt')f.o.receiptSha256='f'.repeat(64);
  if(mode==='marker')fs.writeFileSync(f.o.journalDirectory+'/state-install.pending','foreign');
  if(mode==='writer')fs.writeFileSync(f.o.selectionFile+'.writer','pending',{mode:0o600});
  if(mode==='selection')f.journal.advance(3,f.o.id,'rollback-required','f'.repeat(64));
  await assert.rejects(f.api.submitProduction(f.o));assert.equal(f.commands.length,0);assert.equal(fs.existsSync(f.marker),false);
 });
});
