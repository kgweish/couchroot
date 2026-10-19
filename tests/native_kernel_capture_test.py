"""Bounded kernel observation with synthetic record sockets; no kernel writes."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('COUCHROOT_PARITY_CONTAINER'), 'Linux fixture required')
class KernelCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.binary = root/'capture'
        source = root/'fixture.c'
        source.write_text(r'''
#include "common.h"
static int overrun, suspend_clock, boottime_calls;
static ssize_t fixture_read(int fd, void *bytes, size_t n) {
  if (overrun) { overrun=0; errno=EPIPE; return -1; }
  return read(fd, bytes, n);
}
static int fixture_clock(clockid_t clock, struct timespec *value) {
  int result=clock_gettime(clock,value);
  if (!result && clock==CLOCK_BOOTTIME && suspend_clock &&
      __sync_add_and_fetch(&boottime_calls,1)>1) value->tv_sec++;
  return result;
}
#define read fixture_read
#define clock_gettime fixture_clock
#include "bench-kernel.h"
#undef read
#undef clock_gettime
int main(int argc,char **argv) {
  if(argc!=5) return 64;
  libraries();
  overrun=!strcmp(argv[4],"overrun");
  suspend_clock=!strcmp(argv[4],"suspend");
  BenchKernel capture;
  kernel_begin_fd(&capture,atoi(argv[1]),argv[2],(size_t)atoi(argv[3]));
  puts("READY");fflush(stdout);
  char stop;
  if(read(STDIN_FILENO,&stop,1)!=1) return 65;
  return kernel_end(&capture)?0:1;
}
''')
        native = Path(__file__).resolve().parents[1]/'research/autonomous-root/native-worker'
        subprocess.run(['gcc', '-std=c99', '-O2', '-Wall', '-Wextra', '-Werror',
                        '-Wno-unused-function', '-I', str(native), str(source),
                        '-ldl', '-pthread', '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def capture(self, records, *, capacity=4096, mode='normal', eof=False, existing=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            if existing:
                (root/'foreign').write_bytes(b'preserve foreign bytes')
                (root/'kernel.raw').symlink_to(root/'foreign')
            left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            process = subprocess.Popen([self.binary, str(right.fileno()), tmp,
                                        str(capacity), mode], pass_fds=(right.fileno(),),
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE)
            right.close()
            try:
                if existing:
                    stdout, stderr = process.communicate(timeout=5)
                    self.assertNotEqual(process.returncode, 0, stderr)
                    self.assertEqual(stdout, b'')
                    self.assertTrue((root/'kernel.raw').is_symlink())
                    self.assertEqual((root/'foreign').read_bytes(), b'preserve foreign bytes')
                    self.assertFalse((root/'kernel.json').exists())
                    return
                self.assertEqual(process.stdout.readline(), b'READY\n')
                for record in records:
                    left.sendall(record)
                if eof:
                    left.shutdown(socket.SHUT_WR)
                _, stderr = process.communicate(b'1', timeout=5)
                report = json.loads((root/'kernel.json').read_text())
                raw = (root/'kernel.raw').read_bytes()
                self.assertEqual((root/'kernel.raw').stat().st_mode & 0o777, 0o600)
                self.assertEqual((root/'kernel.json').stat().st_mode & 0o777, 0o600)
                self.assertEqual(report['bytes'], len(raw))
                self.assertEqual(process.returncode == 0, report['complete'], stderr)
                self.assertGreaterEqual(report['monotonic_end_ms'], report['monotonic_start_ms'])
                return report, raw
            finally:
                left.close()
                if process.poll() is None:
                    process.kill()
                process.communicate()

    def test_contiguous_records_extensions_and_context_are_preserved(self):
        records = [b'6,40,100,-;first\n', b'6,41,200,c,extension;second\n KEY=value\n']
        report, raw = self.capture(records)
        self.assertTrue(report['complete'])
        self.assertEqual(raw, b''.join(records))
        self.assertEqual(report['records'], 2)
        self.assertEqual((report['first_sequence'], report['last_sequence']), ('40', '41'))

    def test_empty_window_is_distinct_from_a_capture_failure(self):
        report, raw = self.capture([])
        self.assertTrue(report['complete'])
        self.assertIsNone(report['first_sequence'])
        self.assertEqual(raw, b'')

    def test_gaps_and_reordering_are_incomplete_evidence(self):
        for sequence, field in [(b'42', 'known_sequence_gaps'), (b'40', 'reordered_records')]:
            with self.subTest(sequence=sequence):
                report, _ = self.capture([b'6,40,100,-;first\n', b'6,'+sequence+b',200,-;next\n'])
                self.assertFalse(report['complete'])
                self.assertEqual(report[field], 1)

    def test_malformed_record_and_overflow_are_not_silently_ignored(self):
        for record in [b'malformed\n', b'6,18446744073709551616,100,-;overflow\n']:
            with self.subTest(record=record):
                report, raw = self.capture([record])
                self.assertFalse(report['complete'])
                self.assertEqual(report['malformed_records'], 1)
                self.assertEqual(raw, record)

    def test_full_uint64_sequence_retains_exact_bits(self):
        report, _ = self.capture([b'6,18446744073709551615,100,-;last\n'])
        self.assertTrue(report['complete'])
        self.assertEqual(report['last_sequence'], '18446744073709551615')

    def test_capacity_limit_preserves_bounded_prefix_and_reports_gap(self):
        record = b'6,40,100,-;first\n'
        report, raw = self.capture([record, b'6,41,200,-;second\n'], capacity=len(record))
        self.assertFalse(report['complete'])
        self.assertTrue(report['capacity_exceeded'])
        self.assertEqual(raw, record)

    def test_overrun_and_stream_failure_are_explicit(self):
        report, _ = self.capture([b'6,40,100,-;first\n'], mode='overrun')
        self.assertFalse(report['complete'])
        self.assertEqual(report['overruns'], 1)
        report, _ = self.capture([], eof=True)
        self.assertFalse(report['complete'])
        self.assertNotEqual(report['read_error'], 0)

    def test_suspend_clock_gap_prevents_full_coverage_claim(self):
        report, _ = self.capture([], mode='suspend')
        self.assertFalse(report['complete'])
        self.assertTrue(report['suspend_detected'])

    def test_existing_output_symlink_is_refused_without_overwrite(self):
        self.capture([], existing=True)


if __name__ == '__main__':
    unittest.main()
