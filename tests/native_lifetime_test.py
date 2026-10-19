"""Production lifetime tests in an isolated Linux container, without TV access."""
import base64
import os
import subprocess
import time
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class NativeLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()

    def tearDown(self):
        self.n.tearDown()

    def test_production_status_and_job_deadlines(self):
        status = self.n.op('status')['result']
        self.assertEqual(status['lifetime_seconds'], 0)
        self.assertEqual(status['lifetime_mode'], 'production')
        self.assertIn('prototype-production-files-v1', status['capabilities'])
        self.n.start_job('sleep 86400', timeout=86400000)
        self.assertEqual(self.n.job('job.status')['result']['state'], 'running')
        self.assertTrue(self.n.job('job.cancel')['ok'])
        self.assertEqual(self.n.completed()['state'], 'cancelled')
        self.n.start_job('sleep 10', timeout=100, id='native-short-deadline')
        self.assertEqual(self.n.completed('native-short-deadline')['state'], 'timed_out')

    def test_buffered_requests_do_not_wait_for_more_network_bytes(self):
        payload = base64.b64encode(b'{"op":"status"}').decode()
        self.n.sock.sendall(self.n.authenticated(f'OP\t1\t{payload}') +
                            self.n.authenticated(f'OP\t2\t{payload}'))
        for seq in (1, 2):
            self.n.seq = seq
            self.assertTrue(self.n.result()['ok'])

    def test_bounded_mode_remains_default(self):
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.n.worker_args.pop()
        self.n.restart()
        status = self.n.op('status')['result']
        self.assertEqual(status['lifetime_seconds'], 300)
        self.assertEqual(status['lifetime_mode'], 'bounded')
        # Waiting for the first byte must remain idle in bounded mode too.
        # Cross the progress-watchdog grace without crossing its 300s lifetime.
        time.sleep(32)
        self.assertIsNone(self.n.proc.poll())
        self.assertTrue(self.n.op('status')['ok'])

    def test_production_rejects_experiment_lifetime(self):
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.n.token.write_bytes(base64.b64encode(self.n.secret))
        self.n.token.chmod(0o600)
        result = subprocess.run(self.n.worker_args, capture_output=True, timeout=5,
                                env={**os.environ, 'COUCHROOT_NATIVE_LIFETIME_SECONDS': '300'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'production mode cannot use an experiment lifetime', result.stderr)

    @unittest.skipUnless(os.environ.get('NATIVE_WORKER_LIFETIME_TEST'), 'extended lifetime checks required')
    def test_idle_and_job_survive_old_worker_and_guardian_deadlines(self):
        self.n.start_job('sleep 86400', timeout=86400000)
        worker = self.n.worker_pid
        guardian = self.n.proc.pid
        # No wire requests: this crosses the old 300s worker, 310s guardian and
        # socket idle deadlines. It is not a substitute for a 24-hour job test.
        time.sleep(315)
        self.assertIsNone(self.n.proc.poll())
        status = self.n.op('status')['result']
        self.assertEqual(status['guardian_pid'], guardian)
        self.assertEqual(self.n.worker_pid, worker)
        self.assertEqual(self.n.job('job.status')['result']['state'], 'running')
        self.assertTrue(self.n.job('job.cancel')['ok'])
        self.assertEqual(self.n.completed()['state'], 'cancelled')

    @unittest.skipUnless(os.environ.get('NATIVE_WORKER_LIFETIME_TEST'), 'extended lifetime checks required')
    def test_partial_frame_is_bounded_and_owned_jobs_are_stopped(self):
        job = self.n.start_job('sleep 86400', timeout=86400000)
        self.n.sock.sendall(b'OP\t1\t')
        started = time.monotonic()
        self.n.proc.wait(timeout=38)
        self.assertLess(time.monotonic() - started, 38)
        self.assertFalse(os.path.exists(f'/proc/{self.n.worker_pid}'))
        self.assertFalse(os.path.exists(f'/proc/{job["pid"]}'))


if __name__ == '__main__':
    unittest.main()
