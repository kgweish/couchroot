const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../web/bridge.js');
test('desktop preview reports simulation without a TV or network', () => {
  create(undefined).launch('plex', r => assert.deepEqual(r, { preview: true, name: 'Plex' }), assert.fail);
});
test('known apps route to the actual IDs collected from this TV', () => {
  const ids = [];
  const bridge = create({ application: { launch: (id, done) => { ids.push(id); done(); } } });
  ['plex', 'youtube', 'home'].forEach(key => bridge.launch(key, r => assert.equal(r.preview, false), assert.fail));
  assert.deepEqual(ids, ['kIciSQlYEM.plex', '9Ur5IzDKqV.TizenYouTube', 'com.samsung.tv.csfs']);
});
test('app-control fallback launches as an independent app', () => {
  const platform = {
    ApplicationControl: function (...args) { this.args = args; },
    application: { launchAppControl: (control, id, done) => {
      assert.equal(control.args[0], 'http://tizen.org/appcontrol/operation/default');
      assert.equal(control.args[5], 'SINGLE');
      assert.equal(id, '9Ur5IzDKqV.TizenYouTube'); done();
    } }
  };
  create(platform).launch('youtube', () => {}, assert.fail);
});
test('unsupported runtimes fail explicitly rather than claiming a launch', () => {
  create({ application: {} }).launch('plex', assert.fail, error => assert.match(error.message, /unavailable/));
});
test('platform permission errors remain visible', () => {
  const denied = new Error('SecurityError');
  create({ application: { launch: () => { throw denied; } } }).launch('plex', assert.fail, error => assert.equal(error, denied));
});
test('unknown input never reaches a platform launcher', () => {
  create({ application: { launch: assert.fail } }).launch('arbitrary-command', assert.fail, error => assert.match(error.message, /Unknown/));
});
test('discovery lists menu apps, excludes self/Home/services/duplicates and sorts', () => {
 const list = [{id:'Store00001.z',name:'Zed',show:true,iconPath:'/opt/icon.png'}, {id:'Store00002.a',name:'Alpha',show:true,iconPath:'https://evil.test/icon'}, {id:'Store00001.z',name:'Duplicate',show:true}, {id:'hidden',name:'Hidden',show:false}, {id:'MiniHub001.Hub',name:'Self',show:true}, {id:'com.samsung.tv.csfs',name:'Home',show:true}];
 create({application:{getAppsInfo(ok){ok(list);}}}).discover(found => {
  assert.deepEqual(found.map(a=>a.id), ['Store00002.a','Store00001.z']); assert.equal(found[0].icon,''); assert.equal(found[1].icon,'/opt/icon.png');
 }, assert.fail);
});
test('discovery permission denial and unsupported runtime fail explicitly', () => {
 create({application:{getAppsInfo(){throw Error('SecurityError');}}}).discover(assert.fail, e=>assert.match(e.message,/SecurityError/));
 create({application:{}}).discover(assert.fail, e=>assert.match(e.message,/unavailable/));
});
test('selected installed app launches through normal API and async errors propagate', () => {
 create({application:{launch(id,ok,fail){assert.equal(id,'third.app');fail({name:'NotFoundError'});}}}).launchApp({id:'third.app',name:'Third'},assert.fail,e=>assert.equal(e.name,'NotFoundError'));
});
function quietPlatform(launchAppControl, launch = assert.fail) {
 return {
  ApplicationControl: function (...args) { this.args = args; },
  ApplicationControlData: function (key, value) { this.key = key; this.value = value; },
  application: {launchAppControl, launch}
 };
}
test('quiet launch passes the verified hint with SINGLE mode and exact selected ID', () => {
 let successes = 0;
 const platform = quietPlatform((control,id,ok) => {
  assert.equal(id,'Store00001.player');
  assert.equal(control.args[0],'http://tizen.org/appcontrol/operation/default');
  assert.equal(control.args[5],'SINGLE');
  assert.deepEqual(control.args[4].map(d=>({key:d.key,value:d.value})),[{key:'__NO_LOADING_LAUNCH',value:['enable']}]);
  ok(); ok();
 });
 create(platform).launchApp({id:'Store00001.player',name:'Player'},()=>successes++,assert.fail);
 assert.equal(successes,1);
});
test('Samsung Home keeps its ordinary launch path when quiet launch is available', () => {
 create(quietPlatform(assert.fail,(id,ok)=>{assert.equal(id,'com.samsung.tv.csfs');ok();})).launch('home',()=>{},assert.fail);
});
test('unsupported quiet launch falls back once, ignoring stale callbacks', () => {
 for (const name of ['NotSupportedError','InvalidValuesError','TypeMismatchError','SecurityError']) {
  let attempts = 0, successes = 0;
  const platform = quietPlatform((control,id,ok,fail)=>{fail({name});fail({name});ok();},(id,ok)=>{attempts++;ok();});
  create(platform).launch('plex',()=>successes++,assert.fail);
  assert.equal(attempts,1);assert.equal(successes,1);
 }
});
test('quiet constructor rejection falls back and a normal-launch failure stays visible', () => {
 const platform=quietPlatform(assert.fail,(id,ok,fail)=>fail({name:'SecurityError'}));
 platform.ApplicationControlData=function(){throw {name:'NotSupportedError'};};
 create(platform).launch('plex',assert.fail,e=>assert.equal(e.name,'SecurityError'));
});
test('missing apps and unknown quiet-launch failures do not trigger another launch', () => {
 for(const name of ['NotFoundError','UnknownError']) {
  create(quietPlatform((control,id,ok,fail)=>fail({name}))).launch('plex',assert.fail,e=>assert.equal(e.name,name));
 }
});
test('firmware internal visible helpers and duplicate Prime stub are not offered', () => {
 const {eligible,localIcon}=require('../web/bridge.js');
 assert.equal(eligible({id:'org.tizen.smarthub-reset',show:true}),false);
 assert.equal(eligible({id:'org.tizen.primevideo-dummy',packageId:'org.tizen.primevideo',show:true}),false);
 assert.equal(eligible({id:'org.tizen.primevideo',packageId:'org.tizen.primevideo',show:true}),true);
 assert.equal(eligible({id:'NewStore01.Player',packageId:'NewStore01',show:true}),true);
 for(const uri of ['https://server/icon.png','//server/icon.png','data:image/svg+xml,test','javascript:alert(1)'])assert.equal(localIcon(uri),'');
});
test('source discovery validates connected inputs, deduplicates and labels the Home fallback', async () => {
 const bridge=create({systeminfo:{getPropertyValue(property,ok){
  assert.equal(property,'VIDEOSOURCE');ok({connected:[{type:'HDMI',number:1},{type:'HDMI',number:1},{type:'TV',number:0},{type:'HDMI',number:'2'},{type:'AV',number:1},{type:'HDMI',number:100}],disconnected:[{type:'HDMI',number:3}]});
 }}});
 assert.deepEqual(await new Promise(ok=>bridge.discoverSources(ok)),[
  {id:'HubInput.HDMI.1',name:'HDMI 1 · via Home',icon:''},{id:'HubInput.TV.0',name:'Live TV · via Home',icon:''}
 ]);
 create({application:{launch:assert.fail}}).launchApp({id:'HubInput.HDMI.1',name:'HDMI 1'},assert.fail,e=>assert.match(e.message,/Unknown/));
 for(const platform of [undefined,{}, {systeminfo:{getPropertyValue(){throw Error('unsupported');}}}, {systeminfo:{getPropertyValue(property,ok,fail){fail({name:'NotSupportedError'});ok({connected:[{type:'HDMI',number:1}]});}}}]){
  assert.deepEqual(await new Promise(ok=>create(platform).discoverSources(ok)),[]);
 }
});
