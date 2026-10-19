#!/usr/bin/env python3
"""One authenticated, bounded HTTPS ingestion endpoint. Stores only latest snapshot."""
import hashlib
import hmac
import http.server
import json
import os
from pathlib import Path
import ssl
import socketserver
import threading
import time
from metrics import validate, calculate
from inspector import carry

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass  # Never log credentials, payloads or periodic requests.
    def setup(self):
        self.request.settimeout(15)
        super().setup()
    def reply(self, status):
        self.send_response(status)
        self.send_header('Content-Length', '0')
        self.send_header('Connection', 'keep-alive' if status == 204 else 'close')
        self.end_headers()
        self.close_connection = status != 204
    def do_POST(self):
        device = self.server.routes.get(self.path)
        if device is None: return self.reply(404)
        if self.client_address[0] != device['allowed_ip']: return self.reply(403)
        if not hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer '+device['token']):
            return self.reply(401)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if self.headers.get('Transfer-Encoding') or length<1 or length>524288:
                return self.reply(413)
            # Authentication precedes reads; one transaction per device, with no queue.
            if not device['lock'].acquire(blocking=False): return self.reply(429)
            try:
                if time.monotonic()-device['last_request']<2: return self.reply(429)
                raw=self.rfile.read(length)
                if len(raw)!=length: return self.reply(400)
                data=json.loads(raw)
                if not isinstance(data,dict):return self.reply(400)
                if data.get('device',device['id']) != device['id']: return self.reply(403)
                data['device']=device['id']
                data=validate(data)
                previous=device['latest']
                if previous and data['boot']==previous['boot']:
                    if data['uptime']<=previous['uptime']: return self.reply(409)
                    if data.get('session') is not None and data.get('session')==previous.get('session') and data['seq']<=previous['seq']: return self.reply(409)
                if previous and data['boot'] in previous.get('retired_boots',[]): return self.reply(409)
                sessions=previous.get('retired_sessions',[]) if previous and previous['boot']==data['boot'] else []
                if data.get('session') in sessions: return self.reply(409)
                if previous and previous['boot']==data['boot'] and previous.get('session') and previous.get('session')!=data.get('session'):
                    sessions=(sessions+[previous['session']])[-8:]
                retired=previous.get('retired_boots',[]) if previous else []
                if previous and data['boot']!=previous['boot']: retired=(retired+[previous['boot']])[-8:]
                data['device']=device['id']
                carry(data,previous)
                data.update(received_at=time.time(),retired_boots=retired,retired_sessions=sessions,metrics=calculate(data,previous))
                destination=device['destination']
                temporary=destination.with_suffix('.new')
                temporary.write_text(json.dumps(data,separators=(',',':')))
                os.chmod(temporary,0o644)
                temporary.replace(destination)
                device['latest']=data
                device['last_request']=time.monotonic()
            finally: device['lock'].release()
        except (ValueError,KeyError,TypeError,StopIteration,OverflowError): return self.reply(400)
        except OSError: return self.reply(503)
        return self.reply(204)

def configure(server, secret, directory):
    # Old single-device pairing and URL remain valid during rolling migration.
    records=secret.get('devices', {'s90d':secret})
    if not 1 <= len(records) <= 32: raise ValueError('device count')
    server.routes={}
    tokens=set()
    for identity, record in records.items():
        if not __import__('re').fullmatch(r'[a-z][a-z0-9_-]{0,47}',identity): raise ValueError('device id')
        if record['token'] in tokens: raise ValueError('shared credential')
        tokens.add(record['token'])
        destination=Path(directory)/('latest.json' if identity=='s90d' else identity+'.json')
        try: latest=json.loads(destination.read_text())
        except (OSError,ValueError): latest=None
        device=dict(record,id=identity,destination=destination,latest=latest,last_request=0,lock=threading.Lock())
        server.routes['/v1/devices/'+identity]=device
        if identity=='s90d': server.routes['/v1/s90d']=device

def main():
    root=Path(os.environ.get('TELEMETRY_ROOT','/config'))
    secret=json.loads((root/'receiver.json').read_text())
    # TLS handshake occurs with a deadline in get_request (not on the listen socket).
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version=ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(root/'server.crt',root/'server.key')
    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
        slots = threading.BoundedSemaphore(4)
        def process_request(self, request, address):
            if not self.slots.acquire(blocking=False):
                request.close()
                return
            try:
                super().process_request(request,address)
            except Exception:
                self.slots.release()
                raise
        def process_request_thread(self, request, address):
            try:
                super().process_request_thread(request,address)
            finally:
                self.slots.release()
        def get_request(self):
            conn, addr=super().get_request()
            conn.settimeout(4)
            try:
                return context.wrap_socket(conn,server_side=True),addr
            except Exception:
                conn.close()
                raise
    server=Server(('0.0.0.0',8443),Handler)
    configure(server,secret,os.environ.get('TELEMETRY_DATA','/data'))
    server.serve_forever()

if __name__=='__main__': main()
