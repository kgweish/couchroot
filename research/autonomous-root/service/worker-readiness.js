'use strict';
const MANAGED=['file-transfer-v1','binary-download-v1','binary-upload-v1','jobs-v1','app-profile-v1','helper-view-v1','native-app-launcher-v1'];
const NATIVE=['prototype-production-files-v1','binary-upload-v1','binary-download-v1','prototype-app-exec-v1','prototype-jobs-v1','prototype-helper-lifecycle-v1','prototype-independent-launcher-v1','prototype-crash-guardian-v1','prototype-command-fault-diagnostics-v1'];
const BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
function validateReadiness(info,expected){
 if(!expected||!['managed','native-prototype'].includes(expected.implementation)||typeof expected.bootId!=='string'||!BOOT.test(expected.bootId))throw Error('Invalid worker readiness expectation');
 if(!info||typeof info!=='object'||Array.isArray(info)||info.boot_id!==expected.bootId||!Number.isFinite(info.uptime_seconds)||info.uptime_seconds<0||typeof info.worker_id!=='string'||!/^[a-f0-9]{32}$/.test(info.worker_id))throw Error('Worker boot or identity mismatch');
 const native=expected.implementation==='native-prototype';
 // The deployed managed version predates the implementation field. Its complete
 // capability/launcher shape is required; explicit mismatched labels never pass.
 if(native?info.implementation!=='native-prototype':info.implementation!==undefined&&info.implementation!=='managed')throw Error('Worker implementation mismatch');
 const capabilities=info.capabilities,required=native?NATIVE:MANAGED;
 if(!Array.isArray(capabilities)||capabilities.length>64||capabilities.some(c=>typeof c!=='string'||c.length>128)||new Set(capabilities).size!==capabilities.length||required.some(c=>!capabilities.includes(c)))throw Error('Worker capabilities incomplete');
 const launcher=info.app_launcher;
 if(!launcher||typeof launcher!=='object'||typeof launcher.sha256!=='string'||!HASH.test(launcher.sha256))throw Error('Worker launcher identity missing');
 if(expected.launcherSha256!==undefined&&(typeof expected.launcherSha256!=='string'||!HASH.test(expected.launcherSha256)||launcher.sha256!==expected.launcherSha256))throw Error('Worker launcher digest mismatch');
 if(native){
  if(expected.launcherSha256===undefined||launcher.independently_staged!==true||info.lifetime_mode!=='production'||info.lifetime_seconds!==0||!Number.isSafeInteger(info.guardian_pid)||info.guardian_pid<=0)throw Error('Native worker is not in the expected production mode');
 }else if(launcher.implementation!=='native')throw Error('Managed worker launcher implementation mismatch');
 return info;
}
function validateResourceInventory(info){
 const r=info&&info.resources;
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
 const list=(items,max,valid)=>Array.isArray(items)&&items.length<=max&&items.every(valid);
 const id=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
 if(!info||!Array.isArray(info.capabilities)||!info.capabilities.includes('resource-inventory-v1')||!exact(r,['schema','scope','transfers','jobs','helpers'])||r.schema!==1||r.scope!=='worker-owned'||
  !list(r.transfers,8,t=>exact(t,['id','direction'])&&id(t.id)&&['upload','download'].includes(t.direction))||
  !list(r.jobs,16,j=>exact(j,['id','state','monitor_finished'])&&typeof j.id==='string'&&/^[a-zA-Z0-9-]{16,64}$/.test(j.id)&&['starting','running','cancelling','completed','cancelled','timed_out','interrupted','unknown'].includes(j.state)&&typeof j.monitor_finished==='boolean')||
  !list(r.helpers,8,id))throw Error('Worker resource inventory unavailable or invalid');
 for(const ids of [r.transfers.map(t=>t.id),r.jobs.map(j=>j.id),r.helpers])if(new Set(ids).size!==ids.length)throw Error('Duplicate worker resource identity');
 return r;
}
module.exports={validateReadiness,validateResourceInventory};
