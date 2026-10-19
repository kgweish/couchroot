const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {snapshotManagedJobs}=require('../research/autonomous-root/service/retained-state');
const {installRetainedState,acceptRetainedState,planInstallation,validateSnapshot}=require('../research/autonomous-root/service/retained-install');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection');
const boot='00000000-0000-0000-0000-000000000001',source={boot_id:boot,worker_id:'a'.repeat(32),processes:{worker:{pid:42,start_ticks:'123'},guardian:null}},manifestSha256='b'.repeat(64),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function snapshot(count=2){const records=Array.from({length:count},(_,i)=>{const name=('retained-job-'+String(i).padStart(4,'0')).padEnd(count===64?64:17,'x')+'.json',bytes=Buffer.from(JSON.stringify({id:name.slice(0,-5),boot_id:boot,state:i?'unknown':'completed',pid:0,exit_code:i?null:7}));return {name,size:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};});const body={schema:1,implementation:'managed',source,records};return {...body,sha256:hash(Buffer.from(JSON.stringify(body)))};}
test('installation plan binds snapshot and handles the full retention limit within wire bounds',()=>{
 const value=snapshot(64),plan=planInstallation({snapshot:value,id:'c'.repeat(32),manifestSha256});assert.equal(plan.copies.length,64);
 for(const command of [plan.inspect,plan.begin,plan.commit,plan.discardScratch,...plan.copies]){assert.ok(Buffer.byteLength(command)<=65536);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);}
 assert.match(plan.begin,/\.import-pending/);assert.ok(plan.commit.indexOf('\nsync\n')<plan.commit.indexOf('\nmv '));assert.match(plan.commit,/\.import-manifest\nsync/);
 for(const mutate of [v=>v.sha256='0'.repeat(64),v=>v.records.reverse(),v=>v.records[0].base64='eA==',v=>v.records[0].name='../job.json',v=>v.records.push(v.records[0])]){const copy=structuredClone(value);mutate(copy);assert.throws(()=>validateSnapshot(copy));}
});
const linux={skip:!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0};
async function fixture(fn,count=2){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retained-install-')),journalDirectory=root+'/journal',base=root+'/managed',jobs=base+'/jobs',target=root+'/native';
 for(const p of [journalDirectory,base,jobs,root+'/proc'])fs.mkdirSync(p,{mode:0o700});fs.writeFileSync(root+'/boot',boot+'\n');
 const selectionFile=journalDirectory+'/worker-selection.json',journal=new SelectionJournal(selectionFile);journal.initialize({implementation:'managed',manifest_sha256:'d'.repeat(64)});const state=journal.begin(1,{implementation:'native-prototype',manifest_sha256:manifestSha256},'e'.repeat(64)),id=state.pending.id;
 const expected=snapshot(count);for(const r of expected.records)fs.writeFileSync(jobs+'/'+r.name,Buffer.from(r.base64,'base64'),{mode:0o600});
 const commands=[];const execute=async command=>{commands.push(command);const mapped=command.replaceAll('/opt/couchroot-agent',base).replaceAll('/opt/couchroot-worker-'+id,target).replaceAll('/proc/sys/kernel/random/boot_id',root+'/boot').replaceAll('/proc/42/stat',root+'/proc/42/stat');const r=spawnSync('/bin/sh',[],{input:mapped,encoding:'utf8'});return {exit_code:r.status,stdout:r.stdout,stderr:r.stderr};};
 const options={snapshot:expected,id,manifestSha256,journalDirectory,selectionFile,execute};
 try{await fn({root,jobs,target,options,journal,commands,execute,expected,file:journalDirectory+'/'+id+'.state-install.json',saved:journalDirectory+'/'+id+'.retained-snapshot.json',marker:journalDirectory+'/state-install.pending'});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('install preserves source and destination bytes and retains transition ownership',linux,()=>fixture(async f=>{
 const result=await installRetainedState(f.options);assert.equal(result.phase,'ready');assert.equal(result.scope,'/opt/couchroot-worker-'+f.options.id+'/state');assert.equal(f.journal.read().pending.phase,'prepared');assert.equal(fs.existsSync(f.marker),true);
 for(const r of f.expected.records){const bytes=Buffer.from(r.base64,'base64');assert.deepEqual(fs.readFileSync(f.jobs+'/'+r.name),bytes);assert.deepEqual(fs.readFileSync(f.target+'/state/.jobs/'+r.name),bytes);}
 assert.equal(fs.existsSync(f.target+'/state/.jobs/.import-pending'),false);assert.equal(fs.existsSync(f.target+'/state/.jobs/.import-manifest'),true);
 await assert.rejects(installRetainedState(f.options));const again=await installRetainedState({...f.options,resume:true});assert.equal(again.receipt_sha256,result.receipt_sha256);
}));
test('interrupted copy and lost commit acknowledgement resume only the matching transaction',linux,async()=>{
 for(const mode of ['begin','copy','commit'])await fixture(async f=>{
  let interrupted=false;
  const execute=async command=>{const r=await f.execute(command);const match=mode==='begin'?command.includes('mkdir /opt/couchroot-worker-'):mode==='copy'?command.includes('STATE-RECORD'):command.includes('\nmv ')&&command.includes('.import-manifest\nsync');if(match&&!interrupted){interrupted=true;throw Error('response lost');}return r;};
  await assert.rejects(installRetainedState({...f.options,execute}),e=>e.outcome==='unknown');assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'pending');assert.equal(fs.existsSync(f.marker),true);
  if(mode==='begin')fs.writeFileSync(f.target+'/state/.jobs/.import-record','{partial',{mode:0o600});
  const result=await installRetainedState({...f.options,resume:true});assert.equal(result.phase,'ready');assert.equal(fs.existsSync(f.target+'/state/.jobs/.import-record'),false);
 });
});
test('source drift before commit leaves native startup blocked',linux,()=>fixture(async f=>{
 let changed=false;const execute=async command=>{const r=await f.execute(command);if(!changed&&command.includes('STATE-RECORD')){changed=true;fs.writeFileSync(f.jobs+'/'+f.expected.records[0].name,Buffer.from(f.expected.records[1].base64,'base64'));}return r;};
 await assert.rejects(installRetainedState({...f.options,execute}),e=>e.outcome==='unknown');assert.equal(fs.existsSync(f.target+'/state/.jobs/.import-pending'),true);assert.equal(fs.existsSync(f.target+'/state/.jobs/.import-manifest'),false);
 await assert.rejects(installRetainedState({...f.options,resume:true}));
}));
test('conflicting destination, unknown entries and changed selection refuse progress',linux,async()=>{
 for(const mode of ['conflict','extra','selection'])await fixture(async f=>{
  let stopped=false;await assert.rejects(installRetainedState({...f.options,execute:async command=>{const r=await f.execute(command);if(!stopped&&command.includes('mkdir /opt/couchroot-worker-')){stopped=true;throw Error('stop');}return r;}}));
  if(mode==='conflict')fs.writeFileSync(f.target+'/state/.jobs/'+f.expected.records[0].name,'different',{mode:0o600});
  if(mode==='extra')fs.writeFileSync(f.target+'/state/.jobs/guardian','foreign',{mode:0o600});
  if(mode==='selection')f.journal.advance(2,f.options.id,'rollback-required','f'.repeat(64));
  await assert.rejects(installRetainedState({...f.options,resume:true}));assert.equal(fs.existsSync(f.target+'/state/.jobs/.import-pending'),true);
 });
});

test('all 64 retained records install without reducing the retention contract',linux,()=>fixture(async f=>{
 const result=await installRetainedState(f.options);assert.equal(result.phase,'ready');for(const record of f.expected.records)assert.equal(hash(fs.readFileSync(f.target+'/state/.jobs/'+record.name)),record.sha256);
},64));

test('acceptance verifies durable state and advances only the pending state phase',linux,()=>fixture(async f=>{
 const receipt=await installRetainedState(f.options),options={...f.options,receiptSha256:receipt.receipt_sha256};
 const accepted=await acceptRetainedState(options);assert.equal(accepted.pending.phase,'state-ready');assert.equal(accepted.pending.state_sha256,receipt.receipt_sha256);assert.equal(accepted.selected.implementation,'managed');assert.equal(fs.existsSync(f.marker),true);
 const again=await acceptRetainedState(options);assert.deepEqual(again,accepted);assert.equal(again.revision,3);
}));
test('acceptance refuses changed evidence without advancing selection',linux,async()=>{
 for(const mode of ['receipt','source','destination','marker','journal','snapshot','selection','transport'])await fixture(async f=>{
  const receipt=await installRetainedState(f.options),options={...f.options,receiptSha256:receipt.receipt_sha256};
  if(mode==='receipt')options.receiptSha256='0'.repeat(64);
  if(mode==='source')fs.writeFileSync(f.jobs+'/'+f.expected.records[0].name,'{}');
  if(mode==='destination')fs.writeFileSync(f.target+'/state/.jobs/'+f.expected.records[0].name,'{}');
  if(mode==='marker')fs.writeFileSync(f.marker,'f'.repeat(32)+'\n');
  if(mode==='journal')fs.writeFileSync(f.file,fs.readFileSync(f.file,'utf8').replace('"ready"','"pending"'));
  if(mode==='snapshot')fs.writeFileSync(f.saved,'{}');
  if(mode==='selection')f.journal.advance(2,f.options.id,'rollback-required','f'.repeat(64));
  if(mode==='transport')options.execute=async()=>{throw Error('transport unavailable');};
  await assert.rejects(acceptRetainedState(options));assert.equal(f.journal.read().pending.phase,mode==='selection'?'rollback-required':'prepared');assert.equal(fs.existsSync(f.marker),true);
 });
});
test('acceptance detects local ownership changes across remote awaits',linux,()=>fixture(async f=>{
 const receipt=await installRetainedState(f.options);let changed=false;
 await assert.rejects(acceptRetainedState({...f.options,receiptSha256:receipt.receipt_sha256,execute:async command=>{const r=await f.execute(command);if(!changed){changed=true;fs.writeFileSync(f.marker,'f'.repeat(32)+'\n');}return r;}}));
 assert.equal(f.journal.read().pending.phase,'prepared');
}));

test('accepted state is reverified on repeat and unfinished selection publication blocks work',linux,async()=>{
 for(const mode of ['repeat','writer'])await fixture(async f=>{
  const receipt=await installRetainedState(f.options),options={...f.options,receiptSha256:receipt.receipt_sha256};
  if(mode==='repeat'){
   await acceptRetainedState(options);
   fs.writeFileSync(f.target+'/state/.jobs/'+f.expected.records[0].name,'{}');
  }else fs.writeFileSync(f.options.selectionFile+'.writer','incomplete',{mode:0o600});
  const before=f.commands.length;await assert.rejects(acceptRetainedState(options));
  assert.equal(f.journal.read().revision,mode==='repeat'?3:2);assert.equal(fs.existsSync(f.marker),true);
  if(mode==='writer')assert.equal(f.commands.length,before);
 });
});
