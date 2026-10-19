'use strict';
// Read a stopped managed worker's retained records through an independent
// executor. No record is rewritten and no job is started, signalled or replayed.
const crypto=require('crypto');
const {processIdentities,processAbsenceGuard}=require('./worker-processes');
const ROOT='/opt/couchroot-agent/jobs';
const ID=/^[A-Za-z0-9-]{16,64}$/;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function check(ok){if(!ok)throw Error('Retained job snapshot unavailable');}
function uniqueJson(bytes){
 let text=bytes.toString('utf8');check(Buffer.from(text).equals(bytes));if(text.charCodeAt(0)===0xfeff)text=text.slice(1);const value=JSON.parse(text),stack=[];
 // JSON.parse validates syntax; this pass rejects duplicate decoded keys at
 // every object depth, including differently escaped spellings of one key.
 for(let at=0;at<text.length;at++){
  const c=text[at];
  if(c==='{'||c==='[')stack.push(c==='{'?new Set():null);
  else if(c==='}'||c===']')stack.pop();
  else if(c==='"'){
   const start=at++;for(;at<text.length;at++){if(text[at]==='\\'){at++;continue;}if(text[at]==='"')break;}
   let next=at+1;while(/\s/.test(text[next]||'x'))next++;
   if(text[next]===':'){const keys=stack[stack.length-1],key=JSON.parse(text.slice(start,at+1));check(keys&&!keys.has(key));keys.add(key);if(stack.length===1&&['pid','exit_code'].includes(key)){const token=text.slice(next+1).trimStart().match(/^[^,}\]\s]+/);check(token&&/^(?:null|-?(?:0|[1-9][0-9]*))$/.test(token[0]));}}
  }
 }
 return value;
}
function validateRecord(name,bytes){
 check(typeof name==='string'&&name.endsWith('.json')&&ID.test(name.slice(0,-5))&&name.slice(0,-5).trim()===name.slice(0,-5)&&Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<2048&&!bytes.includes(0));
 const record=uniqueJson(bytes);check(record&&typeof record==='object'&&!Array.isArray(record)&&record.id===name.slice(0,-5));
 check(['starting','running','cancelling','unknown','completed','timed_out','cancelled','interrupted'].includes(record.state));
 check(typeof record.boot_id==='string'&&record.boot_id.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.boot_id));
 for(const key of ['pid','exit_code'])if(record[key]!==undefined&&record[key]!==null)check(Number.isInteger(record[key])&&record[key]>=-2147483648&&record[key]<=2147483647);
 check(record.pid===undefined||record.pid===null||record.pid>=0);
 check(record.process_start===undefined||record.process_start===null||typeof record.process_start==='string');
 return record;
}
function guard(source,bootId){
 check(source&&source.processes&&source.processes.worker&&source.processes.guardian===null&&typeof source.boot_id==='string'&&source.boot_id.length===36&&typeof source.worker_id==='string'&&source.worker_id.length===32);
 const normalized=processIdentities({...source,capabilities:['worker-process-identity-v1']},source.processes.worker.pid);check(JSON.stringify(normalized)===JSON.stringify(source)&&source.processes.worker.pid>1);
 const p=source.processes.worker;
 return processAbsenceGuard(p,source.boot_id,bootId===undefined?source.boot_id:bootId);
}
function prefix(source){return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\n'+guard(source)+
 'for p in /opt /opt/couchroot-agent '+ROOT+'; do test ! -L "$p"; if test -e "$p"; then test -d "$p"; fi; done\n';}
function fileGuard(file){return 'test -f '+file+'; test ! -L '+file+'\ntest "$(stat -c "%u:%h:%a" '+file+')" = 0:1:600\nsize=$(stat -c %s '+file+'); test "$size" -ge 1; test "$size" -lt 2048\n';}
function manifestCommand(source){
 return prefix(source)+'if test -d '+ROOT+'; then\n'+
 'test "$(stat -c "%u:%a" '+ROOT+')" = 0:700\n'+
 // Validate every entry, including dotfiles. A stopped managed worker has only
 // records; a native guardian/import marker is not silently ignored.
 'listing=$(find '+ROOT+' -mindepth 1 -maxdepth 1 -print)\nif test -n "$listing"; then printf "%s\\n" "$listing" | (count=0; while IFS= read -r file; do\ncount=$((count+1)); test "$count" -le 64\n'+
 'name=${file##*/}; id=${name%.json}; test "$name" != "$id"\n'+
 'case "$id" in *[!a-zA-Z0-9-]*) exit 1;; esac\ntest "${#id}" -ge 16; test "${#id}" -le 64\n'+
 'test -f "$file"; test ! -L "$file"; test "$(stat -c "%u:%h:%a" "$file")" = 0:1:600\n'+
 'size=$(stat -c %s "$file"); test "$size" -ge 1; test "$size" -lt 2048\n'+
 'sum=$(sha256sum "$file"); printf "%s %s %s\\n" "$name" "$size" "${sum%% *}"\ndone)\nfi\nfi\n'+guard(source)+'printf "SNAPSHOT-END\\n"\n';
}
function parseManifest(output){
 check(typeof output==='string'&&output.length<=12000&&output.endsWith('SNAPSHOT-END\n'));
 const lines=output.slice(0,-13).split('\n').filter(Boolean),entries=[];check(lines.length<=64);
 for(const line of lines){const m=line.match(/^([A-Za-z0-9-]{16,64}\.json) ([1-9][0-9]{0,3}) ([a-f0-9]{64})$/);check(m&&Number(m[2])<2048);entries.push({name:m[1],size:Number(m[2]),sha256:m[3]});}
 entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);check(new Set(entries.map(e=>e.name)).size===entries.length);return entries;
}
async function snapshotManagedJobs({source,execute}){
 check(typeof execute==='function');const manifest=manifestCommand(source),started=process.hrtime();
 const run=async command=>{const r=await execute(command,5000),t=process.hrtime(started);check(t[0]*1000+t[1]/1000000<60000&&r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&typeof r.stdout==='string'&&r.stdout.length<=12000);return r.stdout;};
 const before=parseManifest(await run(manifest)),records=[];
 for(const entry of before){
  const file=ROOT+'/'+entry.name;
  const command=prefix(source)+fileGuard(file)+'test "$(sha256sum '+file+' | cut -d " " -f1)" = '+entry.sha256+'\nbase64 '+file+'\n'+guard(source);
  const encoded=await run(command),compact=encoded.replace(/\n/g,'');check(/^[A-Za-z0-9+/]+={0,2}$/.test(compact));
  const bytes=Buffer.from(compact,'base64');check(bytes.toString('base64')===compact&&bytes.length===entry.size&&sha(bytes)===entry.sha256);validateRecord(entry.name,bytes);
  records.push({...entry,base64:compact});
 }
 check(JSON.stringify(parseManifest(await run(manifest)))===JSON.stringify(before));
 const result={schema:1,implementation:'managed',source:JSON.parse(JSON.stringify(source)),records};
 return {...result,sha256:sha(Buffer.from(JSON.stringify(result)))};
}
module.exports={snapshotManagedJobs,validateRecord,parseManifest,manifestCommand,sourceExitGuard:guard};
