"""Root-only offline recovery; disposable Linux fixtures, no TV access."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import native_worker_test

OLD_BOOT = '00000000-0000-0000-0000-000000000001'


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class OfflineRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()

    def tearDown(self):
        self.n.tearDown()

    def run_recovery(self, owner, digest, *, boot=None, scope=None):
        return subprocess.run([os.environ['NATIVE_WORKER'], '--reconcile-state',
                               str(scope or self.n.root), boot or self.boot, owner, digest],
                              capture_output=True, timeout=25)

    def old_journal(self):
        status, journal = self.n.guardian_loss()
        journal['boot_id'] = OLD_BOOT
        journal['pid'] = os.getpid()
        journal['process_start'] = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19]
        p = self.n.root/'.jobs/guardian'
        p.write_text(json.dumps(journal))
        return status, journal, p

    def test_offline_recovery_has_no_successor_and_preserves_completed_bytes(self):
        status, journal, path = self.old_journal()
        jobs = self.n.root/'.jobs'
        retained = jobs/'native-old-complete.json'
        retained.write_text(json.dumps(dict(id='native-old-complete', worker_id=journal['worker_id'],
                                           boot_id=OLD_BOOT, state='completed', exit_code=7)))
        retained.chmod(0o600)
        original = retained.read_bytes()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        result = self.run_recovery(journal['worker_id'], digest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b'NATIVE-STATE-RECONCILED\n')
        self.assertFalse(path.exists())
        self.assertFalse(Path(status['app_launcher']['path']).exists())
        self.assertFalse(self.n.token.exists())
        self.assertEqual(retained.read_bytes(), original)
        interrupted = json.loads((jobs/'native-test-job-01.json').read_bytes())
        self.assertEqual(interrupted['state'], 'interrupted')
        self.assertIsNone(interrupted['exit_code'])
        self.assertEqual(interrupted['recovery'], 'stale-guardian-reconciled')
        before = {p.name: p.read_bytes() for p in jobs.iterdir() if p.is_file()}
        retried = self.run_recovery(journal['worker_id'], 'absent')
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assertEqual(before, {p.name: p.read_bytes() for p in jobs.iterdir() if p.is_file()})
        self.n.restart()
        self.assertFalse(self.n.job('job.start', command='touch '+str(self.n.root/'replayed'),
                                    profile='root', timeout_ms=1000)['ok'])
        self.assertFalse((self.n.root/'replayed').exists())

    def test_owner_digest_boot_and_pending_journal_refusals_preserve_evidence(self):
        status, journal, path = self.old_journal()
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        launcher = Path(status['app_launcher']['path'])
        binary = launcher.read_bytes()
        for owner, pin, boot in [('f'*32, digest, self.boot),
                                 (journal['worker_id'], '0'*64, self.boot),
                                 (journal['worker_id'], digest, OLD_BOOT),
                                 (journal['worker_id'], 'absent', self.boot)]:
            with self.subTest(owner=owner, pin=pin, boot=boot):
                result = self.run_recovery(owner, pin, boot=boot)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(path.read_bytes(), raw)
                self.assertEqual(launcher.read_bytes(), binary)
        pending = self.n.root/'.jobs/guardian.next'
        pending.write_bytes(b'{')
        pending.chmod(0o600)
        self.assertNotEqual(self.run_recovery(journal['worker_id'], digest).returncode, 0)
        self.assertEqual(path.read_bytes(), raw)
        self.assertEqual(pending.read_bytes(), b'{')
        pending.unlink()

    def test_active_scope_lock_refuses_offline_takeover(self):
        p = self.n.root/'.jobs/guardian'
        raw = p.read_bytes()
        journal = json.loads(raw)
        result = self.run_recovery(journal['worker_id'], hashlib.sha256(raw).hexdigest())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'exclusive offline job ownership', result.stderr)
        self.assertEqual(p.read_bytes(), raw)
        self.assertTrue(self.n.op('status')['ok'])

    def test_missing_scope_state_is_never_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            result = self.run_recovery('a'*32, 'absent', scope=p)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(p.iterdir()), [])
            for boot in ['bad', self.boot+'\n']:
                self.assertEqual(self.run_recovery('a'*32, 'absent', scope=p, boot=boot).returncode, 64)
