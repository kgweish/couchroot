"""Startup refusal and guardian pressure in disposable Linux namespaces only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class StartupResourceTests(unittest.TestCase):
    def test_one_short_refuses_before_token_or_scope_changes(self):
        import resource
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            token = root/'token'
            secret = base64.b64encode(os.urandom(32))
            token.write_bytes(secret)
            token.chmod(0o600)
            app = root/'launcher-source'
            app.write_bytes(Path('/bin/true').read_bytes())
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            args = [os.environ['NATIVE_WORKER'], '127.0.0.1', '1', str(token),
                    str(root), str(app), hashlib.sha256(app.read_bytes()).hexdigest(),
                    '--production']
            result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True,
                                    timeout=5, preexec_fn=lambda: resource.setrlimit(
                                        resource.RLIMIT_NOFILE, (34, 34)))
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn(b'insufficient startup descriptors; state untouched', result.stderr)
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_admitted_budget_serves_requests_and_cleans_up(self):
        self.admitted_budget(35, '')

    def test_sparse_inherited_table_counts_free_slots(self):
        self.admitted_budget(36, 'exec 7</dev/null\n')

    def admitted_budget(self, limit, inherited):
        with tempfile.TemporaryDirectory() as tmp:
            wrapper = Path(tmp)/'worker'
            wrapper.write_text('#!/bin/sh\n'+inherited+f'ulimit -n {limit}\nexec ' +
                               shlex.quote(os.environ['NATIVE_WORKER']) + ' "$@"\n')
            wrapper.chmod(0o700)
            worker = native_worker_test.NativeWorkerTests('runTest')
            worker.extra_worker_args = ['--production']
            with patch.dict(os.environ, NATIVE_WORKER=str(wrapper)):
                worker.setUp()
            try:
                status = worker.op('status')['result']
                self.assertEqual(status['lifetime_mode'], 'production')
                if inherited:
                    self.assertEqual(os.readlink(f'/proc/{worker.worker_pid}/fd/7'),
                                     '/dev/null')
                worker.start_job('exit 7')
                self.assertEqual(worker.completed()['exit_code'], 7)
                worker.seq += 1
                worker.send(f'SHUTDOWN\t{worker.seq}')
                worker.receive()
                self.assertEqual(worker.proc.wait(timeout=5), 0)
                self.assertFalse((worker.root/'.jobs/guardian').exists())
            finally:
                worker.tearDown()


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class GuardianResourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = Path(self.tmp.name)/'abort-exhaustion.so'
        subprocess.run(['gcc', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror',
                        str(Path(__file__).parent/'native-io/abort-exhaustion.c'),
                        '-ldl', '-o', str(self.library)], check=True)
        self.worker = native_worker_test.NativeWorkerTests('runTest')
        self.worker.extra_worker_args = ['--production']
        self.extra_env = {'LD_PRELOAD': str(self.library)}
        if 'nomem' in self._testMethodName:
            self.extra_env['COUCHROOT_TEST_GUARDIAN_NOMEM'] = '1'
        with patch.dict(os.environ, self.extra_env):
            self.worker.setUp()

    def tearDown(self):
        self.worker.tearDown()
        self.tmp.cleanup()

    def recover(self, fault, nomem=False):
        import resource
        w = self.worker
        w.start_job('exit 7', id='native-preserved-result')
        self.assertEqual(w.completed('native-preserved-result')['exit_code'], 7)
        saved = w.root/'.jobs/native-preserved-result.json'
        before = saved.read_bytes()
        counter = w.root/'run-count'
        live = w.start_job('printf x >> '+str(counter)+'; exec sleep 60',
                           timeout=120000, id='native-pressure-live')
        deadline = time.monotonic()+5
        while not counter.exists():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.01)
        journal = w.root/'.jobs/guardian'
        journal_before = journal.read_bytes()
        guardian = w.proc.pid
        limit = resource.prlimit(guardian, resource.RLIMIT_NOFILE)
        bound = 0
        if nomem:
            # Three available slots allow ordinary runtime cleanup to succeed,
            # exposing a fatal-exit path that must not clean live owned state.
            occupied = {int(p.name) for p in Path(f'/proc/{guardian}/fd').iterdir()}
            free = 0
            while free < 3:
                free += bound not in occupied
                bound += 1
            self.assertLess(bound, 32)
        resource.prlimit(guardian, resource.RLIMIT_NOFILE, (bound, limit[1]))
        if fault:
            os.kill(w.worker_pid, signal.SIGSEGV)
        else:
            w.seq += 1
            w.send(f'SHUTDOWN\t{w.seq}')
            w.receive()
        # 93 would mean an actual exhausted libc allocation bypassed admission.
        self.assertEqual(w.proc.wait(timeout=8), 1 if fault else 125)
        self.assertEqual(journal.read_bytes(), journal_before)
        stopped_record = (w.root/'.jobs/native-pressure-live.json').read_bytes()
        deadline = time.monotonic()+5
        for pid in (w.worker_pid, live['pid']):
            while Path(f'/proc/{pid}').exists():
                try:
                    stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
                except FileNotFoundError:
                    break
                if stat[0] == 'Z':
                    break  # Container PID 1 may retain already-dead orphans.
                self.assertLess(time.monotonic(), deadline)
                time.sleep(.01)
        w.restart(extra_env=self.extra_env)
        self.assertEqual(saved.read_bytes(), before)
        state = w.job('job.status', 'native-pressure-live')['result']
        self.assertEqual(state['state'], 'interrupted')
        self.assertEqual(state['record']['exit_code'], None if fault else 137)
        if not fault:
            self.assertEqual((w.root/'.jobs/native-pressure-live.json').read_bytes(),
                             stopped_record)
        self.assertEqual(counter.read_bytes(), b'x')
        self.assertTrue(w.job('job.forget', 'native-pressure-live')['ok'])
        w.start_job('exit 9', id='native-pressure-after')
        self.assertEqual(w.completed('native-pressure-after')['exit_code'], 9)

    def test_shutdown_under_guardian_exhaustion_retains_then_reconciles(self):
        self.recover(False)

    def test_fault_under_guardian_exhaustion_kills_owned_tasks_then_reconciles(self):
        self.recover(True)

    def test_guardian_identity_nomem_retains_ownership_until_tasks_are_gone(self):
        self.recover(True, nomem=True)


if __name__ == '__main__':
    unittest.main()
