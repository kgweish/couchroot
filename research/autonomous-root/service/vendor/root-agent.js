'use strict';

// Node port of the SamsungTvRootAgent protocol (server side).
//
// SamsungTvRootAgent.dll runs as uid 0 (launched by the archive-root chain),
// calls setsid() to detach from the launch.sh teardown, then connects back to
// this server on TCP and replies to authenticated commands. This gives /exec
// and /debloat a persistent root channel that does not race launch.sh.
//
// Protocol (mirrors samsung_tv_root/root_agent.py):
//   - server greeting:  "SAMSUNG-TV-ROOT/1\t<nonce hex>\n"
//   - frames:           "payload\tauthenticator\n" where
//                       authenticator = hex(HMAC-SHA256(secret, nonce || 0x00 || payload))
//   - agent AUTH:       "AUTH\tpid\tuid\teuid\tgid\tegid\tcap_eff\t<smack b64>"
//   - server EXEC:      "EXEC\tseq\ttimeout_ms\t<cmd b64>"
//   - agent RESULT:     "RESULT\tseq\texitcode\ttimedout\t<stdout b64>\t<stderr b64>"

var net = require('net');
var crypto = require('crypto');
var operationDeadline = require('../operation-deadlines').operationDeadline;

var PROTOCOL_VERSION = 'SAMSUNG-TV-ROOT/1';
var MAX_FRAME_BYTES = 8 * 1024 * 1024;
var MAX_PENDING = 32;
var MAX_PREAUTH = 16;
var MAX_AUTH_BYTES = 512;

function RootAgentServer(opts) {
    opts = opts || {};
    this.bindHost = opts.bindHost || '127.0.0.1';
    this.port = opts.port || 0;
    this.secret = opts.secret || crypto.randomBytes(32); // Buffer, 32+ bytes
    this.onConnect = opts.onConnect;    // (conn) -> void
    this.onClose = opts.onClose;        // () -> void
    this._server = null;
    this._conn = null;
    this._preauth = new Set();
    this._listeningPort = 0;
    this.log = [];   // why each connection was rejected; shown in /status
}

RootAgentServer.prototype.note = function (what) {
    this.log.push({ at: Date.now(), what: String(what) });
    if (this.log.length > 20) this.log.shift();
};

RootAgentServer.prototype.start = function (cb) {
    var self = this;
    this._server = net.createServer(function (socket) {
        self._handle(socket);
    });
    this._server.on('error', function (e) { if (self.onClose) self.onClose(e); });
    this._server.listen(this.port, this.bindHost, function () {
        self._listeningPort = self._server.address().port;
        if (cb) cb(self._listeningPort);
    });
    return this;
};

RootAgentServer.prototype.listeningPort = function () { return this._listeningPort; };

RootAgentServer.prototype._handle = function (socket) {
    var self = this;
    if (this._conn) { this.note('second connection while one agent is active'); socket.destroy(); return; }

    if (this._preauth.size >= MAX_PREAUTH) { this.note('too many unauthenticated peers'); socket.destroy(); return; }
    this._preauth.add(socket);

    var nonce = crypto.randomBytes(32);
    socket.write(PROTOCOL_VERSION + '\t' + nonce.toString('hex') + '\n');

    var lineBuffer = Buffer.alloc(MAX_AUTH_BYTES), lineBytes = 0, binary = null, binaryBuffer = null, binaryBytes = 0;
    var authed = false;

    // the agent must AUTH within 10s; a silent peer is dropped (the host tool
    // uses the same DEFAULT_COMMAND_TIMEOUT for the AUTH frame)
    var authTimer = setTimeout(function () {
        if (!authed) socket.destroy();
    }, 10000);

    function handleLine(line) {
        if (!line) return;
        var payload;
        try { payload = self._verify(line, nonce); }
        catch (e) { self.note('auth frame rejected: ' + (e.message || e)); socket.destroy(); return; }

        if (!authed) {
            // expect AUTH with a full root identity (same require_root as
            // the host tool: a non-root "agent" must never be accepted)
            var af = payload.split('\t');
            if (af.length !== 8 || af[0] !== 'AUTH' || self._conn
                || !/^[1-9][0-9]*$/.test(af[1])
                || !af.slice(2, 6).every(function (v) { return v === '0'; })) {
                self.note('invalid AUTH identity or competing agent');
                socket.destroy();
                return;
            }
            var ident = {
                pid: parseInt(af[1], 10),
                uid: parseInt(af[2], 10),
                euid: parseInt(af[3], 10),
                gid: parseInt(af[4], 10),
                egid: parseInt(af[5], 10),
                cap_eff: af[6],
                smack: Buffer.from(af[7] || '', 'base64').toString('utf8')
            };
            if (ident.uid !== 0 || ident.euid !== 0 || ident.gid !== 0 || ident.egid !== 0) {
                self.note('non-root agent uid=' + ident.uid + ' euid=' + ident.euid);
                socket.destroy();
                return;
            }
            authed = true;
            self._preauth.delete(socket);
            clearTimeout(authTimer);
            self._conn = new RootAgentConnection(socket, self.secret, nonce, ident);
            if (self.onConnect) self.onConnect(self._conn);
            return;
        }

        // A binary body is admitted only after its header was authenticated.
        if (self._conn) binary = self._conn._onFrame(payload) || null;
    }

    socket.on('data', function (chunk) {
        var offset = 0;
        try {
            while (offset < chunk.length && !socket.destroyed) {
                if (binary) {
                    var count = Math.min(binary.length - binaryBytes, chunk.length - offset);
                    chunk.copy(binaryBuffer, binaryBytes, offset, offset + count);
                    binaryBytes += count; offset += count;
                    if (binaryBytes === binary.length) {
                        var body = binaryBuffer, completed = binary;
                        binary = null; binaryBuffer = null; binaryBytes = 0;
                        completed.complete(body);
                    }
                    continue;
                }
                var newline = chunk.indexOf(10, offset);
                var end = newline < 0 ? chunk.length : newline;
                var nextBytes = lineBytes + end - offset;
                var limit = authed ? MAX_FRAME_BYTES : MAX_AUTH_BYTES;
                if (nextBytes > limit) throw Error('frame too large');
                if (nextBytes > lineBuffer.length) {
                    var grown = Buffer.alloc(Math.min(limit, Math.max(nextBytes, lineBuffer.length * 2)));
                    lineBuffer.copy(grown, 0, 0, lineBytes); lineBuffer = grown;
                }
                chunk.copy(lineBuffer, lineBytes, offset, end); lineBytes = nextBytes;
                offset = end + (newline < 0 ? 0 : 1);
                if (newline >= 0) {
                    var line = lineBuffer.toString('utf8', 0, lineBytes);
                    lineBytes = 0;
                    if (lineBuffer.length > 65536) lineBuffer = Buffer.alloc(4096);
                    handleLine(line);
                    if (binary) binaryBuffer = Buffer.alloc(binary.length);
                    if (binary && binary.length === 0) {
                        var empty = binary; binary = null; binaryBuffer = null;
                        empty.complete(Buffer.alloc(0));
                    }
                }
            }
        } catch (e) { self.note('invalid worker response: ' + e.message); socket.destroy(); }
    });

    socket.on('error', function (e) { self.note('socket error: ' + (e.message || e)); });
    socket.on('close', function () {
        self._preauth.delete(socket);
        clearTimeout(authTimer);
        if (self._conn && self._conn._socket === socket) {
            self._conn._failPending(new Error('root agent disconnected'), true);
            self._conn = null;
            if (self.onClose) self.onClose();
        } else if (!authed) {
            self.note('connection closed before auth');
        }
    });
};

RootAgentServer.prototype._verify = function (line, nonce) {
    var sep = line.lastIndexOf('\t');
    if (sep === -1) throw new Error('no authenticator');
    var payload = line.slice(0, sep);
    var observed = line.slice(sep + 1);
    var expected = crypto.createHmac('sha256', this.secret)
        .update(nonce).update('\x00').update(payload, 'utf8').digest('hex');
    if (!/^[a-f0-9]{64}$/.test(observed)) throw new Error('invalid authenticator');
    if (!crypto.timingSafeEqual(Buffer.from(observed, 'hex'), Buffer.from(expected, 'hex'))) {
        throw new Error('auth failed');
    }
    return payload;
};

RootAgentServer.prototype.execute = function (command, timeoutMs) {
    if (!this._conn) return Promise.reject(new Error('no root agent connected'));
    return this._conn.execute(command, timeoutMs);
};

RootAgentServer.prototype.close = function () {
    this._preauth.forEach(function (socket) { socket.destroy(); });
    this._preauth.clear();
    if (this._conn) {
        this._conn._failPending(new Error('root agent server closed'));
        try { this._conn._socket.destroy(); } catch (e) {}
        this._conn = null;
    }
    if (this._server) { try { this._server.close(); } catch (e) {} this._server = null; }
};

RootAgentServer.prototype.shutdown = function () {
    if (!this._conn) return Promise.reject(Object.assign(Error('No root worker connected'), {outcome:'rejected'}));
    return this._conn.shutdown();
};

// --- connection (server side, one agent) ----------------------------------
function RootAgentConnection(socket, secret, nonce, identity) {
    this._socket = socket;
    this._secret = secret;
    this._nonce = nonce;
    this.identity = identity;
    this._sequence = 0;
    this._pending = {}; // seq -> { resolve, reject }
}

RootAgentConnection.prototype._send = function (payload) {
    var mac = crypto.createHmac('sha256', this._secret)
        .update(this._nonce).update('\x00').update(payload, 'utf8').digest('hex');
    this._socket.write(payload + '\t' + mac + '\n');
};

RootAgentConnection.prototype._onFrame = function (payload) {
    var f = payload.split('\t');
    if (this._shutdown) {
        var stopping = this._shutdown;
        if (f.length !== 2 || f[0] !== 'BYE' || f[1] !== String(stopping.sequence) || stopping.acknowledged) {
            stopping.invalid = true;
            this._socket.destroy();
            return;
        }
        stopping.acknowledged = true;
        // BYE precedes worker cleanup. Wait for disconnect, then the controller
        // must independently verify process exit and retained resources.
        return;
    }
    if (f[0] === 'OPDATA') {
        var self = this, pending = this._pending[f[1]], read = pending && pending.read;
        if (f.length !== 5 || !read || !/^(0|[1-9][0-9]*)$/.test(f[2])
            || !/^(0|[1-9][0-9]*)$/.test(f[3]) || !/^[a-f0-9]{64}$/.test(f[4]))
            throw Error('unexpected binary result');
        var offset = Number(f[2]), length = Number(f[3]), digest = f[4];
        if (!Number.isSafeInteger(offset) || offset !== read.offset || !Number.isInteger(read.length)
            || read.length < 1 || read.length > 1048576 || length > read.length)
            throw Error('invalid binary range');
        return {length:length, complete:function(data) {
            if (self._pending[f[1]] !== pending || crypto.createHash('sha256').update(data).digest('hex') !== digest)
                throw Error('invalid binary digest or expired request');
            delete self._pending[f[1]]; clearTimeout(pending.timer);
            pending.resolve({data:data, offset:offset, sha256:digest});
        }};
    }
    if (f[0] === 'RESULT' && f.length >= 6) {
        var seq = f[1];
        var p = this._pending[seq];
        if (p) {
            delete this._pending[seq];
            clearTimeout(p.timer);
            if (f.length !== 6 || !/^-?[0-9]+$/.test(f[2]) || !/^[01]$/.test(f[3])) {
                p.reject(new Error('invalid root agent result'));
                this._socket.destroy();
                return;
            }
            p.resolve({
                exit_code: parseInt(f[2], 10),
                timed_out: f[3] === '1',
                stdout: Buffer.from(f[4], 'base64').toString('utf8'),
                stderr: Buffer.from(f[5], 'base64').toString('utf8')
            });
        }
    } else if (f[0] === 'OPRESULT' && f.length === 3) {
        var op = this._pending[f[1]];
        if (op) {
            delete this._pending[f[1]]; clearTimeout(op.timer);
            try {
                var value = JSON.parse(Buffer.from(f[2], 'base64').toString('utf8'));
                if (typeof value.ok !== 'boolean') throw Error('Invalid operation response');
                if (value.ok) op.resolve(value.result);
                else op.reject(Object.assign(Error(value.error), {outcome:value.outcome || 'rejected'}));
            } catch (e) { op.reject(e); }
        }
    } else if (f[0] === 'PONG') {
        var s = f[1], pr = this._pending[s];
        if (pr) { delete this._pending[s]; clearTimeout(pr.timer); pr.resolve(f); }
    }
};

RootAgentConnection.prototype._failPending = function (error, disconnected) {
    if (this._shutdown) {
        var stopping = this._shutdown;
        this._shutdown = null;
        clearTimeout(stopping.timer);
        if (stopping.acknowledged && !stopping.invalid && disconnected)
            stopping.resolve({acknowledged:true, disconnected:true});
        else stopping.reject(Object.assign(Error('Worker shutdown outcome unknown'), {outcome:'unknown'}));
    }
    var pending = this._pending;
    this._pending = {};
    Object.keys(pending).forEach(function (seq) {
        clearTimeout(pending[seq].timer);
        pending[seq].reject(error);
    });
};

RootAgentConnection.prototype.execute = function (command, timeoutMs) {
    var self = this;
    if (self._closing) return Promise.reject(Object.assign(Error('Worker shutdown in progress'), {outcome:'rejected'}));
    timeoutMs = timeoutMs == null ? 30000 : timeoutMs;
    if (typeof command !== 'string' || !command.trim() || Buffer.byteLength(command) > 65536) {
        return Promise.reject(new Error('invalid or oversized command'));
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        return Promise.reject(new Error('invalid command timeout'));
    }
    if (self._socket.destroyed) return Promise.reject(new Error('root agent disconnected'));
    if (Object.keys(self._pending).length >= MAX_PENDING) return Promise.reject(new Error('root agent busy'));
    return new Promise(function (resolve, reject) {
        var seq = ++self._sequence;
        var timer = setTimeout(function () {
            if (self._pending[seq]) {
                delete self._pending[seq];
                reject(new Error('root agent execute timeout; command outcome unknown'));
                // Do not reuse a channel whose command may still be running.
                self._socket.destroy();
            }
        }, timeoutMs + 5000);
        self._pending[seq] = { resolve: resolve, reject: reject, timer: timer };
        try {
            var b64 = Buffer.from(command, 'utf8').toString('base64');
            self._send('EXEC\t' + seq + '\t' + timeoutMs + '\t' + b64);
        } catch (e) {
            clearTimeout(timer);
            delete self._pending[seq];
            reject(e);
            self._socket.destroy();
        }
    });
};

RootAgentConnection.prototype.shutdown = function () {
    var self = this;
    if (self._closing || self._socket.destroyed || Object.keys(self._pending).length)
        return Promise.reject(Object.assign(Error('Worker must be connected and drained before shutdown'), {outcome:'rejected'}));
    self._closing = true;
    return new Promise(function (resolve, reject) {
        var sequence = ++self._sequence;
        var stopping = {sequence:sequence, resolve:resolve, reject:reject, acknowledged:false, invalid:false};
        self._shutdown = stopping;
        stopping.timer = setTimeout(function () {
            stopping.invalid = true;
            self._failPending(Error('Worker shutdown deadline expired'));
            self._socket.destroy();
        }, 10000);
        try { self._send('SHUTDOWN\t' + sequence); }
        catch (e) { stopping.invalid = true; self._failPending(e); self._socket.destroy(); }
    });
};

module.exports = { RootAgentServer };
// OPWRITE and OPDATA authenticate bounded metadata before raw upload/download bytes.
RootAgentServer.prototype.operation = function (value, data) {
    if (!this._conn) return Promise.reject(Object.assign(Error('Root worker unavailable'), {outcome:'rejected'}));
    return this._conn.operation(value, data);
};
RootAgentConnection.prototype.operation = function (value, data) {
    var self=this, binary=data!==undefined;
    if (self._closing) return Promise.reject(Object.assign(Error('Worker shutdown in progress'), {outcome:'rejected'}));
    if (binary && (!Buffer.isBuffer(data) || value.op!=='file.write' || typeof value.transfer_id!=='string' || value.transfer_id.length!==32 || !/^[a-f0-9]{32}$/.test(value.transfer_id)
        || !Number.isSafeInteger(value.offset) || value.offset<0 || value.offset>2147483648-data.length
        || data.length<1 || data.length>1048576 || typeof value.sha256!=='string' || value.sha256.length!==64 || !/^[a-f0-9]{64}$/.test(value.sha256)))
        return Promise.reject(Object.assign(Error('Invalid binary upload metadata'), {outcome:'rejected'}));
    var bytes=binary?null:Buffer.from(JSON.stringify(value));
    if ((!binary && bytes.length>1500000) || self._socket.destroyed || Object.keys(self._pending).length>=MAX_PENDING)
        return Promise.reject(Object.assign(Error('Operation unavailable or oversized'), {outcome:'rejected'}));
    return new Promise(function(resolve,reject) {
        var seq=++self._sequence;
        var timer=setTimeout(function(){delete self._pending[seq];reject(Object.assign(Error('Operation outcome unknown'),{outcome:'unknown'}));self._socket.destroy();},operationDeadline(value.op));
        self._pending[seq]={resolve:resolve,reject:reject,timer:timer,read:value.op==='file.read'?{offset:value.offset,length:value.length}:null};
        try {
            if (binary) {
                self._send('OPWRITE\t'+seq+'\t'+value.transfer_id+'\t'+value.offset+'\t'+data.length+'\t'+value.sha256);
                self._socket.write(data);
            } else self._send('OP\t'+seq+'\t'+bytes.toString('base64'));
        }
        catch(e){clearTimeout(timer);delete self._pending[seq];reject(e);self._socket.destroy();}
    });
};
