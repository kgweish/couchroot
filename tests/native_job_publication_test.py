"""Initial publication owns a gated child; Linux fault fixture only."""
import base64
import json
import os
from pathlib import Path
import re
import unittest

import native_worker_test


@unittest.skipUnless(os.environ.get('NATIVE_WORKER_FAULT_TEST') and
                     os.environ.get('COUCHROOT_PARITY_CONTAINER'), 'Linux fault worker required')
class JobPublicationTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()

    def tearDown(self):
        self.n.tearDown()

    def test_existing_publication_names_refuse_before_fork(self):
        n = self.n
        n.seq += 1
        n.send(f'SHUTDOWN\t{n.seq}')
        n.receive()
        n.proc.wait(timeout=5)
        # Any attempted fork terminates this fixture, so a refusal response
        # proves the preflight excluded even a transient gated child.
        n.restart({'COUCHROOT_NATIVE_JOB_INTENT_FAULT': 'forked'})
        owner = n.op('status')['result']['worker_id']
        identifier = 'native-existing-publication'
        names = [(f'{identifier}.json', 'file'),
                 (f'{identifier}.json', 'symlink'),
                 (f'{identifier}.json', 'directory'),
                 (f'{identifier}.json.next', 'file'),
                 (f'.intent-{owner}-{identifier}', 'file')]
        for name, kind in names:
            with self.subTest(name=name, kind=kind):
                target = n.root/'.jobs'/name
                if kind == 'symlink':
                    target.symlink_to(n.root/'absent')
                elif kind == 'directory':
                    target.mkdir(mode=0o700)
                else:
                    target.write_bytes(b'{foreign')
                    target.chmod(0o600)
                try:
                    response = n.job('job.start', identifier, command='true',
                                     timeout_ms=1000, profile='root')
                    self.assertFalse(response['ok'])
                    self.assertIn('not launched', response['error'])
                    self.assertIsNone(n.proc.poll())
                    if kind == 'file':
                        self.assertEqual(target.read_bytes(), b'{foreign')
                    elif kind == 'symlink':
                        self.assertEqual(target.readlink(), n.root/'absent')
                    else:
                        self.assertEqual(list(target.iterdir()), [])
                finally:
                    target.rmdir() if kind == 'directory' else target.unlink()

    def test_worker_loss_before_publication_retires_gated_child_without_execution(self):
        n = self.n
        n.seq += 1
        n.send(f'SHUTDOWN\t{n.seq}')
        n.receive()
        n.proc.wait(timeout=5)
        n.restart({'COUCHROOT_NATIVE_JOB_INTENT_FAULT': 'forked'})
        witness = n.root/'witness'
        identifier = 'native-unpublished-child'
        request = dict(op='job.start', id=identifier, command='printf x >> '+str(witness),
                       timeout_ms=1000, profile='root')
        n.seq += 1
        n.send(f'OP\t{n.seq}\t'+base64.b64encode(json.dumps(request).encode()).decode())
        _, stderr = n.proc.communicate(timeout=5)
        self.assertEqual(n.proc.returncode, 86, stderr)
        pid = int(re.search(rb'gated job child (\d+)', stderr)[1])
        self.assertFalse(Path(f'/proc/{pid}').exists())
        self.assertFalse(witness.exists())
        self.assertFalse((n.root/'.jobs'/f'{identifier}.json').exists())
        n.restart()
        self.assertFalse(n.job('job.status', identifier)['ok'])
        n.start_job('printf x >> '+str(witness)+'; exit 7', id=identifier)
        self.assertEqual(n.completed(identifier)['exit_code'], 7)
        self.assertEqual(witness.read_bytes(), b'x')


if __name__ == '__main__':
    unittest.main()
