"""Differential public-operation tests against real managed methods and native wire.
Run in a disposable Linux container; never uses device access or copied TV state.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

import native_worker_test

CONTRACT = json.loads((Path(__file__).parent/'worker-parity/contract.json').read_text())

class Managed:
    def __init__(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='parity-managed-')
        self.root=Path(self.tmp.name)
        self.proc=subprocess.Popen(['dotnet',os.environ['MANAGED_PARITY'],'--parity',str(self.root)],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    def call(self,op,**args):
        self.proc.stdin.write(json.dumps(dict(op='parity.exec' if op=='exec' else op,**args))+'\n');self.proc.stdin.flush()
        line=self.proc.stdout.readline()
        if not line:raise AssertionError(self.proc.stderr.read())
        return json.loads(line)
    def close(self):
        self.proc.stdin.close();self.proc.wait(timeout=10)
        stderr=self.proc.stderr.read();self.proc.stdout.close();self.proc.stderr.close()
        self.tmp.cleanup()
        if self.proc.returncode:raise AssertionError(stderr)

class Native:
    def __init__(self):
        self.session=native_worker_test.NativeWorkerTests('runTest')
        self.session.extra_worker_args=['--production-files'];self.session.setUp();self.root=self.session.root
    def call(self,op,**args):
        n=self.session;n.seq+=1
        if op=='exec':
            n.send(f'EXEC\t{n.seq}\t{args["timeout_ms"]}\t'+base64.b64encode(args['command'].encode()).decode())
        else:n.send(f'OP\t{n.seq}\t'+base64.b64encode(json.dumps(dict(op=op,**args)).encode()).decode())
        frame=n.receive().split('\t')
        if frame[0]=='OPDATA':
            body=n.stream.read(int(frame[3]));assert hashlib.sha256(body).hexdigest()==frame[4]
            return dict(ok=True,result=dict(offset=int(frame[2]),sha256=frame[4],data=base64.b64encode(body).decode()))
        if frame[0]=='RESULT':
            return dict(ok=True,result=dict(exit_code=int(frame[2]),timed_out=frame[3]=='1',stdout=frame[4],stderr=frame[5]))
        assert frame[:2]==['OPRESULT',str(n.seq)]
        return json.loads(base64.b64decode(frame[2]))
    def close(self):self.session.tearDown()

@unittest.skipUnless(os.environ.get('COUCHROOT_PARITY_CONTAINER') and os.environ.get('MANAGED_PARITY') and os.environ.get('NATIVE_WORKER'), 'isolated managed/native differential container required')
class WorkerParityTests(unittest.TestCase):
    def setUp(self):
        self.workers=[]
        for adapter in (Managed,Native):
            worker=adapter();self.workers.append(worker);self.addCleanup(worker.close)
    def compare(self,op,requests,drop=()):
        replies=[w.call(op,**a) for w,a in zip(self.workers,requests)]
        self.assertEqual(replies[0]['ok'],replies[1]['ok'],replies)
        if not replies[0]['ok']:
            self.assertEqual([r.get('outcome') for r in replies],['failed','failed'])
            return replies
        fields=set(CONTRACT['operations'][op])-set(CONTRACT['generated_fields'])-set(drop)
        values=[]
        for w,r in zip(self.workers,replies):
            result=r['result'];self.assertFalse(fields-set(result),r)
            value={k:result[k] for k in fields}
            if 'path' in value:value['path']=value['path'].replace(str(w.root),'<root>',1)
            values.append(value)
        self.assertEqual(*values)
        return replies
    def paired(self,**kwargs):return [dict(kwargs),dict(kwargs)]
    def resources(self,worker):
        status=worker.call('status')
        self.assertTrue(status['ok'],status)
        self.assertIn('resource-inventory-v1',status['result']['capabilities'])
        resources=status['result']['resources']
        self.assertEqual(set(resources),{'schema','scope','transfers','jobs','helpers'})
        self.assertEqual(resources['schema'],1)
        self.assertEqual(resources['scope'],'worker-owned')
        return resources
    def test_resource_inventory_tracks_open_transfers_and_job_supervision(self):
        for w in self.workers:
            self.assertEqual(self.resources(w),dict(schema=1,scope='worker-owned',transfers=[],jobs=[],helpers=[]))
        ids=self.transfer(b'pending')
        for w,id in zip(self.workers,ids):
            self.assertEqual(self.resources(w)['transfers'],[dict(id=id,direction='upload')])
        self.compare('file.close',[dict(transfer_id=id) for id in ids])
        for w in self.workers:
            self.assertEqual(self.resources(w)['transfers'],[])
            source=w.root/'download-source';source.write_bytes(b'data')
            opened=w.call('file.open',path=str(source))
            self.assertTrue(opened['ok'],opened)
            id=opened['result']['transfer_id']
            self.assertEqual(self.resources(w)['transfers'],[dict(id=id,direction='download')])
            self.assertTrue(w.call('file.close',transfer_id=id)['ok'])
        id='parity-inventory-job-001'
        self.compare('job.start',self.paired(id=id,command='sleep 30',timeout_ms=60000,profile='root'),drop=('state','exit_code'))
        for w in self.workers:
            self.assertEqual(self.resources(w)['jobs'],[dict(id=id,state='running',monitor_finished=False)])
        self.assertFalse(self.compare('job.forget',self.paired(id=id))[0]['ok'])
        for w in self.workers:
            self.assertEqual(self.resources(w)['jobs'],[dict(id=id,state='running',monitor_finished=False)])
        self.compare('job.cancel',self.paired(id=id),drop=('state',))
        for w in self.workers:
            self.wait(w,id)
            self.assertEqual(self.resources(w)['jobs'],[dict(id=id,state='cancelled',monitor_finished=True)])
        self.compare('job.forget',self.paired(id=id))
        for w in self.workers:
            self.assertEqual(self.resources(w)['jobs'],[])
    def transfer(self,data,name='nested/file',expected='absent'):
        requests=[]
        for w in self.workers:
            (w.root/'nested').mkdir(exist_ok=True)
            requests.append(dict(path=str(w.root/name),size=len(data),sha256=hashlib.sha256(data).hexdigest(),expected_sha256=expected))
        results=self.compare('file.begin',requests)
        return [r['result']['transfer_id'] for r in results]
    def test_file_lifecycle_resume_ranges_and_conditional_publication(self):
        data=bytes(range(251))*5000;ids=self.transfer(data)
        offset=0
        for chunk in (data[:1048576],data[1048576:]):
            args=[dict(transfer_id=id,offset=offset,data=base64.b64encode(chunk).decode(),sha256=hashlib.sha256(chunk).hexdigest()) for id in ids]
            bad=[dict(a,sha256='0'*64) for a in args];self.assertFalse(self.compare('file.write',bad)[0]['ok'])
            self.compare('file.write',args);offset+=len(chunk)
            self.compare('file.status',[dict(transfer_id=id) for id in ids])
            self.assertFalse(self.compare('file.write',args)[0]['ok'])
        self.compare('file.commit',[dict(transfer_id=id) for id in ids])
        for w in self.workers:self.assertEqual((w.root/'nested/file').read_bytes(),data)
        opened=self.compare('file.open',[dict(path=str(w.root/'nested/file')) for w in self.workers]);ids=[r['result']['transfer_id'] for r in opened]
        self.compare('file.status',[dict(transfer_id=id) for id in ids])
        for offset,length in ((0,1),(1048573,100),(len(data),1)):
            self.compare('file.read',[dict(transfer_id=id,offset=offset,length=length) for id in ids])
        self.compare('file.close',[dict(transfer_id=id) for id in ids])
        for expected,ok in (('absent',False),('0'*64,False),(hashlib.sha256(data).hexdigest(),True)):
            ids=self.transfer(b'',expected=expected)
            results=self.compare('file.commit',[dict(transfer_id=id) for id in ids]);self.assertEqual(results[0]['ok'],ok)
            if not ok:self.compare('file.close',[dict(transfer_id=id) for id in ids])
        for w in self.workers:self.assertEqual((w.root/'nested/file').read_bytes(),b'')
    def test_paths_rejections_and_external_regular_download(self):
        for w in self.workers:
            (w.root/'link').symlink_to('/etc')
            os.mkfifo(w.root/'fifo',0o600)
        for suffix in ('link/passwd','fifo','missing/file','../outside','file/'):
            for op in ('file.open','file.begin'):
                args=[dict(path=str(w.root)+'/'+suffix) for w in self.workers]
                if op=='file.begin':
                    for a in args:a.update(size=0,sha256=hashlib.sha256(b'').hexdigest(),expected_sha256='absent')
                # Both must reject read special files; managed begin can stage
                # beside a FIFO but cannot commit it. That admission difference
                # is explicit and tested on the native side separately.
                if suffix=='fifo' and op=='file.begin':continue
                self.assertFalse(self.compare(op,args)[0]['ok'])
        for path in ('/proc/self/status','/dev/zero','/sys/kernel/uevent_seqnum'):
            self.assertFalse(self.compare('file.open',self.paired(path=path))[0]['ok'])
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'disk-file';p.write_bytes(b'external\0bytes')
            r=self.compare('file.open',self.paired(path=str(p)));ids=[x['result']['transfer_id'] for x in r]
            self.compare('file.read',[dict(transfer_id=id,offset=0,length=100) for id in ids])
            self.compare('file.close',[dict(transfer_id=id) for id in ids])
    def test_exec_nonzero_quoting_bytes_and_timeout(self):
        for command,timeout in [("printf 'hello'; printf 'error' >&2; exit 7",3000),("printf '\\000\\377a'",3000),("printf '%s' 'quoted apostrophe'",3000),('sleep 2',100)]:
            self.compare('exec',self.paired(command=command,timeout_ms=timeout))
    def wait(self,worker,id):
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            r=worker.call('job.status',id=id)
            # Both implementations can expose timed_out before the child is reaped.
            # These fixtures produce a known exit; compare after that transition.
            if r['ok'] and r['result']['state'] in ('completed','cancelled','timed_out') and r['result'].get('exit_code') is not None:return r
            time.sleep(.02)
        self.fail('job completion deadline')
    def test_jobs_nonzero_output_timeout_cancel_and_forget(self):
        for index,command,timeout,cancel in [(0,'printf hello; printf err >&2; exit 7',2000,False),(1,'sleep 3',100,False),(2,'sleep 3',3000,True)]:
            id=f'parity-job-lifecycle-{index:03}'
            args=self.paired(id=id,command=command,timeout_ms=timeout,profile='root')
            self.compare('job.start',args,drop=('state','exit_code'))
            self.assertFalse(self.compare('job.start',args)[0]['ok'])
            if cancel:self.compare('job.cancel',self.paired(id=id),drop=('state',))
            done=[self.wait(w,id)['result'] for w in self.workers]
            self.assertEqual(done[0]['state'],done[1]['state'])
            self.assertEqual(done[0]['exit_code'],done[1]['exit_code'])
            self.assertEqual(done[0]['timed_out'],done[1]['timed_out'])
            self.compare('job.output',self.paired(id=id,stdout_cursor=0,stderr_cursor=0))
            self.compare('job.forget',self.paired(id=id))
    def test_job_admission_boundaries(self):
        for change in (dict(command=''),dict(command=' \t\n'),dict(command='\u00a0\u3000'),dict(command='x'*16385),dict(command='a\0b'),dict(timeout_ms=99),dict(timeout_ms=86400001),dict(profile='other'),dict(id='short')):
            args=dict(id='parity-boundary-job',command=':',timeout_ms=1000,profile='root');args.update(change)
            self.assertFalse(self.compare('job.start',self.paired(**args))[0]['ok'])

    def test_saved_managed_record_schema_and_no_replay(self):
        boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        managed=Path('/opt/couchroot-agent/jobs');managed.mkdir(parents=True,exist_ok=True);managed.chmod(0o700)
        for index,(state,old) in enumerate((('completed',False),('unknown',False),('running',False),('running',True),('cancelled',False),('timed_out',False),('interrupted',False),('starting',False),('cancelling',False))):
            id=f'parity-saved-record-{index:03}'
            record=dict(id=id,boot_id='00000000-0000-0000-0000-000000000001' if old else boot,state=state,pid=0,process_start=None,exit_code=7 if state=='completed' else None)
            paths=[managed/(id+'.json'),self.workers[1].root/'.jobs'/(id+'.json')]
            try:
                for p in paths:p.write_text(json.dumps(record));p.chmod(0o600)
                # Disk-only outcomes are deliberately outside this live inventory.
                for w in self.workers:self.assertEqual(self.resources(w)['jobs'],[])
                results=self.compare('job.status',self.paired(id=id))
                self.assertEqual(results[0]['result']['record'],results[1]['result']['record'])
                self.assertFalse(self.compare('job.start',self.paired(id=id,command=':',timeout_ms=1000,profile='root'))[0]['ok'])
                r=self.compare('job.forget',self.paired(id=id));self.assertEqual(r[0]['ok'],old or state in ('completed','cancelled','timed_out','interrupted'))
            finally:
                for p in paths:p.unlink(missing_ok=True)

if __name__=='__main__':unittest.main()
