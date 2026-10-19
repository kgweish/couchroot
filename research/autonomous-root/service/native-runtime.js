'use strict';
// The committed launch/activation remain immutable. A restart receipt replaces
// the runtime boot/process binding; selection retains the original commitment.
const fs=require('fs'),path=require('path');
const {privateRead}=require('./private-state');
const {hash}=require('./policy');
const {validateLaunch,validateRuntimeLaunch}=require('./production-readiness');
const {processIdentities}=require('./worker-processes');
function check(v){if(!v)throw Error('Native runtime binding unavailable');}
function validateReady(record,{runtime=false}={}){
 check(record&&record.phase==='ready');
 const {worker_identity,unit_started_monotonic,...launch}=record;(runtime?validateRuntimeLaunch:validateLaunch)({...launch,phase:'submitted'});
 check(/^[1-9][0-9]{0,19}$/.test(unit_started_monotonic)&&worker_identity&&worker_identity.boot_id===record.boot_id&&worker_identity.processes&&worker_identity.processes.guardian);
 check(JSON.stringify(processIdentities({...worker_identity,implementation:'native-prototype',guardian_pid:worker_identity.processes.guardian.pid,capabilities:['worker-process-identity-v1']},worker_identity.processes.worker.pid))===JSON.stringify(worker_identity));
}
function readRuntime(directory,id){
 check(typeof id==='string'&&/^[a-f0-9]{32}$/.test(id));
 const originalText=privateRead(path.join(directory,id+'.production.json'),16384),original=JSON.parse(originalText);validateReady(original);check(original.id===id);
 let receipt;
 try{receipt=JSON.parse(privateRead(path.join(directory,id+'.runtime.json'),32768));}catch(e){if(e.code!=='ENOENT')throw e;return {record:original,original,readiness_sha256:hash(originalText)};}
 check(receipt&&Object.keys(receipt).sort().join('|')==='activation_sha256|id|phase|readiness_sha256|record|schema'&&[1,2].includes(receipt.schema)&&receipt.phase==='ready'&&receipt.id===id&&receipt.readiness_sha256===hash(originalText));
 const activationText=privateRead(path.join(directory,id+'.activation.json'),16384),activation=JSON.parse(activationText);
 check(receipt.activation_sha256===hash(activationText)&&activation.schema===1&&activation.phase==='active'&&activation.boot_id===original.boot_id&&activation.manifest_sha256===original.manifest_sha256&&activation.id===id&&activation.readiness_sha256===receipt.readiness_sha256&&JSON.stringify(activation.worker_identity)===JSON.stringify(original.worker_identity));
 const record=receipt.record;validateReady(record,{runtime:receipt.schema===2});
 check(receipt.schema!==2||record.boot_id!==original.boot_id);
 const strip=r=>{const {worker_identity,unit_started_monotonic,...rest}=r;if(receipt.schema===2)delete rest.boot_id;return rest;};
 check(JSON.stringify(strip(record))===JSON.stringify(strip(original)));
 return {record,original,readiness_sha256:receipt.readiness_sha256};
}
function nativeRecordText(directory,id){return JSON.stringify(readRuntime(directory,id).record);}
function nativeReadiness(directory,record){const r=readRuntime(directory,record.id);check(JSON.stringify(r.record)===JSON.stringify(record));return r.readiness_sha256;}
// Only production records use the effective runtime binding. All other receipts
// retain their existing byte-for-byte ownership checks.
function runtimeRead(file,max){const name=path.basename(file),match=/^([a-f0-9]{32})\.production\.json$/.exec(name);return match?nativeRecordText(path.dirname(file),match[1]):privateRead(file,max);}
module.exports={readRuntime,nativeRecordText,nativeReadiness,runtimeRead,validateReady};
