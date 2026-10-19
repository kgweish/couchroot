'use strict';
// Offline signed-package maintenance. No public API or automatic digest reset.
// The caller verifies signing trust, holds the device lock, and supplies the
// exact installed package inventory. Selection stays held until the independent
// probe has exited and its resources have been checked through the SDK route.
const fs=require('fs'),path=require('path');
const {hash}=require('../service/policy');
const {validate,managedVersion}=require('../service/worker-selection');
const {validateReadiness,validateResourceInventory}=require('../service/worker-readiness');
const {processIdentities}=require('../service/worker-processes');
const {snapshotManagedJobs,validateRecord,sourceExitGuard}=require('../service/retained-state');
const {inspectManagedUnit}=require('../service/observer-unit');
const HEX=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const STATE='/opt/usr/home/owner/apps_rw/MiniRoot01/data/worker-state';
const q=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function check(v){if(!v)throw Error('Managed package upgrade evidence unavailable');}
function planUpgrade({id,selectionText,previousPayload,payload,packageSha256,inventory,source,runtimeSha256,host,port,tokenSha256}){
 check(ID.test(id)&&HEX.test(packageSha256)&&HEX.test(runtimeSha256)&&HEX.test(tokenSha256));
 check(typeof host==='string'&&host.split('.').length===4&&host.split('.').every(v=>/^(0|[1-9][0-9]{0,2})$/.test(v)&&Number(v)<256)&&Number.isInteger(port)&&port>=1024&&port<=65535);
 const selection=validate(JSON.parse(selectionText)),from=managedVersion(previousPayload),to=managedVersion(payload);
 check(selection.pending===null&&selection.selected.implementation==='managed'&&selection.selected.manifest_sha256===from&&from!==to);
 sourceExitGuard(source);
 check(inventory&&typeof inventory==='object'&&!Array.isArray(inventory)&&Object.keys(inventory).length>6&&Object.keys(inventory).length<=256);
 for(const [name,digest] of Object.entries(inventory))check(/^[-A-Za-z0-9_./]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').some(p=>['.','..',''].includes(p))&&(HEX.test(digest)||name==='signature1.xml'&&digest===null));
 const manifest=JSON.parse(fs.readFileSync(path.join(payload,'manifest.json'))),files={};
 for(const name of ['SamsungTvArchiveRoot','SamsungTvRootAgent'])for(const suffix of ['dll','runtimeconfig.json','deps.json']){
  const file=name+'.'+suffix;check(inventory['payload/'+file]===manifest[file]);
  if(name==='SamsungTvRootAgent')files[file]=manifest[file];
 }
 check(inventory['payload/manifest.json']===hash(fs.readFileSync(path.join(payload,'manifest.json'))));
 return {schema:1,id,from,to,package_sha256:packageSha256,selection_sha256:hash(selectionText),source,inventory,files,runtime_sha256:runtimeSha256,host,port,token_sha256:tokenSha256,directory:'/opt/couchroot-managed-'+id,stage:'/opt/usr/home/owner/share/tmp/sdk_tools/managed-'+id,unit:'couchroot-managed-'+id+'.service'};
}
function packageGuard(plan){
 let script=sourceExitGuard(plan.source)+'test ! -L '+STATE+'\ntest -d '+STATE+'\n';
 for(const [name,digest] of Object.entries(plan.inventory)){
  script+='p='+q('/opt/usr/apps/MiniRoot01/res/wgt/'+name)+'; if test ! -e "$p"; then p='+q('/opt/usr/apps/MiniRoot01/'+name)+'; fi\ntest ! -L "$p"\n';
  script+=digest===null?'test ! -e "$p"\n':'test -f "$p"; test "$(stat -c "%u:%h" "$p")" = 201:1\ntest "$(sha256sum "$p" | cut -d " " -f1)" = '+digest+'\n';
 }
 return script;
}
function runtimeGuard(plan,identity,launcherSha256){
 check(HEX.test(launcherSha256));const normalized=processIdentities({...identity,capabilities:['worker-process-identity-v1']},identity.processes.worker.pid);
 check(JSON.stringify(normalized)===JSON.stringify(identity)&&identity.boot_id===plan.source.boot_id&&identity.worker_id!==plan.source.worker_id&&identity.processes.worker.pid!==plan.source.processes.worker.pid);
 const pid=identity.processes.worker.pid,code=plan.directory+'/code',launcher='/opt/couchroot-agent/launchers/'+identity.worker_id,stage='/home/owner/share/tmp/sdk_tools/managed-'+plan.id;
 const live='line=$(cat /proc/'+pid+'/stat); rest=${line##*) }; set -- $rest; test "$#" -ge 20; shift 19; test "$1" = '+identity.processes.worker.start_ticks+'\n';
 const file=(p,mode,digest)=>'test -f '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%h:%a" '+p+')" = 0:1:'+mode+'\ntest "$(sha256sum '+p+' | cut -d " " -f1)" = '+digest+'\n';
 const argv=['/usr/bin/dotnet',code+'/SamsungTvRootAgent.dll',plan.host,String(plan.port),stage+'/token',stage].join('\0')+'\0';
 return 'set -eu\n'+packageGuard(plan)+live+'test "$(readlink /proc/'+pid+'/exe)" = /usr/bin/dotnet\ntest "$(sha256sum /proc/'+pid+'/exe | cut -d " " -f1)" = '+plan.runtime_sha256+'\ntest "$(sha256sum /proc/'+pid+'/cmdline | cut -d " " -f1)" = '+hash(argv)+'\ntest "$(readlink /proc/'+pid+'/ns/mnt)" != "$(readlink /proc/1/ns/mnt)"\n'+
 [code,launcher].map(p=>'awk \'$5 == "'+p+'" && $6 ~ /(^|,)ro(,|$)/ { found=1 } END { exit !found }\' /proc/'+pid+'/mountinfo\n').join('')+
 [plan.directory,code,plan.stage,launcher].map(p=>'test -d '+p+'; test ! -L '+p+'; test "$(stat -c "%u:%a" '+p+')" = 0:700\n').join('')+
 Object.entries(plan.files).map(([name,digest])=>file(code+'/'+name,'400',digest)).join('')+file(launcher+'/app-launcher','500',launcherSha256)+
 'test ! -e '+plan.stage+'/token; test ! -L '+plan.stage+'/token\n'+live+'printf "UPGRADE-RUNTIME-VERIFIED\\n"\n';
}
async function verifyUpgrade({plan,channel,execute}){
 check(channel&&channel._conn&&typeof execute==='function');const peer=channel._conn,started=process.hrtime();
 const owned=()=>{const t=process.hrtime(started);check(channel._conn===peer&&t[0]*1000+t[1]/1000000<120000);};
 const run=async(c,t)=>{owned();const r=await execute(c,t);owned();return r;};
 const op=async request=>{owned();const r=await channel.operation(request);owned();return r;};
 const identityOf=info=>{check(['uid','euid','gid','egid'].every(k=>peer.identity[k]===0)&&peer.identity.smack==='User');validateReadiness(info,{implementation:'managed',bootId:plan.source.boot_id});const r=validateResourceInventory(info);check(!r.jobs.length&&!r.helpers.length&&!r.transfers.length);return processIdentities(info,peer.identity.pid);};
 const info=await op({op:'status'}),identity=identityOf(info),command=runtimeGuard(plan,identity,info.app_launcher.sha256);
 const verify=async()=>{const r=await run(command,25000);check(r&&r.exit_code===0&&!r.timed_out&&!r.stderr&&r.stdout==='UPGRADE-RUNTIME-VERIFIED\n');};
 const unit=await inspectManagedUnit({unit:plan.unit,bootId:plan.source.boot_id,execute:run});
 check(unit.active_state==='active'&&unit.sub_state==='running'&&unit.main_pid===identity.processes.worker.pid&&unit.exec_code===0&&unit.exec_status===0&&unit.started_monotonic!=='0');
 await verify();const snapshot=await snapshotManagedJobs({source:plan.source,execute:run});
 for(const entry of snapshot.records){const saved=validateRecord(entry.name,Buffer.from(entry.base64,'base64')),r=await op({op:'job.status',id:saved.id}),terminal=['completed','cancelled','timed_out','interrupted'].includes(saved.state),state=terminal?saved.state:saved.boot_id===plan.source.boot_id?'unknown':'interrupted';check(r&&r.id===saved.id&&r.boot_id===saved.boot_id&&r.state===state&&r.output_available===false&&JSON.stringify(r.record)===JSON.stringify(saved));}
 const after=await op({op:'status'});check(JSON.stringify(identityOf(after))===JSON.stringify(identity)&&after.app_launcher.sha256===info.app_launcher.sha256);
 check(JSON.stringify(await inspectManagedUnit({unit:plan.unit,bootId:plan.source.boot_id,execute:run}))===JSON.stringify(unit));
 check(JSON.stringify(await snapshotManagedJobs({source:plan.source,execute:run}))===JSON.stringify(snapshot));await verify();owned();
 return {schema:1,id:plan.id,package_sha256:plan.package_sha256,from:plan.from,to:plan.to,selection_sha256:plan.selection_sha256,source:plan.source,worker_identity:identity,launcher_sha256:info.app_launcher.sha256,unit,snapshot};
}
module.exports={planUpgrade,packageGuard,runtimeGuard,verifyUpgrade};

// Produce a held selection transaction from actual verification receipts. These
// files are a maintenance plan, not permission to overwrite a remote journal.
// The publisher must compare the original bytes, hold an exclusive remote writer
// marker, persist these receipts, and leave that marker after any uncertain write.
function stageSelection({directory,selectionText,plan,readiness}){
 const {SelectionJournal}=require('../service/worker-selection'),{atomic}=require('../service/policy');
 check(hash(selectionText)===plan.selection_sha256&&readiness.schema===1&&readiness.id===plan.id&&readiness.from===plan.from&&readiness.to===plan.to&&readiness.package_sha256===plan.package_sha256&&readiness.selection_sha256===plan.selection_sha256&&JSON.stringify(readiness.source)===JSON.stringify(plan.source));
 const snapshot=readiness.snapshot;check(snapshot&&snapshot.schema===1&&snapshot.implementation==='managed'&&JSON.stringify(snapshot.source)===JSON.stringify(plan.source));
 const {sha256,...snapshotBody}=snapshot;check(sha256===hash(JSON.stringify(snapshotBody)));
 check(Array.isArray(snapshot.records)&&snapshot.records.length<=64);const names=new Set();
 for(const entry of snapshot.records){const bytes=Buffer.from(entry.base64,'base64');check(!names.has(entry.name)&&entry.size===bytes.length&&entry.sha256===hash(bytes));names.add(entry.name);validateRecord(entry.name,bytes);}
 runtimeGuard(plan,readiness.worker_identity,readiness.launcher_sha256);
 const unit=readiness.unit;check(unit&&unit.unit===plan.unit&&unit.boot_id===plan.source.boot_id&&unit.active_state==='active'&&unit.sub_state==='running'&&unit.main_pid===readiness.worker_identity.processes.worker.pid&&unit.exec_code===0&&unit.exec_status===0&&unit.started_monotonic!=='0');
 fs.mkdirSync(directory,{mode:0o700});const file=path.join(directory,'worker-selection.json');fs.writeFileSync(file,selectionText,{mode:0o600,flag:'wx'});
 // Retain the full previous history even when the bounded selection ring rotates.
 fs.writeFileSync(path.join(directory,'selection-before.json'),selectionText,{mode:0o600,flag:'wx'});
 const quiescence={schema:1,id:plan.id,source:plan.source,selection_sha256:plan.selection_sha256,package_sha256:plan.package_sha256};
 atomic(path.join(directory,'quiescence.json'),quiescence);atomic(path.join(directory,'snapshot.json'),snapshot);atomic(path.join(directory,'readiness.json'),readiness);
 const journal=new SelectionJournal(file);let state=journal.read();check(state.pending===null&&state.selected.implementation==='managed'&&state.selected.manifest_sha256===plan.from);
 state=journal.begin(state.revision,{implementation:'managed',manifest_sha256:plan.to},hash(JSON.stringify(quiescence)));const transactionId=state.pending.id;
 state=journal.advance(state.revision,transactionId,'state-ready',hash(JSON.stringify(snapshot)));
 state=journal.advance(state.revision,transactionId,'trial-ready',hash(JSON.stringify(readiness)));
 atomic(path.join(directory,'selection-held.json'),state);
 return {transaction_id:transactionId,selection_sha256:hash(JSON.stringify(state)),selection:state};
}
module.exports.stageSelection=stageSelection;
