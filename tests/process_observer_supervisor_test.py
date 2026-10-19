"""Native observer supervisor receipts, exercised only in a Linux container."""
import json
import os
from pathlib import Path
import select
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import unittest

BINARY = os.environ.get('PROCESS_OBSERVER')

@unittest.skipUnless(sys.platform == 'linux' and BINARY and os.environ.get('COUCHROOT_PARITY_CONTAINER') == '1', 'isolated Linux observer build required')
class ObserverSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='obs-super-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'token').write_text('a'*64); (self.root/'token').chmod(0o600)
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); self.addCleanup(self.server.close)
        self.server.bind(str(self.root/'control')); self.server.listen(2); self.server.settimeout(3)
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.target = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.addCleanup(self.stop, self.target)

    @staticmethod
    def stop(p):
        if p.poll() is None: p.kill()
        p.wait(timeout=3)
        for f in (p.stdin,p.stdout,p.stderr):
            if f: f.close()

    def start(self, guardian=None):
        args=[BINARY,'--supervise',str(self.root/'control'),str(self.root/'token'),self.boot,str(self.target.pid)]
        if guardian: args.append(str(guardian.pid))
        p = subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        self.addCleanup(self.stop,p)
        return p

    def connect(self):
        peer,_=self.server.accept(); self.addCleanup(peer.close); peer.settimeout(3)
        stream=peer.makefile('rb'); self.addCleanup(stream.close)
        self.assertEqual(stream.readline(),b'AUTH '+b'a'*64+b'\n'); self.assertEqual(stream.readline(),b'BOUND\n')
        child,_,_=struct.unpack('3i',peer.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        return peer,stream,child

    def result(self,p,child):
        self.assertEqual(p.wait(timeout=3),0,p.stderr.read())
        self.assertFalse((self.root/'result.next').exists())
        data=json.loads((self.root/'result').read_text())
        self.assertEqual(data['schema'],1); self.assertEqual(data['boot_id'],self.boot)
        self.assertEqual(data['worker_pid'],self.target.pid); self.assertIsNone(data['guardian_pid'])
        self.assertEqual(data['observer_pid'],child)
        self.assertEqual((self.root/'result').stat().st_mode & 0o777,0o600)
        self.assertEqual((self.root/'result').stat().st_nlink,1)
        return data

    def test_success_publishes_only_after_reaping_observer(self):
        p=self.start(); peer,stream,child=self.connect()
        self.assertTrue((self.root/'result.next').exists()); self.assertFalse((self.root/'result').exists())
        peer.sendall(b'ARM\n'); self.assertEqual(stream.readline(),b'ARMED\n')
        self.target.terminate(); self.target.wait(timeout=3)
        self.assertEqual(stream.readline(),b'EXITED\n'); self.assertEqual(stream.read(),b'')
        r=self.result(p,child); self.assertEqual(r['exit_code'],0); self.assertIsNone(r['signal'])
        self.assertFalse(Path('/proc',str(child)).exists())

    def test_disconnect_records_failure_without_signalling_target(self):
        p=self.start(); peer,_,child=self.connect(); peer.shutdown(socket.SHUT_RDWR)
        r=self.result(p,child); self.assertEqual(r['exit_code'],1); self.assertIsNone(r['signal'])
        self.assertIsNone(self.target.poll())

    def test_owned_observer_signal_is_reported(self):
        p=self.start(); _,_,child=self.connect()
        os.kill(child,signal.SIGTERM)
        r=self.result(p,child); self.assertIsNone(r['exit_code']); self.assertEqual(r['signal'],signal.SIGTERM)
        self.assertIsNone(self.target.poll())

    def test_existing_intent_or_receipt_refuses_launch(self):
        for name in ('result.next','result'):
            f=self.root/name; f.write_text('original')
            p=self.start(); self.assertEqual(p.wait(timeout=3),1)
            self.assertEqual(f.read_text(),'original'); self.assertFalse(select.select([self.server],[],[],0)[0])
            f.unlink()
        self.assertIsNone(self.target.poll())

    def test_supervisor_loss_kills_only_observer_and_retains_unknown_intent(self):
        p=self.start(); _,_,child=self.connect()
        fd=os.pidfd_open(child); self.addCleanup(os.close,fd)
        p.kill(); p.wait(timeout=3)
        self.assertTrue(select.select([fd],[],[],3)[0])
        self.assertTrue((self.root/'result.next').exists()); self.assertFalse((self.root/'result').exists())
        self.assertIsNone(self.target.poll())

    def test_public_directory_refuses_before_intent(self):
        self.root.chmod(0o755); p=self.start(); self.assertEqual(p.wait(timeout=3),1)
        self.assertFalse((self.root/'result.next').exists()); self.assertIsNone(self.target.poll())

    def test_pair_receipt_preserves_both_targets(self):
        guardian=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); self.addCleanup(self.stop,guardian)
        p=self.start(guardian); peer,stream,child=self.connect()
        peer.sendall(b'ARM\n'); self.assertEqual(stream.readline(),b'ARMED\n')
        self.target.terminate(); self.target.wait(timeout=3)
        self.assertFalse(select.select([peer],[],[],0.1)[0])
        guardian.terminate(); guardian.wait(timeout=3)
        self.assertEqual(stream.readline(),b'EXITED\n'); self.assertEqual(p.wait(timeout=3),0)
        data=json.loads((self.root/'result').read_text())
        self.assertEqual(data['guardian_pid'],guardian.pid); self.assertEqual(data['worker_pid'],self.target.pid)
        self.assertEqual(data['observer_pid'],child); self.assertEqual(data['exit_code'],0)

    def test_wrong_boot_refuses_before_intent(self):
        self.boot='00000000-0000-0000-0000-000000000001'
        p=self.start(); self.assertEqual(p.wait(timeout=3),1)
        self.assertFalse((self.root/'result.next').exists()); self.assertIsNone(self.target.poll())

if __name__ == '__main__': unittest.main()
