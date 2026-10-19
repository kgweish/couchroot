'use strict';
// Admit only the persistence debris understood by the native guardian. The
// coordinator inventories and pins it; native alone reconciles it under lock.
const {hash}=require('./policy');
const {bootGuard}=require('./worker-processes');
const ID='[a-zA-Z0-9-]{16,64}',SHA=/^[a-f0-9]{64}$/;
const terminal=new Set(['completed','cancelled','timed_out','interrupted']);
function check(v){if(!v)throw Error('Native restart persistence evidence unavailable');}
function metadataCommand(plan){
 return plan.prefix+'listing=$(find '+plan.root+' -mindepth 1 -maxdepth 1 ! -name lock ! -name .import-manifest ! -name guardian '+(plan.journalNames||[]).filter(n=>n!=='guardian').map(n=>'! -name '+n+' ').join('')+'! -name "*.json" -print)\nif test -n "$listing"; then printf "%s\\n" "$listing" | (count=0; while IFS= read -r file; do\n'+
  'count=$((count+1)); test "$count" -le 192\nname=${file##*/}\ncase "$name" in *[!a-zA-Z0-9.-]*) exit 1;; esac\n'+
  'test -f "$file"; test ! -L "$file"; test "$(stat -c "%u:%a" "$file")" = 0:600\n'+
  'size=$(stat -c %s "$file"); test "$size" -ge 0; test "$size" -lt 2048\nlinks=$(stat -c %h "$file"); test "$links" -ge 1; test "$links" -le 2\n'+
  'sum=$(sha256sum "$file"); printf "%s %s %s %s\\n" "$name" "$size" "$links" "${sum%% *}"\ndone)\nfi\n'+plan.guard+'printf "METADATA-END\\n"\n';
}
function parseMetadata(text,owner){
 check(typeof owner==='string'&&/^[a-f0-9]{32}$/.test(owner));
 check(typeof text==='string'&&text.endsWith('METADATA-END\n')&&text.length<40000);
 const lines=text.slice(0,-13).split('\n').filter(Boolean),entries=[];
 check(lines.length<=192);
 for(const line of lines){
  const m=/^(\S+) (0|[1-9][0-9]*) ([12]) ([a-f0-9]{64})$/.exec(line);check(m);
  const named=new RegExp('^\\.(intent|repair)-'+owner+'-('+ID+')$').exec(m[1]),next=new RegExp('^('+ID+')\\.json\\.next$').exec(m[1]);
  check(named||next);const entry={name:m[1],size:Number(m[2]),links:Number(m[3]),sha256:m[4],kind:named?named[1]:'next',id:named?named[2]:next[1]};
  check(entry.size<2048&&!entries.some(e=>e.name===entry.name)&&(entry.kind!=='next'||entry.links===1));entries.push(entry);
 }
 for(const e of entries)if(e.kind==='repair')check(entries.some(i=>i.kind==='intent'&&i.id===e.id));
 return entries.sort((a,b)=>a.name.localeCompare(b.name));
}
function metadataGuard(root,entries){
 return entries.map(e=>{
  check(new RegExp('^(?:\\.(?:intent|repair)-[a-f0-9]{32}-'+ID+'|'+ID+'\\.json\\.next)$').test(e.name)&&SHA.test(e.sha256)&&[1,2].includes(e.links)&&Number.isInteger(e.size)&&e.size>=0&&e.size<2048);
  const p=root+'/'+e.name;
  return 'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a:%s" '+p+')" = 0:'+e.links+':600:'+e.size+'\n'+
   'test "$(sha256sum '+p+' | cut -d " " -f1)" = '+e.sha256+'\n'+
   (e.links===2?'test '+p+' -ef '+root+'/'+e.id+'.json\n':'');
 }).join('');
}
function decoded(entry){return JSON.parse(Buffer.from(entry.base64,'base64').toString('utf8').replace(/^\uFEFF/,''));}
function validateMetadata(entries,snapshot){
 const records=new Map(snapshot.records.map(e=>[e.name.slice(0,-5),e])),ids=new Set(records.keys()),owner=snapshot.source.worker_id;
 for(const e of entries){
  const record=records.get(e.id);
  if(e.kind==='intent')ids.add(e.id);
  if(e.kind==='next')check(record&&decoded(record).worker_id===owner);
  if(e.links===2){check(record&&record.size===e.size&&record.sha256===e.sha256);check(entries.filter(x=>x.id===e.id&&x.links===2).length===1);}
 }
 check(ids.size<=64);
}
// Read back every retained result before admission. Unchanged records must
// retain their exact bytes. Only this guardian's nonterminal records may change.
async function verifyRestartRecords({retained,record,channel,execute,bootId=record.boot_id,recoveryBootIds=[bootId]}){
 check(Array.isArray(recoveryBootIds)&&recoveryBootIds.length>0&&recoveryBootIds.length<=8);for(const boot of recoveryBootIds)bootGuard(boot);
 const snapshot=retained.snapshot,owner=Object.prototype.hasOwnProperty.call(retained,'reconciliation_worker_id')?retained.reconciliation_worker_id:snapshot.source.worker_id,expected=new Map();
 for(const entry of snapshot.records){const value=decoded(entry);expected.set(value.id,{entry,value,mutable:!!retained.guardian_sha256&&value.worker_id===owner&&!terminal.has(value.state)});}
 for(const e of retained.metadata||[])if(e.kind==='intent'&&!expected.has(e.id))expected.set(e.id,{orphan:true});
 for(const [id,item] of expected){
  const status=await channel.operation({op:'job.status',id}),value=status&&status.record;
  check(value&&value.id===id&&status.output_available===false);
  if(item.orphan){
   check(value.worker_id===owner&&recoveryBootIds.includes(value.boot_id)&&value.state==='interrupted'&&value.recovery==='initial-intent-not-published'&&value.launch_started===false&&value.exit_code===null);
  }else if(item.mutable){
   check(value.worker_id===owner&&value.boot_id===item.value.boot_id&&value.state==='interrupted'&&value.exit_code===null&&value.recovery==='stale-guardian-reconciled');
   for(const k of ['id','pid','process_start','started_at'])check(value[k]===item.value[k]);
  }else check(hash(JSON.stringify(value))===hash(JSON.stringify(item.value)));
 }
 const root=record.scope+'/.jobs',names=[...expected.keys()].sort().map(id=>id+'.json');
 let command='set -eu\nLC_ALL=C\nexport LC_ALL\n';
 for(const e of [...retained.metadata||[],...retained.checkpoint_files||[]])command+='test ! -e '+root+'/'+e.name+'; test ! -L '+root+'/'+e.name+'\n';
 for(const [id,item] of expected){
  const p=root+'/'+id+'.json';command+='test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:600\n';
  if(item.entry&&!item.mutable)command+='test "$(sha256sum '+p+' | cut -d " " -f1)" = '+item.entry.sha256+'\n';
 }
 command+='listing=$(find '+root+' -mindepth 1 -maxdepth 1 ! -name lock ! -name .import-manifest ! -name guardian -print)\nif test -n "$listing"; then printf "%s\\n" "$listing" | while IFS= read -r file; do printf "%s\\n" "${file##*/}"; done | sort; fi\n';
 const result=await execute(command,5000);check(result&&result.exit_code===0&&!result.timed_out&&!result.stderr&&result.stdout===(names.length?names.join('\n')+'\n':''));
}
module.exports={metadataCommand,parseMetadata,metadataGuard,validateMetadata,verifyRestartRecords};
