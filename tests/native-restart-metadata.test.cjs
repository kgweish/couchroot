'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {hash}=require('../research/autonomous-root/service/policy');
const {parseMetadata,verifyRestartRecords}=require('../research/autonomous-root/service/native-restart-metadata');
const owner='a'.repeat(32),boot='00000000-0000-0000-0000-000000000001';
function fixture(){
 const saved={id:'native-saved-0001',boot_id:boot,state:'completed',exit_code:9},live={id:'native-active-01',boot_id:boot,worker_id:owner,state:'running',pid:123,process_start:'456',exit_code:null};
 const entries=[saved,live].map(v=>{const b=Buffer.from(JSON.stringify(v));return {name:v.id+'.json',size:b.length,sha256:hash(b),base64:b.toString('base64')};});
 const orphan='native-orphan-01',metadata=[{kind:'intent',name:'.intent-'+owner+'-'+orphan,id:orphan}];
 const values=new Map([[saved.id,saved],[live.id,{...live,state:'interrupted',exit_code:null,recovery:'stale-guardian-reconciled'}],[orphan,{id:orphan,worker_id:owner,boot_id:boot,state:'interrupted',exit_code:null,launch_started:false,recovery:'initial-intent-not-published'}]]);
 const calls=[],channel={operation:async r=>{calls.push(r);return {record:values.get(r.id),output_available:false};}},commands=[];
 const execute=async c=>{commands.push(c);return {exit_code:0,stdout:[...values.keys()].sort().map(id=>id+'.json\n').join(''),stderr:''};};
 return {values,calls,commands,options:{retained:{snapshot:{source:{worker_id:owner},records:entries},guardian_sha256:'b'.repeat(64),metadata},record:{scope:'/opt/couchroot-worker-'+owner+'/state',boot_id:boot},channel,execute}};
}
test('restart readback covers unchanged, interrupted and unpublished records before admission',async()=>{
 const f=fixture();await verifyRestartRecords(f.options);assert.equal(f.calls.length,3);assert(f.calls.every(r=>r.op==='job.status'));assert.equal(f.commands.length,1);
 assert.match(f.commands[0],/sha256sum .*native-saved-0001.json/);assert.match(f.commands[0],/test ! -e .*\.intent-/);
});
test('restart readback refuses missing, altered, replayed or incorrectly attributed records',async()=>{
 for(const mode of ['missing','terminal','exit','owner','boot','started','recovery','pid','outputs','inventory','io']){
  const f=fixture(),orphan=f.values.get('native-orphan-01'),live=f.values.get('native-active-01');
  if(mode==='missing')f.values.delete('native-saved-0001');
  if(mode==='terminal')f.values.get('native-saved-0001').exit_code=0;
  if(mode==='exit')live.exit_code=0;if(mode==='owner')orphan.worker_id='c'.repeat(32);if(mode==='boot')orphan.boot_id='other';
  if(mode==='started')orphan.launch_started=true;if(mode==='recovery')live.recovery='other';if(mode==='pid')live.pid++;
  if(mode==='outputs')f.options.channel.operation=async()=>({record:live,output_available:true});
  if(mode==='inventory')f.options.execute=async()=>({exit_code:0,stdout:'extra.json\n',stderr:''});
  if(mode==='io')f.options.execute=async()=>({exit_code:1,stdout:'',stderr:''});
  await assert.rejects(verifyRestartRecords(f.options),undefined,mode);
 }
});
test('metadata parser requires bounded exact owner names and paired repair intents',()=>{
 const line='.intent-'+owner+'-native-orphan-01 0 1 '+hash('')+'\n';
 assert.equal(parseMetadata(line+'METADATA-END\n',owner)[0].size,0);
 for(const value of [line+line+'METADATA-END\n',line.replace(' 0 1 ',' 2048 1 ')+'METADATA-END\n',line.replace(owner,'c'.repeat(32))+'METADATA-END\n',line.replace('.intent-','.repair-')+'METADATA-END\n',line+'junk'])assert.throws(()=>parseMetadata(value,owner));
});

test('orphan readback after another reboot requires a durably admitted recovery boot',async()=>{
 const f=fixture(),current='00000000-0000-0000-0000-000000000002';
 await assert.rejects(verifyRestartRecords({...f.options,bootId:current}));
 await verifyRestartRecords({...f.options,bootId:current,recoveryBootIds:[boot,current]});
 for(const ids of [[],['bad'],[boot+'\n'],Array(9).fill(boot)])await assert.rejects(verifyRestartRecords({...f.options,bootId:current,recoveryBootIds:ids}));
 f.values.get('native-orphan-01').boot_id='00000000-0000-0000-0000-000000000003';await assert.rejects(verifyRestartRecords({...f.options,bootId:current,recoveryBootIds:[boot,current]}));
});
