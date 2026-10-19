"""Launch pressure stays inside an isolated native worker, never the host."""
import os
from pathlib import Path
import resource
import subprocess
import tempfile
import time
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class LaunchPressureTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()

    def tearDown(self):
        self.n.tearDown()

    def test_first_output_allocation_failure_preserves_intent(self):
        self.injected_failure('calloc', 1, 'Insufficient memory')

    def test_second_output_allocation_failure_preserves_intent(self):
        self.injected_failure('calloc', 2, 'Insufficient memory')

    def test_fork_failure_releases_pipes_and_preserves_intent(self):
        self.injected_failure('fork', 1, 'Job intent retained; launch failed')

    def test_pipe_failure_releases_partial_allocations_and_preserves_intent(self):
        for occurrence in (1, 2, 3):
            with self.subTest(pipe=occurrence):
                self.injected_failure('pipe2', occurrence, 'Job intent retained; launch failed')

    def test_identity_failure_retires_child_and_preserves_rejected_id(self):
        self.injected_failure('identity', 1, 'Job intent retained; child identity unavailable')

    def injected_failure(self, mode, occurrence, error):
        n = self.n
        with tempfile.TemporaryDirectory() as tmp:
            library = Path(tmp)/'launch-failure.so'
            config = Path(tmp)/'control'
            subprocess.run(['gcc', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror',
                            str(Path(__file__).parent/'native-io/launch-failure.c'),
                            '-ldl', '-o', str(library)], check=True)
            n.seq += 1
            n.send(f'SHUTDOWN\t{n.seq}')
            n.receive()
            n.proc.wait(timeout=5)
            n.restart(extra_env={'LD_PRELOAD': str(library),
                                 'COUCHROOT_TEST_LAUNCH_FAILURE': str(config)})
            config.write_text(f'{n.worker_pid} {mode} {occurrence}')
            before = {p.name for p in Path(f'/proc/{n.worker_pid}/fd').iterdir()}
            marker = n.root/'unexpected-execution'
            identifier = f'native-launch-failure-{mode}-{occurrence}'
            result = n.job('job.start', identifier, command='touch '+str(marker),
                           timeout_ms=1000, profile='root')
            config.unlink()
            self.assertFalse(result['ok'], result)
            self.assertIn(error, result['error'])
            self.assertEqual({p.name for p in Path(f'/proc/{n.worker_pid}/fd').iterdir()}, before)
            self.assertEqual(n.job('job.status', identifier)['result']['state'], 'unknown')
            self.assertFalse(marker.exists())
            self.assertFalse(n.job('job.start', identifier, command='touch '+str(marker),
                                   timeout_ms=1000, profile='root')['ok'])
            after = f'native-after-{mode}-{occurrence}'
            n.start_job('exit 9', id=after)
            self.assertEqual(n.completed(after)['exit_code'], 9)
            n.seq += 1
            n.send(f'SHUTDOWN\t{n.seq}')
            n.receive()
            self.assertEqual(n.proc.wait(timeout=5), 0)
            n.restart()
            self.assertEqual(n.job('job.status', identifier)['result']['state'], 'interrupted')
            self.assertFalse(marker.exists())

    def test_address_space_limit_refuses_without_execution_then_recovers(self):
        n = self.n
        n.start_job('exit 7', id='native-pressure-saved')
        self.assertEqual(n.completed('native-pressure-saved')['exit_code'], 7)
        saved = n.root/'.jobs/native-pressure-saved.json'
        saved_bytes = saved.read_bytes()
        release, live_witness = n.root/'live-release', n.root/'live-witness'
        os.mkfifo(release, 0o600)
        n.start_job('printf x > '+str(live_witness)+'; read permit < '+str(release)+
                    '; test "$permit" = proceed || exit 12; exit 9',
                    timeout=15000, id='native-pressure-live')
        deadline = time.monotonic()+5
        while not live_witness.exists():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.01)
        self.assertTrue(n.op('status')['ok'])
        before = {p.name for p in Path(f'/proc/{n.worker_pid}/fd').iterdir()}
        pages = int(Path(f'/proc/{n.worker_pid}/statm').read_text().split()[0])
        bound = pages * os.sysconf('SC_PAGE_SIZE')
        original = resource.prlimit(n.worker_pid, resource.RLIMIT_AS)
        marker = n.root/'unexpected-execution'
        identifier = 'native-memory-pressure'
        try:
            resource.prlimit(n.worker_pid, resource.RLIMIT_AS, (bound, original[1]))
            result = n.job('job.start', identifier, command='touch '+str(marker),
                           timeout_ms=1000, profile='root')
        finally:
            resource.prlimit(n.worker_pid, resource.RLIMIT_AS, original)
        self.assertFalse(result['ok'], result)
        self.assertIn('Insufficient memory; job intent retained', result['error'])
        self.assertFalse(marker.exists())
        self.assertEqual({p.name for p in Path(f'/proc/{n.worker_pid}/fd').iterdir()}, before)
        self.assertEqual(n.job('job.status', identifier)['result']['state'], 'unknown')
        self.assertFalse(n.job('job.start', identifier, command='touch '+str(marker),
                               timeout_ms=1000, profile='root')['ok'])
        self.assertEqual(n.job('job.status', 'native-pressure-live')['result']['state'], 'running')
        gate = os.open(release, os.O_WRONLY | os.O_NONBLOCK)
        try:
            os.write(gate, b'proceed\n')
        finally:
            os.close(gate)
        self.assertEqual(n.completed('native-pressure-live')['exit_code'], 9)
        self.assertEqual(live_witness.read_bytes(), b'x')
        self.assertEqual(saved.read_bytes(), saved_bytes)
        n.start_job('exit 7', id='native-memory-recovered')
        self.assertEqual(n.completed('native-memory-recovered')['exit_code'], 7)
        n.seq += 1
        n.send(f'SHUTDOWN\t{n.seq}')
        n.receive()
        self.assertEqual(n.proc.wait(timeout=5), 0)
        n.restart()
        self.assertEqual(n.job('job.status', identifier)['result']['state'], 'interrupted')
        self.assertFalse(marker.exists())
        self.assertEqual(saved.read_bytes(), saved_bytes)


if __name__ == '__main__':
    unittest.main()
