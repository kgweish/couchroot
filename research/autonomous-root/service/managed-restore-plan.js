'use strict';
// Exact replacement of stopped managed state; never merge forgotten native jobs.
// The controller must retain admission and persist intent before executing a plan.
const {hash}=require('./policy');
const {validateSnapshot}=require('./retained-install');
const {validateRecord}=require('./retained-state');
const {planNativeSnapshot}=require('./native-retained-state');
function check(ok){if(!ok)throw Error('Managed restore evidence unavailable');}
function planManagedRestore({record,installation,snapshot,baseline},{bootId=record.boot_id}={}){
 const native=planNativeSnapshot(record,installation,null,[],null,bootId);validateSnapshot(baseline);
 check(JSON.stringify(baseline.source)===JSON.stringify(record.source)&&baseline.sha256===installation.snapshot_sha256);
 check(snapshot&&snapshot.schema===1&&snapshot.implementation==='native-prototype'&&JSON.stringify(snapshot.source)===JSON.stringify(record.worker_identity));
 check(JSON.stringify(snapshot.origin)===JSON.stringify({transaction_id:record.id,manifest_sha256:record.manifest_sha256,installation_sha256:record.state_receipt_sha256}));
 const {sha256,...body}=snapshot;check(hash(JSON.stringify(body))===sha256&&Array.isArray(snapshot.records)&&snapshot.records.length<=64);
 let previous='';for(const r of snapshot.records){
  check(r&&Object.keys(r).sort().join('|')==='base64|name|sha256|size'&&typeof r.base64==='string'&&r.base64.length<=2732);
  const bytes=Buffer.from(r.base64,'base64');check(bytes.toString('base64')===r.base64&&bytes.length===r.size&&hash(bytes)===r.sha256&&r.name>previous);validateRecord(r.name,bytes);previous=r.name;
 }
 const parent='/opt/couchroot-agent',jobs=parent+'/jobs',directory=parent+'/rollback-'+record.id,next=directory+'/next',backup=directory+'/previous',marker=directory+'/manifest';
 const receipt={schema:1,id:record.id,phase:'restored',source:record.worker_identity,snapshot_sha256:snapshot.sha256,baseline_sha256:baseline.sha256,directory};
 const data=Buffer.from(JSON.stringify(receipt));
 const absent=p=>'test ! -e '+p+'; test ! -L '+p+'\n';
 const dir=(p,mode='700')=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:'+mode+'\n';
 const file=(p,digest)=>'restore_file '+p+' '+digest+'\n';
 const fileFunction='restore_file() { test -f "$1"; test ! -L "$1"; test "$(stat -c "%u:%h:%a" "$1")" = 0:1:600; test "$(sha256sum "$1" | cut -d " " -f1)" = "$2"; }\n';
 const inventory=(p,records)=>dir(p)+'test "$(find '+p+' -mindepth 1 -maxdepth 1 | wc -l)" -eq '+records.length+'\n'+records.map(r=>file(p+'/'+r.name,r.sha256)).join('');
 const prefix='set -eu\nPATH=/usr/bin:/bin\nexport PATH\numask 077\ntest -d /opt; test ! -L /opt\n'+dir(parent,'755')+native.guard+fileFunction+'restore_old() {\n'+inventory('"$1"',baseline.records)+'}\nrestore_fresh() {\n'+inventory('"$1"',snapshot.records)+'}\n';
 const owned=dir(directory)+file(marker,hash(data))+'test "$(find '+directory+' -mindepth 1 -maxdepth 1 ! -name next ! -name previous ! -name manifest | wc -l)" -eq 0\n';
 const old=p=>'restore_old '+p+'\n',fresh=p=>'restore_fresh '+p+'\n';
 const create=(p,bytes)=>'(set -C; printf %s '+bytes.toString('base64')+' | base64 -d > '+p+')\n';
 // A missing baseline is normalized to an empty directory only when its
 // verified snapshot is empty. Never erase or replace an unexpected entry.
 const oldOrEmpty='if test -e '+jobs+' || test -L '+jobs+'; then\n'+old(jobs)+'else\n'+(baseline.records.length?'exit 1\n':absent(jobs)+'mkdir '+jobs+'\n')+'fi\n';
 const begin=prefix+absent(directory)+oldOrEmpty+'mkdir '+directory+' '+next+'\n'+create(marker,data)+'sync\n'+owned+'printf "RESTORE-PENDING\\n"\n';
 const copies=snapshot.records.map(r=>prefix+owned+absent(backup)+old(jobs)+dir(next)+
  'if test -e '+next+'/'+r.name+' || test -L '+next+'/'+r.name+'; then\n'+file(next+'/'+r.name,r.sha256)+'else\n'+create(next+'/'+r.name,Buffer.from(r.base64,'base64'))+file(next+'/'+r.name,r.sha256)+'fi\n');
 const partial=dir(next)+'test "$(find '+next+' -mindepth 1 -maxdepth 1 '+snapshot.records.map(r=>'! -name '+r.name).join(' ')+' | wc -l)" -eq 0\n'+snapshot.records.map(r=>'if test -e '+next+'/'+r.name+' || test -L '+next+'/'+r.name+'; then\n'+file(next+'/'+r.name,r.sha256)+'fi\n').join('');
 const inspect=prefix+'if test ! -e '+directory+'; then\n'+absent(directory)+'printf "RESTORE-ABSENT\\n"\nelse\n'+owned+'if test -e '+backup+' || test -L '+backup+'; then\n'+old(backup)+
  'if test -e '+next+' || test -L '+next+'; then\n'+fresh(next)+absent(jobs)+'printf "RESTORE-CUTOVER\\n"\nelse\n'+absent(next)+fresh(jobs)+'printf "RESTORE-READY\\n"\nfi\nelse\n'+absent(backup)+old(jobs)+partial+'if test "$(find '+next+' -mindepth 1 -maxdepth 1 | wc -l)" -eq '+snapshot.records.length+'; then printf "RESTORE-STAGED\\n"; else printf "RESTORE-PENDING\\n"; fi\nfi\nfi\n'+native.guard;
 const retire=prefix+owned+absent(backup)+old(jobs)+fresh(next)+'sync\n'+native.guard+'mv '+jobs+' '+backup+'\nsync\n';
 const publish=prefix+owned+old(backup)+fresh(next)+absent(jobs)+native.guard+'mv '+next+' '+jobs+'\nsync\n'+native.guard+fresh(jobs)+'printf "RESTORE-READY\\n"\n';
 const verify=prefix+owned+old(backup)+absent(next)+fresh(jobs)+native.guard+'printf "RESTORE-READY\\n"\n';
 for(const c of [begin,inspect,retire,publish,verify,...copies])check(Buffer.byteLength(c)<=65536);
 return {receipt,begin,copies,inspect,retire,publish,verify};
}
module.exports={planManagedRestore};
