"""Durable launch-token binding before native readiness; disposable Linux only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class NativeStartupBindingTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()

    def tearDown(self):
        self.n.tearDown()

    def stop(self):
        self.n.seq += 1
        self.n.send(f'SHUTDOWN\t{self.n.seq}')
        self.n.receive()
        self.n.proc.wait(timeout=5)

    def token(self):
        value = base64.b64encode(os.urandom(32))
        self.n.token.write_bytes(value)
        self.n.token.chmod(0o600)
        return hashlib.sha256(value).hexdigest()

    def fault(self, stage):
        return subprocess.run(self.n.worker_args, capture_output=True, timeout=5,
                              env={**os.environ, 'COUCHROOT_NATIVE_STARTUP_FAULT': stage})

    def test_ready_status_and_journal_bind_exact_token_without_recording_secret(self):
        info = self.n.op('status')['result']
        raw = (self.n.root/'.jobs/guardian').read_bytes()
        journal = json.loads(raw)
        expected = hashlib.sha256(base64.b64encode(self.n.secret)).hexdigest()
        self.assertEqual(info['startup_token_sha256'], expected)
        self.assertEqual(journal['startup_token_sha256'], expected)
        self.assertIn('startup-token-binding-v1', info['capabilities'])
        self.assertNotIn(base64.b64encode(self.n.secret), raw)
        self.assertNotIn(self.n.secret.hex().encode(), raw)
        self.assertFalse(self.n.token.exists())

    @unittest.skipUnless(os.environ.get('NATIVE_WORKER_FAULT_TEST'), 'fault build required')
    def test_pre_readiness_checkpoints_keep_attempt_binding_across_recovery(self):
        for stage in ['initial-synced', 'namespace', 'runtime-reserved',
                      'journal-runtime', 'partial-runtime', 'ready']:
            with self.subTest(stage=stage):
                self.stop()
                expected = self.token()
                result = self.fault(stage)
                self.assertEqual(result.returncode, 86, result.stderr)
                complete = 0
                for name in ['guardian.initial', 'guardian', 'guardian.next']:
                    path = self.n.root/'.jobs'/name
                    if not path.exists():
                        continue
                    try:
                        journal = json.loads(path.read_bytes())
                    except json.JSONDecodeError:
                        continue  # Partial bytes are not identity evidence.
                    complete += 1
                    self.assertEqual(journal['startup_token_sha256'], expected)
                self.assertGreater(complete, 0)
                self.n.restart()
                info = self.n.op('status')['result']
                self.assertTrue(info['stale_guardian_reconciled'])
                self.assertNotEqual(info['startup_token_sha256'], expected)
                self.assertEqual(info['startup_token_sha256'], hashlib.sha256(base64.b64encode(self.n.secret)).hexdigest())

    @unittest.skipUnless(os.environ.get('NATIVE_WORKER_FAULT_TEST'), 'fault build required')
    def test_successor_cannot_change_remove_or_malform_attempt_binding(self):
        self.stop()
        self.token()
        result = self.fault('journal-runtime')
        self.assertEqual(result.returncode, 86, result.stderr)
        path = self.n.root/'.jobs/guardian.next'
        original = path.read_bytes()
        base = (self.n.root/'.jobs/guardian').read_bytes()
        for value in [None, 'f'*64, 42, 'bad']:
            with self.subTest(value=value):
                altered = json.loads(original)
                if value is None:
                    del altered['startup_token_sha256']
                else:
                    altered['startup_token_sha256'] = value
                raw = json.dumps(altered).encode()
                path.write_bytes(raw)
                denied = subprocess.run(self.n.worker_args, capture_output=True, timeout=5)
                self.assertNotEqual(denied.returncode, 0)
                self.assertIn(b'unresolved guardian journal temporary ownership', denied.stderr)
                self.assertEqual(path.read_bytes(), raw)
                self.assertEqual((self.n.root/'.jobs/guardian').read_bytes(), base)
        path.write_bytes(original)
        self.n.restart()
        self.assertTrue(self.n.op('status')['result']['stale_guardian_reconciled'])

    def test_unbound_legacy_journal_remains_recoverable(self):
        _, journal = self.n.guardian_loss()
        del journal['startup_token_sha256']
        (self.n.root/'.jobs/guardian').write_text(json.dumps(journal))
        self.n.restart()
        self.assertTrue(self.n.op('status')['result']['stale_guardian_reconciled'])
        self.assertEqual(self.n.job('job.status')['result']['record']['state'], 'interrupted')

    def test_unsafe_token_refused_before_new_runtime_or_checkpoint(self):
        self.stop()
        for mode in ['missing', 'public', 'linked', 'symlink', 'large']:
            with self.subTest(mode=mode):
                self.token()
                if mode == 'missing':
                    self.n.token.unlink()
                elif mode == 'public':
                    self.n.token.chmod(0o644)
                elif mode == 'linked':
                    os.link(self.n.token, self.n.root/'token-alias')
                elif mode == 'symlink':
                    self.n.token.rename(self.n.root/'token-alias')
                    self.n.token.symlink_to(self.n.root/'token-alias')
                elif mode == 'large':
                    self.n.token.write_bytes(b'x'*65)
                denied = subprocess.run(self.n.worker_args, capture_output=True, timeout=5)
                self.assertNotEqual(denied.returncode, 0)
                self.assertIn(b'private startup token binding required', denied.stderr)
                self.assertFalse((self.n.root/'.jobs/guardian').exists())
                self.assertFalse((self.n.root/'.jobs/guardian.initial').exists())
                self.assertFalse((self.n.root/'.views').exists())
                self.n.token.unlink(missing_ok=True)
                (self.n.root/'token-alias').unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
