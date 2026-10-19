const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../research/s90d-telemetry/dashboard');
function snapshot(device='s90d'){
 const now=Date.now()/1000;
 const latest={received_at:now,uptime:1000,boot:'fixture-boot',collector_rss_bytes:20000000,memory_total_mib:1000,memory_available_mib:400,metrics:{},unavailable:[]};
 const section=rows=>({rows,status:'ok',truncated:false,skipped:0});
 return {device,name:device.toUpperCase(),server_time:now,latest,devices:['s90d','qn90a'].map(id=>({id,name:id.toUpperCase(),latest})),charts:{},current:{},inspector:{schema:1,uptime:1000,
  apps:section(Array.from({length:64},(_,i)=>({id:device+'.app'+i,package:'package'+i,label:i===0?'<img src=x onerror=alert(1)>':'App '+i,version:'1',type:'tpk',component:'svcapp',system:true,removable:false,package_disabled:false,app_disabled:null,on_boot:i%2===0,auto_restart:false}))),
  processes:section([{pid:42,name:'small',state:'S',rss_bytes:1048576,cpu_percent:null},{pid:43,name:'large',state:'R',rss_bytes:2097152,cpu_percent:25}])}};
}
test('inspector handles search, paging, startup unknowns, process sort, device switch, stale and absent data safely',async()=>{
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','dashboard.css','dashboard.js','inspector.js'].includes(name)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mode='normal';
  await page.route('**/api/snapshot*',async route=>{
   if(mode==='outage')return route.fulfill({status:503,body:'Unavailable'});
   const device=new URL(route.request().url()).searchParams.get('device'),value=snapshot(device);
   if(mode==='stale')value.inspector.uptime=100;
   if(mode==='absent')delete value.inspector;
   if(mode==='partial'){value.inspector.apps.status='partial';value.inspector.apps.truncated=true;}
   if(mode==='managed'){value.inspector.processes.scope='managed-apps';value.inspector.processes.rows[0].rss_bytes=null;value.inspector.processes.rows[0].state='?';}
   await route.fulfill({json:value});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('#inspector-body').children.length===30);
  assert.equal(await page.locator('#inspector-body img').count(),0);
  await page.locator('#inspector-next').click();assert.match(await page.locator('#inspector-page').textContent(),/31–60/);
  await page.locator('#inspector-search').fill('s90d.app63');assert.equal(await page.locator('#inspector-body tr').count(),1);
  await page.locator('[data-inspector="startup"]').click();assert.match(await page.locator('#inspector-body').textContent(),/OffOffUnknown/);
  await page.locator('#inspector-search').fill('');await page.locator('[data-inspector="processes"]').click();await page.locator('#inspector-sort').selectOption('rss');
  assert.match(await page.locator('#inspector-body tr').first().textContent(),/^large43/);
  mode='managed';await page.locator('[data-range="900"]').click();await page.waitForFunction(()=>document.querySelector('#inspector-description').textContent.includes('restricts /proc'));
  assert.match(await page.locator('#inspector-body tr').last().textContent(),/Unknown——/);mode='normal';
  await page.locator('#pause').click();assert.match(await page.locator('#inspector-age').textContent(),/View paused/);
  await page.locator('#device').selectOption('qn90a');await page.waitForFunction(()=>document.querySelector('#inspector-age').textContent==='Retired on QN90A');
  assert.equal(await page.locator('#inspector-body tr').count(),0);
  assert.equal(await page.locator('.inspector-tools').isVisible(),false);
  assert.equal(await page.locator('.inspector-table').isVisible(),false);
  assert.match(await page.locator('#inspector-note').textContent(),/Basic telemetry only/);
  await page.setViewportSize({width:1920,height:1080});
  if(process.env.INSPECTOR_SCREENSHOT)await page.screenshot({path:process.env.INSPECTOR_SCREENSHOT,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if(process.env.INSPECTOR_SCREENSHOT)await page.screenshot({path:process.env.INSPECTOR_SCREENSHOT.replace('.png','-small.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  mode='outage';await page.locator('[data-range="900"]').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Cannot reach'));
  assert.equal(await page.locator('#inspector-age').textContent(),'Retired on QN90A');
  await page.goto('http://127.0.0.1:'+server.address().port+'/?device=qn90a');
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Cannot reach'));
  assert.equal(await page.locator('.inspector-tools').isVisible(),false);
  assert.equal(await page.locator('#inspector-age').textContent(),'Retired on QN90A');
  mode='normal';await page.locator('[data-range="900"]').click();
  await page.waitForFunction(()=>document.querySelector('#device option[value="s90d"]'));
  await page.locator('#device').selectOption('s90d');
  await page.waitForFunction(()=>document.querySelector('#inspector-body').children.length===30);
  assert.equal(await page.locator('.inspector-tools').isVisible(),true);
  assert.doesNotMatch(await page.locator('#inspector-body').textContent(),/qn90a.app/);
  for(const next of ['stale','partial','absent','outage']){
   mode=next;await page.locator('[data-range="900"]').click();
   await page.waitForFunction(mode=>mode==='stale'?document.querySelector('#inspector-age').textContent.includes('Stale'):mode==='partial'?document.querySelector('#inspector-status').textContent.includes('Partial'):mode==='absent'?document.querySelector('#inspector-status').textContent.includes('No inventory'):document.querySelector('#inspector-age').textContent.includes('Disconnected'),next);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
