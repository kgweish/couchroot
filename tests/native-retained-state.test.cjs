const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {snapshotNativeJobs,snapshotNativeRestartJobs,planNativeSnapshot}=require('../research/autonomous-root/service/native-retained-state');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha='b'.repeat(64),boot='00000000-0000-0000-0000-000000000001';
const linux={skip:process.platform!=='linux'||!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0};
async function fixture(fn,count=2){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-retained-')),id='a'.repeat(32),source={boot_id:boot,worker_id:'c'.repeat(32),processes:{worker:{pid:42,start_ticks:'100'},guardian:null}},worker_identity={boot_id:boot,worker_id:'d'.repeat(32),processes:{worker:{pid:52,start_ticks:'200'},guardian:{pid:51,start_ticks:'199'}}};
 const manifest=Buffer.from('{"fixture":"original-import"}'),directory='/opt/couchroot-worker-'+id,scope=directory+'/state';
 const installation={schema:1,id,phase:'ready',source,snapshot_sha256:sha,manifest_sha256:sha,installed_manifest_sha256:hash(manifest),directory,scope,quiescence_sha256:sha};
 const record={schema:1,id,phase:'ready',device:'s90d',manifest_sha256:sha,state_receipt_sha256:hash(JSON.stringify(installation)),worker_sha256:sha,launcher_sha256:sha,source,boot_id:boot,unit:'couchroot-worker-'+id+'.service',directory,scope,port:12345,token_file:'/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/production-ABC123/token',token_sha256:sha,worker_identity,unit_started_monotonic:'123'};
 const target=root+'/native',jobs=target+'/state/.jobs';fs.mkdirSync(jobs,{recursive:true,mode:0o700});fs.mkdirSync(root+'/proc',{mode:0o700});fs.writeFileSync(root+'/boot',boot+'\n');fs.writeFileSync(jobs+'/lock','',{mode:0o600});fs.writeFileSync(jobs+'/.import-manifest',manifest,{mode:0o600});
 const records=[];for(let i=0;i<count;i++){const name=('native-retained-'+String(i).padStart(4,'0')).padEnd(64,'x')+'.json',bytes=Buffer.from((i===1?'\uFEFF':'')+JSON.stringify({id:name.slice(0,-5),boot_id:boot,state:i?'unknown':'completed',pid:0,exit_code:i?null:7}));fs.writeFileSync(jobs+'/'+name,bytes,{mode:0o600});records.push({name,bytes});}
 const commands=[],execute=async command=>{commands.push(command);let mapped=command.replaceAll(directory,target).replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot');for(const pid of [42,51,52])mapped=mapped.replaceAll('/proc/'+pid+'/stat',root+'/proc/'+pid+'/stat');const r=spawnSync('/bin/sh',[],{input:mapped,encoding:'utf8'});return {exit_code:r.status,stdout:r.stdout,stderr:r.stderr};};
 try{await fn({root,jobs,records,commands,options:{record,installation,execute},execute});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('native snapshot preserves bytes and binds production identity and original installation',linux,()=>fixture(async f=>{
 const result=await snapshotNativeJobs(f.options);assert.equal(result.implementation,'native-prototype');assert.deepEqual(result.source,f.options.record.worker_identity);assert.equal(result.origin.installation_sha256,f.options.record.state_receipt_sha256);assert.equal(result.records.length,2);
 const {sha256,...value}=result;assert.equal(sha256,hash(JSON.stringify(value)));for(let i=0;i<2;i++){assert.deepEqual(Buffer.from(result.records[i].base64,'base64'),f.records[i].bytes);assert.deepEqual(fs.readFileSync(f.jobs+'/'+f.records[i].name),f.records[i].bytes);}
 for(const command of f.commands)assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);
}));
test('empty and full native retention inventories remain exact',linux,async()=>{
 for(const count of [0,64])await fixture(async f=>{const result=await snapshotNativeJobs(f.options);assert.equal(result.records.length,count);assert.deepEqual(fs.readdirSync(f.jobs).sort(),['lock','.import-manifest',...f.records.map(r=>r.name)].sort());},count);
});
test('live worker or guardian and unresolved metadata refuse rollback snapshots',linux,async()=>{
 for(const mode of ['worker','guardian','old-source','journal','pending','intent','repair','next','link','manifest'])await fixture(async f=>{
  if(['worker','guardian','old-source'].includes(mode)){const pid=mode==='worker'?52:mode==='guardian'?51:42,ticks=mode==='worker'?'200':mode==='guardian'?'199':'100';fs.mkdirSync(f.root+'/proc/'+pid);fs.writeFileSync(f.root+'/proc/'+pid+'/stat',pid+' (worker) S '+Array(18).fill('0').join(' ')+' '+ticks+' 0\n');}
  else if(mode==='link'){fs.unlinkSync(f.jobs+'/'+f.records[0].name);fs.symlinkSync('/dev/null',f.jobs+'/'+f.records[0].name);}
  else if(mode==='manifest')fs.writeFileSync(f.jobs+'/.import-manifest','changed');
  else fs.writeFileSync(f.jobs+'/'+({journal:'guardian',pending:'.import-pending',intent:'.intent-unknown',repair:'.repair-unknown',next:'record.next'}[mode]),'unfinished',{mode:0o600});
  await assert.rejects(snapshotNativeJobs(f.options));
 });
});
test('inventory changes during reads are detected and forgotten jobs are not resurrected',linux,async()=>{
 await fixture(async f=>{let changed=false;await assert.rejects(snapshotNativeJobs({...f.options,execute:async command=>{const result=await f.execute(command);if(!changed&&command.includes('\nbase64 ')){changed=true;fs.unlinkSync(f.jobs+'/'+f.records[0].name);}return result;}}));});
 await fixture(async f=>{fs.unlinkSync(f.jobs+'/'+f.records[0].name);const result=await snapshotNativeJobs(f.options);assert.deepEqual(result.records.map(r=>r.name),[f.records[1].name]);});
});
test('wrong installation binding and metadata are refused',linux,()=>fixture(async f=>{
 await assert.rejects(snapshotNativeJobs({...f.options,installation:{...f.options.installation,installed_manifest_sha256:'f'.repeat(64)}}));assert.equal(f.commands.length,0);
 fs.chmodSync(f.jobs+'/lock',0o644);await assert.rejects(snapshotNativeJobs(f.options));
}));

function staleGuardian(f){
 const i=f.options.record.worker_identity,journal={schema:4,phase:'ready',prepared:true,worker_id:i.worker_id,boot_id:i.boot_id,pid:i.processes.guardian.pid,process_start:i.processes.guardian.start_ticks};
 fs.writeFileSync(f.jobs+'/guardian',JSON.stringify(journal),{mode:0o600});return journal;
}
test('native restart snapshots preserve a bound stale guardian for native reconciliation only',linux,()=>fixture(async f=>{
 const clean=await snapshotNativeRestartJobs(f.options);assert.equal(clean.guardian_sha256,null);
 staleGuardian(f);const before=fs.readFileSync(f.jobs+'/guardian'),result=await snapshotNativeRestartJobs(f.options);
 assert.equal(result.guardian_sha256,hash(before));assert.deepEqual(result.snapshot,clean.snapshot);assert.deepEqual(fs.readFileSync(f.jobs+'/guardian'),before);
 await assert.rejects(snapshotNativeJobs(f.options));
}));
test('native restart refuses foreign or partial journals, live owners and unexpected metadata',linux,async()=>{
 for(const mode of ['worker','boot','pid','ticks','schema','phase','prepared','link','mode','partial','extra','live'])await fixture(async f=>{
  const j=staleGuardian(f);
  if(mode==='worker')j.worker_id='e'.repeat(32);if(mode==='boot')j.boot_id='00000000-0000-0000-0000-000000000002';
  if(mode==='pid')j.pid++;if(mode==='ticks')j.process_start='201';if(mode==='schema')j.schema=3;if(mode==='phase')j.phase='contained';if(mode==='prepared')j.prepared=false;
  fs.writeFileSync(f.jobs+'/guardian',JSON.stringify(j));
  if(mode==='link'){fs.unlinkSync(f.jobs+'/guardian');fs.symlinkSync('/dev/null',f.jobs+'/guardian');}
  if(mode==='mode')fs.chmodSync(f.jobs+'/guardian',0o644);
  if(mode==='partial')fs.writeFileSync(f.jobs+'/guardian','{');
  if(mode==='extra')fs.writeFileSync(f.jobs+'/guardian.next','unfinished',{mode:0o600});
  if(mode==='live'){fs.mkdirSync(f.root+'/proc/51');fs.writeFileSync(f.root+'/proc/51/stat','51 (worker) S '+Array(18).fill('0').join(' ')+' 199 0\n');}
  const before=fs.readdirSync(f.jobs).sort();await assert.rejects(snapshotNativeRestartJobs(f.options));assert.deepEqual(fs.readdirSync(f.jobs).sort(),before);
 });
});
test('native restart refuses a guardian journal changed during the snapshot',linux,()=>fixture(async f=>{
 staleGuardian(f);let changed=false;
 await assert.rejects(snapshotNativeRestartJobs({...f.options,execute:async c=>{const r=await f.execute(c);if(!changed&&c.includes('base64 '+f.options.record.scope+'/.jobs/guardian')){changed=true;fs.appendFileSync(f.jobs+'/guardian',' ');}return r;}}));assert(changed);
}));

test('restart admits only pinned guardian-owned persistence debris, including publication links',linux,async()=>{
 for(const kind of ['empty','partial','repair','linked-intent','linked-repair','next'])await fixture(async f=>{
  const j=staleGuardian(f),id='native-debris-0001',intent=f.jobs+'/.intent-'+j.worker_id+'-'+id,repair=f.jobs+'/.repair-'+j.worker_id+'-'+id,final=f.jobs+'/'+id+'.json';
  const bytes=JSON.stringify({id,worker_id:j.worker_id,boot_id:boot,state:'starting',exit_code:null});
  if(kind==='next'){
   fs.writeFileSync(final,bytes,{mode:0o600});fs.writeFileSync(final+'.next','{',{mode:0o600});
  }else{
   fs.writeFileSync(intent,kind==='empty'?'':'{',{mode:0o600});
   if(kind==='repair')fs.writeFileSync(repair,'{',{mode:0o600});
   if(kind.startsWith('linked-')){fs.writeFileSync(final,bytes,{mode:0o600});if(kind==='linked-intent')fs.unlinkSync(intent);fs.linkSync(final,kind==='linked-intent'?intent:repair);}
  }
  const before=new Map(fs.readdirSync(f.jobs).map(n=>[n,fs.readFileSync(f.jobs+'/'+n)])),result=await snapshotNativeRestartJobs(f.options);
  assert.equal(result.metadata.length,['repair','linked-repair'].includes(kind)?2:1);
  for(const [n,b] of before)assert.deepEqual(fs.readFileSync(f.jobs+'/'+n),b);
  await assert.rejects(snapshotNativeJobs(f.options));
 });
});
test('restart refuses unbound debris, unsafe links and changed persistence bytes without mutation',linux,async()=>{
 for(const mode of ['foreign','repair-alone','next-alone','next-foreign','external-link','symlink','mode','large','changed','overflow'])await fixture(async f=>{
  const j=staleGuardian(f),id='native-debris-0001',name='.intent-'+(mode==='foreign'?'e'.repeat(32):j.worker_id)+'-'+id,file=f.jobs+'/'+name;
  fs.writeFileSync(file,'{',{mode:0o600});
  if(mode==='repair-alone'){fs.unlinkSync(file);fs.writeFileSync(f.jobs+'/.repair-'+j.worker_id+'-'+id,'',{mode:0o600});}
  if(mode.startsWith('next-')){fs.unlinkSync(file);fs.writeFileSync(f.jobs+'/'+id+'.json.next','',{mode:0o600});if(mode==='next-foreign')fs.writeFileSync(f.jobs+'/'+id+'.json',JSON.stringify({id,boot_id:boot,worker_id:'e'.repeat(32),state:'completed'}),{mode:0o600});}
  if(mode==='external-link')fs.linkSync(file,f.root+'/link');
  if(mode==='symlink'){fs.unlinkSync(file);fs.symlinkSync('/dev/null',file);}
  if(mode==='mode')fs.chmodSync(file,0o644);
  if(mode==='large')fs.writeFileSync(file,'x'.repeat(2048));
  let changed=false;const execute=async c=>{const r=await f.execute(c);if(mode==='changed'&&!changed&&c.includes('METADATA-END')){changed=true;fs.writeFileSync(file,'changed');}return r;};
  const before=fs.readdirSync(f.jobs).sort();await assert.rejects(snapshotNativeRestartJobs({...f.options,execute}));assert.deepEqual(fs.readdirSync(f.jobs).sort(),before);
 },mode==='overflow'?64:2);
});

function interruptedStartup(f,phase='runtime-reserved'){
 const attempt={schema:2,id:'e'.repeat(32),source_worker_id:f.options.record.worker_identity.worker_id,boot_id:boot,origin_id:f.options.record.id,phase:'submitted',fence:'/opt/couchroot-startup-fence-'+'e'.repeat(32),token_sha256:'f'.repeat(64)};
 const journal={schema:4,phase,prepared:phase==='ready',worker_id:'1'.repeat(32),boot_id:boot,pid:2147483000,process_start:'456',startup_token_sha256:attempt.token_sha256};
 fs.writeFileSync(f.jobs+'/guardian',JSON.stringify(journal),{mode:0o600});return {attempt,journal};
}
test('restart binds incomplete checkpoints to their original submitted startup token',linux,async()=>{
 for(const mode of ['base','complete-next','partial-next','initial-empty','initial-partial','ready','absent'])await fixture(async f=>{
  const {attempt,journal}=interruptedStartup(f,mode==='ready'?'ready':'runtime-reserved');
  if(mode==='complete-next')fs.writeFileSync(f.jobs+'/guardian.next',JSON.stringify({...journal,phase:'runtime'}),{mode:0o600});
  if(mode==='partial-next')fs.writeFileSync(f.jobs+'/guardian.next','{',{mode:0o600});
  if(mode.startsWith('initial')||mode==='absent'){fs.unlinkSync(f.jobs+'/guardian');if(mode!=='absent')fs.writeFileSync(f.jobs+'/guardian.initial',mode==='initial-empty'?'':'{',{mode:0o600});}
  const before=new Map(fs.readdirSync(f.jobs).map(n=>[n,fs.readFileSync(f.jobs+'/'+n)]));
  const result=await snapshotNativeRestartJobs({...f.options,attempt});assert.equal(result.reconciliation_required,mode!=='absent');assert.equal(result.snapshot.records.length,2);
  if(mode!=='absent')assert.equal(result.reconciliation_worker_id,mode.startsWith('initial')?null:journal.worker_id);
  for(const [n,b] of before)assert.deepEqual(fs.readFileSync(f.jobs+'/'+n),b);
  if(mode!=='absent')await assert.rejects(snapshotNativeJobs(f.options));
 });
});
test('unaccepted startup checkpoints refuse foreign tokens, old sources, successors and unexpected jobs',linux,async()=>{
 for(const mode of ['token','source','origin','attempt-ready','legacy','boot','phase','prepared','pid','ticks','next-token','next-phase','initial-conflict','new-job','job-temp','changed'])await fixture(async f=>{
  const {attempt,journal}=interruptedStartup(f);
  if(mode==='token')journal.startup_token_sha256='a'.repeat(64);if(mode==='source')attempt.source_worker_id='a'.repeat(32);if(mode==='origin')attempt.origin_id='b'.repeat(32);
  if(mode==='attempt-ready')attempt.phase='ready';if(mode==='legacy')attempt.schema=1;if(mode==='boot')journal.boot_id='00000000-0000-0000-0000-000000000002';if(mode==='phase')journal.phase='unknown';if(mode==='prepared')journal.prepared=true;if(mode==='pid')journal.pid=1;if(mode==='ticks')journal.process_start='0';
  fs.writeFileSync(f.jobs+'/guardian',JSON.stringify(journal));
  if(mode.startsWith('next-'))fs.writeFileSync(f.jobs+'/guardian.next',JSON.stringify({...journal,phase:mode==='next-phase'?'ready':'runtime',startup_token_sha256:mode==='next-token'?'a'.repeat(64):journal.startup_token_sha256}),{mode:0o600});
  if(mode==='initial-conflict')fs.writeFileSync(f.jobs+'/guardian.initial','',{mode:0o600});
  if(mode==='new-job')fs.writeFileSync(f.jobs+'/native-forbidden-1.json',JSON.stringify({id:'native-forbidden-1',worker_id:journal.worker_id,boot_id:boot,state:'completed'}),{mode:0o600});
  if(mode==='job-temp')fs.writeFileSync(f.jobs+'/.intent-'+journal.worker_id+'-native-forbidden-1','',{mode:0o600});
  let changed=false;const execute=async c=>{const r=await f.execute(c);if(mode==='changed'&&!changed&&c.includes('base64 '+f.options.record.scope+'/.jobs/guardian.next')){changed=true;fs.writeFileSync(f.jobs+'/guardian.next','{',{mode:0o600});}return r;};
  await assert.rejects(snapshotNativeRestartJobs({...f.options,attempt,execute}));assert(fs.existsSync(f.jobs+'/guardian'));
 });
});

const {planManagedRestore}=require('../research/autonomous-root/service/managed-restore-plan');
async function restoreFixture(f){
 const baselineBody={schema:1,implementation:'managed',source:f.options.record.source,records:f.records.map(r=>({name:r.name,size:r.bytes.length,sha256:hash(r.bytes),base64:r.bytes.toString('base64')}))};
 const baseline={...baselineBody,sha256:hash(JSON.stringify(baselineBody))};
 f.options.installation.snapshot_sha256=baseline.sha256;f.options.record.state_receipt_sha256=hash(JSON.stringify(f.options.installation));
 const snapshot=await snapshotNativeJobs(f.options);
 const parent=f.root+'/managed';fs.mkdirSync(parent,{mode:0o755});fs.mkdirSync(parent+'/jobs',{mode:0o700});
 for(const r of f.records)fs.writeFileSync(parent+'/jobs/'+r.name,r.bytes,{mode:0o600});
 const plan=planManagedRestore({...f.options,snapshot,baseline});
 const execute=c=>f.execute(c.replaceAll('/opt/couchroot-agent',parent));
 const run=async c=>{const r=await execute(c);assert.equal(r.exit_code,0,r.stderr);return r.stdout;};
 return {snapshot,baseline,parent,plan,execute,run};
}
test('managed rollback replaces inventory exactly and retains original bytes across cutover interruption',linux,()=>fixture(async f=>{
 // Forget one existing record and change the retained result under native.
 fs.unlinkSync(f.jobs+'/'+f.records[0].name);
 const changed=Buffer.from(f.records[1].bytes.toString().replace('unknown','interrupted'));fs.writeFileSync(f.jobs+'/'+f.records[1].name,changed);
 const r=await restoreFixture(f);await r.run(r.plan.begin);for(const c of r.plan.copies)await r.run(c);
 assert.equal(await r.run(r.plan.inspect),'RESTORE-STAGED\n');
 await r.run(r.plan.retire);assert.equal(fs.existsSync(r.parent+'/jobs'),false);
 // A restart can identify the exact two-rename window without replaying retire.
 assert.equal(await r.run(r.plan.inspect),'RESTORE-CUTOVER\n');await r.run(r.plan.publish);
 assert.equal(await r.run(r.plan.inspect),'RESTORE-READY\n');await r.run(r.plan.verify);
 assert.deepEqual(fs.readdirSync(r.parent+'/jobs'),[f.records[1].name]);assert.deepEqual(fs.readFileSync(r.parent+'/jobs/'+f.records[1].name),changed);
 const backup=r.parent+'/rollback-'+f.options.record.id+'/previous';for(const old of f.records)assert.deepEqual(fs.readFileSync(backup+'/'+old.name),old.bytes);
 assert.notEqual((await r.execute(r.plan.retire)).exit_code,0);assert.notEqual((await r.execute(r.plan.publish)).exit_code,0);
}));
test('managed restoration rejects drift, foreign staging and live native processes without replacing baseline',linux,async()=>{
 for(const mode of ['baseline','extra','symlink','worker'])await fixture(async f=>{
  const r=await restoreFixture(f);await r.run(r.plan.begin);for(const c of r.plan.copies)await r.run(c);
  const staged=r.parent+'/rollback-'+f.options.record.id+'/next';
  if(mode==='baseline')fs.writeFileSync(r.parent+'/jobs/'+f.records[0].name,'changed');
  if(mode==='extra')fs.writeFileSync(staged+'/extra','unexpected');
  if(mode==='symlink'){fs.unlinkSync(staged+'/'+f.records[0].name);fs.symlinkSync(r.parent+'/jobs/'+f.records[0].name,staged+'/'+f.records[0].name);}
  if(mode==='worker'){fs.mkdirSync(f.root+'/proc/52');fs.writeFileSync(f.root+'/proc/52/stat','52 (worker) S '+Array(18).fill('0').join(' ')+' 200 0\n');}
  assert.notEqual((await r.execute(r.plan.retire)).exit_code,0);assert(fs.existsSync(r.parent+'/jobs'));assert(!fs.existsSync(r.parent+'/rollback-'+f.options.record.id+'/previous'));
 });
});
test('managed restore supports empty and full inventories and rejects altered snapshot receipts',linux,async()=>{
 for(const count of [0,64])await fixture(async f=>{
  const r=await restoreFixture(f);assert.throws(()=>planManagedRestore({...f.options,snapshot:{...r.snapshot,sha256:'f'.repeat(64)},baseline:r.baseline}));
  if(count===0)fs.rmdirSync(r.parent+'/jobs');
  await r.run(r.plan.begin);for(const c of r.plan.copies)await r.run(c);await r.run(r.plan.retire);await r.run(r.plan.publish);await r.run(r.plan.verify);
  assert.equal(fs.readdirSync(r.parent+'/jobs').length,count);
 },count);
});

const {restoreManagedJobs}=require('../research/autonomous-root/service/managed-restore');
const {SelectionJournal,selectionStatus}=require('../research/autonomous-root/service/worker-selection');
async function durableRestoreFixture(f,committed=false){
 const r=await restoreFixture(f),journalDirectory=f.root+'/journal';fs.mkdirSync(journalDirectory,{mode:0o700});
 const selectionFile=journalDirectory+'/selection.json',j=new SelectionJournal(selectionFile);let s=j.initialize({implementation:'managed',manifest_sha256:'e'.repeat(64)});
 s=j.begin(s.revision,{implementation:'native-prototype',manifest_sha256:f.options.record.manifest_sha256},sha);
 s.pending.id=f.options.record.id;fs.writeFileSync(selectionFile,JSON.stringify(s));
 if(committed){s=j.advance(s.revision,s.pending.id,'state-ready',f.options.record.state_receipt_sha256);s=j.advance(s.revision,s.pending.id,'trial-ready',hash(JSON.stringify(f.options.record)));s=j.commit(s.revision,s.pending.id);s=j.begin(s.revision,{implementation:'managed',manifest_sha256:'e'.repeat(64)},sha);}
 else s=j.advance(s.revision,s.pending.id,'rollback-required',sha);
 for(const [suffix,value] of [['.production.json',f.options.record],['.state-install.json',f.options.installation],['.retained-snapshot.json',r.baseline]])fs.writeFileSync(journalDirectory+'/'+f.options.record.id+suffix,JSON.stringify(value),{mode:0o600});
 const options={...f.options,baseline:r.baseline,snapshot:r.snapshot,journalDirectory,selectionFile,execute:r.execute};
 return {...r,options,selection:s,marker:journalDirectory+'/managed-restore.pending'};
}
test('durable restore supports failed trial and committed native rollback without selecting or starting managed',linux,async()=>{
 for(const committed of [false,true])await fixture(async f=>{
  const r=await durableRestoreFixture(f,committed),before=selectionStatus(r.options.selectionFile),result=await restoreManagedJobs(r.options);
  assert.equal(result.phase,'restored');assert.equal(result.transition_id,r.selection.pending.id);assert.deepEqual(selectionStatus(r.options.selectionFile),before);assert(fs.existsSync(r.marker));
  assert.deepEqual(await restoreManagedJobs({...r.options,resume:true}),result);
  await assert.rejects(restoreManagedJobs(r.options));
 });
});
test('durable restore resumes lost replies without repeating completed directory moves',linux,async()=>{
 for(const boundary of ['begin','copy','retire','publish'])await fixture(async f=>{
  const r=await durableRestoreFixture(f),target=boundary==='copy'?r.plan.copies[0]:r.plan[boundary];let failed=false;
  await assert.rejects(restoreManagedJobs({...r.options,execute:async c=>{const result=await r.execute(c);if(!failed&&c===target){failed=true;throw Error('lost reply');}return result;}}),e=>e.outcome==='unknown');assert(failed);assert(fs.existsSync(r.marker));
  const replay=[];await restoreManagedJobs({...r.options,resume:true,execute:async c=>{replay.push(c);return r.execute(c);}});
  if(['begin','retire','publish'].includes(boundary))assert(!replay.includes(target));
  assert.equal(await r.run(r.plan.verify),'RESTORE-READY\n');
 });
});
test('durable restore refuses changed native state, local ownership and selection on resume',linux,async()=>{
 for(const mode of ['native','marker','selection','receipt'])await fixture(async f=>{
  const r=await durableRestoreFixture(f);let interrupted=false;
  await assert.rejects(restoreManagedJobs({...r.options,execute:async c=>{const result=await r.execute(c);if(c===r.plan.begin&&!interrupted){interrupted=true;throw Error('lost reply');}return result;}}));
  if(mode==='native')fs.unlinkSync(f.jobs+'/'+f.records[0].name);
  if(mode==='marker')fs.writeFileSync(r.marker,'f'.repeat(32)+'\n');
  if(mode==='selection'){const s=JSON.parse(fs.readFileSync(r.options.selectionFile));s.pending.quiescence_sha256='f'.repeat(64);fs.writeFileSync(r.options.selectionFile,JSON.stringify(s));}
  if(mode==='receipt')fs.writeFileSync(r.options.journalDirectory+'/'+f.options.record.id+'.production.json','{}');
  await assert.rejects(restoreManagedJobs({...r.options,resume:true}));
  assert(fs.existsSync(r.parent+'/jobs'));assert(!fs.existsSync(r.parent+'/rollback-'+f.options.record.id+'/previous'));
 });
});

const {acceptManagedRestore}=require('../research/autonomous-root/service/managed-restore');
async function restoredForAcceptance(f,committed=false){
 const r=await durableRestoreFixture(f,committed),receipt=await restoreManagedJobs(r.options);
 return {...r,receipt,accept:{transitionId:receipt.transition_id,receiptSha256:receipt.receipt_sha256,journalDirectory:r.options.journalDirectory,selectionFile:r.options.selectionFile,execute:r.execute}};
}
test('restore acceptance rechecks bytes and advances only the proper state gate, including repeat readback',linux,async()=>{
 for(const committed of [false,true])await fixture(async f=>{
  const r=await restoredForAcceptance(f,committed),before=selectionStatus(r.options.selectionFile),accepted=await acceptManagedRestore(r.accept);
  assert.equal(accepted.pending.phase,committed?'state-ready':'rollback-state-ready');assert.equal(accepted.pending.state_sha256,r.receipt.receipt_sha256);assert.equal(accepted.selected.implementation,before.selected_implementation);assert(fs.existsSync(r.marker));
  assert.deepEqual(await acceptManagedRestore(r.accept),accepted);
  fs.writeFileSync(r.parent+'/jobs/'+f.records[0].name,'changed');await assert.rejects(acceptManagedRestore(r.accept));
 });
});
test('restore acceptance rejects changed receipt, marker, source, backup and destination',linux,async()=>{
 for(const mode of ['receipt','digest','marker','source','backup','destination','extra','writer'])await fixture(async f=>{
  const r=await restoredForAcceptance(f),before=fs.readFileSync(r.options.selectionFile,'utf8');
  if(mode==='receipt')fs.writeFileSync(r.options.journalDirectory+'/'+r.receipt.transition_id+'.managed-restore.json','{}');
  if(mode==='digest')r.accept.receiptSha256='f'.repeat(64);
  if(mode==='marker')fs.unlinkSync(r.marker);
  if(mode==='source')fs.unlinkSync(f.jobs+'/'+f.records[0].name);
  if(mode==='backup')fs.writeFileSync(r.parent+'/rollback-'+f.options.record.id+'/previous/'+f.records[0].name,'changed');
  if(mode==='destination')fs.writeFileSync(r.parent+'/jobs/'+f.records[0].name,'changed');
  if(mode==='extra')fs.writeFileSync(r.parent+'/jobs/extra','changed');
  if(mode==='writer')fs.writeFileSync(r.options.selectionFile+'.writer','busy',{mode:0o600});
  await assert.rejects(acceptManagedRestore(r.accept));assert.equal(fs.readFileSync(r.options.selectionFile,'utf8'),before);
 });
});
test('restore acceptance catches mutation during asynchronous verification before advancing selection',linux,async()=>{
 for(const mode of ['selection','receipt','native'])await fixture(async f=>{
  const r=await restoredForAcceptance(f);let changed=false;
  await assert.rejects(acceptManagedRestore({...r.accept,execute:async c=>{const result=await r.execute(c);if(!changed&&c===r.plan.verify){changed=true;
   if(mode==='selection'){const s=JSON.parse(fs.readFileSync(r.options.selectionFile));s.pending.quiescence_sha256='f'.repeat(64);fs.writeFileSync(r.options.selectionFile,JSON.stringify(s));}
   if(mode==='receipt')fs.writeFileSync(r.options.journalDirectory+'/'+r.receipt.transition_id+'.managed-restore.json','{}');
   if(mode==='native')fs.unlinkSync(f.jobs+'/'+f.records[0].name);
  }return result;}}));assert(changed);assert.equal(selectionStatus(r.options.selectionFile).pending.phase,'rollback-required');
 });
});

async function managedLaunchFixture(f,committed=false){
 const r=await restoredForAcceptance(f,committed),payload='/opt/usr/apps/MiniRoot01/res/wgt/payload',payloadLocal=f.root+'/package-root/apps/MiniRoot01/res/wgt/payload';
 fs.mkdirSync(payloadLocal,{recursive:true,mode:0o755});const manifest={};
 for(const name of ['SamsungTvArchiveRoot','SamsungTvRootAgent'])for(const ext of ['dll','runtimeconfig.json','deps.json']){const n=name+'.'+ext,bytes=Buffer.from(n);manifest[n]=hash(bytes);fs.writeFileSync(payloadLocal+'/'+n,bytes,{mode:0o644});fs.chownSync(payloadLocal+'/'+n,201,201);}
 fs.writeFileSync(payloadLocal+'/manifest.json',JSON.stringify(manifest));
 const selectionModule=require('../research/autonomous-root/service/worker-selection'),version=selectionModule.managedVersion(payloadLocal);
 fs.writeFileSync(r.options.selectionFile,fs.readFileSync(r.options.selectionFile,'utf8').replaceAll('e'.repeat(64),version));
 await acceptManagedRestore(r.accept);
 const tokenFile='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state/managed-ABC123/token',tokenLocal=tokenFile.replace('/opt/usr',f.root+'/package-root');
 fs.mkdirSync(path.dirname(tokenLocal),{recursive:true,mode:0o700});fs.chownSync(path.dirname(tokenLocal),5001,100);const token=Buffer.from('a'.repeat(32)).toString('base64');fs.writeFileSync(tokenLocal,token,{mode:0o600});fs.chownSync(tokenLocal,5001,100);
 const runtime=f.root+'/dotnet';fs.writeFileSync(runtime,'fixture runtime',{mode:0o755});fs.mkdirSync(f.root+'/package-root/home/owner/share/tmp/sdk_tools',{recursive:true,mode:0o755});fs.symlinkSync('package-root/home',f.root+'/home');
 const bin=f.root+'/bin';fs.mkdirSync(bin);fs.writeFileSync(bin+'/systemctl','#!/bin/sh\necho LoadState=not-found\n',{mode:0o755});fs.writeFileSync(bin+'/systemd-run','#!/bin/sh\nprintf "%s\\n" "$@" > '+f.root+'/launched\n',{mode:0o755});
 const file=path.resolve(__dirname,'../research/autonomous-root/service/managed-launch.js'),real=require('node:module').createRequire(file),module={exports:{}};
 require('node:vm').runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,require:n=>n==='./worker-selection'?{...real(n),managedVersion:p=>real(n).managedVersion(p.replace(payload,payloadLocal))}:n==='./policy'?{...real(n),read:(p,l)=>real(n).read(p.replace(payload,payloadLocal),l)}:real(n)});
 const execute=c=>r.execute(c.replaceAll('/opt/usr',f.root+'/package-root').replaceAll('/opt/couchroot-managed-',f.root+'/launch-').replaceAll("'/home","'"+f.root+'/home').replaceAll('/usr/bin/dotnet',runtime).replaceAll('PATH=/usr/bin:/bin','PATH='+bin+':/usr/bin:/bin'));
 const options={transitionId:r.receipt.transition_id,journalDirectory:r.options.journalDirectory,selectionFile:r.options.selectionFile,receiptSha256:r.receipt.receipt_sha256,payload,managedSha256:version,runtimeSha256:hash('fixture runtime'),port:12345,tokenFile,tokenSha256:hash(token),execute};
 return {...r,api:module.exports,launchOptions:options,execute,tokenLocal,payloadLocal,runtime,bin,launchFile:r.options.journalDirectory+'/'+options.transitionId+'.managed-launch.json'};
}
test('managed restart journals before submission and keeps rollback selection pending',linux,()=>fixture(async f=>{
 const r=await managedLaunchFixture(f),before=selectionStatus(r.options.selectionFile);let submissions=0;
 const result=await r.api.submitManaged({...r.launchOptions,execute:async c=>{if(c.includes('systemd-run')){submissions++;assert.equal(JSON.parse(fs.readFileSync(r.launchFile)).phase,'submitting');assert.match(c,/PrivateMounts=yes/);assert.match(c,/BindReadOnlyPaths=/);assert.doesNotMatch(c,/archive-root|launch-sdk/);}const output=await r.execute(c);if(c.includes('systemd-run'))assert.equal(output.stdout,'RESTORE-READY\nMANAGED-SUBMITTED\n',JSON.stringify(output));return output;}}).catch(e=>{throw e.cause||e;});
 assert.equal(result.phase,'submitted');assert.equal(submissions,1);assert.deepEqual(selectionStatus(r.options.selectionFile),before);
 assert.match(fs.readFileSync(f.root+'/launched','utf8'),/SamsungTvRootAgent.dll/);assert.equal(hash(fs.readFileSync(f.root+'/launch-'+result.id+'/code/SamsungTvRootAgent.dll')),result.files['SamsungTvRootAgent.dll']);
 await assert.rejects(r.api.submitManaged(r.launchOptions));
}));
test('managed launch uses canonical staging when home is the TV compatibility symlink',linux,()=>fixture(async f=>{
 const r=await managedLaunchFixture(f);
 assert(fs.lstatSync(f.root+'/home').isSymbolicLink());
 const result=await r.api.submitManaged(r.launchOptions);
 assert.equal(result.stage,'/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+result.id);
 const args=fs.readFileSync(f.root+'/launched','utf8').trimEnd().split('\n');
 assert.deepEqual(args.slice(-2),[f.root+'/home/owner/share/tmp/sdk_tools/managed-'+result.id+'/token',f.root+'/home/owner/share/tmp/sdk_tools/managed-'+result.id]);
 assert(fs.existsSync(f.root+'/package-root/home/owner/share/tmp/sdk_tools/managed-'+result.id+'/token'));
}));
test('generated managed launch arguments pass the unchanged production staging validator',{
 skip:linux.skip||!process.env.MANAGED_PARITY
},()=>fixture(async f=>{
 const r=await managedLaunchFixture(f),result=await r.api.submitManaged(r.launchOptions);
 const args=fs.readFileSync(f.root+'/launched','utf8').trimEnd().split('\n');
 const runtimeStage=args[args.length-1].replace(f.root+'/home','/home');
 const validate=stage=>spawnSync('dotnet',[process.env.MANAGED_PARITY,'--validate-staging',stage],{encoding:'utf8',timeout:10000});
 const accepted=validate(runtimeStage);assert.equal(accepted.status,0,accepted.stderr);assert.equal(accepted.stdout,runtimeStage+'/\n');
 assert.equal(validate(result.stage).status,64);
 assert.equal(validate('/home/owner/share/tmp/sdk_tools/../foreign').status,64);
}));
test('managed launch refuses a compatibility home alias to a different directory',linux,()=>fixture(async f=>{
 const r=await managedLaunchFixture(f);
 fs.unlinkSync(f.root+'/home');fs.mkdirSync(f.root+'/foreign-home');fs.symlinkSync('foreign-home',f.root+'/home');
 await assert.rejects(r.api.submitManaged(r.launchOptions));assert(!fs.existsSync(f.root+'/launched'));
}));
test('managed launch still refuses a symlink in the canonical staging parent',linux,()=>fixture(async f=>{
 const r=await managedLaunchFixture(f),parent=f.root+'/package-root/home/owner/share/tmp/sdk_tools';
 fs.renameSync(parent,parent+'-actual');fs.symlinkSync(parent+'-actual',parent);
 await assert.rejects(r.api.submitManaged(r.launchOptions));
 assert(!fs.existsSync(f.root+'/launched'));
 assert(!fs.existsSync(f.root+'/launch-'+r.launchOptions.transitionId));
}));
test('managed launch uncertain response retains intent and cannot launch twice',linux,()=>fixture(async f=>{
 const r=await managedLaunchFixture(f);let submissions=0;
 await assert.rejects(r.api.submitManaged({...r.launchOptions,execute:async c=>{const result=await r.execute(c);if(c.includes('systemd-run')){submissions++;assert.equal(result.exit_code,0,result.stderr);throw Error('lost reply');}return result;}}),e=>e.outcome==='unknown');
 assert(fs.existsSync(f.root+'/launched'));assert.equal(JSON.parse(fs.readFileSync(r.launchFile)).phase,'unknown');await assert.rejects(r.api.submitManaged(r.launchOptions));assert.equal(submissions,1);
}));
test('managed launch rejects runtime, token, package, unit and selection drift',linux,async()=>{
 for(const mode of ['runtime','token','package','unit','selection'])await fixture(async f=>{
  const r=await managedLaunchFixture(f);
  if(mode==='runtime')fs.writeFileSync(r.runtime,'changed');if(mode==='token')fs.writeFileSync(r.tokenLocal,'changed');
  if(mode==='package')fs.writeFileSync(r.payloadLocal+'/SamsungTvRootAgent.dll','changed');
  if(mode==='unit')fs.writeFileSync(r.bin+'/systemctl','#!/bin/sh\necho LoadState=loaded\n');
  if(mode==='selection'){const s=JSON.parse(fs.readFileSync(r.options.selectionFile));s.pending.state_sha256='f'.repeat(64);fs.writeFileSync(r.options.selectionFile,JSON.stringify(s));}
  await assert.rejects(r.api.submitManaged(r.launchOptions));assert(!fs.existsSync(f.root+'/launched'));
 });
});
test('managed launch plan handles full retention and rejects malformed callback and package binding',linux,()=>fixture(async f=>{
 const r=await managedLaunchFixture(f),inputs={record:f.options.record,installation:f.options.installation,baseline:r.baseline,snapshot:r.snapshot};
 const o={...r.launchOptions,inputs},plan=r.api.managedLaunchPlan(o);assert(Buffer.byteLength(plan.command)<=65536);assert.equal(spawnSync('/bin/sh',['-n'],{input:plan.command}).status,0);
 for(const patch of [{port:0},{tokenFile:'/tmp/token'},{tokenFile:o.tokenFile.replace('ABC123','ABC123\n')},{managedSha256:'f'.repeat(64)},{runtimeSha256:'invalid'},{transitionId:o.transitionId+'\n'},{payload:'/tmp/payload'}])assert.throws(()=>r.api.managedLaunchPlan({...o,...patch}));
},64));

const {readyManaged,managedRuntimeCommand}=require('../research/autonomous-root/service/managed-readiness');
async function managedReadyFixture(f,committed=false){
 const r=await managedLaunchFixture(f,committed),record=await r.api.submitManaged(r.launchOptions),worker='9'.repeat(32),launcherBytes=Buffer.from('fixture launcher'),providerIdentity={boot_id:boot,worker_id:'8'.repeat(32),processes:{worker:{pid:77,start_ticks:'700'},guardian:{pid:76,start_ticks:'699'}}};
 const info={implementation:'managed',boot_id:boot,worker_id:worker,uptime_seconds:1,processes:{worker:{pid:73,start_ticks:'500'},guardian:null},capabilities:['worker-process-identity-v1','resource-inventory-v1','file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1'],app_launcher:{implementation:'native',sha256:hash(launcherBytes)},resources:{schema:1,scope:'worker-owned',jobs:[],helpers:[],transfers:[]}};
 const launcher=r.parent+'/launchers/'+worker;fs.mkdirSync(launcher,{recursive:true,mode:0o700});fs.writeFileSync(launcher+'/app-launcher',launcherBytes,{mode:0o500});
 const proc=f.root+'/proc/73';fs.mkdirSync(proc+'/ns',{recursive:true});fs.mkdirSync(f.root+'/proc/1/ns',{recursive:true});fs.symlinkSync('mnt:[2]',proc+'/ns/mnt');fs.symlinkSync('mnt:[1]',f.root+'/proc/1/ns/mnt');fs.symlinkSync(r.runtime,proc+'/exe');fs.writeFileSync(proc+'/stat','73 (dotnet) S '+Array(18).fill('0').join(' ')+' 500 0\n');
 fs.writeFileSync(proc+'/cmdline',['/usr/bin/dotnet',record.directory+'/code/SamsungTvRootAgent.dll','127.0.0.1',String(record.port),record.stage.replace('/opt/usr/home/','/home/')+'/token',record.stage.replace('/opt/usr/home/','/home/')].join('\0')+'\0');
 fs.writeFileSync(proc+'/mountinfo','1 0 0:1 / '+f.root+'/launch-'+record.id+'/code ro - tmpfs tmpfs rw\n2 0 0:2 / '+launcher+' ro - tmpfs tmpfs rw\n');
 fs.unlinkSync(f.root+'/package-root/home/owner/share/tmp/sdk_tools/managed-'+record.id+'/token');
 const channel={_conn:{identity:{pid:73,uid:0,euid:0,gid:0,egid:0,smack:'User'}},operation:async request=>{if(request.op==='status')return JSON.parse(JSON.stringify(info));const item=r.snapshot.records.find(e=>e.name===request.id+'.json'),saved=JSON.parse(Buffer.from(item.base64,'base64').toString().replace(/^\uFEFF/,''));return {id:saved.id,boot_id:saved.boot_id,state:saved.state,record:saved,output_available:false};}};
 const execute=async c=>{if(c.includes('--property=Id,'))return {exit_code:0,stdout:'Id='+record.unit+'\nLoadState=loaded\nActiveState=active\nSubState=running\nMainPID=73\nExecMainCode=0\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n',stderr:''};return r.execute(c.replaceAll('/proc/73/',proc+'/').replaceAll('/proc/1/ns/mnt',f.root+'/proc/1/ns/mnt'));};
 return {...r,record,info,proc,channel,execute,readyOptions:{record,journalDirectory:r.options.journalDirectory,selectionFile:r.options.selectionFile,channel,execute,providerIdentity},intent:r.launchFile+'.readiness.pending'};
}
test('managed readiness verifies runtime, mounts, retained jobs and receipt without committing selection',linux,()=>fixture(async f=>{
 const r=await managedReadyFixture(f),before=selectionStatus(r.options.selectionFile),result=await readyManaged(r.readyOptions).catch(e=>{throw e.cause||e;});
 assert.equal(result.record.phase,'ready');assert.equal(result.record.worker_identity.processes.worker.pid,73);assert.equal(result.readiness_sha256,hash(JSON.stringify(result.record)));assert.deepEqual(selectionStatus(r.options.selectionFile),before);assert(!fs.existsSync(r.intent));assert(fs.existsSync(r.marker));
 await assert.rejects(readyManaged(r.readyOptions));
}));
test('managed readiness rejects identity, inventory, retained results and remote runtime drift',linux,async()=>{
 for(const mode of ['identity','resources','job','ticks','mount','argv','runtime','launcher','unit','disconnect'])await fixture(async f=>{
  const r=await managedReadyFixture(f),op=r.channel.operation;
  if(mode==='identity')r.channel._conn.identity.smack='System';if(mode==='resources')r.info.resources.helpers=['a'.repeat(32)];
  if(mode==='job')r.channel.operation=async q=>{const v=await op(q);if(q.op==='job.status')v.record.exit_code=99;return v;};
  if(mode==='ticks')fs.writeFileSync(r.proc+'/stat','73 (dotnet) S '+Array(18).fill('0').join(' ')+' 501 0\n');
  if(mode==='mount')fs.writeFileSync(r.proc+'/mountinfo','');if(mode==='argv')fs.writeFileSync(r.proc+'/cmdline','wrong command');
  if(mode==='runtime')fs.writeFileSync(r.runtime,'changed');if(mode==='launcher')fs.chmodSync(r.parent+'/launchers/'+r.info.worker_id+'/app-launcher',0o700);
  if(mode==='unit')r.readyOptions.execute=async c=>{const v=await r.execute(c);if(c.includes('--property=Id,'))v.stdout=v.stdout.replace('MainPID=73','MainPID=74');return v;};
  if(mode==='disconnect'){let calls=0;r.channel.operation=async q=>{const v=await op(q);if(++calls>1)r.channel._conn=null;return v;};}
  await assert.rejects(readyManaged(r.readyOptions),e=>e.outcome==='unknown');assert(fs.existsSync(r.intent));assert.equal(JSON.parse(fs.readFileSync(r.launchFile)).phase,'submitted');assert.equal(selectionStatus(r.options.selectionFile).pending.phase,'rollback-state-ready');
 });
});
test('managed readiness keeps uncertain published receipt and refuses another readiness attempt',linux,()=>fixture(async f=>{
 const r=await managedReadyFixture(f),file=path.resolve(__dirname,'../research/autonomous-root/service/managed-readiness.js'),real=require('node:module').createRequire(file),module={exports:{}};
 require('node:vm').runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,require:n=>n==='./policy'?{...real(n),atomic:(p,v)=>{real(n).atomic(p,v);throw Error('lost publication reply');}}:real(n)});
 await assert.rejects(module.exports.readyManaged(r.readyOptions),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(r.launchFile)).phase,'ready');assert(fs.existsSync(r.intent));await assert.rejects(readyManaged(r.readyOptions));
}));
test('managed readiness handles full retention within wire bounds',linux,()=>fixture(async f=>{
 const r=await managedReadyFixture(f),identity={boot_id:r.info.boot_id,worker_id:r.info.worker_id,processes:r.info.processes},inputs={record:f.options.record,installation:f.options.installation,baseline:r.baseline,snapshot:r.snapshot};
 const command=managedRuntimeCommand(r.record,identity,inputs,r.info.app_launcher.sha256);assert(Buffer.byteLength(command)<=65536);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);
 const result=await readyManaged(r.readyOptions);assert.equal(result.record.phase,'ready');
},64));
test('managed readiness rejects unit changes and local ownership changes across awaits',linux,async()=>{
 for(const mode of ['unit','marker'])await fixture(async f=>{
  const r=await managedReadyFixture(f);let count=0;
  r.readyOptions.execute=async c=>{const result=await r.execute(c);if(c.includes('--property=Id,')){count++;if(mode==='unit'&&count>1)result.stdout=result.stdout.replace('Monotonic=123','Monotonic=124');if(mode==='marker')fs.writeFileSync(r.options.journalDirectory+'/managed-launch.pending','foreign');}return result;};
  await assert.rejects(readyManaged(r.readyOptions),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(r.launchFile)).phase,'submitted');assert(fs.existsSync(r.intent));
 });
 let calls=0;await assert.rejects(require('../research/autonomous-root/service/observer-unit').inspectManagedUnit({unit:'couchroot-worker-'+'a'.repeat(32)+'.service',bootId:boot,execute:()=>{calls++;}}));assert.equal(calls,0);
});

const {productionRetirementPlan,retireProduction}=require('../research/autonomous-root/service/production-retirement');
async function productionRetirementFixture(f,committed=false){
 f.options.record.worker_sha256=hash('native worker');f.options.record.launcher_sha256=hash('native launcher');fs.mkdirSync(f.root+'/native/code',{mode:0o700});fs.writeFileSync(f.root+'/native/code/worker','native worker',{mode:0o500});fs.writeFileSync(f.root+'/native/state/launcher','native launcher',{mode:0o400});
 const r=await managedReadyFixture(f,committed),ready=await readyManaged(r.readyOptions),selection=new SelectionJournal(r.options.selectionFile);
 if(committed){selection.advance(selection.read().revision,ready.record.id,'trial-ready',ready.readiness_sha256);selection.commit(selection.read().revision,ready.record.id);}else selection.commitRollback(selection.read().revision,ready.record.id,ready.readiness_sha256);
 fs.writeFileSync(r.bin+'/systemctl','#!/bin/sh\nif test "$1" = stop; then touch '+f.root+'/unit-stopped; exit 0; fi\nif test "$#" -gt 4; then printf "LoadState=not-found\\nActiveState=inactive\\nMainPID=0\\n"; exit 0; fi\ncase "$3" in\nLoadState) echo LoadState=loaded;;\nActiveState) echo ActiveState=active;;\nSubState) echo SubState=exited;;\nMainPID) echo MainPID=0;;\nExecMainCode) echo ExecMainCode=1;;\nExecMainStatus) echo ExecMainStatus=0;;\nExecMainStartTimestampMonotonic) echo ExecMainStartTimestampMonotonic=123;;\n*) exit 1;; esac\n');
 return {...r,retireOptions:{managed:ready.record,journalDirectory:r.options.journalDirectory,selectionFile:r.options.selectionFile,execute:r.execute,confirmManaged:async()=>ready.record.worker_identity},retireFile:r.options.journalDirectory+'/'+ready.record.origin_id+'.production-retirement.json'};
}
test('production retirement removes only verified native staging and preserves managed restoration and baseline',linux,()=>fixture(async f=>{
 const r=await productionRetirementFixture(f),before=selectionStatus(r.options.selectionFile),receipt=await retireProduction(r.retireOptions);
 assert.equal(receipt.phase,'staging-retired');assert(!fs.existsSync(f.root+'/native'));assert(fs.existsSync(f.root+'/unit-stopped'));assert.deepEqual(selectionStatus(r.options.selectionFile),before);
 for(const item of f.records){assert.deepEqual(fs.readFileSync(r.parent+'/jobs/'+item.name),item.bytes);assert.deepEqual(fs.readFileSync(r.parent+'/rollback-'+f.options.record.id+'/previous/'+item.name),item.bytes);}
 assert(fs.existsSync(r.marker));assert(fs.existsSync(r.options.journalDirectory+'/managed-launch.pending'));assert(!fs.existsSync(r.retireFile+'.pending'));await assert.rejects(retireProduction(r.retireOptions));
}));
test('production retirement rejects changed native state, unit identity and managed ownership before deletion',linux,async()=>{
 for(const mode of ['record','worker','extra','unit','identity','receipt'])await fixture(async f=>{
  const r=await productionRetirementFixture(f);
  if(mode==='record')fs.writeFileSync(f.jobs+'/'+f.records[0].name,'changed');if(mode==='worker')fs.writeFileSync(f.root+'/native/code/worker','changed');
  if(mode==='extra')fs.writeFileSync(f.root+'/native/state/foreign','changed');
  if(mode==='unit')fs.writeFileSync(r.bin+'/systemctl','#!/bin/sh\necho MainPID=52\n');
  if(mode==='identity')r.retireOptions.confirmManaged=async()=>({...r.retireOptions.managed.worker_identity,worker_id:'0'.repeat(32)});
  if(mode==='receipt')fs.writeFileSync(r.options.journalDirectory+'/'+r.retireOptions.managed.id+'.managed-restore.json','{}');
  await assert.rejects(retireProduction(r.retireOptions));assert(fs.existsSync(f.root+'/native/code/worker'));assert(fs.existsSync(f.jobs));assert(!fs.existsSync(f.root+'/unit-stopped'));
 });
});
test('lost production cleanup reply retains intent and never repeats deletion',linux,()=>fixture(async f=>{
 const r=await productionRetirementFixture(f);let calls=0;
 await assert.rejects(retireProduction({...r.retireOptions,execute:async c=>{calls++;const v=await r.execute(c);assert.equal(v.exit_code,0,v.stderr);throw Error('lost reply');}}),e=>e.outcome==='unknown');
 assert(!fs.existsSync(f.root+'/native'));assert(fs.existsSync(r.retireFile+'.pending'));assert(!fs.existsSync(r.retireFile));await assert.rejects(retireProduction(r.retireOptions));assert.equal(calls,1);
 const resumed=await retireProduction({...r.retireOptions,resume:true,execute:async c=>{assert.doesNotMatch(c,/\nrm |\nrmdir |systemctl stop/);return r.execute(c);}});
 assert.equal(resumed.phase,'staging-retired');assert(!fs.existsSync(r.retireFile+'.pending'));assert.deepEqual(await retireProduction({...r.retireOptions,resume:true}),resumed);
}));
test('production cleanup supports full retained inventory within protocol bounds',linux,()=>fixture(async f=>{
 const r=await productionRetirementFixture(f),inputs=JSON.parse(fs.readFileSync(r.options.journalDirectory+'/'+r.retireOptions.managed.id+'.managed-restore-input.json')),plan=productionRetirementPlan(inputs);
 assert(Buffer.byteLength(plan.command)<=65536);assert.equal(spawnSync('/bin/sh',['-n'],{input:plan.command}).status,0);await interruptProductionDeletion(r);await retireProduction({...r.retireOptions,resume:true,finishPartial:true});assert(!fs.existsSync(f.root+'/native'));assert.equal(fs.readdirSync(r.parent+'/jobs').length,64);
},64));
test('production retirement resume refuses incomplete cleanup and changed ownership or unit state',linux,async()=>{
 for(const mode of ['partial','unit','intent','missing','managed'])await fixture(async f=>{
  const r=await productionRetirementFixture(f);
  await assert.rejects(retireProduction({...r.retireOptions,execute:async c=>{if(mode==='partial')throw Error('submission not observed');const result=await r.execute(c);assert.equal(result.exit_code,0,result.stderr);throw Error('lost reply');}}));
  if(mode==='unit')fs.writeFileSync(r.bin+'/systemctl','#!/bin/sh\nprintf "LoadState=loaded\\nActiveState=active\\nMainPID=52\\n"\n');
  if(mode==='intent')fs.writeFileSync(r.retireFile+'.pending','{}');
  if(mode==='missing')fs.unlinkSync(r.retireFile+'.pending');
  if(mode==='managed')fs.writeFileSync(r.parent+'/jobs/'+f.records[0].name,'changed');
  await assert.rejects(retireProduction({...r.retireOptions,resume:true}));assert(!fs.existsSync(r.retireFile));
  if(mode==='partial')assert(fs.existsSync(f.root+'/native/code/worker'));
 });
});
test('production retirement resumes an uncertain receipt publication without deleting staging again',linux,()=>fixture(async f=>{
 const r=await productionRetirementFixture(f),file=path.resolve(__dirname,'../research/autonomous-root/service/production-retirement.js'),real=require('node:module').createRequire(file),module={exports:{}};
 require('node:vm').runInNewContext(fs.readFileSync(file,'utf8'),{module,process,Buffer,require:n=>n==='./policy'?{...real(n),atomic:(p,v)=>{real(n).atomic(p,v);throw Error('lost publication acknowledgement');}}:real(n)});
 await assert.rejects(module.exports.retireProduction(r.retireOptions),e=>e.outcome==='unknown');assert(fs.existsSync(r.retireFile));assert(fs.existsSync(r.retireFile+'.pending'));
 const before=fs.readFileSync(r.retireFile,'utf8'),result=await retireProduction({...r.retireOptions,resume:true});assert.equal(result.phase,'staging-retired');assert.equal(fs.readFileSync(r.retireFile,'utf8'),before);assert(!fs.existsSync(r.retireFile+'.pending'));
}));
async function interruptProductionDeletion(r){
 await assert.rejects(retireProduction({...r.retireOptions,execute:c=>r.execute(c.replace('\nrm ','\nexit 73\nrm '))}),e=>e.outcome==='unknown');
 assert(fs.existsSync(r.retireFile+'.pending'));
}
test('explicit partial retirement finishes verified subsets across file and directory removal boundaries',linux,async()=>{
 for(const step of ['none','worker','records','files','directories','absent'])await fixture(async f=>{
  const r=await productionRetirementFixture(f);await interruptProductionDeletion(r);
  const root=f.root+'/native',files=[root+'/code/worker',root+'/state/launcher',f.jobs+'/lock',f.jobs+'/.import-manifest',...f.records.map(v=>f.jobs+'/'+v.name)];
  if(step==='worker')fs.unlinkSync(files[0]);if(step==='records')fs.unlinkSync(files[4]);
  if(['files','directories','absent'].includes(step))for(const file of files)fs.unlinkSync(file);
  if(['directories','absent'].includes(step)){fs.rmdirSync(f.jobs);fs.rmdirSync(root+'/state');fs.rmdirSync(root+'/code');}
  if(step==='absent')fs.rmdirSync(root);
  const result=await retireProduction({...r.retireOptions,resume:true,finishPartial:true});assert.equal(result.phase,'staging-retired');assert(!fs.existsSync(root));assert(!fs.existsSync(r.retireFile+'.pending'));
  assert.deepEqual(await retireProduction({...r.retireOptions,resume:true}),result);await assert.rejects(retireProduction({...r.retireOptions,resume:true,finishPartial:true}));
  for(const saved of f.records)assert.deepEqual(fs.readFileSync(r.parent+'/jobs/'+saved.name),saved.bytes);
 });
});
test('partial retirement refuses unexpected files, links, changed bytes, units and absent intents without deleting',linux,async()=>{
 for(const mode of ['extra','bytes','link','directory-link','unit','intent'])await fixture(async f=>{
  const r=await productionRetirementFixture(f);await interruptProductionDeletion(r);
  if(mode==='extra')fs.writeFileSync(f.jobs+'/foreign','new',{mode:0o600});
  if(mode==='bytes')fs.writeFileSync(f.jobs+'/'+f.records[0].name,'changed');
  if(mode==='link'){fs.unlinkSync(f.jobs+'/'+f.records[0].name);fs.symlinkSync('/dev/null',f.jobs+'/'+f.records[0].name);}
  if(mode==='directory-link'){fs.renameSync(f.root+'/native/code',f.root+'/saved-code');fs.symlinkSync(f.root+'/saved-code',f.root+'/native/code');}
  if(mode==='unit')fs.writeFileSync(r.bin+'/systemctl','#!/bin/sh\nif test "$#" -gt 4; then printf "LoadState=loaded\\nActiveState=inactive\\nMainPID=0\\n"; else echo ExecMainStartTimestampMonotonic=999; fi\n');
  if(mode==='intent')fs.unlinkSync(r.retireFile+'.pending');
  await assert.rejects(retireProduction({...r.retireOptions,resume:true,finishPartial:true}));assert(fs.existsSync(f.root+'/native/code/worker'));assert(fs.existsSync(f.root+'/native/state/launcher'));assert(!fs.existsSync(r.retireFile));
 });
});

const {verifyManagedCompletion}=require('../research/autonomous-root/service/managed-completion');
async function completionFixture(fn,committed=false){return require('./retirement-test-state.cjs').withRetirementState(()=>fixture(async f=>{
 f.options.record.token_sha256=hash(Buffer.from('a'.repeat(32)).toString('base64'));
 const r=await productionRetirementFixture(f,committed),dir='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';fs.mkdirSync(path.dirname(dir),{recursive:true,mode:0o700});fs.renameSync(r.options.journalDirectory,dir);
 const options={...r.retireOptions,journalDirectory:dir,selectionFile:dir+'/selection.json'};await retireProduction(options);
 const id='1'.repeat(32),retired={schema:1,id,phase:'complete',device:'s90d',manifest_sha256:f.options.record.manifest_sha256,worker_sha256:sha,launcher_sha256:sha,observer_sha256:sha,boot_id:boot,source:f.options.record.source,unit:'couchroot-retirement-'+id+'.service',directory:'/opt/couchroot-retirement-'+id,scope:'/opt/couchroot-retirement-'+id+'/state',token_file:dir+'/retirement-ABC123/token',token_sha256:sha,port:12346,provider_identity:r.readyOptions.providerIdentity,unit_started_monotonic:'123'};
 fs.writeFileSync(dir+'/'+id+'.retirement.json',JSON.stringify(retired),{mode:0o600});
 const execute=async c=>{
  if(c.includes('--property=Id,')&&c.includes(retired.unit))return {exit_code:0,stdout:'Id='+retired.unit+'\nLoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\nExecMainCode=1\nExecMainStatus=0\nExecMainStartTimestampMonotonic=123\n',stderr:''};
  return r.readyOptions.execute(c.replaceAll('/proc/77/stat',f.root+'/proc/77/stat').replaceAll('/proc/76/stat',f.root+'/proc/76/stat').replaceAll(retired.directory,f.root+'/provider'));
 };
 await fn({f,r,dir,retired,options:{managed:options.managed,retired,journalDirectory:dir,selectionFile:options.selectionFile,execute,confirmManaged:async()=>JSON.parse(JSON.stringify(r.info))}});
}));}
test('managed completion rechecks retired provider, native cleanup and live managed runtime without releasing markers',linux,()=>completionFixture(async f=>{
 const before=fs.readdirSync(f.dir).sort(),result=await verifyManagedCompletion(f.options);assert.equal(result.phase,'verified');assert.equal(result.id,f.options.managed.id);assert.deepEqual(fs.readdirSync(f.dir).sort(),before);
 assert(fs.existsSync(f.dir+'/managed-launch.pending'));assert(fs.existsSync(f.dir+'/managed-restore.pending'));assert.deepEqual(await verifyManagedCompletion(f.options),result);
}));
test('managed completion refuses unresolved provider or changed live evidence',linux,async()=>{
 for(const mode of ['provider-marker','provider-token','provider-unit','native-staging','managed-unit','runtime','identity','resources'])await completionFixture(async f=>{
  const run=f.options.execute;
  if(mode==='provider-marker')fs.writeFileSync(f.dir+'/retirement-launch.pending','unresolved',{mode:0o600});
  if(mode==='provider-token')fs.mkdirSync(path.dirname(f.retired.token_file),{mode:0o700});
  if(mode==='native-staging')fs.mkdirSync(f.f.root+'/native',{mode:0o700});
  if(mode==='runtime')fs.writeFileSync(f.r.runtime,'changed');
  if(mode==='identity')f.options.confirmManaged=async()=>({...f.r.info,worker_id:'0'.repeat(32)});
  if(mode==='resources')f.options.confirmManaged=async()=>({...f.r.info,resources:{...f.r.info.resources,helpers:['a'.repeat(32)]}});
  if(['provider-unit','managed-unit'].includes(mode))f.options.execute=async c=>{const r=await run(c);if(c.includes('--property=Id,')&&c.includes(mode==='provider-unit'?f.retired.unit:f.options.managed.unit))r.stdout=r.stdout.replace('Monotonic=123','Monotonic=999');return r;};
  await assert.rejects(verifyManagedCompletion(f.options));assert(fs.existsSync(f.dir+'/managed-launch.pending'));assert(fs.existsSync(f.dir+'/managed-restore.pending'));
 });
});

const {activateManaged}=require('../research/autonomous-root/service/managed-activation');
function activationTokens(f){
 const bytes=Buffer.from('a'.repeat(32)).toString('base64');
 for(const record of [f.f.options.record,f.options.managed]){fs.mkdirSync(path.dirname(record.token_file),{mode:0o700});fs.writeFileSync(record.token_file,bytes,{mode:0o600});assert.equal(hash(bytes),record.token_sha256);}
 fs.writeFileSync(f.dir+'/state-install.pending',f.f.options.record.id+'\n',{mode:0o600});fs.writeFileSync(f.dir+'/production-launch.pending',f.f.options.record.id+'\n',{mode:0o600});
}
test('managed activation cleans matching local ownership and publishes a bound active receipt',linux,()=>completionFixture(async f=>{
 activationTokens(f);const before=selectionStatus(f.options.selectionFile),result=await activateManaged(f.options);
 assert.equal(result.phase,'active');assert.equal(result.readiness_sha256,hash(JSON.stringify(f.options.managed)));assert.deepEqual(selectionStatus(f.options.selectionFile),before);
 for(const record of [f.f.options.record,f.options.managed])assert(!fs.existsSync(path.dirname(record.token_file)));
 for(const name of ['state-install.pending','production-launch.pending','managed-restore.pending','managed-launch.pending'])assert(!fs.existsSync(f.dir+'/'+name));
 assert.equal(hash(fs.readFileSync(f.dir+'/'+result.id+'.managed-activation.json')),result.receipt_sha256);assert(!fs.existsSync(f.dir+'/'+result.id+'.managed-activation.json.pending'));
 assert(fs.existsSync(f.dir+'/'+result.id+'.managed-restore-input.json'));await assert.rejects(activateManaged(f.options));
}));
test('managed activation refuses unmatched local tokens and unresolved native activation',linux,async()=>{
 for(const mode of ['token','extra','partial','absent'])await completionFixture(async f=>{
  activationTokens(f);
  if(mode==='token')fs.writeFileSync(f.options.managed.token_file,'changed');
  if(mode==='extra')fs.writeFileSync(path.dirname(f.options.managed.token_file)+'/foreign','changed');
  if(mode==='partial')fs.unlinkSync(f.dir+'/state-install.pending');
  if(mode==='absent'){fs.unlinkSync(f.f.options.record.token_file);fs.rmdirSync(path.dirname(f.f.options.record.token_file));fs.unlinkSync(f.dir+'/state-install.pending');fs.unlinkSync(f.dir+'/production-launch.pending');}
  await assert.rejects(activateManaged(f.options));assert(fs.existsSync(f.dir+'/managed-launch.pending'));assert(fs.existsSync(f.options.managed.token_file));assert(!fs.existsSync(f.dir+'/'+f.options.managed.id+'.managed-activation.json'));
 });
});
test('interrupted local activation retains intent and refuses implicit replay',linux,async()=>{
 for(const boundary of ['token','marker','publication','directory','managed-token','final-marker'])await completionFixture(async f=>{
  activationTokens(f);const file=path.resolve(__dirname,'../research/autonomous-root/service/managed-activation.js'),real=require('node:module').createRequire(file),module={exports:{}};let injected=false;
  const fsProxy={...fs,unlinkSync:p=>{fs.unlinkSync(p);if(!injected&&(boundary==='token'&&p===f.f.options.record.token_file||boundary==='marker'&&p===f.dir+'/managed-restore.pending'||boundary==='managed-token'&&p===f.options.managed.token_file||boundary==='final-marker'&&p===f.dir+'/managed-launch.pending')){injected=true;throw Error('lost local cleanup acknowledgement');}},rmdirSync:p=>{fs.rmdirSync(p);if(boundary==='directory'&&!injected){injected=true;throw Error('lost directory acknowledgement');}}};
  require('node:vm').runInNewContext(fs.readFileSync(file,'utf8'),{module,process,require:n=>n==='fs'?fsProxy:n==='./policy'?{...real(n),atomic:(p,v)=>{real(n).atomic(p,v);if(boundary==='publication'){injected=true;throw Error('lost publication acknowledgement');}}}:real(n)});
  await assert.rejects(module.exports.activateManaged(f.options),e=>e.outcome==='unknown');assert(injected);assert(fs.existsSync(f.dir+'/'+f.options.managed.id+'.managed-activation.json.pending'));await assert.rejects(activateManaged(f.options));
  const resumed=await activateManaged({...f.options,resume:true});assert.equal(resumed.phase,'active');assert(!fs.existsSync(f.dir+'/'+resumed.id+'.managed-activation.json.pending'));assert.deepEqual(await activateManaged({...f.options,resume:true}),resumed);
 });
});
test('managed activation accepts previously retired native tokens only with committed activation evidence',linux,()=>completionFixture(async f=>{
 activationTokens(f);const native=f.f.options.record;
 fs.unlinkSync(native.token_file);fs.rmdirSync(path.dirname(native.token_file));fs.unlinkSync(f.dir+'/state-install.pending');fs.unlinkSync(f.dir+'/production-launch.pending');
 fs.writeFileSync(f.dir+'/'+native.id+'.activation.json',JSON.stringify({schema:1,id:native.id,phase:'active',boot_id:native.boot_id,manifest_sha256:native.manifest_sha256,readiness_sha256:hash(JSON.stringify(native)),retirement_sha256:sha,worker_identity:native.worker_identity}),{mode:0o600});
 const file=path.resolve(__dirname,'../research/autonomous-root/service/managed-activation.js'),real=require('node:module').createRequire(file),module={exports:{}};
 require('node:vm').runInNewContext(fs.readFileSync(file,'utf8'),{module,process,require:n=>n==='fs'?{...fs,unlinkSync:p=>{fs.unlinkSync(p);throw Error('interrupted managed token cleanup');}}:real(n)});
 await assert.rejects(module.exports.activateManaged(f.options));
 const result=await activateManaged({...f.options,resume:true});assert.equal(result.phase,'active');assert.equal(result.id,f.options.managed.id);assert.notEqual(result.id,native.id);
 assert.deepEqual(await activateManaged({...f.options,resume:true}),result);
},true));

test('managed activation recovery rejects missing intents, out-of-order cleanup and changed evidence',linux,async()=>{
 for(const mode of ['missing-intent','order','token','extra','intent','runtime','receipt'])await completionFixture(async f=>{
  activationTokens(f);const file=path.resolve(__dirname,'../research/autonomous-root/service/managed-activation.js'),real=require('node:module').createRequire(file),module={exports:{}};
  const fsProxy={...fs,unlinkSync:p=>{fs.unlinkSync(p);throw Error('interrupt first cleanup');}};
  require('node:vm').runInNewContext(fs.readFileSync(file,'utf8'),{module,process,require:n=>n==='fs'?fsProxy:real(n)});
  await assert.rejects(module.exports.activateManaged(f.options));const intent=f.dir+'/'+f.options.managed.id+'.managed-activation.json.pending';
  if(mode==='missing-intent')fs.unlinkSync(intent);
  if(mode==='order')fs.unlinkSync(f.dir+'/managed-launch.pending');
  if(mode==='token')fs.writeFileSync(f.options.managed.token_file,'changed');
  if(mode==='extra')fs.writeFileSync(path.dirname(f.f.options.record.token_file)+'/foreign','foreign');
  if(mode==='intent'){const v=JSON.parse(fs.readFileSync(intent));v.steps[0].path=f.options.managed.token_file;fs.writeFileSync(intent,JSON.stringify(v));}
  if(mode==='runtime')fs.writeFileSync(f.r.runtime,'changed');
  if(mode==='receipt')fs.writeFileSync(f.dir+'/'+f.options.managed.id+'.managed-activation.json','{}',{mode:0o600});
  const before=fs.readdirSync(f.dir).sort();await assert.rejects(activateManaged({...f.options,resume:true}));assert.deepEqual(fs.readdirSync(f.dir).sort(),before);assert(fs.existsSync(f.options.managed.token_file));
 });
});

test('restart snapshot binds the new boot and ignores colliding old process IDs without rewriting records',linux,()=>fixture(async f=>{
 const current='00000000-0000-0000-0000-000000000002';fs.writeFileSync(f.root+'/boot',current+'\n');
 for(const [pid,ticks] of [[42,'100'],[51,'199'],[52,'200']]){fs.mkdirSync(f.root+'/proc/'+pid);fs.writeFileSync(f.root+'/proc/'+pid+'/stat',pid+' (reused) S '+Array(18).fill('0').join(' ')+' '+ticks+' 0\n');}
 staleGuardian(f);const before=fs.readFileSync(f.jobs+'/guardian');
 await assert.rejects(snapshotNativeRestartJobs(f.options));
 const result=await snapshotNativeRestartJobs({...f.options,bootId:current});
 assert.equal(result.snapshot.source.boot_id,boot);assert.deepEqual(fs.readFileSync(f.jobs+'/guardian'),before);
 for(const entry of result.snapshot.records)assert.deepEqual(Buffer.from(entry.base64,'base64'),f.records.find(r=>r.name===entry.name).bytes);
 fs.writeFileSync(f.root+'/boot',boot+'\n');await assert.rejects(snapshotNativeRestartJobs({...f.options,bootId:current}));
}));
