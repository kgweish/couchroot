'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {execFile,execFileSync}=require('node:child_process');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
const {operationDeadline,HTTP_MARGIN_MS,CLIENT_MARGIN_MS}=require('../research/autonomous-root/service/operation-deadlines');
const contract=require('./worker-parity/contract.json').response_deadlines;
function signed(secret,nonce,payload){return payload+'\t'+crypto.createHmac('sha256',secret).update(nonce).update('\0').update(payload).digest('hex')+'\n';}
class Socket extends EventEmitter {
 constructor(){super();this.writes=[];this.destroyed=false;}
 write(bytes){this.writes.push(bytes);}
 destroy(){this.destroyed=true;this.emit('close');}
}
function connected(){
 const server=new RootAgentServer(),socket=new Socket();server._handle(socket);
 const nonce=Buffer.from(socket.writes[0].trim().split('\t')[1],'hex');
 socket.emit('data',Buffer.from(signed(server.secret,nonce,'AUTH\t42\t0\t0\t0\t0\t3fffffffff\tVXNlcg==')));
 return {server,socket,nonce};
}
test('fixed operation response budgets match the migration contract',()=>{
 for(const op of Object.keys(require('./worker-parity/contract.json').operations))
  assert.equal(operationDeadline(op),contract.operation_ms[op]||contract.default_ms);
 assert.equal(operationDeadline('constructor'),contract.default_ms);
 assert.equal(HTTP_MARGIN_MS,contract.http_margin_ms);assert.equal(CLIENT_MARGIN_MS,contract.client_margin_ms);
 assert.ok(CLIENT_MARGIN_MS>HTTP_MARGIN_MS);
});
test('response deadline expires once, closes the wire and never replays',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const op of ['file.open','file.commit','helper.prepare','file.read','file.write','job.status','app.exec']){
  const {server,socket}=connected();
  const pending=server.operation({op,timeout_ms:86400000}).then(()=>{throw Error('unexpected success');},e=>e);
  const submitted=socket.writes.length;
  t.mock.timers.tick(operationDeadline(op)-1);assert.equal(socket.destroyed,false);
  t.mock.timers.tick(1);
  assert.equal((await pending).outcome,'unknown');assert.equal(socket.destroyed,true);
  assert.equal(socket.writes.length,submitted);assert.equal(server._conn,null);
  server.close();
 }
});
test('a confirmed result cancels its longer deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {server,socket,nonce}=connected();
 const pending=server.operation({op:'file.open'});
 t.mock.timers.tick(41000);
 socket.emit('data',Buffer.from(signed(server.secret,nonce,'OPRESULT\t1\t'+Buffer.from(JSON.stringify({ok:true,result:{size:7}})).toString('base64'))));
 assert.deepEqual(await pending,{size:7});t.mock.timers.tick(120000);assert.equal(socket.destroyed,false);server.close();
});
test('enrolled Python client receives a slow operation through HTTPS and the real wire',
 {skip:!process.env.COUCHROOT_DEADLINE_TEST,timeout:60000},async()=>{
 const {createApi}=require('../research/autonomous-root/service/api');
 const {Journal,hash}=require('../research/autonomous-root/service/policy');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'couchroot-deadline-'));
 let api,peer,replyTimer;const channel=new RootAgentServer();
 try{
  function cert(name){execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/'+name+'-key.pem','-out',dir+'/'+name+'.pem','-days','1','-subj','/CN='+name],{stdio:'ignore'});return {key:fs.readFileSync(dir+'/'+name+'-key.pem'),cert:fs.readFileSync(dir+'/'+name+'.pem')};}
  const serverCert=cert('server'),clientCert=cert('client');
  let requests=0,buffer='',nonce;
  const authenticated=new Promise(resolve=>{channel.onConnect=resolve;});
  await new Promise(resolve=>channel.start(resolve));
  peer=net.connect(channel.listeningPort(),'127.0.0.1');
  peer.on('data',chunk=>{
   buffer+=chunk.toString();let end;
   while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    if(!nonce){nonce=Buffer.from(line.split('\t')[1],'hex');peer.write(signed(channel.secret,nonce,'AUTH\t42\t0\t0\t0\t0\t3fffffffff\tVXNlcg=='));continue;}
    const payload=channel._verify(line,nonce),fields=payload.split('\t');assert.equal(fields[0],'OP');requests++;
    const op=JSON.parse(Buffer.from(fields[2],'base64')).op;
    const reply=()=>peer.write(signed(channel.secret,nonce,'OPRESULT\t'+fields[1]+'\t'+Buffer.from(JSON.stringify({ok:true,result:{size:7,operation:op}})).toString('base64')));
    if(op==='file.open')replyTimer=setTimeout(reply,42000);else reply();
   }
  });
  await authenticated;
  const journal=new Journal(dir+'/journal.json');
  api=createApi({credentials:{...serverCert,ca:clientCert.cert},clientPin:hash(new crypto.X509Certificate(clientCert.cert).raw),journal,setEnabled:()=>{},agent:{status:()=>({connected:!!channel._conn,worker_ready:true}),operation:(...args)=>channel.operation(...args)}});
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  const config={host:'127.0.0.1',port:api.address().port,server_certificate:dir+'/server.pem',client_certificate:dir+'/client.pem',client_key:dir+'/client-key.pem',server_sha256:hash(new crypto.X509Certificate(serverCert.cert).raw)};
  fs.writeFileSync(dir+'/client.json',JSON.stringify(config),{mode:0o600});
  const script=`import importlib.util,json,sys,time
spec=importlib.util.spec_from_file_location('api',sys.argv[1]);api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
c=json.load(open(sys.argv[2]));start=time.monotonic()
with api.Session(c) as session:
 assert api.operation(c,dict(op='file.open',path='/fixture'),session=session)['size']==7
 assert time.monotonic()-start>=41
 assert api.operation(c,dict(op='file.status',transfer_id='fixture'),session=session)['operation']=='file.status'
`;
  await new Promise((resolve,reject)=>execFile('python3',['-c',script,path.resolve(__dirname,'../research/autonomous-root/client.py'),dir+'/client.json'],{timeout:55000},(error,out,err)=>error?reject(Error(err||error.message)):resolve(out)));
  assert.equal(requests,2);assert.equal(journal.rows.length,1);assert.equal(journal.rows[0].state,'completed');
 }finally{
  clearTimeout(replyTimer);if(peer)peer.destroy();channel.close();if(api){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}fs.rmSync(dir,{recursive:true,force:true});
 }
});
