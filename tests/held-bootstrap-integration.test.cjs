'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
const {validateBootstrap}=require('../research/autonomous-root/service/held-bootstrap');
const enabled=process.platform==='linux'&&process.env.COUCHROOT_REHEARSAL==='1'&&process.env.NATIVE_WORKER;
for(const close of ['shutdown','disconnect','excessive-timeout'])test('bounded native bootstrap authenticates, rejects public resources and retires on '+close,{skip:!enabled,timeout:20000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'held-bootstrap-')),secret=crypto.randomBytes(32),launcher=crypto.createHash('sha256').update(fs.readFileSync('/bin/true')).digest('hex');
 let peer,resolve;const connected=new Promise(r=>resolve=r),server=new RootAgentServer({secret,onConnect:p=>{peer=p;resolve();}});await new Promise(r=>server.start(r));fs.writeFileSync(dir+'/token',secret.toString('base64'),{mode:0o600});
 fs.copyFileSync('/bin/true',dir+'/launcher');fs.chmodSync(dir+'/launcher',0o400);
 const child=spawn(process.env.NATIVE_WORKER,['127.0.0.1',String(server.listeningPort()),dir+'/token',dir,dir+'/launcher',launcher,'--held-bootstrap'],{stdio:['ignore','ignore','pipe']}),ended=once(child,'exit');let log='';child.stderr.on('data',b=>log+=b);
 try{
  await Promise.race([connected,ended.then(()=>{throw Error(log);})]);assert(!fs.existsSync(dir+'/token'));
  const info=await server.operation({op:'status'});validateBootstrap(info,{bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),launcherSha256:launcher});assert.equal(info.processes.worker.pid,peer.identity.pid);
  const r=await server.execute('printf held; printf err >&2; exit 7',1000);assert.equal(r.exit_code,7);assert.equal(r.stdout,'held');assert.equal(r.stderr,'err');
  const timeout=await server.execute('sleep 3',100);assert.equal(timeout.timed_out,true);
  for(const op of [{op:'job.start',id:'must-not-start-0001',command:'touch '+dir+'/ran',profile:'root',timeout_ms:1000},{op:'file.write',path:dir+'/ran',base64:'eA=='},{op:'helper.create'},{op:'app.exec',command:'true',timeout_ms:1000}])await assert.rejects(server.operation(op),/Held bootstrap/);
  assert(!fs.existsSync(dir+'/ran'));
  if(close==='excessive-timeout'){await assert.rejects(server.execute('touch '+dir+'/ran',25001));assert(!fs.existsSync(dir+'/ran'));}
  else if(close==='shutdown'){const r=await server.shutdown();assert(r.acknowledged&&r.disconnected);}else server.close();
  await ended;assert(!fs.existsSync(dir+'/.jobs/guardian'));assert(!fs.readdirSync(dir).some(n=>n.startsWith('.helper-')));if(close==='shutdown')assert.equal(child.exitCode,0,log);
 }finally{server.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await ended;}fs.rmSync(dir,{recursive:true,force:true});}
});

test('bootstrap refuses lifetime overrides and remote hosts before consuming a token',{skip:!enabled},async()=>{
 for(const [host,env] of [['127.0.0.1',{...process.env,COUCHROOT_NATIVE_LIFETIME_SECONDS:'86400'}],['192.0.2.1',process.env]]){
  const child=spawn(process.env.NATIVE_WORKER,[host,'12345','/missing/token','/missing/scope','/missing/launcher','a'.repeat(64),'--held-bootstrap'],{env,stdio:['ignore','ignore','pipe']});let output='';child.stderr.on('data',b=>output+=b);await once(child,'exit');assert.notEqual(child.exitCode,0);assert.match(output,/held bootstrap requires loopback and fixed lifetime/);
 }
});
