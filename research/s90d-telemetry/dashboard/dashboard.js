'use strict';
const palette={gold:'#d8c28f',green:'#a6c89c',blue:'#8cb9cb',purple:'#c5add5'};
const definitions=[
 {id:'cpu',title:'CPU activity',unit:'%',max:100,series:[{name:'Active',color:palette.gold,value:(row,labels)=>{const idle=row[labels.indexOf('idle')],wait=row[labels.indexOf('iowait')];return Number.isFinite(idle)&&Number.isFinite(wait)?Math.max(0,100-idle-wait):null;}}]},
 {id:'memory',title:'Memory',unit:'MiB',series:[{name:'In use',key:'used',color:palette.green},{name:'Available',key:'available',color:palette.blue}]},
 {id:'network',title:'Network traffic',unit:'KiB/s',series:[{name:'Received',key:'read',color:palette.green},{name:'Sent',key:'write',color:palette.blue}]},
 {id:'disk',title:'Storage activity',unit:'KiB/s',series:[{name:'Read',key:'read',color:palette.gold},{name:'Written',key:'write',color:palette.purple}]},
 {id:'collector_cpu',title:'Collector CPU',unit:'% of one core',series:[{name:'Collector',key:'cpu',color:palette.purple}]},
 {id:'collector_memory',title:'Collector memory',unit:'MiB',series:[{name:'Resident memory',key:'rss',color:palette.blue}]}
];
const number=(v,digits=1)=>Number.isFinite(v)?v.toLocaleString(undefined,{maximumFractionDigits:digits}):'—';
const ageText=seconds=>seconds<60?`${Math.floor(seconds)}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:`${Math.floor(seconds/3600)}h ago`;
function duration(seconds){const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return days?`${days}d ${hours}h`:hours?`${hours}h ${minutes}m`:`${minutes}m`;}
const timeText=timestamp=>new Date(timestamp*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
let range=Number(new URLSearchParams(location.search).get('range'))||900;
if(![900,3600,21600,86400].includes(range))range=900;
let device=new URLSearchParams(location.search).get("device")||"s90d";
let paused=false,request=null,generation=0,lastPayload=null,receivedAt=0,connectionFailed=false,timer;
const charts=document.getElementById('charts');
for(const def of definitions){
 const card=document.createElement('article');card.className='chart';card.id='chart-'+def.id;
 card.innerHTML=`<div class="chart-header"><h3>${def.title}</h3><span class="chart-unit">${def.unit}</span></div><div class="legend"></div><svg viewBox="0 0 560 185" role="img" tabindex="0" aria-label="${def.title} history. Use left and right arrow keys to inspect samples."></svg><div class="chart-tip">Loading history…</div>`;
 for(const series of def.series){const label=document.createElement('span'),dot=document.createElement('i');dot.style.backgroundColor=series.color;label.append(dot,document.createTextNode(series.name));card.querySelector('.legend').append(label);}
 charts.append(card);
}
function value(series,row,labels){const v=series.value?series.value(row,labels):row[labels.indexOf(series.key)];return Number.isFinite(v)?v:null;}
function svgElement(tag,attrs={},text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
function renderChart(def,chart,now){
 const card=document.getElementById('chart-'+def.id),svg=card.querySelector('svg'),tip=card.querySelector('.chart-tip');svg.replaceChildren();
 const labels=chart?.labels||[],rows=(chart?.data||[]).slice().sort((a,b)=>a[0]-b[0]);
 const samples=rows.map(row=>({time:row[0],values:def.series.map(series=>value(series,row,labels))}));
 const present=samples.flatMap(sample=>sample.values.filter(v=>v!==null));
 const left=44,right=546,top=12,bottom=153,max=def.max||Math.max(1,...present)*1.18;
 const x=t=>left+(t-(now-range))/range*(right-left),y=v=>bottom-Math.min(max,Math.max(0,v))/max*(bottom-top);
 for(let i=0;i<4;i++){const n=max*i/3,Y=y(n);svg.append(svgElement('line',{x1:left,x2:right,y1:Y,y2:Y,class:'grid'}),svgElement('text',{x:left-9,y:Y+3,'text-anchor':'end'},number(n,n<10?1:0)));}
 for(let i=0;i<4;i++){const t=now-range+range*i/3;svg.append(svgElement('text',{x:left+(right-left)*i/3,y:178,'text-anchor':i===0?'start':i===3?'end':'middle'},timeText(t)));}
 if(!present.length){svg.append(svgElement('text',{x:295,y:80,'text-anchor':'middle',class:'empty-chart'},chart?.error?'History unavailable':'No samples in this window'));tip.textContent=chart?.error||'History appears as the TV sends readings.';return;}
 def.series.forEach((series,index)=>{
  let segment=[];const segments=[];let previousTime=null;
  for(const sample of samples){const v=sample.values[index];if(v===null||(previousTime!==null&&sample.time-previousTime>Math.max(35,range/180*2.5))){if(segment.length)segments.push(segment);segment=[];}if(v!==null)segment.push([x(sample.time),y(v)]);previousTime=sample.time;}
  if(segment.length)segments.push(segment);
  for(const points of segments){const line=points.map(([X,Y],i)=>`${i?'L':'M'}${X.toFixed(2)},${Y.toFixed(2)}`).join(' ');if(points.length>1){svg.append(svgElement('path',{d:`${line} L${points.at(-1)[0]},${bottom} L${points[0][0]},${bottom}Z`,fill:series.color,class:'area'}));svg.append(svgElement('path',{d:line,stroke:series.color,class:'line'}));}else svg.append(svgElement('circle',{cx:points[0][0],cy:points[0][1],r:2,fill:series.color}));}
 });
 const cursor=svgElement('line',{x1:0,x2:0,y1:top,y2:bottom,stroke:'#c8d0bf','stroke-opacity':0,'stroke-dasharray':'3 4'});svg.append(cursor);
 let selected=samples.length-1;
 const defaultText=`${timeText(now-range)} – ${timeText(now)} · Hover or use arrow keys to inspect`;
 tip.textContent=defaultText;
 function show(index){selected=Math.max(0,Math.min(samples.length-1,index));const point=samples[selected],X=x(point.time);cursor.setAttribute('x1',X);cursor.setAttribute('x2',X);cursor.setAttribute('stroke-opacity','.6');tip.textContent=`${new Date(point.time*1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})} · `+def.series.map((s,i)=>`${s.name}: ${number(point.values[i],2)} ${def.unit}`).join(' · ');}
 svg.onpointermove=e=>{const X=(e.clientX-svg.getBoundingClientRect().left)/svg.getBoundingClientRect().width*560;const time=now-range+(X-left)/(right-left)*range;let best=0;for(let i=1;i<samples.length;i++)if(Math.abs(samples[i].time-time)<Math.abs(samples[best].time-time))best=i;show(best);};
 svg.onpointerleave=()=>{cursor.setAttribute('stroke-opacity','0');tip.textContent=defaultText;};
 svg.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();show(selected+(e.key==='ArrowLeft'?-1:1));}};
}
function latestReading(chart,key,now){if(!chart)return null;const index=chart.labels.indexOf(key);const row=chart.data.find(row=>row[0]>=now-45&&Number.isFinite(row[index]));return row?row[index]:null;}
function renderOverview(){
 const overview=document.getElementById('overview');overview.replaceChildren();
 for(const d of lastPayload?.devices||[]){
  const s=d.latest, age=s?Math.max(0,lastPayload.server_time-s.received_at+(Date.now()-receivedAt)/1000):null;
  const online=!connectionFailed&&age!==null&&age<=35, metrics=s?.metrics||{}, cpu=metrics.cpu;
  const card=document.createElement('article'),title=document.createElement('h3'),status=document.createElement('p'),values=document.createElement('p');
  title.textContent=d.name;status.textContent=connectionFailed?'Metrics server disconnected':online?'Receiving · '+ageText(age):age===null?'No telemetry received':'No recent telemetry · '+ageText(age);
  values.textContent=online?`CPU ${number(cpu?100-cpu.idle-cpu.iowait:null)}% · RAM ${number(metrics.memory?.used,0)} MiB · Uptime ${duration(s.uptime)} · Collector ${number(metrics.collector_cpu?.cpu,2)}% / ${number(s.collector_rss_bytes/1048576)} MiB`:'Current readings unavailable';
  card.append(title,status,values);overview.append(card);
 }
}
function updateStatus(){
 renderOverview();
 window.tvInspector.status(paused,connectionFailed);
 const badge=document.getElementById('connection'),freshness=document.getElementById('freshness'),latest=lastPayload?.latest;
 if(connectionFailed){badge.textContent='Dashboard disconnected';badge.className='badge offline';freshness.textContent='Unable to reach the metrics server';return;}
 if(!lastPayload)return;
 const age=latest?Math.max(0,lastPayload.server_time-latest.received_at+(Date.now()-receivedAt)/1000):null;
 if(paused){badge.textContent='View paused';badge.className='badge loading';freshness.textContent='Collection continues on the TV';}
 else if(age===null||age>35){badge.textContent='No recent telemetry';badge.className='badge offline';freshness.textContent=age===null?'Waiting for the TV’s first sample':`Last sample ${ageText(age)}`;}
 else{badge.textContent='Receiving telemetry';badge.className='badge';freshness.textContent=`Last sample ${ageText(age)} · Updates every 10s`;}
 document.getElementById('sample-age').textContent=age===null?'—':ageText(age).replace(' ago','');
 if(!paused&&(age===null||age>35))clearReadings();
}
function clearReadings(){for(const id of ['cpu-value','memory-value','network-value','uptime-value','collector-cpu','collector-memory'])document.getElementById(id).textContent='—';document.getElementById('cpu-meter').style.width='0%';document.getElementById('memory-meter').style.width='0%';document.getElementById('cpu-note').textContent='Waiting for fresh telemetry';document.getElementById('memory-note').textContent='History remains available below';}
function render(payload){
 const select=document.getElementById('device');
 if(!select.options.length)for(const d of payload.devices){const option=document.createElement('option');option.value=d.id;option.textContent=d.name;select.append(option);}
 device=payload.device;select.value=device;document.getElementById('device-name').textContent=payload.name;
 lastPayload=payload;receivedAt=Date.now();connectionFailed=false;
 window.tvInspector.render(payload);
 const latest=payload.latest,online=latest&&payload.server_time-latest.received_at<=35;
 const failed=Object.values(payload.charts).some(c=>c.error)||Object.values(payload.current).some(c=>c.error);
 const notice=document.getElementById('notice');notice.hidden=!failed;notice.textContent='Some Netdata history is unavailable. Retrying automatically.';
 if(online){
  const idle=latestReading(payload.current.cpu,'idle',payload.server_time),wait=latestReading(payload.current.cpu,'iowait',payload.server_time),cpu=idle===null||wait===null?null:Math.max(0,100-idle-wait);
  document.getElementById('cpu-value').textContent=cpu===null?'—':number(cpu)+'%';document.getElementById('cpu-note').textContent='Excludes idle and I/O wait';document.getElementById('cpu-meter').style.width=(cpu||0)+'%';
  const used=latest.memory_total_mib===null?null:latest.memory_total_mib-latest.memory_available_mib,percent=used===null?null:used/latest.memory_total_mib*100;
  document.getElementById('memory-value').textContent=percent===null?'—':number(percent)+'%';document.getElementById('memory-note').textContent=percent===null?'Memory counters unavailable':`${number(used,0)} / ${number(latest.memory_total_mib,0)} MiB · ${number(latest.memory_available_mib,0)} available`;document.getElementById('memory-meter').style.width=(percent||0)+'%';
  const receive=latestReading(payload.current.network,'read',payload.server_time),send=latestReading(payload.current.network,'write',payload.server_time);
  const traffic=document.getElementById('network-value');traffic.replaceChildren();for(const [v,cls,prefix] of [[receive,'receive','↓ '],[send,'send','↑ ']]){const span=document.createElement('span');span.className=cls;span.textContent=prefix+number(v);traffic.append(span);}
  document.getElementById('uptime-value').textContent=duration(latest.uptime);document.getElementById('boot-note').textContent='Boot '+latest.boot.slice(0,8);
  const ownCPU=latestReading(payload.current.collector_cpu,'cpu',payload.server_time);document.getElementById('collector-cpu').textContent=ownCPU===null?'—':number(ownCPU,2)+'%';document.getElementById('collector-memory').textContent=number(latest.collector_rss_bytes/1048576)+' MiB';
 }else clearReadings();
 for(const def of definitions)renderChart(def,payload.charts[def.id],payload.server_time);
 updateStatus();
}
async function refresh(){
 clearTimeout(timer);if(paused||document.hidden)return;
 request?.abort();const controller=new AbortController();request=controller;const epoch=++generation;const timeout=setTimeout(()=>controller.abort(),14000);
 try{const response=await fetch('/api/snapshot?range='+range+'&device='+encodeURIComponent(device),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('Metrics request failed');const payload=await response.json();if(epoch===generation)render(payload);}
 catch(error){if(epoch===generation&&!paused){connectionFailed=true;clearReadings();const notice=document.getElementById('notice');notice.hidden=false;notice.textContent='Cannot reach the metrics server. The charts show the last successful update; retrying automatically.';updateStatus();}}
 finally{clearTimeout(timeout);if(epoch===generation&&!paused)timer=setTimeout(refresh,10000);}
}
function selectRange(){document.querySelectorAll('[data-range]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.range)===range)));}
for(const button of document.querySelectorAll('[data-range]'))button.onclick=()=>{range=Number(button.dataset.range);history.replaceState(null,'','?range='+range+'&device='+encodeURIComponent(device));selectRange();if(paused){paused=false;document.getElementById('pause').textContent='Pause updates';document.getElementById('pause').setAttribute('aria-pressed','false');}refresh();};
document.getElementById('pause').onclick=()=>{paused=!paused;document.getElementById('pause').textContent=paused?'Resume updates':'Pause updates';document.getElementById('pause').setAttribute('aria-pressed',String(paused));if(paused){generation++;request?.abort();clearTimeout(timer);updateStatus();}else refresh();};
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;request?.abort();clearTimeout(timer);}else refresh();});
document.getElementById('device').onchange=e=>{device=e.target.value;lastPayload=null;window.tvInspector.clear(device);clearReadings();document.getElementById('pause').setAttribute('aria-pressed','false');document.getElementById('pause').textContent='Pause updates';paused=false;history.replaceState(null,'','?range='+range+'&device='+encodeURIComponent(device));refresh();};
window.tvInspector.clear(device);setInterval(updateStatus,1000);selectRange();refresh();
