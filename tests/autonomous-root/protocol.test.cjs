// Adapted from Vetro 9319cb0, MIT; see research/autonomous-root/service/vendor/LICENSE.
'use strict';
const assert = require('assert').strict;
const EventEmitter = require('events');
const crypto = require('crypto');
const {RootAgentServer} = require('../../research/autonomous-root/service/vendor/root-agent.js');
class Socket extends EventEmitter {
  constructor() { super(); this.writes = []; this.destroyed = false; }
  write(data) { this.writes.push(data); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}
function frame(server, socket, payload) {
  const nonce = Buffer.from(socket.writes[0].trim().split('\t')[1], 'hex');
  const mac = crypto.createHmac('sha256', server.secret).update(nonce).update('\x00').update(payload).digest('hex');
  return payload + '\t' + mac + '\n';
}
function authenticate(server, socket) {
  socket.emit('data', Buffer.from(frame(server, socket, 'AUTH\t42\t0\t0\t0\t0\t3fffffffff\tVXNlcg==')));
}
async function main() {
  let failures = 0;
  async function check(name, fn) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
  }
  await check('disconnect rejects pending commands immediately', async () => {
    const server = new RootAgentServer(); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    const pending = server.execute('id', 1).then(() => 'resolved', () => 'rejected');
    socket.destroy();
    assert.equal(await Promise.race([pending, new Promise(r => setImmediate(() => r('still pending')))]), 'rejected');
    server.close();
  });
  await check('a second peer cannot replace an authenticated agent', async () => {
    const server = new RootAgentServer(); const first = new Socket(); const second = new Socket();
    server._handle(first); server._handle(second); authenticate(server, first); authenticate(server, second);
    assert.equal(server._conn._socket, first); assert.equal(second.destroyed, true);
    first.destroy(); second.destroy(); server.close();
  });
  await check('AUTH and RESULT in one TCP chunk are both processed', async () => {
    let pending;
    const server = new RootAgentServer({onConnect: () => { pending = server.execute('id', 1); }});
    const socket = new Socket(); server._handle(socket);
    socket.emit('data', Buffer.from(frame(server, socket, 'AUTH\t42\t0\t0\t0\t0\t3fffffffff\tVXNlcg==') + frame(server, socket, 'RESULT\t1\t0\t0\tb2s=\t')));
    const result = await Promise.race([pending, new Promise(r => setImmediate(() => r(null)))]);
    socket.destroy(); pending.catch(() => {}); server.close();
    assert.ok(result); assert.equal(result.stdout, 'ok');
  });
  await check('pre-auth sockets are capped and freed on close', async () => {
    const server=new RootAgentServer(), peers=Array.from({length:16},()=>new Socket()), extra=new Socket();
    try {
      peers.forEach(peer=>{server._handle(peer);assert.equal(peer.destroyed,false);});
      assert.equal(server._preauth.size,16);server._handle(extra);
      assert.equal(extra.destroyed,true);assert.equal(extra.writes.length,0);
      peers[0].destroy();const replacement=new Socket();server._handle(replacement);
      assert.equal(replacement.destroyed,false);authenticate(server,replacement);
      assert.equal(server._conn._socket,replacement);
    } finally {server.close();}
    assert.ok(peers.every(peer=>peer.destroyed));assert.equal(server._preauth.size,0);
  });
  await check('two idle peers do not block the real agent', async () => {
    const server=new RootAgentServer(), agent=new Socket();
    try {
      server._handle(new Socket());server._handle(new Socket());server._handle(agent);
      authenticate(server,agent);assert.equal(server._conn._socket,agent);
    } finally {server.close();}
  });
  await check('maximum identity fields and a 255-byte SMACK label fit the pre-auth limit', async () => {
    const server=new RootAgentServer(), socket=new Socket(), smack='a'.repeat(255);
    try {
      server._handle(socket);
      const payload='AUTH\t2147483647\t0\t0\t0\t0\tffffffffffffffff\t'+Buffer.from(smack).toString('base64');
      const auth=Buffer.from(frame(server,socket,payload));
      assert.ok(auth.length<=512,'AUTH including HMAC and newline must fit 512 bytes');
      socket.emit('data',auth);
      assert.equal(socket.destroyed,false);assert.equal(server._conn.identity.smack,smack);
      assert.equal(server._conn.identity.pid,2147483647);
    } finally {server.close();}
  });
  await check('fragmented pre-auth lines cannot exceed 512 bytes', async () => {
    const server=new RootAgentServer(), socket=new Socket();
    try {
      server._handle(socket);socket.emit('data',Buffer.alloc(256,65));socket.emit('data',Buffer.alloc(256,65));
      assert.equal(socket.destroyed,false);socket.emit('data',Buffer.from('x'));
      assert.equal(socket.destroyed,true);assert.equal(server._preauth.size,0);
    } finally {server.close();}
  });
  await check('authenticated responses retain their larger output allowance', async () => {
    const server=new RootAgentServer(), socket=new Socket();
    try {
      server._handle(socket);authenticate(server,socket);const pending=server.execute('id',1000);
      socket.emit('data',Buffer.from(frame(server,socket,'RESULT\t1\t0\t0\t'+Buffer.alloc(1024,65).toString('base64')+'\t')));
      assert.equal((await pending).stdout.length,1024);
    } finally {server.close();}
  });
  process.exitCode = failures ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
