'use strict';
// A submitted, sealed launch attempt can own pre-readiness checkpoints even
// though its new worker identity was never published as a ready runtime.
const {hash}=require('./policy');
const {bootGuard,processAbsenceGuard}=require('./worker-processes');
const ID=/^[a-f0-9]{32}$/,SHA=/^[a-f0-9]{64}$/;
const phases=['namespace','runtime-reserved','runtime','freezer-reserved','contained','ready'];
function check(v){if(!v)throw Error('Interrupted native startup binding unavailable');}
function eligible(attempt,record){
 if(!attempt)return false;
 try{bootGuard(attempt.boot_id);}catch(_){return false;}
 return !!(attempt.phase==='submitted'&&attempt.origin_id===record.id&&((attempt.schema===2&&attempt.boot_id===record.boot_id)||(attempt.schema===3&&attempt.source_boot_id===record.boot_id))&&ID.test(attempt.id)&&SHA.test(attempt.token_sha256)&&attempt.fence==='/opt/couchroot-startup-fence-'+attempt.id&&attempt.source_worker_id===record.worker_identity.worker_id);
}
function validate(j,attempt,record){
 check(j&&j.schema===4&&phases.includes(j.phase)&&j.prepared===(j.phase==='ready')&&j.startup_token_sha256===attempt.token_sha256&&j.boot_id===attempt.boot_id&&ID.test(j.worker_id)&&j.worker_id!==record.worker_identity.worker_id&&Number.isInteger(j.pid)&&j.pid>1&&j.pid<=2147483647&&typeof j.process_start==='string'&&/^[1-9][0-9]{0,19}$/.test(j.process_start));
 return j;
}
async function inspectStartupJournal({attempt,record,execute,bootId=record.boot_id},plan){
 check(eligible(attempt,record));
 const files=[],absent=[],contents=new Map();
 for(const name of ['guardian','guardian.initial','guardian.next']){
  const file=plan.root+'/'+name,command=plan.binding+'if test -e '+file+' || test -L '+file+'; then\n'+plan.fileGuard(file)+'size=$(stat -c %s '+file+'); test "$size" -ge 0; test "$size" -lt 4096\nbase64 '+file+'\nelse printf "ABSENT\\n"; fi\n'+plan.guard;
  const r=await execute(command,5000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string'&&r.stdout.length<6000);
  if(r.stdout==='ABSENT\n'){absent.push(name);continue;}
  const compact=r.stdout.replace(/\n/g,''),bytes=Buffer.from(compact,'base64');check(bytes.toString('base64')===compact);
  contents.set(name,bytes);files.push({name,size:bytes.length,sha256:hash(bytes)});
 }
 if(contents.has('guardian.initial')){
  check(!contents.has('guardian')&&!contents.has('guardian.next'));
  // This initial file cannot have published an identity or created a runtime.
  // The original launch's sealed fence and source binding are the authority;
  // never derive an owner from partial bytes. Native verifies it under its lock.
  return {files,absent,guard:'',owner:null,initial:true};
 }
 if(!files.length)return null;
 check(contents.has('guardian'));
 const base=validate(JSON.parse(contents.get('guardian').toString('utf8')),attempt,record);
 if(contents.has('guardian.next')){
  let next;try{next=JSON.parse(contents.get('guardian.next').toString('utf8'));}catch(e){check(e instanceof SyntaxError&&base.phase!=='ready');}
  if(next!==undefined){
   validate(next,attempt,record);check(phases.indexOf(next.phase)===phases.indexOf(base.phase)+1&&next.worker_id===base.worker_id&&next.pid===base.pid&&next.process_start===base.process_start);
   // Native checks every inode/namespace reservation before any cleanup. This
   // service admission checks identity and phase, then pins both exact files.
  }
 }
 const guard=processAbsenceGuard({pid:base.pid,start_ticks:base.process_start},base.boot_id,bootId);
 return {files,absent,guard,owner:base.worker_id,initial:false};
}
function checkpointGuard(root,checkpoint){
 if(!checkpoint)return '';
 return checkpoint.files.map(e=>{check(['guardian','guardian.initial','guardian.next'].includes(e.name)&&SHA.test(e.sha256)&&Number.isInteger(e.size)&&e.size>=0&&e.size<4096);const p=root+'/'+e.name;return 'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a:%s" '+p+')" = 0:1:600:'+e.size+'\ntest "$(sha256sum '+p+' | cut -d " " -f1)" = '+e.sha256+'\n';}).join('')+
  checkpoint.absent.map(name=>{check(['guardian','guardian.initial','guardian.next'].includes(name));return 'test ! -e '+root+'/'+name+'; test ! -L '+root+'/'+name+'\n';}).join('');
}
module.exports={eligible,inspectStartupJournal,checkpointGuard};
