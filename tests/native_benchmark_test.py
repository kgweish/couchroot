"""Benchmark accounting/protocol fixtures in Linux; no TV or production changes."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest


@unittest.skipUnless(os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated Linux benchmark fixture required')
class BenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.binary = root / 'bench-fixture'
        source = root / 'fixture.c'
        source.write_text('''
#define main benchmark_main
#include "bench.c"
#undef main
int main(int argc, char **argv) {
  libraries();
  if (argc != 3) return 64;
  if (!strcmp(argv[1], "resources")) {
    puts(json(bench_resources(argv[2], 123)));
  } else {
    w.fd = atoi(argv[2]);
    puts(json(job_timing("root")));
  }
  return 0;
}
''')
        worker = Path(__file__).resolve().parents[1] / 'research/autonomous-root/native-worker'
        subprocess.run(['gcc', '-std=c99', '-O2', '-Wall', '-Wextra', '-Werror',
                        '-Wno-unused-function', '-I', str(worker), str(source),
                        '-ldl', '-pthread', '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def proc_fixture(self, path):
        pid = path / '123'
        (pid / 'fd').mkdir(parents=True)
        for fd in ('0', '7', '11'):
            (pid / 'fd' / fd).symlink_to('/unavailable-fixture-target')
        (pid / 'task/123').mkdir(parents=True)
        (pid / 'task/124').mkdir()
        (pid / 'status').write_text('Name:\tfixture\nVmHWM:\t456 kB\n')
        (pid / 'task/123/status').write_text(
            'voluntary_ctxt_switches:\t17\nnonvoluntary_ctxt_switches:\t4\n')
        (pid / 'task/124/status').write_text('Name:\toptional-fields-missing\n')
        # Long mount lines count once, rather than once per fgets buffer.
        (pid / 'mountinfo').write_text('x' * 5000 + '\nsecond mount\n')
        return pid

    def test_resources_count_long_mounts_all_threads_and_unknown_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.proc_fixture(Path(tmp))
            result = subprocess.run([self.binary, 'resources', tmp],
                                    capture_output=True, check=True, timeout=5)
            report = json.loads(result.stdout)
            self.assertEqual([report[k] for k in ('descriptors', 'threads', 'mounts')], [3, 2, 2])
            self.assertEqual(report['peak_rss_kib'], 456)
            self.assertEqual(report['tasks']['123']['voluntary_context_switches'], 17)
            self.assertEqual(report['tasks']['123']['involuntary_context_switches'], 4)
            self.assertIsNone(report['tasks']['124']['voluntary_context_switches'])
            self.assertIsNone(report['idle_wakeups'])

    def test_missing_peak_and_retired_thread_are_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            pid = self.proc_fixture(Path(tmp))
            (pid / 'status').write_text('Name:\tfixture\n')
            (pid / 'task/123/status').unlink()
            result = subprocess.run([self.binary, 'resources', tmp],
                                    capture_output=True, check=True, timeout=5)
            report = json.loads(result.stdout)
            self.assertIsNone(report['peak_rss_kib'])
            self.assertIsNone(report['tasks']['123']['involuntary_context_switches'])

    def test_missing_required_proc_tree_refuses_a_zero_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run([self.binary, 'resources', tmp], capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b'')

    def job_case(self, terminal=None, output='YmVuY2g=', delays=None):
        terminal = terminal if terminal is not None else dict(state='completed', exit_code=7)
        left, right = socket.socketpair()
        left.settimeout(5)
        process = subprocess.Popen([self.binary, 'jobs', str(right.fileno())],
                                   pass_fds=(right.fileno(),), stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE)
        right.close()
        operations = []
        secret = bytes(32)
        def mac(payload):
            return hmac.new(secret, secret + b'\0' + payload, hashlib.sha256).hexdigest().encode()
        try:
            with left.makefile('rb') as stream:
                while True:
                    line = stream.readline()
                    if not line:
                        break
                    payload, signature = line.rstrip(b'\n').rsplit(b'\t', 1)
                    self.assertEqual(signature, mac(payload))
                    _, sequence, encoded = payload.split(b'\t')
                    op = json.loads(base64.b64decode(encoded))
                    operations.append(op)
                    name = op['op']
                    self.assertLessEqual(len(operations), 6, 'unexpected submission/retry')
                    if name == 'job.status':
                        result = dict(state='running') if len(operations) == 2 else terminal
                    elif name == 'job.output':
                        result = dict(stdout=dict(data=output), stderr=dict(data=''))
                    else:
                        result = {}
                    time.sleep((delays or {}).get(name, 0))
                    response = b'OPRESULT\t' + sequence + b'\t' + base64.b64encode(
                        json.dumps(dict(ok=True, result=result)).encode())
                    left.sendall(response + b'\t' + mac(response) + b'\n')
            stdout, stderr = process.communicate(timeout=5)
            return process.returncode, stdout, stderr, operations
        finally:
            left.close()
            if process.poll() is None:
                process.kill()
            process.communicate()

    def test_job_measurement_preserves_one_submission_and_checks_output_before_forget(self):
        code, stdout, stderr, ops = self.job_case()
        self.assertEqual(code, 0, stderr)
        self.assertEqual([op['op'] for op in ops],
                         ['job.start', 'job.status', 'job.status', 'job.output', 'job.forget'])
        self.assertEqual(len({op['id'] for op in ops}), 1)
        report = json.loads(stdout)
        self.assertEqual(report['status_polls'], 2)
        self.assertGreaterEqual(report['observed_completion_ms'], report['admission_ms'])
        self.assertEqual(report['job_id'], ops[0]['id'])

    def test_output_and_forget_latency_are_measured_without_extending_completion(self):
        code, stdout, stderr, ops = self.job_case(delays={'job.output': .06, 'job.forget': .08})
        self.assertEqual(code, 0, stderr)
        report = json.loads(stdout)
        self.assertGreaterEqual(report['output_ms'], 60)
        self.assertGreaterEqual(report['forget_ms'], 80)
        self.assertGreaterEqual(report['through_forget_ms'],
                                report['observed_completion_ms'] + report['output_ms'] + report['forget_ms'])
        self.assertAlmostEqual(report['forgotten_monotonic_ms'] - report['forget_start_monotonic_ms'],
                               report['forget_ms'], places=5)
        self.assertAlmostEqual(report['completion_monotonic_ms'] - report['start_monotonic_ms'],
                               report['observed_completion_ms'], places=5)
        self.assertEqual(sum(op['op'] == 'job.forget' for op in ops), 1)

    def test_unverified_job_outcomes_never_forget_or_report_a_timing(self):
        cases = [dict(terminal=dict(state='completed', exit_code=None)),
                 dict(terminal=dict(state='interrupted', exit_code=7)),
                 dict(terminal=dict(state='completed', exit_code=7, persistence_failed=True)),
                 dict(output='d3Jvbmc=')]
        for case in cases:
            with self.subTest(case=case):
                code, stdout, _, ops = self.job_case(**case)
                self.assertNotEqual(code, 0)
                self.assertEqual(stdout, b'')
                self.assertEqual(sum(op['op'] == 'job.start' for op in ops), 1)
                self.assertNotIn('job.forget', [op['op'] for op in ops])


if __name__ == '__main__':
    unittest.main()
