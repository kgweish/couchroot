'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {Journal,hash}=require('../research/autonomous-root/service/policy');
const source=path.resolve(__dirname,'../research/autonomous-root/service/api.js');
const localRequire=createRequire(source);
async function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'api-timing-'));
 let handler,now=0,mode='ok',enabled=true,sequence=0;
 const calls=[],raw=Buffer.from('synthetic enrolled peer'),socket={authorized:true,getPeerCertificate:()=>({raw})};
 const journal=new Journal(path.join(dir,'requests.json'));
 const begin=journal.begin.bind(journal),finish=journal.finish.bind(journal);
 journal.begin=(value,syncs)=>{calls.push('begin');now+=11;if(mode==='begin-sync-fails'){syncs.file_sync={ms:7,calls:1};throw Error('storage failed');}if(mode==='begin-fails')throw Error('storage failed');begin(value);};
 journal.finish=(id,result)=>{calls.push('finish');now+=17;if(mode==='finish-fails')throw Error('storage failed');finish(id,result);};
 const worker=async(op)=>{
  calls.push('worker');now+=23;
  if(!['file.read','job.status','job.output','file.status'].includes(op.op))assert.equal(journal.rows.at(-1).state,'submitted');
  if(mode==='unknown')throw Error('transport lost');
  if(mode==='failed')throw Object.assign(Error('confirmed worker refusal'),{outcome:'failed'});
  if(op.op==='file.read')return {data:Buffer.from('bytes'),sha256:hash('bytes'),offset:0};
  return {exit_code:0,timed_out:false,state:'running'};
 };
 const context={module:{exports:{}},Buffer,process:{hrtime:start=>{
  const value=[Math.floor(now/1000),(now%1000)*1e6];
  if(!start)return value;
  const ns=(value[0]-start[0])*1e9+value[1]-start[1];return [Math.floor(ns/1e9),ns%1e9];
 }},require:name=>name==='https'?{createServer:(_,callback)=>{handler=callback;return {on:()=>{}};}}:localRequire(name)};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),context,{filename:source});
 context.module.exports.createApi({credentials:{},clientPin:hash(raw),journal,setEnabled:()=>{},agent:{status:()=>({connected:enabled}),operation:worker,execute:()=>worker({op:'exec'})}});
 async function request(route='/v1/op',operation={op:'job.start'},extra={}){
  const id=extra.id||'timing-fixture-'+String(++sequence).padStart(4,'0');
  const value=route==='/v1/exec'?{id,command:'true',timeout_ms:2000}:{id,operation};
  const req={method:'POST',url:route,socket:extra.socket||socket,headers:{connection:'keep-alive',...extra.headers},setTimeout:()=>{},async *[Symbol.asyncIterator](){now+=5;yield Buffer.from(JSON.stringify(value));}};
  const response={id};
  await handler(req,{writeHead:(status,headers)=>{response.status=status;response.headers=headers;},end:bytes=>{response.body=bytes;}});
  response.syncCalls={};
  response.metrics=Object.fromEntries((response.headers['Server-Timing']||'').split(', ').filter(Boolean).map(part=>{const [key,parameters]=part.split(';dur='),[value,desc]=parameters.split(';desc=');assert.match(value,/^\d+\.\d{3}$/);if(desc){assert.match(desc,/^"[1-9]\d* calls"$/);response.syncCalls[key]=Number(desc.match(/\d+/)[0]);}return [key,Number(value)];}));
  return response;
 }
 try{await run({request,journal,calls,mode:value=>{mode=value;},enabled:value=>{enabled=value;},socket});}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('phase durations preserve journal/worker ordering and reset on keep-alive',()=>fixture(async f=>{
 for(const route of ['/v1/op','/v1/exec']){
  const r=await f.request(route);assert.equal(r.status,200);
  assert.deepEqual(r.metrics,{journal_begin:11,worker:23,journal_finish:17,handler:56});
  assert.equal(f.journal.rows.at(-1).state,'completed');
 }
 assert.deepEqual(f.calls,['begin','worker','finish','begin','worker','finish']);
 const read=await f.request('/v1/op',{op:'job.status'});
 assert.deepEqual(read.metrics,{worker:23,handler:28});assert.equal(f.journal.rows.length,2);
 const binary=await f.request('/v1/files/read',{op:'file.read'});
 assert.deepEqual(binary.metrics,{worker:23,handler:28});assert.equal(binary.body.toString(),'bytes');
 assert.equal(binary.headers['X-SHA256'],hash('bytes'));assert.equal(binary.headers['Content-Length'],5);
}));
test('failed and unknown operations measure attempted phases without replay',()=>fixture(async f=>{
 f.mode('unknown');const lost=await f.request();assert.equal(lost.status,409);
 assert.deepEqual(lost.metrics,{journal_begin:11,worker:23,handler:39});
 assert.equal(JSON.parse(lost.body).outcome,'unknown');assert.equal(f.journal.rows[0].state,'submitted');
 const replay=await f.request('/v1/op',{op:'job.start'},{id:lost.id});
 assert.deepEqual(replay.metrics,{journal_begin:11,handler:16});assert.equal(f.calls.filter(x=>x==='worker').length,1);
 f.mode('failed');const failed=await f.request();assert.equal(JSON.parse(failed.body).outcome,'failed');
 assert.deepEqual(failed.metrics,{journal_begin:11,worker:23,journal_finish:17,handler:56});
 assert.equal(f.journal.rows.at(-1).state,'completed');
}));
test('journal failures remain failed/uncertain and never fabricate unattempted phases',()=>fixture(async f=>{
 f.mode('begin-fails');const begin=await f.request();
 assert.equal(JSON.parse(begin.body).outcome,'rejected');assert.deepEqual(begin.metrics,{journal_begin:11,handler:16});
 assert.deepEqual(f.calls,['begin']);assert.equal(f.journal.rows.length,0);
 f.mode('finish-fails');const finish=await f.request();
 assert.equal(JSON.parse(finish.body).outcome,'unknown');
 assert.deepEqual(finish.metrics,{journal_begin:11,worker:23,journal_finish:17,handler:56});
 assert.equal(f.journal.rows[0].state,'submitted');assert.deepEqual(f.calls,['begin','begin','worker','finish']);
}));
test('unenrolled, browser, invalid and unavailable requests disclose no phase timing',()=>fixture(async f=>{
 for(const extra of [{socket:{...f.socket,authorized:false}},{socket:{...f.socket,getPeerCertificate:()=>({raw:Buffer.from('foreign peer')})}},{headers:{origin:'https://example.invalid'}}]){
  const r=await f.request('/v1/op',{op:'job.start'},extra);assert.equal(r.status,403);assert.deepEqual(r.metrics,{});
 }
 const invalid=await f.request('/v1/op',{op:'unknown'});assert.deepEqual(invalid.metrics,{});
 f.enabled(false);const unavailable=await f.request();assert.equal(unavailable.status,503);assert.deepEqual(unavailable.metrics,{});
 assert.deepEqual(f.calls,[]);
}));

test('failed journal sync reaches the authenticated timing header without worker dispatch',()=>fixture(async f=>{
 f.mode('begin-sync-fails');const r=await f.request();assert.equal(r.status,409);
 assert.equal(JSON.parse(r.body).outcome,'rejected');
 assert.deepEqual(r.metrics,{journal_begin:11,journal_begin_file_sync:7,handler:16});
 assert.deepEqual(r.syncCalls,{journal_begin_file_sync:1});assert.deepEqual(f.calls,['begin']);
}));
