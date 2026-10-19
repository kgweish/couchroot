const {test}=require('node:test');
const assert=require('node:assert/strict');
const telemetry=require('../research/s90d-telemetry/legacy-hub/telemetry.js');
test('telemetry accepts only a credential-free HTTPS ingestion endpoint',()=>{
 assert.equal(telemetry.validate({schema:1,enabled:true,endpoint:'https://nas.local:20490/v1/s90d'}).enabled,true);
 for(const endpoint of ['http://nas/v1/s90d','https://user:password@nas/v1/s90d','https://nas/','https://nas/v1/s90d?token=secret','javascript:alert(1)'])
  assert.throws(()=>telemetry.validate({schema:1,enabled:true,endpoint}));
});
test('file API failure is reported and never pretends to save',()=>{
 let failed=false, saved=false;
 const store=telemetry.create({filesystem:{resolve(_,ok){ok({resolve(){throw {name:'SecurityError'};}});}}},null);
 store.save({schema:1,enabled:true,endpoint:'https://nas/v1/s90d'},()=>saved=true,()=>failed=true);
 assert.equal(failed,true);assert.equal(saved,false);
});
