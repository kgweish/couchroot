#!/usr/bin/env python3
"""Read-only TV dashboard; expose only the nine known charts, never Netdata admin APIs."""
from concurrent.futures import ThreadPoolExecutor
import http.server
import json
import os
from pathlib import Path
import socketserver
import threading
import time
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('TELEMETRY_DATA','/data'))
NETDATA=os.environ.get('NETDATA_URL','http://netdata:19999')
CHARTS=('cpu','memory','network','disk','collector_cpu','collector_memory','uptime','availability','age')
RANGES=(900,3600,21600,86400)
POOL=ThreadPoolExecutor(max_workers=4)
CACHE={}
LOCK=threading.Lock()

def query(prefix,name,seconds,points):
    url=NETDATA+'/api/v1/data?'+urllib.parse.urlencode(dict(chart=prefix+'.'+name,after=-seconds,points=points,format='json',group='average'))
    try:
        with urllib.request.urlopen(url,timeout=2) as response:
            raw=response.read(1048577)
            if len(raw)>1048576:raise ValueError('oversized response')
            value=json.loads(raw)
        if not isinstance(value.get('labels'),list) or not isinstance(value.get('data'),list):raise ValueError('invalid chart')
        return value
    except urllib.error.HTTPError as error:
        if error.code in (400,404):return {'labels':[], 'data':[], 'unavailable':True}
        return {'labels':[], 'data':[], 'error':'History temporarily unavailable'}
    except (OSError,ValueError):
        return {'labels':[], 'data':[], 'error':'History temporarily unavailable'}

def devices():
    try: return json.loads((DATA/'devices.json').read_text())
    except FileNotFoundError: return {'s90d':{'name':'S90D','chart_prefix':'s90d','snapshot':'latest.json'}}

def latest(device):
    try:
        sample=json.loads((DATA/device['snapshot']).read_text())
        value={key:sample[key] for key in ('boot','seq','uptime','received_at','collector_rss_bytes','collector_cpu_seconds')}
        value['metrics']=sample.get('metrics',{})
        value['inspector']=sample.get('inspector')
        value['unavailable']=[name for name in ('stat','meminfo','netdev','diskstats') if sample.get(name) is None]
        mem={line.split(':',1)[0]:int(line.split()[1]) for line in (sample['meminfo'] or '').splitlines() if ':' in line}
        value['memory_total_mib']=mem.get('MemTotal',0)/1024 or None
        value['memory_available_mib']=mem['MemAvailable']/1024 if 'MemAvailable' in mem else None
        return value
    except (OSError,ValueError,KeyError,IndexError): return None

def snapshot(seconds,identity='s90d'):
    with LOCK:
        now=time.monotonic(); key=(seconds,identity)
        if key in CACHE and now-CACHE[key][0]<5:return CACHE[key][1]
        inventory=devices(); device=inventory[identity]
        points=min(180,seconds//10)
        futures={name:POOL.submit(query,device['chart_prefix'],name,seconds,points) for name in CHARTS}
        charts={name:future.result() for name,future in futures.items()}
        overview=[dict(id=id,name=d['name'],latest=latest(d)) for id,d in inventory.items()]
        sample=next(d['latest'] for d in overview if d['id']==identity)
        # Device policy also hides snapshots saved by older receiver versions.
        inspector=sample.get('inspector') if sample and identity != 'qn90a' else None
        for entry in overview:
            if entry['latest']:entry['latest'].pop('inspector',None)
        # Current values come from this exact snapshot, never a previous boot's history bucket.
        live={}
        for name in ('cpu','network','disk','collector_cpu'):
            values=(sample or {}).get('metrics',{}).get(name,{})
            live[name]={'labels':['time']+list(values),'data':[[sample['received_at']]+list(values.values())] if values else []}
        result={'device':identity,'name':device['name'],'devices':overview,'server_time':time.time(),'range':seconds,'latest':sample,'charts':charts,'current':live,'inspector':inspector}
        CACHE[key]=(time.monotonic(),result)
        return result

class Handler(http.server.BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(10)
        super().setup()
    def log_message(self,*args):pass
    def reply(self,status,data,content_type):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        url=urllib.parse.urlsplit(self.path)
        if url.path=='/api/snapshot':
            try:
                params=urllib.parse.parse_qs(url.query,strict_parsing=True)
                if not set(params)<= {'range','device'} or len(params.get('range',[]))!=1 or len(params.get('device',['s90d']))!=1:raise ValueError()
                identity=params.get('device',['s90d'])[0]
                if identity not in devices():raise ValueError()
                seconds=int(params['range'][0])
                if seconds not in RANGES:raise ValueError()
            except (ValueError,KeyError):return self.reply(400,b'Invalid range','text/plain')
            return self.reply(200,json.dumps(snapshot(seconds,identity),allow_nan=False).encode(),'application/json')
        files={'/inspector.js':('inspector.js','text/javascript; charset=utf-8'),'/':('index.html','text/html; charset=utf-8'),'/index.html':('index.html','text/html; charset=utf-8'),'/dashboard.js':('dashboard.js','text/javascript; charset=utf-8'),'/dashboard.css':('dashboard.css','text/css; charset=utf-8'),'/health':(None,'text/plain')}
        if url.path not in files:return self.reply(404,b'Not found','text/plain')
        name,mime=files[url.path]
        self.reply(200,(ROOT/name).read_bytes() if name else b'ok',mime)

class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
    daemon_threads=True
    slots=threading.BoundedSemaphore(8)
    def process_request(self,request,address):
        if not self.slots.acquire(blocking=False):request.close();return
        try:super().process_request(request,address)
        except Exception:self.slots.release();raise
    def process_request_thread(self,request,address):
        try:super().process_request_thread(request,address)
        finally:self.slots.release()

if __name__=='__main__':
    Server(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler).serve_forever()
