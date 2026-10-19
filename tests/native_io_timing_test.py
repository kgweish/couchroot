"""Diagnostic interposer behavior; does not operate any TV."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('COUCHROOT_PARITY_CONTAINER'), 'Linux fixture required')
class SyncTimingTests(unittest.TestCase):
    def test_observes_only_job_scope_and_preserves_sync_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / 'timing.so'
            source = Path(__file__).parent / 'native-io/timing.c'
            subprocess.run(['gcc', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror',
                            str(source), '-ldl', '-o', str(library)], check=True)
            script = r'''
import errno,os,pathlib,sys
root=pathlib.Path(sys.argv[1]);(root/'.jobs').mkdir();(root/'.jobs-other').mkdir()
for path in (root/'.jobs/record.next',root/'other',root/'.jobs-other/record.next'):
 with path.open('wb') as f:
  f.write(b'exact fixture bytes');f.flush();os.fsync(f.fileno())
 assert path.read_bytes()==b'exact fixture bytes'
try:os.fsync(987654)
except OSError as error:assert error.errno==errno.EBADF
else:raise AssertionError('invalid fsync succeeded')
'''
            result = subprocess.run(['python3', '-c', script, tmp], capture_output=True,
                                    env={**os.environ, 'LD_PRELOAD': str(library)}, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            lines = result.stderr.decode().splitlines()
            self.assertEqual(len(lines), 1, lines)
            self.assertRegex(lines[0], r'^IO_TIMING pid=\d+ result=0 errno=\d+ ms=\d+\.\d{3} path=')
            self.assertTrue(lines[0].endswith('/.jobs/record.next'))
            self.assertGreaterEqual(float(re.search(r'ms=([\d.]+)', lines[0])[1]), 0)


if __name__ == '__main__':
    unittest.main()
