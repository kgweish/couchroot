'use strict';
// Read-only restart inventory: reconstruct transition progress from durable
// journals alone. It never launches, signals, deletes or rewrites anything, and
// a missing acknowledgement is reported as unknown rather than replayable.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {privateRead}=require('./private-state');
const {selectionStatus,SelectionJournal}=require('./worker-selection');
const ID=/^[a-f0-9]{32}$/;
const MARKERS=['bootstrap-launch.pending','retirement-launch.pending','production-launch.pending','state-install.pending','managed-restore.pending','managed-launch.pending','observer-launch.pending'];
const providerId=id=>crypto.createHash('sha256').update('observer-handoff:'+id).digest('hex').slice(0,32);
function inventoryRestart(selectionFile){
 const directory=path.dirname(selectionFile),diagnostics=[];
 const exists=name=>{try{fs.lstatSync(path.join(directory,name));return true;}catch(e){if(e.code==='ENOENT')return false;diagnostics.push(name+' unreadable: '+e.code);return true;}};
 // Records are classified by phase only; malformed or foreign files are reported, never repaired.
 const record=name=>{if(!exists(name))return null;try{const v=JSON.parse(privateRead(path.join(directory,name),262144));return v&&typeof v==='object'?v:{phase:'invalid'};}catch(e){diagnostics.push(name+' invalid: '+String(e.message).slice(0,80));return {phase:'invalid'};}};
 const phaseOf=name=>{const r=record(name);return r?String(r.phase):null;};
 const selection=selectionStatus(selectionFile),markers=MARKERS.filter(exists);if(exists(path.basename(selectionFile)+'.writer'))markers.push(path.basename(selectionFile)+'.writer');
 const mutations=[];let proven=false;
 // A committed selection proves every forward step that its commit required.
 const step=(name,status,evidence)=>mutations.push({name,status:proven?'verified-complete':status,evidence:evidence.filter(Boolean)});
 const pending=selection.pending||null,history=selection.history||[],last=history[history.length-1]||null;
 let transaction=null,direction=null,origin=null;
 if(pending&&ID.test(pending.id)){transaction=pending.id;direction=pending.to.implementation==='managed'?'to-managed':'to-native';}
 else if(last&&last.outcome==='committed'&&ID.test(last.id)&&last.to&&last.to.implementation!=='managed')transaction=last.id,direction='to-native';
 else if(last&&last.outcome==='committed'&&ID.test(last.id)&&last.to&&last.to.implementation==='managed'&&last.from&&last.from.implementation==='native-prototype'&&(phaseOf(last.id+'.managed-activation.json')!=='active'&&phaseOf(last.id+'.restart-return.json')!=='complete'||markers.length))transaction=last.id,direction='to-managed';
 if(direction==='to-managed'){const prior=pending?last:history[history.length-2];origin=prior&&ID.test(prior.id)&&prior.to&&prior.to.implementation==='native-prototype'?prior.id:null;}
 const native=direction==='to-native'?transaction:origin,committed=id=>!!id&&history.some(h=>h.id===id&&h.outcome==='committed');
 if(native){
  // Forward trial: provider, source stop, retained state, production readiness, commit.
  const obs=providerId(native),provider=phaseOf(obs+'.retirement.json'),forward=direction==='to-native';
  proven=committed(native);
  const pendingPhase=forward&&pending?pending.phase:null,accepted=p=>committed(native)||(pendingPhase&&['state-ready','trial-ready'].includes(pendingPhase)&&(p==='state'||pendingPhase==='trial-ready'));
  step('provider-launch',provider===null?(markers.includes('retirement-launch.pending')&&forward?'submitted-unknown':'not-submitted'):['ready','shutdown-acknowledged','shutdown-observed','staging-retired','complete'].includes(provider)?'verified-complete':'submitted-unknown',[provider&&obs+'.retirement.json:'+provider,markers.includes('retirement-launch.pending')&&'retirement-launch.pending']);
  const snapshot=exists(native+'.retained-snapshot.json');
  step('source-stop',snapshot?'verified-complete':provider===null?'not-submitted':'submitted-unknown',[snapshot&&native+'.retained-snapshot.json']);
  const install=phaseOf(native+'.state-install.json');
  step('state-install',accepted('state')?'verified-complete':install===null&&!markers.includes('state-install.pending')?'not-submitted':'submitted-unknown',[install&&native+'.state-install.json:'+install,markers.includes('state-install.pending')&&'state-install.pending']);
  const production=phaseOf(native+'.production.json'),readiness=exists(native+'.production.json.readiness.pending');
  step('production-launch',accepted('trial')?'verified-complete':production===null&&!markers.includes('production-launch.pending')?'not-submitted':'submitted-unknown',[production&&native+'.production.json:'+production,readiness&&native+'.production.json.readiness.pending',markers.includes('production-launch.pending')&&'production-launch.pending']);
  step('native-commit',committed(native)?'verified-complete':'not-submitted',[committed(native)&&'selection-history']);
  proven=false;
  if(forward&&committed(native)){
   // Public admission: provider retirement, then the activation receipt.
   const active=phaseOf(native+'.activation.json'),intent=exists(native+'.activation.json.pending'),teardown=['shutdown','cleanup','finish'].some(k=>exists(obs+'.retirement.json.'+k+'.pending'));
   step('provider-retirement',provider==='complete'||active==='active'?'verified-complete':teardown||['shutdown-acknowledged','shutdown-observed','staging-retired'].includes(provider)?'submitted-unknown':'not-submitted',[provider&&'provider-retirement:'+provider,teardown&&'provider-teardown-pending']);
   step('native-activation',active==='active'&&!intent?'verified-complete':active||intent?'submitted-unknown':'not-submitted',[active&&native+'.activation.json:'+active,intent&&native+'.activation.json.pending']);
   const startup=phaseOf(native+'.startup.json');if(startup)step('native-startup',startup==='ready'?'verified-complete':'submitted-unknown',[native+'.startup.json:'+startup]);
  }
 }
 // A return from an activated native launches its own provider through native.
 const activeReturn=direction==='to-managed'&&!!origin&&phaseOf(origin+'.activation.json')==='active',returnProvider=direction==='to-managed'?providerId(activeReturn?transaction:origin):null;
 if(activeReturn){
  const p=phaseOf(returnProvider+'.retirement.json'),launching=markers.includes('retirement-launch.pending');
  step('return-provider-launch',committed(transaction)||['ready','shutdown-acknowledged','shutdown-observed','staging-retired','complete'].includes(p)?'verified-complete':p===null&&!launching?'not-submitted':'submitted-unknown',[p&&returnProvider+'.retirement.json:'+p,launching&&'retirement-launch.pending']);
 }
 if(direction==='to-managed'){
  const stop=phaseOf(transaction+'.native-stop.json');
  step('native-stop',stop===null?'not-submitted':stop==='stopped'?'verified-complete':'submitted-unknown',[stop&&transaction+'.native-stop.json:'+stop]);
  const restore=phaseOf(transaction+'.managed-restore.json'),ready=pending&&['state-ready','trial-ready'].includes(pending.phase)||committed(transaction);
  step('managed-restore',ready?'verified-complete':restore===null&&!markers.includes('managed-restore.pending')?'not-submitted':'submitted-unknown',[restore&&transaction+'.managed-restore.json:'+restore,markers.includes('managed-restore.pending')&&'managed-restore.pending']);
  const launch=phaseOf(transaction+'.managed-launch.json'),trial=pending&&pending.phase==='trial-ready'||committed(transaction);
  step('managed-launch',trial?'verified-complete':launch===null&&!markers.includes('managed-launch.pending')?'not-submitted':'submitted-unknown',[launch&&transaction+'.managed-launch.json:'+launch,exists(transaction+'.managed-launch.json.readiness.pending')&&transaction+'.managed-launch.json.readiness.pending']);
  step('managed-commit',committed(transaction)?'verified-complete':'not-submitted',[committed(transaction)&&'selection-history']);
 }
 if(direction==='to-managed'){
  const managedId=transaction,retired=origin&&phaseOf(origin+'.production-retirement.json'),provider=origin&&phaseOf(returnProvider+'.retirement.json'),active=managedId&&phaseOf(managedId+'.managed-activation.json');
  const teardown=origin&&['shutdown','cleanup','finish'].some(k=>exists(returnProvider+'.retirement.json.'+k+'.pending'));
  step('native-retirement',retired==='staging-retired'?'verified-complete':retired===null||retired===undefined?'not-submitted':'submitted-unknown',[retired&&origin+'.production-retirement.json:'+retired]);
  step('provider-retirement',provider==='complete'?'verified-complete':teardown||['shutdown-acknowledged','shutdown-observed','staging-retired'].includes(provider)?'submitted-unknown':'not-submitted',[provider&&'provider-retirement:'+provider,teardown&&'provider-teardown-pending']);
  step('managed-activation',active==='active'?'verified-complete':active?'submitted-unknown':'not-submitted',[active&&managedId+'.managed-activation.json:'+active]);
 }
 const unknown=mutations.filter(m=>m.status==='submitted-unknown').map(m=>m.name),open=mutations.find(m=>m.status!=='verified-complete');
 // After a service restart the bounded provider and production workers have
 // lost their transports; any recovery needs a freshly verified executor.
 if(selection.phase==='inspection-required')diagnostics.push('selection journal requires inspection: '+selection.reason);
 if(unknown.length)diagnostics.push('submitted with unknown outcome: '+unknown.join(', ')+'; verify through an independent executor before any further mutation');
 if(pending&&!unknown.length)diagnostics.push('transition '+pending.phase+' has no unknown submission; '+(open?'next unsubmitted step: '+open.name:'all steps verified; selection publication remains'));
 if(!pending&&selection.phase==='stable'&&selection.selected_implementation!=='managed')diagnostics.push(open?'native selected without verified activation; return to managed requires the durable native state':'native active; startup verifies the committed receipts and reacquires through a held authenticated bootstrap');
 for(const name of markers)diagnostics.push('ownership marker present: '+name);
 const settled=selection.phase==='stable'&&selection.selected_implementation==='managed'&&!markers.length&&!unknown.length;
 const nativeActive=selection.phase==='stable'&&selection.selected_implementation==='native-prototype'&&direction==='to-native'&&!markers.length&&!unknown.length&&!open;
 return {schema:1,selection_phase:selection.phase,transaction_id:transaction,direction,origin_id:origin,boundary:settled?'settled':nativeActive?'native-active':open?open.name:pending?'selection-publication':'markers',mutations,markers,action:settled||nativeActive?'none':'pending-reconciliation',diagnostics:diagnostics.slice(0,12).map(d=>d.slice(0,200))};
}
// After a restart, abandon only a forward transition proven to have submitted
// nothing remote: prepared selection, no markers, and no file naming either the
// transaction or its provider. Everything else stays pending for inspection.
function abandonUnsubmitted(selectionFile){
 const r=inventoryRestart(selectionFile),directory=path.dirname(selectionFile);
 if(r.selection_phase!=='reconciliation-required'||r.direction!=='to-native'||r.markers.length||!r.mutations.length||r.mutations.some(m=>m.status!=='not-submitted'))return {abandoned:false,inventory:r};
 const journal=new SelectionJournal(selectionFile),state=journal.read();
 if(!state||!state.pending||state.pending.id!==r.transaction_id||state.pending.phase!=='prepared')return {abandoned:false,inventory:r};
 const owned=[r.transaction_id,providerId(r.transaction_id)];
 if(fs.readdirSync(directory).some(n=>owned.some(id=>n.includes(id))))return {abandoned:false,inventory:r};
 const next=journal.abandon(state.revision,r.transaction_id);
 return {abandoned:true,transaction_id:r.transaction_id,revision:next.revision,inventory:inventoryRestart(selectionFile)};
}
module.exports={inventoryRestart,abandonUnsubmitted,providerId};
