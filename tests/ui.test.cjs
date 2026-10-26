const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const fixtures = require('../preview/fixtures.js');
let server, browser, base;
before(async()=>{
 server=http.createServer((req,res)=>{
  const name=req.url==='/'?'index.html':req.url.slice(1);
  if(!/^(?:logos\/)?[a-z0-9.-]+$/.test(name)||!fs.existsSync(path.join(__dirname,'../web',name))){res.writeHead(404).end();return;}
  res.setHeader('Content-Type', name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(path.join(__dirname,'../web',name)));
 }).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();server?.close();});
async function setup(options={}) {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 if(options.legacyCss)await page.route('**/style.css',route=>route.fulfill({
  contentType:'text/css',body:fs.readFileSync(path.join(__dirname,'../web/style.css'),'utf8').replace(/font-size:\s*clamp\([^;]+;/g,'')
 }));
 await page.addInitScript(fixtures.install, { ...options, apps: fixtures.catalog('test') });
 if(options.startupUnfocused)await page.addInitScript(()=>{
  window.bootFocused=false;window.bootDiscoveries=0;document.hasFocus=()=>window.bootFocused;
  const discover=tizen.application.getAppsInfo;
  tizen.application.getAppsInfo=(...args)=>{window.bootDiscoveries++;return discover(...args);};
 });
 if(options.tvos){
  await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8').replace('<body>','<body data-design="tvos">')}));
  await page.addInitScript(()=>{tizen.systeminfo={getPropertyValue(property,ok){ok({connected:[{type:'TV',number:0},{type:'HDMI',number:2}],disconnected:[{type:'HDMI',number:1}]});}};});
  await page.route('https://images.unsplash.com/**',route=>route.abort());
 }
 await page.goto(base);await page.waitForTimeout(80);return page;
}
async function key(page,...keys){for(const k of keys)await page.keyboard.press(k);}
async function focusText(page){return page.locator(':focus').textContent();}
const ids=page=>page.locator('#favorites > button').evaluateAll(bs=>bs.map(b=>b.dataset.id));
test('saved shortcuts and remote focus work before initial catalog discovery; foreground starts it once',async()=>{
 const p=await setup({startupUnfocused:true});
 assert.equal((await ids(p)).length,2);assert.equal(await p.evaluate(()=>bootDiscoveries),0);
 await key(p,'ArrowDown','ArrowRight');assert.equal(await focusText(p),'Samsung Home');
 await p.evaluate(()=>{window.bootFocused=true;window.dispatchEvent(new Event('focus'));});
 await p.waitForFunction(()=>bootDiscoveries===1);await p.waitForTimeout(80);
 assert.equal(await focusText(p),'Samsung Home');
 await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForTimeout(30);
 assert.equal(await p.evaluate(()=>bootDiscoveries),1);await p.close();
 const edit=await setup({startupUnfocused:true});
 await edit.locator('#edit-apps').click();await edit.waitForFunction(()=>bootDiscoveries===1);
 await edit.evaluate(()=>{window.bootFocused=true;window.dispatchEvent(new Event('focus'));});await edit.waitForTimeout(80);
 assert.equal(await edit.evaluate(()=>bootDiscoveries),1);await edit.close();
});
test('Home backdrop stays cached while arrows repaint the focused controls',async()=>{
 const p=await setup(),cdp=await p.context().newCDPSession(p);let layers=[];
 cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers||[];});
 await cdp.send('LayerTree.enable');await p.screenshot();
 const {root}=await cdp.send('DOM.getDocument');
 async function layerFor(selector){
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
  const {node}=await cdp.send('DOM.describeNode',{nodeId});
  return layers.find(layer=>layer.backendNodeId===node.backendNodeId&&layer.drawsContent);
 }
 const backdrop=await layerFor('.ambient'),controls=await layerFor('main');
 assert.ok(backdrop,'Backdrop must have a separate cached surface');
 assert.ok(controls,'Interactive controls must paint separately from the backdrop');
 assert.ok(backdrop.width<=1920&&backdrop.height<=1080,'Decorations must not allocate an oversized surface');
 for(const arrow of ['ArrowRight','ArrowLeft','ArrowDown']){
  await key(p,arrow);await p.screenshot(); // Complete a rendered frame, not just event dispatch.
 }
 const tilesBeforeFooter=await layerFor('main'),footer=await layerFor('.bottom-menu');
 assert.ok(footer,'Footer focus and fading must have a small separate surface');
 assert.ok(footer.height<270,'The footer surface must not cover the app tiles');
 for(const arrow of ['ArrowRight','ArrowLeft']){await key(p,arrow);await p.screenshot();}
 assert.equal((await layerFor('main')).paintCount,tilesBeforeFooter.paintCount,'Footer arrows must not repaint app tiles');
 assert.ok((await layerFor('.bottom-menu')).paintCount>footer.paintCount);
 await key(p,'ArrowUp');await p.screenshot();
 const after=await layerFor('.ambient');
 assert.equal(after.layerId,backdrop.layerId);
 assert.equal(after.paintCount,backdrop.paintCount,'Arrow navigation must reuse the painted backdrop');
 assert.ok((await layerFor('main')).paintCount>controls.paintCount,'The test must exercise actual control painting');
 await p.close();
});
test('older TV CSS keeps readable logos, separated controls and full-screen utility pages',async()=>{
 const p=await setup({legacyCss:true});
 await p.evaluate(()=>document.documentElement.classList.add('no-flex-gap'));
 assert.ok(await p.locator('.plex-word').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>100);
 const controls=await p.locator('footer > button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};}));
 assert.ok(controls[1].left-controls[0].right>30);
 assert.ok(controls[2].left-controls[1].right>30);
 await p.locator('#edit-apps').click();
 assert.deepEqual(await p.locator('#editor').boundingBox(),{x:0,y:0,width:1920,height:1080});
 await key(p,'Escape');await p.locator('#settings').click();
 assert.deepEqual(await p.locator('#settings-dialog').boundingBox(),{x:0,y:0,width:1920,height:1080});
 await key(p,'Escape');assert.equal(await p.locator('#favorites').isVisible(),true);await p.close();
});
test('remote add, order save/cancel, restart persistence, remove, empty Home and fallback',async()=>{
 const p=await setup();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 assert.equal((await ids(p)).length,2);
 await key(p,'ArrowDown','Enter');assert.equal(await focusText(p),'Add apps');
 await key(p,'Enter');await p.waitForTimeout(80);assert.match(await focusText(p),/App 00/);
 await key(p,'Enter');assert.match(await p.locator('#editor-status').textContent(),/added/);
 await key(p,'Escape','Escape');assert.equal((await ids(p)).length,3);
 await key(p,'ArrowUp','ArrowRight','ArrowRight','Enter');assert.deepEqual(await p.evaluate(()=>launches),['Store00001.app0']);
 await key(p,'ArrowDown','ArrowLeft','ArrowLeft','Enter','ArrowDown','ArrowDown','ArrowDown','Enter','Enter','ArrowUp','Escape');
 assert.deepEqual((await p.evaluate(()=>JSON.parse(localStorage.getItem('minimal-hub.shortcuts.v1')).apps)).map(a=>a.id),['kIciSQlYEM.plex','9Ur5IzDKqV.TizenYouTube','Store00001.app0']);
 await key(p,'Enter','Enter','ArrowLeft','ArrowLeft','Enter','Escape');
 assert.equal((await ids(p))[0],'Store00001.app0');await p.reload();await p.waitForTimeout(80);assert.equal((await ids(p))[0],'Store00001.app0');
 await key(p,'ArrowDown','Enter','ArrowDown','Enter','ArrowRight','Enter');assert.match(await p.locator('#editor-status').textContent(),/Undo remove/);
 await key(p,'Escape');assert.equal((await ids(p)).length,2);
 // Remove each remaining shortcut through the actual editor.
 for(let i=0;i<2;i++){await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','ArrowRight','Enter','Escape');}
 assert.equal((await ids(p)).length,0);assert.equal(await p.locator('#empty-home').isVisible(),true);
 await p.reload();await p.waitForTimeout(80);assert.equal((await ids(p)).length,0);
 // Empty Home offers Add apps first; Back returns to the hub and Samsung Home stays reachable.
 assert.equal(await p.locator(':focus').getAttribute('id'),'empty-add');
 await key(p,'Enter');await p.waitForTimeout(80);assert.equal(await p.locator('#editor-title').textContent(),'Add apps');
 await key(p,'Escape','Escape');assert.equal(await p.locator(':focus').getAttribute('id'),'edit-apps');
 await key(p,'ArrowRight','Enter');assert.equal((await p.evaluate(()=>launches)).at(-1),'com.samsung.tv.csfs');
 assert.deepEqual(errors,[]);await p.close();
});
test('picker scroll, unavailable app, icon fallback, launch/storage/discovery failure and focus trap',async()=>{
 const p=await setup();
 await p.locator('#edit-apps').click();await key(p,'Enter');await p.waitForTimeout(80);
 for(let i=0;i<12;i++)await key(p,'ArrowDown');
 assert.ok(await p.locator('#editor-list').evaluate(e=>e.scrollTop)>0);
 const rect=await p.locator(':focus').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=1080);
 await key(p,'Escape','Escape');
 await p.evaluate(()=>{window.testApps=[];window.launchFail=true;});
 await p.locator('#edit-apps').click();await p.waitForTimeout(80);await key(p,'Escape','ArrowUp','Enter');
 assert.match(await p.locator('#launch-error-title').textContent(),/Could not open/);assert.equal(await p.locator('.unavailable').count(),2);await key(p,'Escape');
 await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','ArrowRight');
 await p.evaluate(()=>Storage.prototype.setItem=function(){throw Error('QuotaExceeded');});await key(p,'Enter');
 assert.match(await p.locator('#editor-status').textContent(),/Could not save/);await key(p,'Escape','Escape');assert.equal((await ids(p)).length,2);
 await key(p,'Escape','Escape');assert.equal(await p.locator('#favorites').isVisible(),true);assert.deepEqual(await p.evaluate(()=>launches),['kIciSQlYEM.plex']);
 await p.close();
 const denied=await setup({discoveryFail:true});await denied.locator('#edit-apps').click();await key(denied,'Enter');await denied.waitForTimeout(80);assert.match(await denied.locator('#editor-status').textContent(),/Could not list/);assert.equal(await denied.locator('#editor-list button').count(),0);await denied.close();
});
test('large saved grid scrolls with arrows; broken icon keeps initials; fallback stays reachable',async()=>{
 const p=await setup();
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:window.testApps.slice(2)})));
 await p.reload();await p.waitForTimeout(80);
 await p.evaluate(()=>{window.testApps[2].iconPath='/missing-app-icon.png';});
 await p.locator('#edit-apps').click();await p.waitForTimeout(80);await key(p,'Escape');
 const first=p.locator('#favorites > button').first();await first.locator('img').waitFor({state:'detached'});assert.equal(await first.locator('img').count(),0);assert.match(await first.textContent(),/App 00/);
 await key(p,'ArrowUp','ArrowUp','ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowDown');
 assert.ok(await p.locator('#favorites').evaluate(e=>e.scrollTop)>0);
 const r=await p.locator(':focus').boundingBox();assert.ok(r.y>=0&&r.y+r.height<1080);
 await key(p,'ArrowDown','ArrowRight');assert.match(await focusText(p),/Samsung Home/);
 const home=await p.locator(':focus').boundingBox();assert.ok(home.y+home.height<1080);
 await p.close();
});
test('late discovery preserves toolbar focus',async()=>{
 const p=await setup();
 await p.evaluate(()=>{const get=tizen.application.getAppsInfo;tizen.application.getAppsInfo=(ok,fail)=>setTimeout(()=>get(ok,fail),250);});
 await key(p,'ArrowDown','Enter','ArrowRight');
 assert.equal(await focusText(p),'Done');await p.waitForTimeout(350);assert.equal(await focusText(p),'Done');await p.close();
});
test('gear settings persist sound/layout, navigate four columns, confirm reset, and trap focus',async()=>{
 const p=await setup();
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:window.testApps.slice(2)})));
 await p.reload();await p.waitForTimeout(80);await p.locator('#settings').click();
 assert.equal(await p.locator(':focus').getAttribute('id'),'setting-sound');
 await key(p,'Enter','ArrowDown','Enter');assert.equal(await p.locator('#sound-value').textContent(),'Off');assert.equal(await p.locator('#layout-value').textContent(),'Compact');
 await key(p,'ArrowDown','ArrowDown','ArrowDown','ArrowDown','Enter');assert.equal(await p.locator(':focus').getAttribute('id'),'reset-cancel');
 await key(p,'Tab');assert.equal(await p.locator(':focus').getAttribute('id'),'reset-confirm');await key(p,'Tab');assert.equal(await p.locator(':focus').getAttribute('id'),'reset-cancel');
 await key(p,'Escape','Escape');assert.equal((await ids(p)).length,12);assert.equal(await p.locator('.apps.compact').count(),1);
 await p.reload();await p.waitForTimeout(80);await key(p,'ArrowDown');assert.equal(await p.locator(':focus').getAttribute('data-id'),'Store00001.app4');
 await p.locator('#settings').click();assert.equal(await p.locator('#sound-value').textContent(),'Off');assert.equal(await p.locator('#layout-value').textContent(),'Compact');
 await key(p,'ArrowDown','ArrowDown','ArrowDown','ArrowDown','ArrowDown','Enter','ArrowRight','Enter');assert.match(await p.locator('#settings-status').textContent(),/restored/);
 await key(p,'Escape');assert.deepEqual(await ids(p),['kIciSQlYEM.plex','9Ur5IzDKqV.TizenYouTube']);
 assert.equal(await p.evaluate(()=>localStorage.getItem('minimal-hub.sound.v1')),'off');assert.equal(await p.evaluate(()=>localStorage.getItem('minimal-hub.layout.v1')),'compact');await p.close();
});
test('settings failed saves preserve preferences and shortcuts; repeated Back stays in hub',async()=>{
 const p=await setup();await p.locator('#settings').click();
 await p.evaluate(()=>Storage.prototype.setItem=function(){throw Error('QuotaExceeded');});
 await key(p,'Enter');assert.match(await p.locator('#settings-status').textContent(),/Could not save/);assert.equal(await p.locator('#sound-value').textContent(),'On');
 await key(p,'ArrowDown','Enter');assert.match(await p.locator('#settings-status').textContent(),/Could not save/);assert.equal(await p.locator('#layout-value').textContent(),'Comfortable');
 await key(p,'ArrowDown','Enter');assert.equal(await p.locator('#fade-value').textContent(),'Auto-dim');assert.match(await p.locator('#settings-status').textContent(),/Could not save/);
 await key(p,'ArrowDown','Enter');assert.equal(await p.locator('#clock-value').textContent(),'Off');assert.match(await p.locator('#settings-status').textContent(),/Could not save/);
 await key(p,'ArrowDown','Enter');assert.equal(await p.locator('#start-value').textContent(),'Last selected');assert.match(await p.locator('#settings-status').textContent(),/Could not save/);
 await key(p,'ArrowDown','Enter','ArrowRight','Enter');assert.match(await p.locator('#settings-status').textContent(),/previous list is unchanged/);
 await key(p,'Escape','Escape','Escape');assert.equal(await p.locator('#settings-dialog').isVisible(),false);assert.deepEqual(await p.evaluate(()=>launches),[]);
 const consumed=await p.evaluate(()=>[false,true,false].map(repeat=>{const e=new KeyboardEvent('keydown',{key:'Back',keyCode:10009,repeat,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented;}));assert.deepEqual(consumed,[true,true,true]);
 assert.deepEqual(await p.evaluate(()=>launches),[]);await p.locator('[data-app="home"]').click();assert.deepEqual(await p.evaluate(()=>launches),['com.samsung.tv.csfs']);await p.close();
});
test('editor artwork follows focus and moving retains tile artwork; settings preview follows values',async()=>{
 const p=await setup();await p.locator('#edit-apps').click();await key(p,'ArrowDown','ArrowDown');
 assert.equal(await p.locator('#preview-name').textContent(),'YouTube');assert.equal(await p.locator('#preview-art .youtube-logo').count(),1);
 await key(p,'Enter','Enter','ArrowLeft');
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'9Ur5IzDKqV.TizenYouTube');assert.equal(await p.locator('#move-position').textContent(),'Position 1 of 2');assert.equal(await p.locator(':focus .youtube-logo').count(),1);
 await key(p,'Escape','Escape');await p.locator('#settings').click();await key(p,'ArrowDown');assert.equal(await p.locator('#setting-visual > span').count(),6);
 await key(p,'Enter');assert.equal(await p.locator('#setting-visual > span').count(),8);await key(p,'ArrowUp','Enter');assert.equal(await p.locator('#setting-visual.quiet').count(),1);await p.close();
});

test('idle menu dims without moving focus, restores on first key, and stays visible for controls and errors',async()=>{
 const p=await setup();await p.clock.install();
 await key(p,'ArrowRight');await p.clock.fastForward(8500);assert.equal(await p.locator('.bottom-menu.idle').count(),1);
 await key(p,'ArrowLeft');assert.equal(await p.locator('.bottom-menu.idle').count(),0);assert.equal(await p.locator(':focus').getAttribute('data-id'),'kIciSQlYEM.plex');
 await key(p,'ArrowDown');await p.clock.fastForward(10000);assert.equal(await p.locator('.bottom-menu.idle').count(),0);
 await key(p,'ArrowUp');await p.evaluate(()=>window.launchFail=true);await key(p,'Enter');await p.clock.fastForward(10000);assert.equal(await p.locator('.bottom-menu.idle').count(),0);await p.close();
});
test('clock cycles off/12/24, idle preference persists, and minute display refreshes',async()=>{
 const p=await setup();await p.clock.install({time:new Date(2026,8,20,13,8,0)});
 await p.locator('#settings').click();await key(p,'ArrowDown','ArrowDown','Enter');assert.equal(await p.locator('#fade-value').textContent(),'Always visible');
 await key(p,'ArrowDown','Enter');assert.equal(await p.locator('#clock-value').textContent(),'12-hour');await key(p,'Escape');assert.equal(await p.locator('#home-clock').textContent(),'1:08 PM');
 await p.clock.fastForward(61000);assert.equal(await p.locator('#home-clock').textContent(),'1:09 PM');
 await p.locator('#settings').click();await key(p,'ArrowDown','ArrowDown','ArrowDown','Enter');assert.equal(await p.locator('#clock-value').textContent(),'24-hour');await key(p,'Escape');assert.equal(await p.locator('#home-clock').textContent(),'13:09');
 await p.reload();await p.waitForTimeout(80);assert.equal(await p.locator('#home-clock').isVisible(),true);await p.clock.fastForward(10000);assert.equal(await p.locator('.bottom-menu.idle').count(),0);
 await p.locator('#settings').click();await key(p,'ArrowDown','ArrowDown','ArrowDown','Enter','Escape');assert.equal(await p.locator('#home-clock').isVisible(),false);await p.close();
});

test('launch expands selected tile and moves neighbors without delaying launch; failure/reduced motion recover',async()=>{
 const p=await setup();await p.clock.install();await key(p,'Enter');assert.deepEqual(await p.evaluate(()=>launches),['kIciSQlYEM.plex']);
 assert.equal(await p.locator('.launch-selected').count(),1);assert.match(await p.locator('#favorites > button').first().getAttribute('style'),/scale\(1\.12\)/);
 assert.match(await p.locator('#favorites > button').nth(1).getAttribute('style'),/translateX/);
 await p.clock.runFor(1200);assert.equal(await p.locator('.launch-motion').count(),0);await key(p,'Escape');
 await p.evaluate(()=>window.launchFail=true);await key(p,'Enter');assert.equal(await p.locator('.launch-motion').count(),0);assert.match(await p.locator('#launch-error-title').textContent(),/Could not open/);
 await p.evaluate(()=>window.launchFail=false);await p.emulateMedia({reducedMotion:'reduce'});await key(p,'Escape','ArrowRight','Enter');assert.equal(await p.locator('.launch-motion').count(),0);assert.equal((await p.evaluate(()=>launches)).at(-1),'9Ur5IzDKqV.TizenYouTube');await p.close();
});

test('launch measures tiles before applying animation styles',async()=>{
 const p=await setup();
 const reads=await p.evaluate(()=>{
  const grid=document.getElementById('favorites'),read=Element.prototype.getBoundingClientRect,reads=[];
  Element.prototype.getBoundingClientRect=function(){
   if(this.parentElement===grid)reads.push({id:this.dataset.id,afterAnimation:grid.classList.contains('launch-motion')});
   return read.call(this);
  };
  try{grid.firstElementChild.click();}finally{Element.prototype.getBoundingClientRect=read;}
  return reads;
 });
 assert.deepEqual(reads.map(read=>read.id),['kIciSQlYEM.plex','9Ur5IzDKqV.TizenYouTube']);
 assert.ok(reads.every(read=>!read.afterAnimation),'Geometry reads must finish before animation changes');
 assert.deepEqual(await p.evaluate(()=>launches),['kIciSQlYEM.plex']);
 await p.close();
});

test('Gallery launch effects avoid resize passes',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>{window.launchResizes=0;window.addEventListener('resize',()=>window.launchResizes++);});
 await key(p,'Enter');
 assert.equal(await p.evaluate(()=>launchResizes),0,'Launch classes must not trigger caption layout work');
 await key(p,'Escape');
 assert.equal(await p.evaluate(()=>launchResizes),0,'Clearing launch classes must not trigger caption layout work');
 assert.equal(await p.locator('.design-caption').count(),(await ids(p)).length);
 await p.close();
});

test('core Settings skips monitoring and keeps reset and hold controls reachable',async()=>{
 const p=await setup();
 assert.equal(await p.evaluate(()=>typeof window.HubTelemetry),'undefined');
 await p.locator('#settings').click();
 assert.equal(await p.getByRole('button',{name:/TV monitoring/}).count(),0);
 await p.locator('#setting-start').focus();await key(p,'ArrowDown');
 assert.equal(await p.locator(':focus').getAttribute('id'),'setting-reset');
 await key(p,'Enter');assert.equal(await p.locator('#reset-dialog').isVisible(),true);
 await key(p,'Escape','ArrowDown');assert.equal(await p.locator(':focus').getAttribute('id'),'setting-hold');
 await key(p,'Escape');assert.equal(await p.locator('#favorites').isVisible(),true);
 await p.clock.install();await p.clock.fastForward(120000);
 assert.deepEqual(await p.evaluate(()=>launches),[]);await p.close();
});
test('scrolled tiles keep the focus-ring gutter and normal opacity; late discovery keeps the added confirmation; options list uses up/down',async()=>{
 const p=await setup({discoveryDelay:200});
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:window.testApps.slice(2,13)})));
 await p.reload();await p.waitForTimeout(300);await key(p,'ArrowDown','ArrowDown','ArrowDown');
 const room=await p.evaluate(()=>document.getElementById('favorites').getBoundingClientRect().bottom-document.activeElement.getBoundingClientRect().bottom);
 assert.ok(room>=10,`focus ring gutter was ${room}px`);await p.locator('#home-scroll.can-scroll-up').waitFor({state:'attached'});assert.equal(await p.locator('#home-scroll.can-scroll-up').count(),1);
 assert.ok(await p.locator('#favorites > button').evaluateAll(bs=>bs.every(b=>getComputedStyle(b).opacity==='1')));
 await p.locator('#edit-apps').click();await key(p,'Enter');for(let i=0;i<11;i++)await key(p,'ArrowDown');assert.match(await focusText(p),/App 11/);
 await key(p,'Enter');await p.waitForTimeout(300);assert.match(await p.locator('#editor-status').textContent(),/App 11 added/);assert.match(await focusText(p),/App 11/);
 await key(p,'Escape','ArrowDown','Enter','ArrowDown');assert.match(await focusText(p),/Remove from Home/);
 await key(p,'ArrowDown','Enter');assert.equal(await p.locator('#editor').getAttribute('data-mode'),'edit');await p.close();
});

test('selection survives immediate reload; first-favorite preference, removed selection and empty Home have predictable focus',async()=>{
 const p=await setup();
 await key(p,'ArrowRight');await p.reload();await p.waitForTimeout(80);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'9Ur5IzDKqV.TizenYouTube');
 assert.deepEqual(await ids(p),['kIciSQlYEM.plex','9Ur5IzDKqV.TizenYouTube']);
 await p.locator('#settings').click();await p.locator('#setting-start').click();
 assert.equal(await p.locator('#start-value').textContent(),'First favorite');
 await key(p,'Escape');await p.reload();await p.waitForTimeout(80);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'kIciSQlYEM.plex');
 // Starting on the first favorite does not change focus restoration on app return.
 await key(p,'ArrowRight');await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(80);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'9Ur5IzDKqV.TizenYouTube');
 await p.locator('#settings').click();await p.locator('#setting-start').click();await key(p,'Escape');
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:window.testApps.slice(0,1)})));
 await p.reload();await p.waitForTimeout(80);assert.equal(await p.locator(':focus').getAttribute('data-id'),'kIciSQlYEM.plex');
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[]})));
 await p.reload();await p.waitForTimeout(80);assert.equal(await p.locator(':focus').getAttribute('id'),'empty-add');
 assert.equal(await p.locator('#home-scroll').isVisible(),false);await p.close();
});

test('selection save failures keep remote navigation usable and late Home discovery preserves footer focus',async()=>{
 const p=await setup({discoveryDelay:500});
 await key(p,'ArrowDown','ArrowRight');await p.waitForTimeout(600);
 assert.equal(await focusText(p),'Samsung Home');
 await p.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('QuotaExceeded');};});
 await key(p,'ArrowUp');await p.waitForTimeout(300);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'9Ur5IzDKqV.TizenYouTube');
 assert.match(await p.locator('#status').textContent(),/Could not remember/);
 await key(p,'Enter');assert.equal((await p.evaluate(()=>launches)).at(-1),'9Ur5IzDKqV.TizenYouTube');await p.close();
});

test('launch errors offer remote retry and Samsung Home, trap focus and restore the failed tile on Back',async()=>{
 const p=await setup({launchFail:true,discoveryDelay:300});
 await key(p,'ArrowRight','Enter');await p.waitForTimeout(350);
 assert.equal(await p.locator('#launch-error-title').textContent(),'Could not open YouTube');
 assert.equal(await p.locator(':focus').getAttribute('id'),'launch-cancel');
 assert.equal(await p.locator('#status').textContent(),'');
 await key(p,'Tab','Tab','Tab');assert.equal(await p.locator(':focus').getAttribute('id'),'launch-cancel');
 await key(p,'Escape');assert.equal(await p.locator(':focus').getAttribute('data-id'),'9Ur5IzDKqV.TizenYouTube');
 await key(p,'Enter','ArrowRight');await p.evaluate(()=>window.launchFail=false);await key(p,'Enter');
 assert.equal(await p.locator('#launch-error-dialog').isVisible(),false);
 assert.deepEqual(await p.evaluate(()=>launches),['9Ur5IzDKqV.TizenYouTube','9Ur5IzDKqV.TizenYouTube','9Ur5IzDKqV.TizenYouTube']);
 await key(p,'Escape');await p.evaluate(()=>window.launchFail=true);await key(p,'Enter','ArrowRight','ArrowRight','Enter');
 assert.equal(await p.locator('#launch-error-title').textContent(),'Could not open Samsung Home');
 assert.equal(await p.locator('#launch-home').isVisible(),false);
 await key(p,'Tab','Tab');assert.equal(await p.locator(':focus').getAttribute('id'),'launch-cancel');
 await key(p,'Escape');assert.equal(await focusText(p),'Samsung Home');await p.close();
});

test('launch timeout can retry; late callbacks and abandoned launches cannot interrupt another screen',async()=>{
 const p=await setup();await p.clock.install();
 await p.evaluate(()=>{window.pending=[];tizen.application.launch=(id,ok,fail)=>{launches.push(id);pending.push({ok,fail});};});
 await key(p,'Enter','Enter');assert.equal((await p.evaluate(()=>launches)).length,1);
 await p.clock.fastForward(10001);assert.match(await p.locator('#launch-error-detail').textContent(),/did not respond/);
 await key(p,'ArrowRight','Enter');assert.equal((await p.evaluate(()=>launches)).length,2);
 await p.evaluate(()=>pending[0].fail({name:'LateError'}));assert.equal(await p.locator('#launch-error-dialog').isVisible(),false);
 await p.evaluate(()=>pending[1].ok());assert.match(await p.locator('#status').textContent(),/Opening/);
 await key(p,'Escape','Enter');await p.locator('#settings').click();
 await p.evaluate(()=>pending[2].fail({name:'LateError'}));await p.clock.fastForward(11000);
 assert.equal(await p.locator('#settings-dialog').isVisible(),true);assert.equal(await p.locator('#launch-error-dialog').isVisible(),false);
 await key(p,'Escape');assert.equal(await p.locator('#status').textContent(),'');await p.close();
});

test('scroll cues follow Home and list boundaries at both viewport sizes without dimming apps',async()=>{
 for(const viewport of [{width:1920,height:1080},{width:960,height:540}]){
  const p=await setup();await p.setViewportSize(viewport);
  await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:window.testApps})));
  await p.reload();await p.locator('#home-scroll.can-scroll-down:not(.can-scroll-up)').waitFor({state:'attached',timeout:3000});
  assert.equal(await p.locator('#home-scroll.can-scroll-down').count(),1);assert.equal(await p.locator('#home-scroll.can-scroll-up').count(),0);
  for(let i=0;i<4;i++)await key(p,'ArrowDown');await p.locator('#home-scroll.can-scroll-up:not(.can-scroll-down)').waitFor({state:'attached',timeout:3000});
  assert.equal(await p.locator('#home-scroll.can-scroll-up').count(),1);assert.equal(await p.locator('#home-scroll.can-scroll-down').count(),0);
  assert.ok(await p.locator('#favorites > button').evaluateAll(bs=>bs.every(b=>getComputedStyle(b).opacity==='1')));
  await p.locator('#edit-apps').click();await p.locator('#editor-scroll.can-scroll-down').waitFor({state:'attached',timeout:3000});assert.equal(await p.locator('#editor-scroll.can-scroll-down').count(),1);
  for(let i=0;i<14;i++)await key(p,'ArrowDown');await p.locator('#editor-scroll.can-scroll-up:not(.can-scroll-down)').waitFor({state:'attached',timeout:3000});
  assert.equal(await p.locator('#editor-scroll.can-scroll-up').count(),1);assert.equal(await p.locator('#editor-scroll.can-scroll-down').count(),0);
  await key(p,'Escape');await p.locator('#settings').click();
  for(let i=0;i<6;i++)await key(p,'ArrowDown');
  const box=await p.locator(':focus').boundingBox();assert.ok(box.y>=0&&box.y+box.height<viewport.height);
  await p.close();
 }
});

test('return reuses unchanged tiles, defers discovery, and refreshes changed app data without stealing focus',async()=>{
 const p=await setup();await p.clock.install();
 await p.evaluate(()=>{
  window.originalTiles=Array.from(document.querySelector('#favorites').children);window.discoveries=0;
  const discover=tizen.application.getAppsInfo;tizen.application.getAppsInfo=(...args)=>{discoveries++;discover(...args);};
  document.dispatchEvent(new Event('visibilitychange'));
 });
 assert.equal(await p.evaluate(()=>discoveries),0);
 assert.equal(await p.evaluate(()=>originalTiles.every((tile,i)=>tile===document.querySelector('#favorites').children[i])),true);
 await key(p,'ArrowDown','ArrowRight');await p.clock.fastForward(200);await p.clock.fastForward(30);
 assert.equal(await p.evaluate(()=>discoveries),1);
 assert.equal(await p.evaluate(()=>originalTiles.every((tile,i)=>tile===document.querySelector('#favorites').children[i])),true);
 assert.equal(await focusText(p),'Samsung Home');
 await p.evaluate(()=>{testApps[1].name='Renamed YouTube';document.dispatchEvent(new Event('visibilitychange'));});
 await key(p,'ArrowDown','ArrowRight');await p.clock.fastForward(200);await p.clock.fastForward(30);
 assert.equal(await p.locator('#favorites button').nth(1).getAttribute('aria-label'),'Open Renamed YouTube');
 assert.equal(await focusText(p),'Samsung Home');await p.close();
});

test('grid move follows rows in both layouts, reuses its tile, cancels, and preserves the draft after a failed save',async()=>{
 for(const columns of [3,4]){
  const p=await setup();
  await p.evaluate(columns=>{localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:testApps.slice(0,7)}));localStorage.setItem('minimal-hub.layout.v1',columns===4?'compact':'comfortable');},columns);
  await p.reload();await p.waitForTimeout(80);
  const before=await ids(p);
  await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','Enter');
  await p.evaluate(()=>window.movedTile=document.activeElement);
  await key(p,'ArrowDown');assert.equal((await ids(p))[columns],before[0]);
  assert.equal(await p.evaluate(()=>movedTile===document.activeElement),true);
  assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('minimal-hub.shortcuts.v1')).apps.map(a=>a.id)),before);
  await key(p,'ArrowRight',columns===3?'ArrowDown':'ArrowRight');assert.equal((await ids(p))[6],before[0]);
  // Bottom-row Down reaches safe Cancel; Up restores the selected tile.
  await key(p,'ArrowDown');assert.equal(await p.locator(':focus').getAttribute('id'),'move-cancel');
  await key(p,'ArrowUp');assert.equal(await p.evaluate(()=>movedTile===document.activeElement),true);
  await key(p,'Escape','Escape');assert.deepEqual(await ids(p),before);
  await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','Enter','ArrowRight');
  await p.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('Quota');};});
  await key(p,'Enter');assert.match(await p.locator('#move-status').textContent(),/Could not save/);
  assert.equal(await p.locator('#move-banner').isVisible(),true);
  await p.evaluate(()=>Storage.prototype.setItem=realSet);await key(p,'Enter','Escape');
  assert.equal((await ids(p))[1],before[0]);await p.reload();await p.waitForTimeout(80);assert.equal((await ids(p))[1],before[0]);await p.close();
 }
});

test('undo restores original position, preserves later additions, and survives a failed write',async()=>{
 const p=await setup();const before=await ids(p);
 await p.locator('#edit-apps').click();await key(p,'ArrowDown','ArrowDown','Enter','ArrowDown','Enter');
 await p.locator('#editor-actions button').first().click();await p.waitForTimeout(80);await key(p,'Enter','Escape','Escape');
 await p.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('Quota');};});
 await p.locator('#undo-remove').click();assert.match(await p.locator('#status').textContent(),/Could not save/);assert.equal(await p.locator('#undo-remove').isVisible(),true);
 await p.evaluate(()=>Storage.prototype.setItem=realSet);await key(p,'Enter');
 assert.deepEqual(await ids(p),[...before,'Store00001.app0']);assert.equal(await p.locator('#undo-remove').isVisible(),false);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),before[1]);
 await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','ArrowDown','Enter','Escape');
 await p.locator('#settings').click();await p.locator('#setting-reset').click();await key(p,'ArrowRight','Enter','Escape');
 assert.equal(await p.locator('#undo-remove').isVisible(),false);assert.deepEqual(await ids(p),before);await p.close();
});

test('optional hold OK opens actions only after holding, taps launch on release, and interrupted holds cancel',async()=>{
 const p=await setup();await p.clock.install();
 await p.keyboard.down('Enter');assert.equal(await p.evaluate(()=>launches.length),1);await p.keyboard.up('Enter');await key(p,'Escape');
 await p.locator('#settings').click();await p.locator('#setting-hold').click();await key(p,'Escape','ArrowUp');
 await p.keyboard.down('Enter');assert.equal(await p.evaluate(()=>launches.length),1);
 await p.clock.fastForward(100);await p.keyboard.up('Enter');assert.equal(await p.evaluate(()=>launches.length),2);await key(p,'Escape');
 await p.keyboard.down('Enter');await p.clock.fastForward(700);await p.keyboard.down('Enter');await p.keyboard.up('Enter');
 assert.equal(await p.locator('#editor').getAttribute('data-mode'),'options');assert.equal(await p.evaluate(()=>launches.length),2);
 await key(p,'Enter','ArrowLeft','Enter');assert.equal(await p.locator('#editor').isVisible(),false);assert.match(await p.locator('#status').textContent(),/saved/);
 for(const interrupt of ['back','arrow','blur','visibility']){
  await p.keyboard.down('Enter');
  if(interrupt==='back')await key(p,'Escape');
  else if(interrupt==='arrow')await key(p,'ArrowRight');
  else await p.evaluate(type=>type==='blur'?window.dispatchEvent(new Event('blur')):document.dispatchEvent(new Event('visibilitychange')),interrupt);
  await p.clock.fastForward(700);await p.keyboard.up('Enter');assert.equal(await p.locator('#editor').isVisible(),false);assert.equal(await p.evaluate(()=>launches.length),2);
 }
 await p.reload();await p.waitForTimeout(80);await p.locator('#settings').click();assert.equal(await p.locator('#hold-value').textContent(),'On');await p.close();
});

test('accepted launch keeps progress until hidden; duplicate requests and stale callbacks are suppressed',async()=>{
 const p=await setup();await p.clock.install();await p.emulateMedia({reducedMotion:'reduce'});
 await key(p,'Enter','Enter');assert.equal(await p.evaluate(()=>launches.length),1);assert.equal(await p.locator('.launch-label').count(),1);
 assert.equal(await p.locator('#favorites button').first().getAttribute('aria-busy'),'true');
 await p.clock.fastForward(10001);assert.match(await p.locator('#launch-error-detail').textContent(),/accepted the request/);
 await key(p,'Escape','Enter');
 await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await p.locator('.launch-label').count(),0);
 await p.clock.fastForward(11000);assert.equal(await p.locator('#launch-error-dialog').isVisible(),false);
 await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await key(p,'Enter');assert.equal(await p.evaluate(()=>launches.length),3);await key(p,'Escape');assert.equal(await p.locator('.launch-label').count(),0);await p.close();
});

test('Samsung Home overlay can be accepted while Hub stays visible; missing callbacks still time out',async()=>{
 const p=await setup();await p.clock.install();
 await p.locator('[data-app="home"]').click();
 assert.deepEqual(await p.evaluate(()=>launches),['com.samsung.tv.csfs']);
 assert.equal(await p.evaluate(()=>document.hidden),false);
 await p.clock.fastForward(11000);
 assert.equal(await p.locator('#launch-error-dialog').isVisible(),false);
 assert.equal(await p.locator('#status').textContent(),'');
 await p.evaluate(()=>{tizen.application.launch=(id)=>launches.push(id);});
 await key(p,'Enter');assert.equal(await p.evaluate(()=>launches.length),2);
 await p.clock.fastForward(11000);
 assert.equal(await p.locator('#launch-error-title').textContent(),'Could not open Samsung Home');
 await key(p,'Escape');assert.equal(await focusText(p),'Samsung Home');await p.close();
});

test('S89C uses installed IDs, five-column arrows and source fallback while preserving edited and empty Home',async()=>{
 const p=await setup({tvos:true});p.setDefaultTimeout(3000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.waitForFunction(()=>document.querySelectorAll('#favorites button').length===16);
 const listed=await ids(p);assert.ok(listed.includes('HubInput.HDMI.2'));assert.ok(!listed.includes('HubInput.HDMI.1'));
 assert.equal(await p.locator('.apps').evaluate(grid=>getComputedStyle(grid).gridTemplateColumns.split(' ').length),5);
 await p.locator('#favorites button').first().focus();await key(p,'ArrowDown');assert.equal(await p.locator(':focus').getAttribute('data-id'),listed[5]);
 await p.locator('[data-id="HubInput.HDMI.2"]').click();assert.deepEqual(await p.evaluate(()=>launches),['com.samsung.tv.csfs']);
 assert.match(await p.locator('#design-date').textContent(),/[A-Za-z]+/);assert.equal(await p.locator('#home-clock').isVisible(),true);
 await p.evaluate(()=>localStorage.setItem('minimal-hub.clock.v1','off'));await p.reload();assert.equal(await p.locator('#home-clock').isVisible(),false);
 for(const apps of [[],[{id:'Store00001.app4',name:'My app'}], [{id:'kIciSQlYEM.plex',name:'Plex'},{id:'9Ur5IzDKqV.TizenYouTube',name:'YouTube'}]]){
  await p.evaluate(apps=>{localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps}));},apps);
  await p.reload();await p.waitForTimeout(100);assert.deepEqual(await ids(p),apps.map(a=>a.id));
 }
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[{id:'kIciSQlYEM.plex',name:'Plex'}]})));await p.reload();
 const single=await p.locator('#favorites button').boundingBox();assert.ok(single.width>single.height,'A sole app keeps landscape proportions');
 await p.evaluate(()=>{testApps=Array.from({length:35},(_,i)=>({id:'Store00001.x'+i,name:'Channel '+i,show:true}));localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:testApps}));});
 // Wait for discovery to finish replacing the saved tiles before measuring them.
 await p.reload();await p.locator('#favorites > button.unavailable').nth(34).waitFor();
 await p.locator('#favorites .design-caption').nth(34).waitFor();
 await p.locator('#favorites button').first().focus();
 for(let i=0;i<6;i++)await key(p,'ArrowDown');
 assert.equal(await p.locator('#favorites > button:focus').getAttribute('data-id'),'Store00001.x30');
 assert.equal(await p.locator('#favorites > button:focus').evaluate(tile=>{
  const caption=tile.querySelector('.design-caption'),grid=tile.closest('.apps');
  return !!caption&&!!grid&&caption.getBoundingClientRect().bottom<=grid.getBoundingClientRect().bottom;
 }),true);
 assert.deepEqual(errors,[]);await p.close();
});

test('a second move without arrows has only its own moving tile and badge',async()=>{
 const p=await setup();
 try {
  await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','Enter');
  const first=await p.locator('#favorites .moving').getAttribute('data-id');
  await key(p,'Escape','ArrowDown','Enter','Enter');
  assert.equal(await p.locator('#favorites .moving').count(),1);
  assert.equal(await p.locator('#favorites .move-label').count(),1);
  assert.notEqual(await p.locator('#favorites .moving').getAttribute('data-id'),first);
  assert.equal(await p.locator('#favorites .moving').getAttribute('aria-disabled'),null);
  await key(p,'Enter');assert.equal(await p.locator('#move-banner').isVisible(),false);
 } finally {await p.close();}
});

test('Cinema is optional, preserves shortcuts and restores Gallery after a full layout cycle',async()=>{
 const p=await setup({tvos:true});
 await p.waitForFunction(()=>document.querySelectorAll('#favorites button').length===16);
 const before=await ids(p),saved=await p.evaluate(()=>localStorage.getItem('minimal-hub.shortcuts.v1'));
 await p.locator('#settings').click();
 for(let i=0;i<3;i++)await p.locator('#setting-layout').click();
 assert.equal(await p.locator('#layout-value').textContent(),'Cinema');
 await key(p,'Escape');assert.deepEqual(await ids(p),before.slice(0,5));
 assert.equal(await p.evaluate(()=>localStorage.getItem('minimal-hub.shortcuts.v1')),saved);
 await p.locator('#favorites button').first().focus();
 await p.reload();await p.waitForTimeout(100);
 assert.deepEqual(await ids(p),before.slice(0,5));
 await p.locator('#settings').click();await p.locator('#setting-layout').click();await p.locator('#setting-layout').click();await key(p,'Escape');
 assert.deepEqual(await ids(p),before);assert.equal(await p.locator('#cinema-hero').isVisible(),false);
 await p.close();
});

test('Cinema library includes installed apps outside favorites and restores rail focus on Back',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>{
  localStorage.setItem('minimal-hub.design.v1','cinema');
  localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[{id:'kIciSQlYEM.plex',name:'Plex'},{id:'9Ur5IzDKqV.TizenYouTube',name:'YouTube'}]}));
 });
 await p.reload();await p.waitForTimeout(100);
 await key(p,'ArrowRight','ArrowDown');
 assert.equal((await ids(p)).length,16);
 assert.ok((await ids(p)).includes('Store00001.app11'));
 await key(p,'Escape');assert.deepEqual(await ids(p),['kIciSQlYEM.plex','9Ur5IzDKqV.TizenYouTube']);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'9Ur5IzDKqV.TizenYouTube');
 await key(p,'ArrowDown');
 await p.locator('[data-id="HubInput.HDMI.2"]').click();
 assert.deepEqual(await p.evaluate(()=>launches),['com.samsung.tv.csfs']);await key(p,'Escape');
 await key(p,'Escape','ArrowDown');
 await p.locator('[data-id="Store00001.app11"]').focus();await key(p,'Enter');
 assert.equal((await p.evaluate(()=>launches)).at(-1),'Store00001.app11');
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(200);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'Store00001.app11');
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('minimal-hub.shortcuts.v1')).apps.length),2);
 await p.close();
});

test('Cinema restores a library selection after restart and keeps an empty favorites rail editable',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>{
  window.dispatchEvent(new Event('pagehide'));
  localStorage.setItem('minimal-hub.design.v1','cinema');
  localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[{id:'kIciSQlYEM.plex',name:'Plex'}]}));
  localStorage.setItem('minimal-hub.selection.v1','Store00001.app11');
 });
 await p.reload();await p.waitForTimeout(100);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'Store00001.app11');
 await key(p,'Escape');assert.equal(await p.locator(':focus').getAttribute('data-id'),'kIciSQlYEM.plex');
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[]})));
 await p.reload();await p.waitForTimeout(100);
 assert.equal(await p.locator('#empty-add').isVisible(),true);
 await key(p,'ArrowDown','ArrowRight','ArrowRight','Enter');
 assert.ok((await ids(p)).includes('Store00001.app11'));
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('minimal-hub.shortcuts.v1')).apps.length),0);
 await key(p,'Escape');await p.locator('#edit-apps').click();
 assert.equal(await p.locator('#editor').isVisible(),true);await p.close();
});

test('Cinema clears a completed library discovery message without interrupting Settings',async()=>{
 const p=await setup({tvos:true,discoveryDelay:300});
 await p.evaluate(()=>localStorage.setItem('minimal-hub.design.v1','cinema'));
 await p.reload();await p.waitForTimeout(50);await key(p,'ArrowDown');
 assert.match(await p.locator('#status').textContent(),/Checking installed apps/);
 await p.waitForTimeout(350);assert.equal(await p.locator('#status').textContent(),'');
 await p.close();
});

test('Cinema refreshes its library when an editor-owned discovery finishes on Home',async()=>{
 const p=await setup({tvos:true,discoveryDelay:300});
 await p.evaluate(()=>localStorage.setItem('minimal-hub.design.v1','cinema'));
 await p.reload();await p.waitForTimeout(350);
 await p.evaluate(()=>testApps.push({id:'Store00001.new',name:'New app',show:true}));
 await p.locator('#edit-apps').click();await key(p,'Escape');
 await p.locator('#favorites button').first().focus();await key(p,'ArrowDown');
 await p.waitForTimeout(350);assert.ok((await ids(p)).includes('Store00001.new'));
 await p.close();
});

test('Cinema Up from Inputs follows the partial app row above it',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>{
  localStorage.setItem('minimal-hub.design.v1','cinema');
  testApps.splice(2);
  localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:testApps}));
  document.dispatchEvent(new Event('visibilitychange'));
 });
 // Reload restores the fixture catalog, so refresh the in-session sparse catalog.
 await p.locator('#settings').click();
 for(let i=0;i<3;i++)await p.locator('#setting-layout').click();
 await key(p,'Escape');await p.waitForTimeout(200);
 await p.locator('#favorites button').first().focus();await key(p,'ArrowDown','ArrowDown');
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'HubInput.TV.0');
 await key(p,'ArrowUp');assert.equal(await p.locator('body').evaluate(b=>b.classList.contains('cinema-library-open')),true);
 assert.equal(await p.locator(':focus').getAttribute('data-id'),'kIciSQlYEM.plex');await p.close();
});

test('Cinema library keeps installed apps and inputs when Home has 256 unavailable shortcuts',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>{
  localStorage.setItem('minimal-hub.design.v1','cinema');
  localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:Array.from({length:256},(_,i)=>({id:'Removed000.app'+i,name:'Removed '+i}))}));
 });
 await p.reload();await p.waitForTimeout(100);await key(p,'ArrowDown');
 const library=await ids(p);assert.ok(library.includes('Store00001.app11'));assert.ok(library.includes('HubInput.HDMI.2'));
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('minimal-hub.shortcuts.v1')).apps.length),256);
 await p.close();
});

test('Cinema clears its hero after the final favorite is removed',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>{
  localStorage.setItem('minimal-hub.design.v1','cinema');
  localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[{id:'kIciSQlYEM.plex',name:'Plex'}]}));
 });
 await p.reload();await p.waitForFunction(()=>document.getElementById('cinema-name').textContent==='Plex');
 await p.locator('#edit-apps').click();await p.locator('#editor-list button').first().click();await p.locator('#editor-list button').nth(1).click();await key(p,'Escape');
 assert.equal(await p.locator('#cinema-logo').isVisible(),false);
 assert.match(await p.locator('#cinema-prompt').textContent(),/Add favorites/);await p.close();
});

test('Home Shelf is optional, keeps saved ordering and navigates ten spines per row',async()=>{
 const p=await setup({tvos:true});await p.waitForFunction(()=>document.querySelectorAll('#favorites button').length===16);
 const before=await ids(p),saved=await p.evaluate(()=>localStorage.getItem('minimal-hub.shortcuts.v1'));
 await p.locator('#settings').click();for(let i=0;i<4;i++)await p.locator('#setting-layout').click();
 assert.equal(await p.locator('#layout-value').textContent(),'Home Shelf');
 await key(p,'Escape');assert.deepEqual(await ids(p),before);
 await p.locator('#favorites button').first().focus();await key(p,'ArrowDown');
 assert.equal(await p.locator(':focus').getAttribute('data-id'),before[10]);
 await key(p,'ArrowDown');assert.equal(await p.locator(':focus').getAttribute('data-app'),'home');
 await key(p,'ArrowRight');assert.equal(await p.locator(':focus').getAttribute('id'),'edit-apps');
 await key(p,'ArrowRight','Enter');assert.equal(await p.locator('#layout-value').textContent(),'Home Shelf');
 await key(p,'Escape');await p.reload();await p.waitForTimeout(100);
 assert.equal(await p.locator('body').evaluate(b=>b.classList.contains('design-shelf')),true);
 assert.equal(await p.evaluate(()=>localStorage.getItem('minimal-hub.shortcuts.v1')),saved);
 await p.locator('#settings').click();await p.locator('#setting-layout').click();await key(p,'Escape');
 assert.equal(await p.locator('#favorites').evaluate(g=>getComputedStyle(g).gridTemplateColumns.split(' ').length),5);
 await p.close();
});

test('Home Shelf Move uses its visible columns and cancelling preserves the saved list',async()=>{
 const p=await setup({tvos:true});await p.evaluate(()=>localStorage.setItem('minimal-hub.design.v1','shelf'));
 await p.reload();await p.waitForTimeout(100);const before=await ids(p);
 await p.locator('#edit-apps').click();await key(p,'ArrowDown','Enter','Enter');
 const rest=await p.locator('#favorites button').nth(1).evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m13);
 const selected=await p.locator('#favorites button:focus').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m13);
 assert.ok(Math.abs(selected-rest)<.001,'Move keeps the resting case angle so its neighbor stays readable');
 await key(p,'ArrowDown');
 assert.equal((await ids(p))[10],before[0]);
 await key(p,'Escape','Escape');assert.deepEqual(await ids(p),before);await p.close();
});

test('Home Shelf keeps its rigid case pose while an app launch is pending',async()=>{
 const p=await setup({tvos:true});
 await p.evaluate(()=>localStorage.setItem('minimal-hub.design.v1','shelf'));await p.reload();await p.waitForTimeout(100);
 await p.evaluate(()=>{tizen.application.launch=id=>launches.push(id);});
 const tile=p.locator('#favorites button').first();await tile.focus();await key(p,'Enter');
 assert.equal(await tile.getAttribute('aria-busy'),'true');
 assert.ok(Math.abs(await tile.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m13))>.1,'Launch feedback retains the case angle');
 assert.equal(await p.locator('#favorites.launch-motion').count(),0);
 assert.equal(await p.locator('#favorites button').nth(1).evaluate(el=>getComputedStyle(el).opacity),'1','The other cases stay solid');
 assert.equal(await tile.locator('.launch-label').isVisible(),true);
 await key(p,'Escape');assert.equal(await tile.getAttribute('aria-busy'),null);
 for(const reducedMotion of ['no-preference','reduce']) {
  await p.emulateMedia({reducedMotion});await tile.focus();await p.waitForTimeout(180);
  const pose=await p.evaluate(()=>{
   const tiles=document.querySelectorAll('#favorites button'),tile=tiles[0];
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
   document.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
   document.querySelector('#favorites').getAnimations({subtree:true}).forEach(animation=>animation.finish());
   return {pressed:tile.classList.contains('pressed'),yaw:new DOMMatrix(getComputedStyle(tile).transform).m13,
    resting:new DOMMatrix(getComputedStyle(tiles[2]).transform).m13};
  });
  assert.equal(pose.pressed,true,'Inspect before the 120ms press feedback expires');
  assert.ok(Math.abs(pose.yaw-pose.resting)<.001,'A pressed case returns to its resting angle after focus moves');
  await key(p,'Escape');
 }
 await p.close();
});

test('Home Shelf recovers a failed launch and keeps an empty shelf editable',async()=>{
 const p=await setup({tvos:true,launchFail:true});
 await p.evaluate(()=>localStorage.setItem('minimal-hub.design.v1','shelf'));await p.reload();await p.waitForTimeout(100);
 const first=(await ids(p))[0];await p.locator('#favorites button').first().focus();await key(p,'Enter');
 assert.equal(await p.locator('#launch-error-dialog').isVisible(),true);await key(p,'Escape');
 assert.equal(await p.locator(':focus').getAttribute('data-id'),first);
 await p.evaluate(()=>localStorage.setItem('minimal-hub.shortcuts.v1',JSON.stringify({version:1,apps:[]})));await p.reload();await p.waitForTimeout(100);
 assert.equal(await p.locator('#empty-add').isVisible(),true);assert.equal(await p.locator('#cinema-name').textContent(),'Your shelf');
 await key(p,'ArrowDown','ArrowRight','Enter');assert.equal(await p.locator('#editor').isVisible(),true);await p.close();
});
