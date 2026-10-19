'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hash}=require('../research/autonomous-root/service/policy');
const {markerId,recoveryCandidate,reconcileBootstrap,validateRecord,recoveryCommand}=require('../research/autonomous-root/service/bootstrap-recovery');
const boot='00000000-0000-0000-0000-000000000001',id='b'.repeat(32),sha='a'.repeat(64);
function fixture(run){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrap-recovery-')),file=directory+'/'+id+'.bootstrap.json',selection=directory+'/worker-selection.json',marker=directory+'/bootstrap-launch.pending';
 fs.writeFileSync(selection,'{"selection":"unchanged"}',{mode:0o600});
 const record={schema:2,id,phase:'submitted',boot_id:boot,directory:'/opt/couchroot-bootstrap-'+id,scope:'/opt/couchroot-bootstrap-'+id+'/state',unit:'couchroot-bootstrap-'+id+'.service',fence:'/opt/couchroot-bootstrap-fence-'+id,file,selection_sha256:hash(fs.readFileSync(selection)),worker_sha256:sha,launcher_sha256:sha,token_sha256:sha};
 const save=()=>fs.writeFileSync(file,JSON.stringify(record),{mode:0o600});save();fs.symlinkSync(id+'.bootstrap.json',marker);
 return Promise.resolve().then(()=>run({directory,file,selection,marker,record,save})).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));}
function info(){return {implementation:'managed',boot_id:boot,uptime_seconds:1,worker_id:'c'.repeat(32),processes:{worker:{pid:21,start_ticks:'10'},guardian:null},app_launcher:{sha256:sha,implementation:'native'},resources:{schema:1,scope:'worker-owned',jobs:[],helpers:[],transfers:[]},capabilities:['file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1','resource-inventory-v1','worker-process-identity-v1']};}
test('recovery binds atomic marker, explicit observed boot, selection bytes and exact scope',()=>fixture(f=>{
 assert.equal(markerId(f.marker),id);assert.deepEqual(recoveryCandidate(f.selection,boot),f.record);
 assert.deepEqual(recoveryCandidate(f.selection,'00000000-0000-0000-0000-000000000002'),f.record);
 for(const bad of [null,'bad',boot+'\n'])assert.throws(()=>recoveryCandidate(f.selection,bad));
 for(const change of [r=>r.schema=1,r=>r.id='d'.repeat(32),r=>r.directory='/opt/foreign',r=>r.fence='/opt/foreign',r=>r.file='/tmp/foreign',r=>r.worker_sha256='bad',r=>r.phase='ready']){const r=structuredClone(f.record);change(r);assert.throws(()=>validateRecord(r,f.directory));}
 fs.writeFileSync(f.selection,'changed');assert.throws(()=>recoveryCandidate(f.selection,boot));
 fs.unlinkSync(f.marker);fs.symlinkSync('../outside',f.marker);assert.throws(()=>markerId(f.marker));
}));
test('legacy intent and malformed receipts remain blocked without executing recovery',()=>fixture(async f=>{
 f.record.schema=1;f.save();let calls=0;await assert.rejects(reconcileBootstrap({selectionFile:f.selection,bootId:boot,executor:{pid:21,status:async()=>info(),execute:async()=>{calls++;}}}));assert.equal(calls,0);
}));
test('lost cleanup reply is reconciled under the same receipt, never replaying launch',()=>fixture(async f=>{
 let calls=0;const executor={pid:21,status:async()=>info(),execute:async command=>{calls++;assert.match(command,/flock -n 9/);assert.match(command,/\/sealed/);assert.doesNotMatch(command,/systemd-run|kill |rm -[rf]/);if(calls===1)throw Error('lost response');return {exit_code:0,timed_out:false,stderr:'',stdout:'BOOTSTRAP-RECONCILED\n'};}};
 await assert.rejects(reconcileBootstrap({selectionFile:f.selection,bootId:boot,executor}));assert.equal(markerId(f.marker),id);assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'submitted');
 const r=await reconcileBootstrap({selectionFile:f.selection,bootId:boot,executor});assert.equal(r.launch_replayed,false);assert(!fs.existsSync(f.marker));assert.equal(JSON.parse(fs.readFileSync(f.file)).phase,'retired');assert.equal(calls,2);
 assert.equal(recoveryCandidate(f.selection,boot),null);
}));
test('changed executor or selection never clears a pending receipt',()=>fixture(async f=>{
 let n=0;const executor={pid:21,status:async()=>{const i=info();if(n++)i.worker_id='d'.repeat(32);return i;},execute:async()=>({exit_code:0,timed_out:false,stderr:'',stdout:'BOOTSTRAP-RECONCILED\n'})};
 await assert.rejects(reconcileBootstrap({selectionFile:f.selection,bootId:boot,executor}));assert.equal(markerId(f.marker),id);
}));
test('cleanup receipt persisted before marker removal can finish after restart',()=>fixture(async f=>{
 f.record.phase='retired';f.record.reconciled=true;f.save();const executor={pid:21,status:async()=>info(),execute:async()=>({exit_code:0,timed_out:false,stderr:'',stdout:'BOOTSTRAP-RECONCILED\n'})};
 await reconcileBootstrap({selectionFile:f.selection,bootId:boot,executor});assert(!fs.existsSync(f.marker));
 assert.equal(require('node:child_process').spawnSync('/bin/sh',['-n'],{input:recoveryCommand(f.record)}).status,0);
}));
test('preparation publishes a complete durable receipt before its exclusive marker',()=>fixture(f=>{
 const vm=require('node:vm'),{createRequire}=require('node:module');
 const source=path.resolve(__dirname,'../research/autonomous-root/service/held-bootstrap.js'),real=createRequire(source),stage='/home/owner/share/tmp/sdk_tools/archive-root-'+id.slice(0,16),bytes=Buffer.from('signed bytes'),staged=new Map();
 fs.unlinkSync(f.marker);fs.unlinkSync(f.file);let published=false;
 const mockfs={...fs,writeFileSync:(p,b,o)=>{if(p.startsWith(stage+'/')){assert(!staged.has(p));staged.set(p,b);}else fs.writeFileSync(p,b,o);},symlinkSync:(target,marker)=>{
  const record=JSON.parse(fs.readFileSync(f.file));assert.equal(record.schema,2);assert.equal(record.selection_sha256,hash(fs.readFileSync(f.selection)));assert.equal(record.file,f.file);assert.equal(target,id+'.bootstrap.json');published=true;fs.symlinkSync(target,marker);
 }};
 const modules={fs:mockfs,'./policy':{...real('./policy'),read:()=>bytes},'./native-candidate':{loadCandidate:()=>({artifacts:{'native-worker':{sha256:hash(bytes)},'native-app-launcher':{sha256:hash(bytes)}}})}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,exports:module.exports,__dirname:path.dirname(source),process,Buffer,setTimeout,require:n=>modules[n]||real(n)});
 const prepared=module.exports.prepareBootstrap({payload:'/signed',device:'qn90a',stage,port:12345,bootId:boot,journalDirectory:f.directory,selectionFile:f.selection});
 assert(published);assert.equal(markerId(f.marker),id);assert.equal(recoveryCandidate(f.selection,boot).id,id);assert.match(prepared.command,/flock -n 9/);
 // A second creator cannot replace the ownership pointer, even after it has
 // staged its own known bytes. The original intent remains authoritative.
 staged.clear();assert.throws(()=>module.exports.prepareBootstrap({payload:'/signed',device:'qn90a',stage,port:12345,bootId:boot,journalDirectory:f.directory,selectionFile:f.selection}),/EEXIST/);assert.equal(markerId(f.marker),id);
}));

test('cross-boot recovery pins the fresh executor and preserves the original receipt boot',()=>fixture(async f=>{
 const current='00000000-0000-0000-0000-000000000002';let calls=0;
 const executor={pid:21,status:async()=>({...info(),boot_id:current}),execute:async command=>{
  calls++;assert.match(command,new RegExp(current));assert.doesNotMatch(command,/systemctl (stop|reset-failed)|systemd-run/);
  if(calls===1)throw Error('lost cleanup response');return {exit_code:0,timed_out:false,stderr:'',stdout:'BOOTSTRAP-RECONCILED\n'};
 }};
 await assert.rejects(reconcileBootstrap({selectionFile:f.selection,bootId:current,executor}));assert.equal(markerId(f.marker),id);assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),f.record);
 const result=await reconcileBootstrap({selectionFile:f.selection,bootId:current,executor});assert.equal(result.launch_replayed,false);assert.equal(calls,2);
 const retired=JSON.parse(fs.readFileSync(f.file));assert.equal(retired.boot_id,boot);assert.equal(retired.reconciled_boot_id,current);assert.equal(retired.phase,'retired');assert(!fs.existsSync(f.marker));
}));
test('wrong executor boot refuses before cross-boot cleanup and leaves the pending marker',()=>fixture(async f=>{
 let calls=0;await assert.rejects(reconcileBootstrap({selectionFile:f.selection,bootId:'00000000-0000-0000-0000-000000000002',executor:{pid:21,status:async()=>info(),execute:async()=>{calls++;}}}));
 assert.equal(calls,0);assert.equal(markerId(f.marker),id);assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),f.record);
}));
