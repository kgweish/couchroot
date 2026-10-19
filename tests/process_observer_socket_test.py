"""External observer transport in an isolated Linux container; no TV access."""
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import unittest

BINARY = os.environ.get('PROCESS_OBSERVER')


@unittest.skipUnless(sys.platform == 'linux' and BINARY and os.environ.get('COUCHROOT_PARITY_CONTAINER') == '1', 'isolated Linux observer build required')
class ObserverSocketTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='observer-socket-')
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.token = self.base / 'token'
        self.token.write_text('a' * 64)
        self.token.chmod(0o600)
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(self.listener.close)
        self.address = str(self.base / 'control.sock')
        self.listener.bind(self.address)
        self.listener.listen(1)
        self.listener.settimeout(3)
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.target = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.addCleanup(self.stop, self.target)

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream: stream.close()

    def start(self, token=None, guardian=None, **options):
        args = [BINARY, '--connect', self.address, str(token or self.token), self.boot, str(self.target.pid)]
        if guardian: args.append(str(guardian.pid))
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
        self.addCleanup(self.stop, process)
        return process

    def connect(self):
        peer, _ = self.listener.accept()
        self.addCleanup(peer.close)
        peer.settimeout(3)
        stream = peer.makefile('rb')
        self.addCleanup(stream.close)
        self.assertEqual(stream.readline(), b'AUTH ' + b'a' * 64 + b'\n')
        self.assertEqual(stream.readline(), b'BOUND\n')
        return peer, stream

    def test_socket_protocol_observes_exit_without_parent_stdio(self):
        process = self.start()
        peer, stream = self.connect()
        for byte in b'ARM\n': peer.sendall(bytes([byte]))
        self.assertEqual(stream.readline(), b'ARMED\n')
        self.assertIsNone(process.poll())
        self.target.terminate(); self.target.wait(timeout=3)
        self.assertEqual(stream.readline(), b'EXITED\n')
        self.assertEqual(stream.read(), b'')
        self.assertEqual(process.wait(timeout=3), 0)
        self.assertEqual(process.stdout.read(), b'')
        self.assertEqual(process.stderr.read(), b'')

    def test_controller_disconnect_fails_without_signalling_target(self):
        process = self.start()
        peer, stream = self.connect()
        peer.shutdown(socket.SHUT_RDWR)
        self.assertNotEqual(process.wait(timeout=3), 0)
        self.assertIsNone(self.target.poll())
        self.assertNotIn(b'EXITED', stream.read())

    def test_invalid_control_never_produces_exit_evidence(self):
        process = self.start()
        peer, stream = self.connect()
        peer.sendall(b'NO\n')
        self.assertNotEqual(process.wait(timeout=3), 0)
        self.assertNotIn(b'EXITED', stream.read())
        self.assertIsNone(self.target.poll())

    def test_invalid_tokens_rejected_before_connect(self):
        for content in ('', 'a' * 63, 'a' * 65, 'A' * 64, 'a' * 63 + '\n'):
            with self.subTest(content_length=len(content)):
                self.token.write_text(content)
                process = self.start()
                self.assertNotEqual(process.wait(timeout=3), 0)
                self.assertFalse(select.select([self.listener], [], [], 0)[0])
        self.assertIsNone(self.target.poll())

    def test_linked_or_public_token_refused(self):
        self.token.chmod(0o644)
        process = self.start(); self.assertNotEqual(process.wait(timeout=3), 0)
        self.token.chmod(0o600)
        link = self.base / 'link'; link.symlink_to(self.token)
        process = self.start(link); self.assertNotEqual(process.wait(timeout=3), 0)
        link.unlink(); os.link(self.token, link)
        process = self.start(); self.assertNotEqual(process.wait(timeout=3), 0)
        self.assertFalse(select.select([self.listener], [], [], 0)[0])
        self.assertIsNone(self.target.poll())

    def test_missing_controller_refused_without_target_side_effects(self):
        self.address = str(self.base / 'missing.sock')
        process = self.start()
        self.assertNotEqual(process.wait(timeout=3), 0)
        self.assertEqual(process.stdout.read(), b'')
        self.assertIsNone(self.target.poll())

    def test_pair_waits_for_both_processes(self):
        guardian = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.addCleanup(self.stop, guardian)
        process = self.start(guardian=guardian)
        peer, stream = self.connect()
        peer.sendall(b'ARM\n'); self.assertEqual(stream.readline(), b'ARMED\n')
        guardian.terminate(); guardian.wait(timeout=3)
        self.assertFalse(select.select([peer], [], [], 0.1)[0])
        self.target.terminate(); self.target.wait(timeout=3)
        self.assertEqual(stream.readline(), b'EXITED\n')
        self.assertEqual(process.wait(timeout=3), 0)

    def test_wrong_boot_never_authenticates_or_binds(self):
        self.boot = '00000000-0000-0000-0000-000000000001'
        process = self.start(); self.assertNotEqual(process.wait(timeout=3), 0)
        self.assertFalse(select.select([self.listener], [], [], 0)[0])
        self.assertIsNone(self.target.poll())

    def test_descriptor_pressure_refuses_before_connect(self):
        import resource
        def limit():
            _, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
            resource.setrlimit(resource.RLIMIT_NOFILE, (5, hard))
        process = self.start(preexec_fn=limit)
        self.assertEqual(process.wait(timeout=3), 1)
        self.assertFalse(select.select([self.listener], [], [], 0)[0])
        self.assertIsNone(self.target.poll())

    @unittest.skipUnless(os.geteuid() == 0, 'credential fixture needs container root')
    def test_foreign_controller_credentials_refused(self):
        # Permit traversal and connection so failure is specifically peer identity.
        self.base.chmod(0o755)
        os.chown(self.token, 65534, 65534)
        os.chmod(self.address, 0o777)
        process = self.start(user=65534, group=65534, extra_groups=[])
        peer, _ = self.listener.accept(); self.addCleanup(peer.close); peer.settimeout(3)
        self.assertEqual(peer.recv(128), b'')
        self.assertEqual(process.wait(timeout=3), 1)
        self.assertIn(b'controller connection unavailable', process.stderr.read())
        self.assertIsNone(self.target.poll())


if __name__ == '__main__':
    unittest.main()
