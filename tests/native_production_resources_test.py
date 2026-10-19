"""Production resource boundaries in isolated Linux fixtures; no TV access."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_ACCEPT'), 'native acceptance controller required')
class AcceptanceModeTests(unittest.TestCase):
    def test_conflicting_modes_refuse_before_creating_state(self):
        conflicts = ('COUCHROOT_NATIVE_HANDOFF_ONLY', 'COUCHROOT_NATIVE_PARITY_ONLY',
                     'COUCHROOT_NATIVE_RESOURCE_ONLY', 'COUCHROOT_NATIVE_SOAK_SECONDS',
                     'COUCHROOT_NATIVE_LIFETIME_SECONDS', 'COUCHROOT_NATIVE_LAUNCH_PRESSURE')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = [os.environ['NATIVE_ACCEPT'], '/missing-worker', str(root/'token'),
                    str(root/'files'), '/missing-launcher', '0'*64, '/missing-helper']
            for extra in [{key: '1'} for key in conflicts] + [
                    {'COUCHROOT_NATIVE_PRODUCTION_RESOURCES': value} for value in ('', '0', 'yes')]:
                with self.subTest(extra=extra):
                    env = {key: value for key, value in os.environ.items()
                           if not key.startswith('COUCHROOT_NATIVE_')}
                    env.update(COUCHROOT_NATIVE_PRODUCTION_RESOURCES='1')
                    env.update(extra)
                    result = subprocess.run(args, env=env, capture_output=True, timeout=5)
                    self.assertEqual(result.returncode, 64, result.stderr)
                    self.assertIn(b'cannot combine experiment modes', result.stderr)
                    self.assertEqual(list(root.iterdir()), [])

    def test_launch_pressure_mode_conflicts_refuse_before_creating_state(self):
        conflicts = ('COUCHROOT_NATIVE_HANDOFF_ONLY', 'COUCHROOT_NATIVE_PARITY_ONLY',
                     'COUCHROOT_NATIVE_RESOURCE_ONLY', 'COUCHROOT_NATIVE_SOAK_SECONDS',
                     'COUCHROOT_NATIVE_LIFETIME_SECONDS', 'COUCHROOT_NATIVE_PRODUCTION_RESOURCES')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = [os.environ['NATIVE_ACCEPT'], '/missing-worker', str(root/'token'),
                    str(root/'files'), '/missing-launcher', '0'*64, '/missing-helper']
            for extra in [{key: '1'} for key in conflicts] + [
                    {'COUCHROOT_NATIVE_LAUNCH_PRESSURE': value} for value in ('', '0', 'yes')]:
                with self.subTest(extra=extra):
                    env = {key: value for key, value in os.environ.items()
                           if not key.startswith('COUCHROOT_NATIVE_')}
                    env.update(COUCHROOT_NATIVE_LAUNCH_PRESSURE='1')
                    env.update(extra)
                    result = subprocess.run(args, env=env, capture_output=True, timeout=5)
                    self.assertEqual(result.returncode, 64, result.stderr)
                    self.assertIn(b'cannot combine experiment modes', result.stderr)
                    self.assertEqual(list(root.iterdir()), [])


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class ProductionResourceTests(unittest.TestCase):
    def setUp(self):
        self.worker = native_worker_test.NativeWorkerTests('runTest')
        self.worker.extra_worker_args = ['--production']
        self.worker.setUp()
        status = self.worker.op('status')['result']
        self.assertEqual(status['lifetime_mode'], 'production')
        self.assertEqual(status['lifetime_seconds'], 0)

    def tearDown(self):
        self.worker.tearDown()

    def test_descriptor_admission_and_recovery(self):
        self.worker.test_operation_descriptor_admission_boundaries(file_slots=3)

    def test_exhaustion_preserves_launch_intent_without_replay(self):
        self.worker.test_descriptor_exhaustion_retains_intent_without_launch()

    def test_limit_restored_after_poll_error_keeps_the_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = Path(tmp)/'poll-limit.so'
            source = Path(__file__).parent/'native-io/poll-limit.c'
            subprocess.run(['gcc', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror',
                            str(source), '-ldl', '-o', str(library)], check=True)
            self.worker.seq += 1
            self.worker.send(f'SHUTDOWN\t{self.worker.seq}')
            self.worker.receive()
            self.worker.proc.wait(timeout=5)
            self.worker.restart(extra_env={'LD_PRELOAD': str(library)})
            for _ in range(3):
                self.assertTrue(self.worker.op('status')['ok'])
            import resource
            self.assertGreater(resource.prlimit(self.worker.worker_pid,
                                               resource.RLIMIT_NOFILE)[0], 0)

    def test_zero_limit_idle_survives_but_partial_frame_remains_bounded(self):
        import resource
        pid = self.worker.worker_pid
        original = resource.prlimit(pid, resource.RLIMIT_NOFILE)
        try:
            resource.prlimit(pid, resource.RLIMIT_NOFILE, (0, original[1]))
            # Complete any poll entered before the limit change, then exercise
            # another idle wait with the zero limit already in force.
            self.assertTrue(self.worker.op('status')['ok'])
            self.assertTrue(self.worker.op('status')['ok'])
            time.sleep(32)
            self.assertIsNone(self.worker.proc.poll())
            self.assertTrue(self.worker.op('status')['ok'])
            self.assertEqual(resource.prlimit(pid, resource.RLIMIT_NOFILE)[0], 0)
            self.worker.sock.sendall(b'OP\t')
            started = time.monotonic()
            self.worker.proc.wait(timeout=38)
            self.assertGreaterEqual(time.monotonic() - started, 25)
            self.assertLess(time.monotonic() - started, 38)
            self.assertFalse(Path(f'/proc/{pid}').exists())
        finally:
            try:
                resource.prlimit(pid, resource.RLIMIT_NOFILE, original)
            except ProcessLookupError:
                pass

    @unittest.skipUnless(os.environ.get('NATIVE_WORKER_STORAGE_TEST'),
                         'isolated mount-capable container required')
    def test_full_and_readonly_storage_preserves_outcomes(self):
        self.worker.test_full_and_readonly_job_intent_storage()


if __name__ == '__main__':
    unittest.main()
