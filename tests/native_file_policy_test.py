"""Production file policy and retained records, in an isolated Linux container."""
import base64
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import tempfile
import unittest

import native_worker_test
from tvsetup.native_job_migration import migrate

@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'), 'isolated native container required')
class NativeFilePolicyTests(unittest.TestCase):
    def setUp(self):
        self.n=native_worker_test.NativeWorkerTests('runTest');self.n.extra_worker_args=['--production-files'];self.n.setUp()
        self.root=self.n.root
    def tearDown(self):self.n.tearDown()
    def stop(self):
        self.n.seq+=1;self.n.send(f'SHUTDOWN\t{self.n.seq}');self.n.receive();self.n.proc.wait(timeout=5)
    def test_nested_and_external_reads_and_write_roots(self):
        (self.root/'nested').mkdir()
        data=b'nested upload';id=self.n.begin(data,'nested/data')
        self.assertTrue(self.n.upload(id,data)['ok']);self.assertTrue(self.n.op('file.commit',transfer_id=id)['ok'])
        self.assertEqual((self.root/'nested/data').read_bytes(),data)
        with tempfile.TemporaryDirectory() as external:
            p=Path(external)/'read';p.write_bytes(b'external')
            opened=self.n.op('file.open',path=str(p));self.assertTrue(opened['ok'],opened)
            id=opened['result']['transfer_id'];self.assertEqual(opened['result']['offset'],0)
            status=self.n.op('file.status',transfer_id=id)['result']
            self.assertEqual(status['offset'],8);self.assertIsNone(status['expected_sha256'])
            self.assertTrue(self.n.op('file.close',transfer_id=id)['ok'])
            self.assertFalse(self.n.op('file.begin',path=str(p),size=0,sha256=hashlib.sha256(b'').hexdigest(),expected_sha256='absent')['ok'])
        for base in ('/opt/couchroot-agent/files','/home/owner/share/tmp/sdk_tools'):
            Path(base).mkdir(parents=True,exist_ok=True)
            with tempfile.TemporaryDirectory(dir=base) as folder:
                id=self.n.begin(data,Path(folder)/'file')
                self.assertTrue(self.n.upload(id,data)['ok']);self.assertTrue(self.n.op('file.commit',transfer_id=id)['ok'])
                self.assertEqual((Path(folder)/'file').read_bytes(),data)
    def test_noncanonical_symlink_special_and_missing_parent_refusal(self):
        (self.root/'dir').mkdir();(self.root/'link').symlink_to(self.root/'dir',target_is_directory=True)
        (self.root/'dangling').symlink_to(self.root/'missing')
        os.mkfifo(self.root/'fifo',0o600)
        paths=[str(self.root)+'/dir/../file',str(self.root)+'//file',str(self.root)+'/file/',str(self.root/'link/file'),str(self.root/'dangling'),str(self.root/'fifo'),str(self.root/'missing/file'),'/proc/self/status','/sys/kernel/uevent_seqnum','/dev/zero',str(self.root/'.jobs/lock')]
        for path in paths:
            with self.subTest(path=path):
                self.assertFalse(self.n.op('file.open',path=path)['ok'])
                self.assertFalse(self.n.op('file.begin',path=path,size=0,sha256=hashlib.sha256(b'').hexdigest(),expected_sha256='absent')['ok'])
        self.assertFalse((self.root/'missing').exists())
    def test_parent_replacement_commit_refuses_and_cleanup_uses_owned_parent(self):
        parent=self.root/'dir';parent.mkdir()
        data=b'kept';id=self.n.begin(data,'dir/file');self.assertTrue(self.n.upload(id,data)['ok'])
        parent.rename(self.root/'moved');parent.mkdir()
        self.assertFalse(self.n.op('file.commit',transfer_id=id)['ok'])
        self.assertFalse((parent/'file').exists())
        self.assertTrue(self.n.op('file.close',transfer_id=id)['ok'])
        self.assertEqual(list((self.root/'moved').iterdir()),[])
    def test_descriptor_threshold_and_repeated_close_preserve_set(self):
        (self.root/'nested').mkdir()
        pid=self.n.worker_pid
        occupied=lambda:{int(p.name) for p in Path(f'/proc/{pid}/fd').iterdir()}
        before=occupied();original=resource.prlimit(pid,resource.RLIMIT_NOFILE)
        for slots in (2,3):
            limit=available=0
            while available<slots:
                if limit not in before:available+=1
                limit+=1
            try:
                resource.prlimit(pid,resource.RLIMIT_NOFILE,(limit,original[1]))
                r=self.n.op('file.begin',path=str(self.root/'nested/data'),size=0,sha256=hashlib.sha256(b'').hexdigest(),expected_sha256='absent')
                self.assertEqual(r['ok'],slots==3,r)
            finally:resource.prlimit(pid,resource.RLIMIT_NOFILE,original)
            if r['ok']:self.assertTrue(self.n.op('file.close',transfer_id=r['result']['transfer_id'])['ok'])
            self.assertEqual(before,occupied())
        for i in range(16):
            id=self.n.begin(b'',f'nested/data-{i}')
            self.assertTrue(self.n.op('file.close',transfer_id=id)['ok'])
        self.assertEqual(before,occupied())
    def test_imported_records_restart_no_replay_and_forget(self):
        boot=self.n.op('status')['result']['boot_id'];self.stop()
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp);source.chmod(0o700)
            for i,state in enumerate(('completed','unknown','running','cancelled')):
                id=f'legacy-parity-job-{i:02}'
                p=source/(id+'.json');p.write_text(json.dumps(dict(id=id,boot_id=boot,state=state,pid=0,exit_code=7 if state=='completed' else None,process_start=None)));p.chmod(0o600)
            migrate(source,self.root/'.jobs');original={p.name:p.read_bytes() for p in source.iterdir()}
            self.n.restart()
            for i,state in enumerate(('completed','unknown','unknown','cancelled')):
                id=f'legacy-parity-job-{i:02}';r=self.n.op('job.status',id=id)
                self.assertTrue(r['ok'],r);self.assertEqual(r['result']['state'],state)
                self.assertFalse(r['result']['output_available'])
                self.assertFalse(self.n.op('job.start',id=id,command='touch '+str(self.root/'unexpected'),timeout_ms=1000,profile='root')['ok'])
                self.assertFalse(self.n.op('job.cancel',id=id)['ok'])
                self.assertEqual(self.n.op('job.forget',id=id)['ok'],state in ('completed','cancelled'))
            self.assertFalse((self.root/'unexpected').exists())
            self.assertEqual(original,{p.name:p.read_bytes() for p in source.iterdir()})
    def test_incomplete_import_prevents_start(self):
        self.stop()
        marker=self.root/'.jobs/.import-pending';marker.write_text('{}');marker.chmod(0o600)
        self.n.token.write_bytes(base64.b64encode(self.n.secret));self.n.token.chmod(0o600)
        trial=subprocess.run(self.n.worker_args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
        self.assertNotEqual(trial.returncode,0)
        self.assertIn(b'unfinished job import',trial.stderr)
        marker.unlink()
        self.n.restart()

if __name__=='__main__':unittest.main()
