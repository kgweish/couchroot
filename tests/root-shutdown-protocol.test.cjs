const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {RootAgentServer}=require('../research/autonomous-root/service/vendor/root-agent');
class Socket extends EventEmitter {
 constructor(){super();this.writes=[];this.destroyed=false;}
 write(data){this.writes.push(data);}
 destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close');}}
}
function setup(){
 const server=new RootAgentServer(),socket=new Socket();server._handle(socket);
 const nonce=Buffer.from(socket.writes[0].trim().split('\t')[1],'hex');
 const frame=payload=>Buffer.from(payload+'\t'+crypto.createHmac('sha256',server.secret).update(nonce).update('\x00').update(payload).digest('hex')+'\n');
 socket.emit('data',frame('AUTH\t42\t0\t0\t0\t0\tff\tVXNlcg=='));
 return {server,socket,frame};
}
test('shutdown requires matching BYE and disconnect and blocks subsequent requests',async()=>{
 const {server,socket,frame}=setup();try{
  let done=false;const pending=server.shutdown().then(value=>{done=true;return value;});
  assert.match(socket.writes[1],/^SHUTDOWN\t1\t/);
  await assert.rejects(server.execute('true',100),e=>e.outcome==='rejected');
  await assert.rejects(server.operation({op:'status'}),e=>e.outcome==='rejected');
  await assert.rejects(server.shutdown(),e=>e.outcome==='rejected');
  socket.emit('data',frame('BYE\t1'));await Promise.resolve();assert.equal(done,false);
  socket.destroy();assert.deepEqual(await pending,{acknowledged:true,disconnected:true});
 }finally{server.close();}
});
test('pending requests reject shutdown before submission',async()=>{
 const {server,socket,frame}=setup();try{
  const pending=server.operation({op:'status'});
  await assert.rejects(server.shutdown(),e=>e.outcome==='rejected');assert.equal(socket.writes.length,2);
  socket.emit('data',frame('OPRESULT\t1\t'+Buffer.from(JSON.stringify({ok:true,result:{}})).toString('base64')));await pending;
  const stopped=server.shutdown();socket.emit('data',frame('BYE\t2'));socket.destroy();await stopped;
 }finally{server.close();}
});
for(const reply of ['BYE\t2','BYE\t1\textra','PONG\t1','RESULT\t1\t0\t0\t\t','OPRESULT\t1\te30=','duplicate','disconnect','server-close'])test('shutdown refuses '+reply,async()=>{
 const {server,socket,frame}=setup();try{
  const rejected=assert.rejects(server.shutdown(),e=>e.outcome==='unknown');
  if(reply==='disconnect')socket.destroy();
  else if(reply==='server-close'){socket.emit('data',frame('BYE\t1'));server.close();}
  else if(reply==='duplicate')socket.emit('data',Buffer.concat([frame('BYE\t1'),frame('BYE\t1')]));
  else socket.emit('data',frame(reply));
  await rejected;assert.equal(socket.destroyed,true);
 }finally{server.close();}
});
test('acknowledgement without disconnect expires rather than claiming exit',async()=>{
 const {server,socket,frame}=setup();try{
  const rejected=assert.rejects(server.shutdown(),e=>e.outcome==='unknown');socket.emit('data',frame('BYE\t1'));
  await rejected;assert.equal(socket.destroyed,true);
 }finally{server.close();}
});
