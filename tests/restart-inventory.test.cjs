'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SelectionJournal}=require('../research/autonomous-root/service/worker-selection'),{inventoryRestart,providerId}=require('../research/autonomous-root/service/restart-inventory');
const managed={implementation:'managed',manifest_sha256:'a'.repeat(64)},native={implementation:'native-prototype',manifest_sha256:'b'.repeat(64)},d=c=>c.repeat(64);
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restart-inventory-'));fs.chmodSync(dir,0o700);const file=dir+'/worker-selection.json',journal=new SelectionJournal(file);journal.initialize(managed);
 const write=(name,value)=>fs.writeFileSync(dir+'/'+name,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
 const listing=()=>fs.readdirSync(dir).sort().map(n=>[n,fs.readFileSync(dir+'/'+n,'utf8')]);
 try{return fn({dir,file,journal,write,listing,state:()=>{const before=listing(),r=inventoryRestart(file);assert.deepEqual(listing(),before,'inventory must be read-only');return r;}});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const statuses=r=>Object.fromEntries(r.mutations.map(m=>[m.name,m.status]));
test('settled managed selection needs no reconciliation',()=>fixture(f=>{
 const r=f.state();assert.equal(r.action,'none');assert.equal(r.boundary,'settled');assert.deepEqual(r.mutations,[]);
}));
test('forward transition distinguishes not-submitted, unknown and verified steps at every durable boundary',()=>fixture(f=>{
 const id=f.journal.begin(1,native,d('c')).pending.id,obs=providerId(id);
 let r=f.state();assert.equal(r.direction,'to-native');assert.equal(r.boundary,'provider-launch');assert.equal(statuses(r)['provider-launch'],'not-submitted');assert.equal(r.action,'pending-reconciliation');assert.match(r.diagnostics.join('\n'),/no unknown submission; next unsubmitted step: provider-launch/);
 f.write('retirement-launch.pending',obs+'\n');r=f.state();assert.equal(statuses(r)['provider-launch'],'submitted-unknown');assert.match(r.diagnostics.join('\n'),/unknown outcome: provider-launch/);
 f.write(obs+'.retirement.json',{phase:'submitting'});assert.equal(statuses(f.state())['provider-launch'],'submitted-unknown');
 f.write(obs+'.retirement.json',{phase:'ready'});r=f.state();assert.equal(statuses(r)['provider-launch'],'verified-complete');assert.equal(statuses(r)['source-stop'],'submitted-unknown');
 f.write(id+'.retained-snapshot.json',{schema:1});f.write('state-install.pending',id);r=f.state();assert.equal(statuses(r)['source-stop'],'verified-complete');assert.equal(statuses(r)['state-install'],'submitted-unknown');
 f.write(id+'.state-install.json',{phase:'ready'});assert.equal(statuses(f.state())['state-install'],'submitted-unknown','a ready receipt is not acceptance');
 f.journal.advance(2,id,'state-ready',d('d'));r=f.state();assert.equal(statuses(r)['state-install'],'verified-complete');assert.equal(statuses(r)['production-launch'],'not-submitted');
 f.write('production-launch.pending',id);f.write(id+'.production.json',{phase:'submitted'});f.write(id+'.production.json.readiness.pending','x');r=f.state();assert.equal(statuses(r)['production-launch'],'submitted-unknown');assert(r.mutations.find(m=>m.name==='production-launch').evidence.some(e=>e.endsWith('readiness.pending')));
 f.journal.advance(3,id,'trial-ready',d('e'));r=f.state();assert.equal(statuses(r)['production-launch'],'verified-complete');assert.equal(r.boundary,'native-commit');
 f.journal.commit(4,id);r=f.state();assert(['provider-launch','source-stop','state-install','production-launch','native-commit'].every(n=>statuses(r)[n]==='verified-complete'));assert.equal(statuses(r)['provider-retirement'],'not-submitted');assert.equal(statuses(r)['native-activation'],'not-submitted');assert.equal(r.boundary,'provider-retirement');assert.equal(r.action,'pending-reconciliation');assert.match(r.diagnostics.join('\n'),/native selected without verified activation/);assert.match(r.diagnostics.join('\n'),/ownership marker present: production-launch.pending/);
 f.write(obs+'.retirement.json.shutdown.pending','x');assert.equal(statuses(f.state())['provider-retirement'],'submitted-unknown');fs.unlinkSync(f.dir+'/'+obs+'.retirement.json.shutdown.pending');
 f.write(obs+'.retirement.json',{phase:'complete'});f.write(id+'.activation.json.pending','x');r=f.state();assert.equal(statuses(r)['provider-retirement'],'verified-complete');assert.equal(statuses(r)['native-activation'],'submitted-unknown');assert.equal(r.action,'pending-reconciliation');
 f.write(id+'.activation.json',{phase:'active'});assert.equal(statuses(f.state())['native-activation'],'submitted-unknown','a published receipt with its intent is not finished');
 for(const n of [id+'.activation.json.pending','production-launch.pending','state-install.pending','retirement-launch.pending'])fs.rmSync(f.dir+'/'+n,{force:true});
 r=f.state();assert(Object.values(statuses(r)).every(s=>s==='verified-complete'));assert.equal(r.boundary,'native-active');assert.equal(r.action,'none');assert.match(r.diagnostics.join('\n'),/held authenticated bootstrap/);
}));
test('return transition classifies native stop, restoration, managed launch, retirement and activation',()=>fixture(f=>{
 const origin=f.journal.begin(1,native,d('c')).pending.id;f.journal.advance(2,origin,'state-ready',d('d'));f.journal.advance(3,origin,'trial-ready',d('e'));f.journal.commit(4,origin);
 f.write(providerId(origin)+'.retirement.json',{phase:'ready'});f.write(origin+'.retained-snapshot.json',{});
 const id=f.journal.begin(5,managed,d('f')).pending.id;let r=f.state();assert.equal(r.direction,'to-managed');assert.equal(r.origin_id,origin);assert.equal(r.boundary,'native-stop');assert.equal(statuses(r)['native-stop'],'not-submitted');
 f.write(id+'.native-stop.json',{phase:'submitting'});r=f.state();assert.equal(statuses(r)['native-stop'],'submitted-unknown');assert.match(r.diagnostics.join('\n'),/native-stop; verify through an independent executor/);
 f.write(id+'.native-stop.json',{phase:'stopped'});f.write('managed-restore.pending',id);r=f.state();assert.equal(statuses(r)['native-stop'],'verified-complete');assert.equal(statuses(r)['managed-restore'],'submitted-unknown');
 f.write(id+'.managed-restore.json',{phase:'restored'});f.journal.advance(6,id,'state-ready',d('9'));r=f.state();assert.equal(statuses(r)['managed-restore'],'verified-complete');assert.equal(statuses(r)['managed-launch'],'not-submitted');
 f.write('managed-launch.pending',id);f.write(id+'.managed-launch.json',{phase:'unknown'});assert.equal(statuses(f.state())['managed-launch'],'submitted-unknown');
 f.journal.advance(7,id,'trial-ready',d('8'));f.journal.commit(8,id);r=f.state();assert.equal(statuses(r)['managed-commit'],'verified-complete');assert.equal(r.boundary,'native-retirement');
 // After commit the pending record is gone; the inventory still follows the last return.
 assert.equal(r.direction,'to-managed');assert.equal(r.transaction_id,id);assert.equal(r.origin_id,origin);
 for(const n of ['managed-restore.pending','managed-launch.pending'])fs.unlinkSync(f.dir+'/'+n);
 f.write(origin+'.production-retirement.json',{phase:'staging-retired'});f.write(providerId(origin)+'.retirement.json',{phase:'complete'});f.write(id+'.managed-activation.json',{phase:'active'});
 r=f.state();assert.equal(r.action,'none');assert.equal(r.boundary,'settled');assert.deepEqual(r.mutations,[]);
}));
test('committed return is inventoried through its activation evidence and never reports success without receipts',()=>fixture(f=>{
 const origin=f.journal.begin(1,native,d('c')).pending.id;f.journal.advance(2,origin,'state-ready',d('d'));f.journal.advance(3,origin,'trial-ready',d('e'));f.journal.commit(4,origin);
 const id=f.journal.begin(5,managed,d('f')).pending.id;f.write(id+'.native-stop.json',{phase:'stopped'});f.write(id+'.managed-restore.json',{phase:'restored'});f.journal.advance(6,id,'state-ready',d('9'));f.journal.advance(7,id,'trial-ready',d('8'));
 let r=f.state();assert.equal(statuses(r)['native-retirement'],'not-submitted');
 f.write(origin+'.production-retirement.json',{phase:'submitted'});f.write(origin+'.production-retirement.json.pending','x');r=f.state();assert.equal(statuses(r)['native-retirement'],'submitted-unknown');
 f.write(origin+'.production-retirement.json',{phase:'staging-retired'});f.write(providerId(origin)+'.retirement.json',{phase:'complete'});f.write(id+'.managed-activation.json',{phase:'active'});r=f.state();
 assert.equal(statuses(r)['native-retirement'],'verified-complete');assert.equal(statuses(r)['provider-retirement'],'verified-complete');assert.equal(statuses(r)['managed-activation'],'verified-complete');assert.equal(r.boundary,'managed-commit');
}));
test('return from an activated native tracks its own provider from launch to retirement',()=>fixture(f=>{
 const origin=f.journal.begin(1,native,d('c')).pending.id;f.journal.advance(2,origin,'state-ready',d('d'));f.journal.advance(3,origin,'trial-ready',d('e'));f.journal.commit(4,origin);
 f.write(providerId(origin)+'.retirement.json',{phase:'complete'});f.write(origin+'.retained-snapshot.json',{});f.write(origin+'.activation.json',{phase:'active'});
 assert.equal(f.state().boundary,'native-active');
 const id=f.journal.begin(5,managed,d('f')).pending.id,obs=providerId(id);let r=f.state();assert.equal(r.direction,'to-managed');assert.equal(statuses(r)['return-provider-launch'],'not-submitted');assert.equal(r.boundary,'return-provider-launch');
 f.write('retirement-launch.pending',obs+'\n');r=f.state();assert.equal(statuses(r)['return-provider-launch'],'submitted-unknown');assert.equal(r.action,'pending-reconciliation');
 f.write(obs+'.retirement.json',{phase:'ready'});fs.unlinkSync(f.dir+'/retirement-launch.pending');r=f.state();assert.equal(statuses(r)['return-provider-launch'],'verified-complete');assert.equal(r.boundary,'native-stop');assert.equal(statuses(r)['provider-retirement'],'not-submitted','the activated origin provider does not stand in for the return provider');
 f.write(id+'.native-stop.json',{phase:'stopped'});f.write(id+'.managed-restore.json',{phase:'restored'});f.journal.advance(6,id,'state-ready',d('9'));f.journal.advance(7,id,'trial-ready',d('8'));f.journal.commit(8,id);
 f.write(origin+'.production-retirement.json',{phase:'staging-retired'});f.write(obs+'.retirement.json',{phase:'complete'});f.write(id+'.managed-activation.json',{phase:'active'});r=f.state();
 assert(Object.values(statuses(r)).every(s=>s==='verified-complete'),JSON.stringify(r.mutations));assert.equal(r.action,'none');assert.equal(r.boundary,'settled');
}));
test('malformed records, writer markers and invalid journals stay pending with diagnostics and are never repaired',()=>fixture(f=>{
 const id=f.journal.begin(1,native,d('c')).pending.id;f.write(providerId(id)+'.retirement.json','{not json');let r=f.state();assert.equal(statuses(r)['provider-launch'],'submitted-unknown');assert.match(r.diagnostics.join('\n'),/retirement.json invalid/);
 f.write('worker-selection.json.writer','w');r=f.state();assert.equal(r.selection_phase,'inspection-required');assert.equal(r.action,'pending-reconciliation');assert.match(r.diagnostics.join('\n'),/selection journal requires inspection/);
 fs.unlinkSync(f.dir+'/worker-selection.json.writer');f.write('worker-selection.json','{}');r=f.state();assert.equal(r.selection_phase,'inspection-required');assert.equal(r.transaction_id,null);assert.equal(r.action,'pending-reconciliation');
 f.write('managed-launch.pending','x');assert(f.state().markers.includes('managed-launch.pending'));
 assert(f.state().diagnostics.length<=12&&f.state().diagnostics.every(x=>x.length<=200));
}));
const {abandonUnsubmitted}=require('../research/autonomous-root/service/restart-inventory');
test('startup abandonment requires proof that nothing remote was submitted and is idempotent',()=>fixture(f=>{
 const id=f.journal.begin(1,native,d('c')).pending.id;
 const r=abandonUnsubmitted(f.file);assert.equal(r.abandoned,true);assert.equal(r.transaction_id,id);
 const s=f.journal.read();assert.equal(s.pending,null);assert.equal(s.selected.implementation,'managed');assert.deepEqual([s.history.at(-1).id,s.history.at(-1).outcome,s.history.at(-1).state_sha256],[id,'abandoned',null]);
 assert.equal(r.inventory.action,'none');assert.equal(abandonUnsubmitted(f.file).abandoned,false);assert.equal(f.journal.read().revision,s.revision);
 // A later trial can begin normally after an abandoned entry.
 assert.equal(f.journal.begin(s.revision,native,d('d')).pending.phase,'prepared');
}));
test('any evidence of submission, later phase or return direction refuses abandonment without changing the journal',()=>{
 const cases={
  marker:(f,id)=>f.write('retirement-launch.pending',providerId(id)),
  provider:(f,id)=>f.write(providerId(id)+'.retirement.json',{phase:'submitting'}),
  'token-named':(f,id)=>f.write(id+'.anything','x'),
  'state-ready':(f,id)=>f.journal.advance(2,id,'state-ready',d('d')),
  writer:f=>f.write('worker-selection.json.writer','w'),
  'unrelated-marker':f=>f.write('managed-launch.pending','x')
 };
 for(const [name,apply] of Object.entries(cases))fixture(f=>{
  const id=f.journal.begin(1,native,d('c')).pending.id;apply(f,id);const before=f.listing();
  assert.equal(abandonUnsubmitted(f.file).abandoned,false,name);assert.deepEqual(f.listing(),before,name);
 });
 fixture(f=>{
  const origin=f.journal.begin(1,native,d('c')).pending.id;f.journal.advance(2,origin,'state-ready',d('d'));f.journal.advance(3,origin,'trial-ready',d('e'));f.journal.commit(4,origin);
  f.journal.begin(5,managed,d('f'));const before=f.listing();assert.equal(abandonUnsubmitted(f.file).abandoned,false);assert.deepEqual(f.listing(),before);
 });
});
test('journal validation accepts abandonment only without state or readiness evidence',()=>fixture(f=>{
 const {validate}=require('../research/autonomous-root/service/worker-selection');
 const id=f.journal.begin(1,native,d('c')).pending.id;f.journal.advance(2,id,'state-ready',d('d'));assert.throws(()=>f.journal.abandon(3,id));
 const s=f.journal.read(),entry={id,from:managed,to:native,quiescence_sha256:d('c'),state_sha256:d('d'),readiness_sha256:null,outcome:'abandoned'};
 assert.throws(()=>validate({...s,pending:null,history:[entry]}));assert.doesNotThrow(()=>validate({...s,pending:null,history:[{...entry,state_sha256:null}]}));
 assert.throws(()=>validate({...s,pending:null,history:[{...entry,state_sha256:null,outcome:'committed'}]}));
}));

test('an uncertain bootstrap prevents settled inventory and abandonment without replay',()=>fixture(f=>{
 const id='e'.repeat(32);f.write('bootstrap-launch.pending',id+'\n');const r=f.state();assert.equal(r.action,'pending-reconciliation');assert(r.markers.includes('bootstrap-launch.pending'));
 const {abandonUnsubmitted}=require('../research/autonomous-root/service/restart-inventory');f.journal.begin(1,native,d('c'));const before=f.listing();assert.equal(abandonUnsubmitted(f.file).abandoned,false);assert.deepEqual(f.listing(),before);
}));
