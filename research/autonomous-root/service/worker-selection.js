'use strict';
// Selection metadata only. This journal never stops, starts or migrates a worker.
// Its caller must establish single ownership and verify the referenced evidence.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {atomic,hash,read}=require('./policy');
const HEX=/^[a-f0-9]{64}$/;
function check(ok){if(!ok)throw Error('Invalid worker selection journal');}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function exact(v,keys){return object(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');}
function version(v){return exact(v,['implementation','manifest_sha256'])&&['managed','native-prototype'].includes(v.implementation)&&typeof v.manifest_sha256==='string'&&HEX.test(v.manifest_sha256);}
function same(a,b){return a.implementation===b.implementation&&a.manifest_sha256===b.manifest_sha256;}
function validate(s){
 check(exact(s,['schema','revision','selected','last_known_good','pending','history']));
 check(s.schema===1&&Number.isSafeInteger(s.revision)&&s.revision>=1&&version(s.selected)&&version(s.last_known_good));
 check(Array.isArray(s.history)&&s.history.length<=32&&s.history.every(h=>exact(h,['id','from','to','quiescence_sha256','state_sha256','readiness_sha256','outcome'])&&typeof h.id==='string'&&/^[a-f0-9]{32}$/.test(h.id)&&version(h.from)&&version(h.to)&&!same(h.from,h.to)&&['committed','rolled-back','abandoned'].includes(h.outcome)&&typeof h.quiescence_sha256==='string'&&HEX.test(h.quiescence_sha256)&&['state_sha256','readiness_sha256'].every(k=>h.outcome==='abandoned'?h[k]===null:typeof h[k]==='string'&&HEX.test(h[k]))));
 check(new Set(s.history.map(h=>h.id)).size===s.history.length);
 let prior=null;
 for(const h of s.history){if(prior)check(same(h.from,prior));prior=h.outcome==='committed'?h.to:h.from;}
 if(prior)check(same(s.selected,prior));
 check(same(s.selected,s.last_known_good));
 if(s.pending!==null){
  const p=s.pending;check(exact(p,['id','phase','from','to','quiescence_sha256','state_sha256','readiness_sha256']));
  check(typeof p.id==='string'&&/^[a-f0-9]{32}$/.test(p.id)&&!s.history.some(h=>h.id===p.id)&&['prepared','state-ready','trial-ready','rollback-required','rollback-state-ready'].includes(p.phase)&&version(p.from)&&version(p.to)&&!same(p.from,p.to)&&same(s.selected,p.from)&&same(s.last_known_good,p.from));
  check(typeof p.quiescence_sha256==='string'&&HEX.test(p.quiescence_sha256));
  for(const name of ['state_sha256','readiness_sha256'])check(p[name]===null||(typeof p[name]==='string'&&HEX.test(p[name])));
  if(['state-ready','trial-ready','rollback-state-ready'].includes(p.phase))check(p.state_sha256!==null);
  if(p.phase==='trial-ready')check(p.readiness_sha256!==null);
 }
 return s;
}
function readState(file){
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 try{const st=fs.fstatSync(fd);check(st.isFile()&&st.size>0&&st.size<=65536&&st.nlink===1&&!(st.mode&0o077)&&st.uid===process.geteuid());
  const bytes=Buffer.alloc(st.size+1);let at=0;while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,null);if(!n)break;at+=n;}check(at===st.size&&fs.fstatSync(fd).size===st.size);
  return validate(JSON.parse(bytes.subarray(0,at)));
 }finally{fs.closeSync(fd);}
}
function parentCheck(file){const parent=path.dirname(file),st=fs.lstatSync(parent);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&!(st.mode&0o077));}
class SelectionJournal {
 constructor(file){this.file=path.resolve(file);this.failed=false;}
 read(){return readState(this.file);}
 // Single writer: each change holds an exclusive intent file. A crash leaves it
 // for inspection; no PID or elapsed-time heuristic removes another writer's lock.
 change(revision,transform){
  check(!this.failed);parentCheck(this.file);let lock;
  try{lock=fs.openSync(this.file+'.writer',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}catch(e){throw Error('Worker selection writer requires inspection');}
  let publishing=false;
  try{
   fs.writeFileSync(lock,crypto.randomBytes(32));fs.fsyncSync(lock);
   const current=this.read();check((current?current.revision:0)===revision);
   const next=transform(current);next.revision=revision+1;validate(next);
   publishing=true;atomic(this.file,next);return next;
  }catch(e){this.failed=publishing;throw e;}
  finally{
   fs.closeSync(lock);
   // A failed publication can be durable despite throwing. Retain the writer
   // marker so neither a fresh process nor a retry assumes the old state won.
   if(!this.failed){try{fs.unlinkSync(this.file+'.writer');const d=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}catch(e){this.failed=true;throw e;}}
  }
 }
 initialize(managed){check(version(managed)&&managed.implementation==='managed');return this.change(0,()=>({schema:1,selected:managed,last_known_good:managed,pending:null,history:[]}));}
 begin(revision,target,quiescence){check(version(target)&&typeof quiescence==='string'&&HEX.test(quiescence));return this.change(revision,s=>{check(s&&s.pending===null&&!same(s.selected,target));return {...s,pending:{id:crypto.randomBytes(16).toString('hex'),phase:'prepared',from:s.selected,to:target,quiescence_sha256:quiescence,state_sha256:null,readiness_sha256:null}};});}
 advance(revision,id,phase,evidence){check(typeof evidence==='string'&&HEX.test(evidence));return this.change(revision,s=>{
  check(s&&s.pending&&s.pending.id===id);const p=s.pending;
  if(phase==='state-ready'){check(p.phase==='prepared');p.state_sha256=evidence;}
  else if(phase==='trial-ready'){check(p.phase==='state-ready');p.readiness_sha256=evidence;}
  else if(phase==='rollback-required'){check(['prepared','state-ready','trial-ready'].includes(p.phase));p.quiescence_sha256=evidence;p.state_sha256=null;p.readiness_sha256=null;}
  else if(phase==='rollback-state-ready'){check(p.phase==='rollback-required');p.state_sha256=evidence;}
  else throw Error('Invalid worker selection phase');
  p.phase=phase;return s;
 });}
 // Only a prepared transition with no state or readiness evidence may be abandoned.
 // The caller must independently prove that no remote mutation was submitted.
 abandon(revision,id){return this.change(revision,s=>{check(s&&s.pending&&s.pending.id===id&&s.pending.phase==='prepared'&&s.pending.state_sha256===null&&s.pending.readiness_sha256===null);const {phase,...receipt}=s.pending;return {...s,pending:null,history:s.history.concat({...receipt,outcome:'abandoned'}).slice(-32)};});}
 // Rebind an uncommitted ready trial only after independent restart recovery
 // proves the old executor absent. Its original launch receipt remains on disk.
 rebindTrial(revision,id,previous,readiness){check(HEX.test(previous)&&HEX.test(readiness));return this.change(revision,s=>{check(s&&s.pending&&s.pending.id===id&&s.pending.phase==='trial-ready'&&s.pending.readiness_sha256===previous);s.pending.readiness_sha256=readiness;return s;});}
 commit(revision,id){return this.change(revision,s=>{check(s&&s.pending&&s.pending.id===id&&s.pending.phase==='trial-ready');const {phase,...receipt}=s.pending;return {...s,selected:s.pending.to,last_known_good:s.pending.to,pending:null,history:s.history.concat({...receipt,outcome:'committed'}).slice(-32)};});}
 commitRollback(revision,id,readiness){check(typeof readiness==='string'&&HEX.test(readiness));return this.change(revision,s=>{check(s&&s.pending&&s.pending.id===id&&s.pending.phase==='rollback-state-ready');const {phase,...receipt}=s.pending;receipt.readiness_sha256=readiness;return {...s,selected:s.pending.from,last_known_good:s.pending.from,pending:null,history:s.history.concat({...receipt,outcome:'rolled-back'}).slice(-32)};});}
}
function selectionStatus(file){
 try{
  let writer=false;try{fs.lstatSync(file+'.writer');writer=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(writer)return {phase:'inspection-required',launch_allowed:false,reason:'selection-writer-incomplete'};
  const state=readState(file);
  if(!state)return {phase:'legacy-managed',selected_implementation:'managed',launch_allowed:true};
  return {phase:state.pending?'reconciliation-required':'stable',revision:state.revision,selected_implementation:state.selected.implementation,selected_manifest_sha256:state.selected.manifest_sha256,last_known_good:state.last_known_good,pending:state.pending,history:state.history,reason:!state.pending&&state.selected.implementation!=='managed'?'native-runtime-verification-required':undefined,launch_allowed:!state.pending&&state.selected.implementation==='managed'};
 }catch(_){return {phase:'inspection-required',launch_allowed:false,reason:'selection-record-invalid'};}
}
function managedVersion(payload){
 const manifest=JSON.parse(read(path.join(payload,'manifest.json'))),files=[];
 for(const name of ['SamsungTvArchiveRoot','SamsungTvRootAgent'])for(const suffix of ['dll','runtimeconfig.json','deps.json']){
  const file=name+'.'+suffix,digest=hash(read(path.join(payload,file),4*1024*1024));
  check(typeof manifest[file]==='string'&&HEX.test(manifest[file])&&digest===manifest[file]);files.push([file,digest]);
 }
 return hash(JSON.stringify(files));
}
module.exports={SelectionJournal,selectionStatus,validate,managedVersion};
