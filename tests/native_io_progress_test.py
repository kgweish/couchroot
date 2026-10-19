"""Slow storage versus stalled storage, isolated Linux host worker only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import time
import threading
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('NATIVE_IO_DELAY') and
                     os.environ.get('COUCHROOT_PARITY_CONTAINER'), 'isolated I/O-delay container required')
class NativeIOProgressTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()

    def tearDown(self):
        self.n.tearDown()

    def delayed(self, path, operation, mode='progress'):
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.n.restart(extra_env={
            'LD_PRELOAD': os.environ['NATIVE_IO_DELAY'],
            'COUCHROOT_IO_TEST_PATH': str(path),
            'COUCHROOT_IO_TEST_OP': operation,
            'COUCHROOT_IO_TEST_MODE': mode,
        })
        self.n.sock.settimeout(50)

    def test_slow_hash_and_range_read_complete_without_restarting_worker(self):
        path = self.n.root / 'slow-read'
        data = b'r' * 1048576
        path.write_bytes(data)
        self.delayed(path, 'pread')
        worker = self.n.worker_pid
        started = time.monotonic()
        opened = self.n.op('file.open', path=str(path))
        self.assertTrue(opened['ok'], opened)
        self.assertGreaterEqual(time.monotonic() - started, 32)
        self.assertEqual(opened['result']['sha256'], hashlib.sha256(data).hexdigest())
        self.n.seq += 1
        payload = dict(op='file.read', transfer_id=opened['result']['transfer_id'], offset=0, length=len(data))
        started = time.monotonic()
        self.n.send(f'OP\t{self.n.seq}\t' + base64.b64encode(json.dumps(payload).encode()).decode())
        frame = self.n.receive().split('\t')
        self.assertEqual(frame[:4], ['OPDATA', str(self.n.seq), '0', str(len(data))])
        self.assertEqual(self.n.stream.read(len(data)), data)
        self.assertEqual(frame[4], hashlib.sha256(data).hexdigest())
        self.assertGreaterEqual(time.monotonic() - started, 32)
        self.assertEqual(self.n.worker_pid, worker)
        self.assertTrue(self.n.op('status')['ok'])

    def test_hash_refuses_size_changes_during_read(self):
        path = self.n.root / 'changing-size'
        for new_size in (1, 262144):
            with self.subTest(size=new_size):
                path.write_bytes(bytes(131072))
                self.delayed(path, 'pread')
                def resize():
                    time.sleep(1)
                    with path.open('r+b') as stream:
                        stream.truncate(new_size)
                writer = threading.Thread(target=resize)
                writer.start()
                try:
                    self.assertFalse(self.n.op('file.open', path=str(path))['ok'])
                finally:
                    writer.join(timeout=5)
                self.assertTrue(self.n.op('status')['ok'])

    def test_sparse_file_at_two_gib_limit_and_oversize_refusal(self):
        path = self.n.root / 'sparse-limit'
        size = 2147483648
        with path.open('wb') as stream:
            stream.truncate(size)
        digest = hashlib.sha256()
        zeros = bytes(1048576)
        for _ in range(size // len(zeros)):
            digest.update(zeros)
        self.n.sock.settimeout(30)
        opened = self.n.op('file.open', path=str(path))
        self.assertTrue(opened['ok'], opened)
        self.assertEqual(opened['result']['size'], size)
        self.assertEqual(opened['result']['sha256'], digest.hexdigest())
        self.n.seq += 1
        payload = dict(op='file.read', transfer_id=opened['result']['transfer_id'],
                       offset=size - 16, length=32)
        self.n.send(f'OP\t{self.n.seq}\t' + base64.b64encode(json.dumps(payload).encode()).decode())
        frame = self.n.receive().split('\t')
        self.assertEqual(frame[:4], ['OPDATA', str(self.n.seq), str(size - 16), '16'])
        self.assertEqual(self.n.stream.read(16), bytes(16))
        self.assertEqual(frame[4], hashlib.sha256(bytes(16)).hexdigest())
        self.assertTrue(self.n.op('file.close', transfer_id=opened['result']['transfer_id'])['ok'])
        with path.open('r+b') as stream:
            stream.truncate(size + 1)
        self.assertFalse(self.n.op('file.open', path=str(path))['ok'])

    def test_partial_slow_writes_complete_and_publish_exact_bytes(self):
        self.delayed(self.n.root / '.upload-', 'pwrite')
        data = b'w' * 1048576
        transfer = self.n.begin(data)
        started = time.monotonic()
        self.assertTrue(self.n.upload(transfer, data)['ok'])
        self.assertGreaterEqual(time.monotonic() - started, 32)
        self.assertEqual(self.n.op('file.status', transfer_id=transfer)['result']['offset'], len(data))
        self.assertTrue(self.n.op('file.commit', transfer_id=transfer)['ok'])
        self.assertEqual((self.n.root / 'file').read_bytes(), data)

    def stalled(self, operation, mode):
        path = self.n.root / 'stalled-read'
        path.write_bytes(b'stalled')
        self.delayed(self.n.root / '.upload-' if operation == 'fsync' else path, operation, mode)
        job = self.n.start_job('sleep 86400', timeout=86400000)
        if operation == 'fsync':
            transfer = self.n.begin(b'x')
            self.n.seq += 1
            self.n.send(f'OPWRITE\t{self.n.seq}\t{transfer}\t0\t1\t' + hashlib.sha256(b'x').hexdigest(), b'x')
        else:
            self.n.seq += 1
            payload = base64.b64encode(json.dumps(dict(op='file.open', path=str(path))).encode()).decode()
            self.n.send(f'OP\t{self.n.seq}\t{payload}')
        started = time.monotonic()
        self.n.proc.wait(timeout=38)
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, 29)
        self.assertLess(elapsed, 38)
        self.assertFalse(Path(f'/proc/{self.n.worker_pid}').exists())
        self.assertFalse(Path(f'/proc/{job["pid"]}').exists())
        self.assertFalse((self.n.root / 'file').exists())

    def test_blocked_hash_read_expires(self):
        self.stalled('pread', 'blocked')

    def test_repeated_eintr_does_not_extend_progress(self):
        self.stalled('pread', 'eintr')

    def test_blocked_flush_expires_without_publication(self):
        self.stalled('fsync', 'blocked')


if __name__ == '__main__':
    unittest.main()
