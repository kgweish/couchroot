"""Job execution deadlines exclude durable launch preparation; Linux fixture only."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class JobStartTimingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        library = Path(self.tmp.name)/'delay.so'
        subprocess.run(['gcc', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror',
                        str(Path(__file__).parent/'native-io/delay.c'),
                        '-ldl', '-o', str(library)], check=True)
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.id = 'native-delayed-start'
        pid_file = Path(self.tmp.name)/'worker-pid'
        directory = 'directory' in self._testMethodName
        self.n.restart(extra_env={
            'LD_PRELOAD': str(library),
            'COUCHROOT_IO_TEST_PATH': str(self.n.root/'.jobs') if directory else str(self.n.root/'.jobs'/'.intent-'),
            'COUCHROOT_IO_TEST_OP': 'fsync',
            'COUCHROOT_IO_TEST_MODE': ('blocked' if 'stalled' in self._testMethodName else
                                      'fail' if 'failed' in self._testMethodName else 'progress'),
            'COUCHROOT_IO_TEST_PID_FILE': str(pid_file),
            **({'COUCHROOT_IO_TEST_EXACT': '1',
                'COUCHROOT_IO_TEST_AFTER_FILE': str(self.n.root/'.jobs'/f'{self.id}.json')}
               if directory else {}),
        })
        pid_file.write_text(str(self.n.worker_pid))

    def tearDown(self):
        self.n.tearDown()
        self.tmp.cleanup()

    def delayed_start(self, command, timeout):
        witness = self.n.root/'executed'
        observations = []

        def observe_gate():
            time.sleep(1)
            observations.append(witness.exists())

        observer = threading.Thread(target=observe_gate)
        observer.start()
        before = time.monotonic()
        try:
            result = self.n.start_job('printf x >> '+str(witness)+'; '+command,
                                      timeout=timeout, id=self.id)
        finally:
            observer.join(timeout=3)
        self.assertGreaterEqual(time.monotonic()-before, 2)
        self.assertEqual(observations, [False], 'command ran before durable preparation')
        return result, witness

    def test_slow_preparation_does_not_consume_command_timeout(self):
        _, witness = self.delayed_start('sleep .05; exit 7', 500)
        terminal = self.n.completed(self.id)
        self.assertEqual(terminal['state'], 'completed')
        self.assertEqual(terminal['exit_code'], 7)
        self.assertFalse(terminal['timed_out'])
        self.assertFalse(terminal['persistence_failed'])
        record = self.n.root/'.jobs'/f'{self.id}.json'
        saved = record.read_bytes()
        self.assertEqual(json.loads(saved)['exit_code'], 7)
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.n.restart()
        self.assertEqual(self.n.job('job.status', self.id)['result']['state'], 'completed')
        self.assertEqual(record.read_bytes(), saved)
        self.assertEqual(witness.read_bytes(), b'x')

    def test_command_timeout_remains_active_after_slow_preparation(self):
        survivor = self.n.root/'survived'
        _, witness = self.delayed_start('sleep 2; touch '+str(survivor), 200)
        terminal = self.n.completed(self.id)
        self.assertEqual(terminal['state'], 'timed_out')
        self.assertEqual(terminal['exit_code'], 137)
        self.assertTrue(terminal['timed_out'])
        self.assertEqual(witness.read_bytes(), b'x')
        self.assertFalse(survivor.exists())

    def test_slow_directory_preparation_keeps_command_gated(self):
        _, witness = self.delayed_start('sleep .05; exit 7', 500)
        terminal = self.n.completed(self.id)
        self.assertEqual(terminal['state'], 'completed')
        self.assertEqual(terminal['exit_code'], 7)
        self.assertFalse(terminal['timed_out'])
        self.assertFalse(terminal['persistence_failed'])
        self.assertEqual(witness.read_bytes(), b'x')

    def test_failed_initial_publication_never_releases_command_or_leaks_child(self):
        witness = self.n.root/'executed'
        children = Path(f'/proc/{self.n.worker_pid}/task/{self.n.worker_pid}/children')
        before = children.read_text()
        result = self.n.job('job.start', self.id, command='touch '+str(witness),
                            timeout_ms=500, profile='root')
        self.assertFalse(result['ok'])
        self.assertIn('cannot be persisted; not launched', result['error'])
        self.assertEqual(children.read_text(), before)
        self.assertFalse(self.n.job('job.status', self.id)['ok'])
        self.assertFalse((self.n.root/'.jobs'/f'{self.id}.json').exists())
        self.assertFalse(witness.exists())
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.n.restart()
        self.assertFalse(self.n.job('job.status', self.id)['ok'])
        self.assertFalse(witness.exists())
        # The failed exclusive publication positively reported no execution.
        self.n.start_job('exit 9', id=self.id)
        self.assertEqual(self.n.completed(self.id)['exit_code'], 9)

    def test_conflicting_publication_preserves_foreign_bytes_and_retires_gated_child(self):
        witness = self.n.root/'executed'
        record = self.n.root/'.jobs'/f'{self.id}.json'
        foreign = b'foreign concurrent writer must survive'
        children = Path(f'/proc/{self.n.worker_pid}/task/{self.n.worker_pid}/children')
        before = children.read_text()
        def conflict():
            deadline = time.monotonic()+5
            while not list((self.n.root/'.jobs').glob('.intent-*')):
                self.assertLess(time.monotonic(), deadline)
                time.sleep(.01)
            record.write_bytes(foreign)
            record.chmod(0o600)
        thread = threading.Thread(target=conflict)
        thread.start()
        result = self.n.job('job.start', self.id, command='touch '+str(witness),
                            timeout_ms=500, profile='root')
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(result['ok'])
        self.assertEqual(record.read_bytes(), foreign)
        self.assertEqual(children.read_text(), before)
        self.assertFalse(witness.exists())
        self.assertFalse(list((self.n.root/'.jobs').glob('.intent-*')))
        record.unlink()  # Only this fixture's exact, never-accepted foreign bytes.

    def test_failed_directory_sync_retains_published_id_without_execution(self):
        witness = self.n.root/'executed'
        result = self.n.job('job.start', self.id, command='touch '+str(witness),
                            timeout_ms=500, profile='root')
        self.assertFalse(result['ok'])
        self.assertIn('Launch failed after intent', result['error'])
        terminal = self.n.completed(self.id)
        self.assertEqual(terminal['exit_code'], 137)
        self.assertTrue(terminal['persistence_failed'])
        self.assertFalse(witness.exists())
        record = self.n.root/'.jobs'/f'{self.id}.json'
        self.assertEqual(json.loads(record.read_text())['id'], self.id)
        self.assertFalse(self.n.job('job.start', self.id, command='touch '+str(witness),
                                    timeout_ms=500, profile='root')['ok'])
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)
        self.n.restart()
        retained = self.n.job('job.status', self.id)['result']
        self.assertIn(retained['state'], ('interrupted', 'cancelled'))
        self.assertFalse(witness.exists())
        self.assertFalse(self.n.job('job.start', self.id, command='true',
                                    timeout_ms=500, profile='root')['ok'])

    def test_stalled_preparation_watchdog_keeps_command_gated(self):
        witness = self.n.root/'executed'
        request = dict(op='job.start', id=self.id, command='touch '+str(witness),
                       timeout_ms=500, profile='root')
        self.n.seq += 1
        self.n.send(f'OP\t{self.n.seq}\t'+base64.b64encode(json.dumps(request).encode()).decode())
        before = time.monotonic()
        self.assertEqual(self.n.proc.wait(timeout=38), 137)
        self.assertGreaterEqual(time.monotonic()-before, 25)
        self.assertFalse(witness.exists())
        self.n.restart()
        self.assertEqual(self.n.job('job.status', self.id)['result']['state'], 'interrupted')
        self.assertFalse(witness.exists())


if __name__ == '__main__':
    unittest.main()
