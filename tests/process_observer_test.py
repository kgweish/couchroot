"""Native pidfd observer protocol in a disposable Linux container only."""
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import unittest

BINARY = os.environ.get('PROCESS_OBSERVER')


@unittest.skipUnless(sys.platform == 'linux' and BINARY and os.environ.get('COUCHROOT_PARITY_CONTAINER') == '1', 'isolated Linux observer build required')
class ProcessObserverTests(unittest.TestCase):
    def setUp(self):
        self.target = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.observers = []

    def tearDown(self):
        for p in self.observers:
            if p.poll() is None:
                p.kill()
            p.wait(timeout=3)
            for stream in (p.stdin, p.stdout, p.stderr):
                stream.close()
        if self.target.poll() is None:
            self.target.kill()
        self.target.wait(timeout=3)

    def start(self, args=None, **kw):
        p = subprocess.Popen([BINARY, *(args if args is not None else [self.boot, str(self.target.pid)])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
        self.observers.append(p)
        return p

    def line(self, p, expected):
        self.assertTrue(select.select([p.stdout], [], [], 3)[0], 'observer response deadline')
        self.assertEqual(p.stdout.readline(), expected + b'\n')

    def test_fragmented_arm_and_actual_exit(self):
        p = self.start()
        self.line(p, b'BOUND')
        for byte in b'ARM\n':
            p.stdin.write(bytes([byte]))
            p.stdin.flush()
        self.line(p, b'ARMED')
        self.assertIsNone(p.poll())
        self.target.terminate()
        self.target.wait(timeout=3)
        self.line(p, b'EXITED')
        self.assertEqual(p.wait(timeout=3), 0)
        self.assertEqual(p.stderr.read(), b'')

    def test_pair_requires_both_exits_in_either_order(self):
        for guardian_first in (False, True):
            worker = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
            guardian = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
            try:
                p = self.start([self.boot, str(worker.pid), str(guardian.pid)])
                self.line(p, b'BOUND')
                p.stdin.write(b'ARM\n'); p.stdin.flush()
                self.line(p, b'ARMED')
                first, second = (guardian, worker) if guardian_first else (worker, guardian)
                first.terminate(); first.wait(timeout=3)
                self.assertFalse(select.select([p.stdout], [], [], 0.1)[0])
                self.assertIsNone(p.poll())
                second.terminate(); second.wait(timeout=3)
                self.line(p, b'EXITED')
                self.assertEqual(p.wait(timeout=3), 0)
            finally:
                for child in (worker, guardian):
                    if child.poll() is None: child.kill()
                    child.wait(timeout=3)

    def test_pair_refuses_duplicate_and_invalid_guardian_pid(self):
        for guardian in (str(self.target.pid), '0', '-1', '01', '2147483648'):
            p = self.start([self.boot, str(self.target.pid), guardian])
            self.assertNotEqual(p.wait(timeout=3), 0)
            self.assertEqual(p.stdout.read(), b'')
        self.assertIsNone(self.target.poll())

    def test_guardian_exit_before_arm_refuses_pair(self):
        guardian = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        try:
            p = self.start([self.boot, str(self.target.pid), str(guardian.pid)])
            self.line(p, b'BOUND')
            guardian.terminate(); guardian.wait(timeout=3)
            self.assertNotEqual(p.wait(timeout=3), 0)
            self.assertNotIn(b'EXITED', p.stdout.read())
            self.assertIsNone(self.target.poll())
        finally:
            if guardian.poll() is None: guardian.kill()
            guardian.wait(timeout=3)

    def test_pair_descriptor_admission_refuses_before_binding(self):
        import resource
        def tight_limit():
            _, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
            resource.setrlimit(resource.RLIMIT_NOFILE, (5, hard))
        p = self.start([self.boot, str(self.target.pid), str(os.getpid())], preexec_fn=tight_limit)
        self.assertNotEqual(p.wait(timeout=3), 0)
        self.assertEqual(p.stdout.read(), b'')
        self.assertIn(b'initial observation unavailable', p.stderr.read())
        self.assertIsNone(self.target.poll())

    def test_invalid_arguments_and_boot_fail_without_target_signal(self):
        for args in [[], [self.boot, '0'], [self.boot, '01'], [self.boot, '-1'], [self.boot, '+2'], [self.boot, '2147483648'], [self.boot, '9'*100], [self.boot.upper(), str(self.target.pid)], ['00000000-0000-0000-0000-000000000001', str(self.target.pid)]]:
            p = self.start(args)
            self.assertNotEqual(p.wait(timeout=3), 0)
            self.assertEqual(p.stdout.read(), b'')
        self.assertIsNone(self.target.poll())

    def test_exit_before_arm_is_not_success(self):
        p = self.start()
        self.line(p, b'BOUND')
        self.target.terminate()
        self.target.wait(timeout=3)
        self.assertNotEqual(p.wait(timeout=3), 0)
        self.assertNotIn(b'EXITED', p.stdout.read())

    def test_malformed_control_and_controller_eof_fail(self):
        for control in [b'ARM\nextra', b'arm\n', b'ARM\r\n', None]:
            p = self.start()
            self.line(p, b'BOUND')
            if control is None:
                p.stdin.close()
            else:
                p.stdin.write(control)
                p.stdin.flush()
            self.assertNotEqual(p.wait(timeout=3), 0)
        self.assertIsNone(self.target.poll())

    def test_no_inherited_descriptor_and_no_privilege_change(self):
        with open('/dev/null', 'rb') as stream:
            p = self.start(pass_fds=(stream.fileno(),))
            self.line(p, b'BOUND')
            links = [os.readlink(f) for f in Path('/proc', str(p.pid), 'fd').iterdir()]
            self.assertNotIn('/dev/null', links)
            own = Path('/proc/self/status').read_text().splitlines()
            child = Path('/proc', str(p.pid), 'status').read_text().splitlines()
            for field in ('Uid:', 'Gid:', 'CapEff:'):
                self.assertEqual(next(v for v in own if v.startswith(field)), next(v for v in child if v.startswith(field)))
            p.stdin.close()
            self.assertNotEqual(p.wait(timeout=3), 0)

    def test_unarmed_controller_has_bounded_lifetime(self):
        p = self.start()
        self.line(p, b'BOUND')
        self.assertNotEqual(p.wait(timeout=12), 0)
        self.assertIn(b'deadline expired', p.stderr.read())
        self.assertIsNone(self.target.poll())

    def test_armed_observation_expires_without_signalling_target(self):
        p = self.start()
        self.line(p, b'BOUND')
        p.stdin.write(b'ARM\n')
        p.stdin.flush()
        self.line(p, b'ARMED')
        self.assertNotEqual(p.wait(timeout=22), 0)
        self.assertIn(b'deadline expired', p.stderr.read())
        self.assertIsNone(self.target.poll())

    def test_inherited_alarm_mask_and_ignored_handler_are_reset(self):
        def mask_alarm():
            signal.signal(signal.SIGALRM, signal.SIG_IGN)
            signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM})
        p = self.start(preexec_fn=mask_alarm)
        self.line(p, b'BOUND')
        fields = dict(line.split(':', 1) for line in Path('/proc', str(p.pid), 'status').read_text().splitlines())
        alarm_bit = 1 << (signal.SIGALRM - 1)
        self.assertFalse(int(fields['SigBlk'], 16) & alarm_bit)
        self.assertFalse(int(fields['SigIgn'], 16) & alarm_bit)
        p.stdin.close()
        self.assertNotEqual(p.wait(timeout=3), 0)
