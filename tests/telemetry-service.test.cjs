const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture() {
 const listeners={},timers=[],launches=[];
 const value={schema:1,enabled:true,endpoint:'https://192.0.2.20:20490/v1/devices/qn90a'};
 const w={document:{hidden:false,readyState:'loading',hasFocus:()=>true,addEventListener:(n,f)=>listeners[n]=f},addEventListener:(n,f)=>listeners['window-'+n]=f,setTimeout:f=>{timers.push(f);return timers.length;},localStorage:{}};
 w.tizen={application:{launchAppControl:(...a)=>launches.push(a)},ApplicationControl:function(...a){this.args=a;},ApplicationControlData:function(key,value){this.key=key;this.value=value;}};
 w.HubTelemetry={create:()=>({load:ok=>{w.HubTelemetryService.apply(value);ok(value);}})};
 vm.runInNewContext(fs.readFileSync('research/s90d-telemetry/legacy-hub/telemetry-service.js','utf8'),{window:w});
 return {w,listeners,timers,launches,value,flush:()=>{while(timers.length)timers.shift()();}};
}
test('launches service only after ready, using public appcontrol settings',()=>{
 const x=fixture();assert.equal(x.launches.length,0);x.listeners.DOMContentLoaded();assert.equal(x.launches.length,0);x.flush();
 assert.equal(x.launches.length,1);assert.equal(x.launches[0][1],'MiniTelemetry.Start');
 assert.deepEqual(JSON.parse(JSON.stringify(x.launches[0][0].args[4])),[{key:'telemetry.enabled',value:['true']},{key:'telemetry.receiver_url',value:[x.value.endpoint]}]);
});
test('initial document and hidden startup do not synchronously read the Tizen filesystem',()=>{
 const x=fixture();let reads=0;
 x.w.HubTelemetry.create=()=>({load:ok=>{reads++;x.w.HubTelemetryService.apply(x.value);ok(x.value);}});
 x.listeners.DOMContentLoaded();assert.equal(reads,0);
 x.w.document.hidden=true;x.flush();assert.equal(reads,0);
 x.w.document.hidden=false;x.listeners.visibilitychange();assert.equal(reads,0);x.flush();
 assert.equal(reads,1);assert.equal(x.launches.length,1);
});
test('coalesces preference changes and sends disabled state',()=>{
 const x=fixture();x.listeners.DOMContentLoaded();x.w.HubTelemetryService.apply({...x.value,enabled:false});x.flush();assert.equal(x.launches.length,1);assert.equal(x.launches[0][0].args[4][0].value[0],'false');
 x.w.HubTelemetryService.apply({...x.value,enabled:false});x.flush();assert.equal(x.launches.length,1);
});
test('cold startup waits for focus, then loads once; a lost focus postpones the read',()=>{
 const x=fixture();let focused=false,reads=0;
 x.w.document.hasFocus=()=>focused;
 x.w.HubTelemetry.create=()=>({load:ok=>{reads++;x.w.HubTelemetryService.apply(x.value);ok(x.value);}});
 x.listeners.DOMContentLoaded();x.flush();assert.equal(reads,0);
 focused=true;x.listeners['window-focus']();focused=false;x.flush();assert.equal(reads,0);
 focused=true;x.listeners['window-focus']();x.flush();assert.equal(reads,1);
 x.listeners['window-focus']();x.flush();assert.equal(reads,1);
});
test('hidden startup defers collection launch until dashboard resumes',()=>{
 const x=fixture();x.w.document.hidden=true;x.listeners.DOMContentLoaded();x.flush();assert.equal(x.launches.length,0);x.w.document.hidden=false;x.listeners.visibilitychange();x.flush();assert.equal(x.launches.length,1);
});
test('failed launch retries within a fixed budget and visible return starts a new attempt',()=>{
 const x=fixture();x.w.tizen.application.launchAppControl=(...a)=>{x.launches.push(a);a[3]();};
 x.listeners.DOMContentLoaded();x.flush();assert.equal(x.launches.length,7);assert.equal(x.timers.length,0);
 x.listeners.visibilitychange();x.flush();assert.equal(x.launches.length,14);
});
test('cold boot retries a temporarily unavailable filesystem without another Hub launch',()=>{
 const x=fixture();let reads=0;
 x.w.HubTelemetry.create=()=>({load:(ok,fail)=>{if(++reads<3){fail(new Error('not ready'));return;}x.w.HubTelemetryService.apply(x.value);ok(x.value);}});
 x.listeners.DOMContentLoaded();x.flush();assert.equal(reads,3);assert.equal(x.launches.length,1);assert.equal(x.timers.length,0);
});
test('visibility return reloads preferences after the startup retry budget is exhausted',()=>{
 const x=fixture();const create=x.w.HubTelemetry.create;let reads=0;
 x.w.HubTelemetry.create=()=>({load:(_,fail)=>{reads++;fail(new Error('not ready'));}});
 x.listeners.DOMContentLoaded();x.flush();assert.equal(reads,7);assert.equal(x.launches.length,0);
 x.w.HubTelemetry.create=create;x.listeners.visibilitychange();x.flush();assert.equal(x.launches.length,1);
});
test('configured device identity validates its own route without copying launcher code',()=>{
 const context={window:{HUB_DEVICE_ID:'example-tv-2'},URL};
 vm.runInNewContext(fs.readFileSync('research/s90d-telemetry/legacy-hub/telemetry.js','utf8'),context);
 const value={schema:1,enabled:true,endpoint:'https://nas:20490/v1/devices/example-tv-2'};
 assert.equal(context.window.HubTelemetry.validate(value).endpoint,value.endpoint);
 assert.throws(()=>context.window.HubTelemetry.validate({...value,endpoint:'https://nas:20490/v1/devices/qn90a'}));
});
