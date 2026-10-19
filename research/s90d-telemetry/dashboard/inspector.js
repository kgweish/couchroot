'use strict';
window.tvInspector=(()=>{
 const el=id=>document.getElementById('inspector-'+id);
 let view='apps',page=0,payload=null,received=0,paused=false,disconnected=false;
 const pageSize=30;
 const flag=v=>v===true?'On':v===false?'Off':'Unknown';
 const disabled=v=>v===true?'Disabled':v===false?'Not disabled':'Unknown';
 const fmt=v=>Number.isFinite(v)?v.toLocaleString(undefined,{maximumFractionDigits:1}):'—';
 const descriptions={
  apps:'Package registry only. Global package and app disable flags are separate; per-user overrides and actual running state are not inferred. Removable is metadata, not a recommendation.',
  processes:'Observed /proc processes. CPU is the average since the preceding inventory, as percent of one core. A first sample or reused PID has no CPU rate. Names can be truncated by the kernel; no app-to-process match is inferred.',
  startup:'Registered app on-boot and auto-restart flags. These do not cover systemd units, helper scripts, dependency launches, or prove that an app started.'
 };
 function retired(){return payload?.device==='qn90a';}
 function section(){return payload?.inspector?.[view==='processes'?'processes':'apps'];}
 function age(){return payload?.latest&&payload?.inspector?Math.max(0,payload.server_time-payload.latest.received_at+payload.latest.uptime-payload.inspector.uptime+(Date.now()-received)/1000):null;}
 function status(p=paused,d=disconnected){
  paused=p;disconnected=d;
  const seconds=age(),badge=el('age');
  badge.className='badge loading';
  if(retired()){badge.textContent='Retired on QN90A';return;}
  if(disconnected){badge.textContent='Disconnected · last snapshot';badge.className='badge offline';}
  else if(seconds===null)badge.textContent='Inventory unavailable';
  else if(paused)badge.textContent='View paused · saved snapshot';
  else {badge.textContent=(seconds>150?'Stale · ':'Snapshot · ')+(seconds<60?Math.floor(seconds)+'s':Math.floor(seconds/60)+'m')+' ago';badge.className=seconds>150?'badge offline':'badge';}
 }
 function cell(row,text,detail){const td=document.createElement('td');td.textContent=text??'Unknown';if(detail){const small=document.createElement('small');small.textContent=detail;td.append(small);}row.append(td);}
 function draw(){
  const off=retired();
  for(const selector of ['.inspector-tools','.inspector-table','.inspector-pages','#inspector-description'])document.querySelector(selector).hidden=off;
  el('note').textContent=off?'Basic telemetry only. Continuous app and process inspection is retired on QN90A.':'Snapshots every minute. App registration, running processes and startup flags describe different states.';
  if(off){el('body').replaceChildren();el('head').replaceChildren();el('status').textContent='';el('page').textContent='';status();return;}
  el('description').textContent=descriptions[view];
  el('sort').disabled=view!=='processes';
  el('search').placeholder=view==='processes'?'Process name or PID':'Name, app ID or package';
  const captions={apps:'Registered apps',processes:'Observed processes',startup:'App startup flags'};
  el('caption').textContent=(payload?.name?payload.name+' · ':'')+captions[view];
  const heads=view==='apps'?['App / package','Version / type','Package flag','App flag','System','Removable']:view==='processes'?['Process','PID','State','Memory · MiB','CPU · % of one core']:['App / package','On boot','Auto-restart','App flag'];
  el('head').replaceChildren();const tr=document.createElement('tr');for(const h of heads){const th=document.createElement('th');th.scope='col';th.textContent=h;tr.append(th);}el('head').append(tr);
  const source=section(),query=el('search').value.trim().toLowerCase(),sort=el('sort').value;
  if(view==='processes'&&source?.scope==='managed-apps')el('description').textContent='The TV restricts /proc visibility. This view includes managed app contexts from Tizen, labeled by app ID. System processes may be absent. Broker memory is shown when available; unknown CPU and state are not inferred.';
  let rows=(source?.rows||[]).filter(r=>(view==='processes'?[r.name,r.pid]:[r.label,r.id,r.package]).join(' ').toLowerCase().includes(query));
  rows=rows.slice().sort((a,b)=>{
   if(view==='processes'&&sort!=='name'){const key=sort==='rss'?'rss_bytes':'cpu_percent';const av=a[key]??-1,bv=b[key]??-1;if(av!==bv)return bv-av;}
   return String(a.label||a.name||a.id).localeCompare(String(b.label||b.name||b.id))||(a.pid||0)-(b.pid||0);
  });
  page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
  el('body').replaceChildren();
  for(const r of rows.slice(page*pageSize,(page+1)*pageSize)){
   const row=document.createElement('tr');
   if(view==='processes'){cell(row,r.name);cell(row,r.pid);cell(row,r.state==='?'?'Unknown':r.state);cell(row,fmt(r.rss_bytes===null?null:r.rss_bytes/1048576));cell(row,fmt(r.cpu_percent));}
   else {cell(row,r.label||r.id,r.id+' · '+r.package);if(view==='apps'){cell(row,r.version,(r.type||'Unknown')+' · '+(r.component||'Unknown'));cell(row,disabled(r.package_disabled));cell(row,disabled(r.app_disabled));cell(row,flag(r.system));cell(row,flag(r.removable));}else{cell(row,flag(r.on_boot));cell(row,flag(r.auto_restart));cell(row,disabled(r.app_disabled));}}
   el('body').append(row);
  }
  el('status').textContent=!source?'No inventory from this collector yet.':source.status==='unavailable'?'This source is unavailable to the collector; it may be inaccessible or unsupported.':source.status==='partial'?`Partial snapshot${source.truncated?' · collection limit reached':''}${source.skipped?' · '+source.skipped+' processes exited or could not be read':''}.`:rows.length?`${rows.length} matching ${view==='processes'?'processes':'apps'}.`:'No matching entries.';
  el('page').textContent=rows.length?`${page*pageSize+1}–${Math.min(rows.length,(page+1)*pageSize)} of ${rows.length}`:'0 entries';
  el('prev').disabled=page===0;el('next').disabled=(page+1)*pageSize>=rows.length;
  status();
 }
 for(const button of document.querySelectorAll('[data-inspector]'))button.onclick=()=>{view=button.dataset.inspector;page=0;for(const b of document.querySelectorAll('[data-inspector]'))b.setAttribute('aria-pressed',String(b===button));draw();};
 el('search').oninput=()=>{page=0;draw();};el('sort').onchange=()=>{page=0;draw();};
 el('prev').onclick=()=>{page--;draw();};el('next').onclick=()=>{page++;draw();};
 draw();
 return {render(value){payload=value;received=Date.now();disconnected=false;draw();},status,clear(device){payload={device};page=0;disconnected=false;draw();}};
})();
