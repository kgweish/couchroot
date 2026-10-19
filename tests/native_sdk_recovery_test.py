"""Ordinary recovery executable against host-only vconf/clock shared libraries."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'research/autonomous-root/recovery/native'
FIXTURE = ROOT/'tests/native-sdk-recovery'


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('cc'), 'Linux C/loader fixtures')
class NativeSdkRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='native-sdk-recovery-')
        cls.out = Path(cls.temp.name)
        cls.binary = cls.out/'build/sdk-host-recovery'
        subprocess.run(['sh', str(SOURCE/'build.sh'), str(cls.out/'build')], check=True,
                       env={**os.environ, 'CC': 'cc', 'ARCH_FLAGS': ' '}, capture_output=True)
        for name, flags in [('vconf', []), ('missing', ['-DMISSING_SET'])]:
            folder = cls.out/name; folder.mkdir()
            subprocess.run(['cc', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC', *flags,
                            str(FIXTURE/'fake-vconf.c'), '-o', str(folder/'libvconf.so.0')], check=True)
        cls.clock = cls.out/'clock.so'
        subprocess.run(['cc', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC',
                        str(FIXTURE/'fake-clock.c'), '-o', str(cls.clock)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.log = self.out/'events'; self.log.unlink(missing_ok=True)
        self.state = self.out/'state'; self.state.write_text('127.0.0.1')
        self.env = {**os.environ, 'LD_LIBRARY_PATH': str(self.out/'vconf'),
                    'LD_PRELOAD': str(self.clock), 'FAKE_LOG': str(self.log),
                    'FAKE_STATE': str(self.state)}

    def run_recovery(self, args=None, **env):
        return subprocess.run([str(self.binary), *(args or ['set', '127.0.0.1', '192.0.2.10', '0'])],
                              env={**self.env, **env}, capture_output=True, text=True, timeout=5)

    def events(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_set_and_verified_readback(self):
        r = self.run_recovery()
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, 'Host readback verified\n', ''))
        self.assertEqual(self.state.read_text(), '192.0.2.10')
        self.assertEqual(self.events(), ['sleep 0 0', 'get db/sdk/develop/ip',
                                       'set db/sdk/develop/ip', 'get db/sdk/develop/ip'])

    def test_already_restored_never_writes(self):
        self.state.write_text('192.0.2.10')
        r = self.run_recovery()
        self.assertEqual((r.returncode, r.stdout), (0, 'Already restored\n'))
        self.assertEqual(self.events(), ['sleep 0 0', 'get db/sdk/develop/ip'])

    def test_drift_preserves_value(self):
        self.state.write_text('192.0.2.99')
        r = self.run_recovery()
        self.assertEqual((r.returncode, r.stderr), (1, 'Host drift; refusing overwrite\n'))
        self.assertEqual(self.state.read_text(), '192.0.2.99')
        self.assertNotIn('set db/sdk/develop/ip', self.events())

    def test_invalid_input_and_identity_have_no_library_calls(self):
        cases = [[], ['set'], ['bogus', '127.0.0.1', '192.0.2.10', '0'],
                 ['set', '127.0.0.1', '192.0.2.10', '0', 'extra']]
        for address in ['0.0.0.0', '127.1', '127.000.0.1', '::1', 'host', '192.0.2.256', ' 127.0.0.1']:
            for position in [1, 2]:
                args = ['set', '127.0.0.1', '192.0.2.10', '0']; args[position] = address; cases.append(args)
        for mode, values in [('set', ['1', '30', '-1', '+0', '00', ' 0', '']),
                             ('watch', ['0', '29', '601', '999999999999999999', '-30', '+30', '030'])]:
            cases.extend([mode, '127.0.0.1', '192.0.2.10', value] for value in values)
        for args in cases:
            with self.subTest(args=args):
                r = subprocess.run([str(self.binary), *args], env=self.env, capture_output=True)
                self.assertEqual(r.returncode, 2); self.assertEqual(self.events(), [])
        for flag in ['FAKE_NONROOT', 'FAKE_NONROOT_EUID']:
            self.assertEqual(self.run_recovery(**{flag: '1'}).returncode, 2)
            self.assertEqual(self.events(), [])

    def test_library_and_symbol_failure(self):
        for folder in ['absent', 'missing']:
            r = self.run_recovery(LD_LIBRARY_PATH=str(self.out/folder))
            self.assertEqual(r.returncode, 1); self.assertIn('vconf', r.stderr)
            self.assertEqual(self.events(), [])

    def test_read_set_and_readback_failures(self):
        for env, message, sets in [({'FAKE_GET_FAIL': '1'}, 'Host unavailable', 0),
                                  ({'FAKE_SET_FAIL': '1'}, 'Host change unconfirmed', 1),
                                  ({'FAKE_GET_FAIL': '2'}, 'Host change unconfirmed', 1),
                                  ({'FAKE_NO_CHANGE': '1'}, 'Host change unconfirmed', 1)]:
            with self.subTest(env=env):
                self.setUp(); r = self.run_recovery(**env)
                self.assertEqual((r.returncode, r.stderr), (1, message+'\n'))
                self.assertEqual(self.events().count('set db/sdk/develop/ip'), sets)

    def test_watch_bounds_and_interrupted_sleep(self):
        for delay in ['30', '600']:
            self.setUp(); r = self.run_recovery(['watch', '127.0.0.1', '192.0.2.10', delay])
            self.assertEqual(r.returncode, 0); self.assertEqual(self.events()[0], 'sleep '+delay+' 0')
        self.setUp(); r = self.run_recovery(['watch', '127.0.0.1', '192.0.2.10', '30'], FAKE_EINTR='1')
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.events()[:3], ['sleep 30 0', 'sleep 7 123', 'get db/sdk/develop/ip'])
        self.setUp(); r = self.run_recovery(FAKE_SLEEP_FAIL='1')
        self.assertEqual(r.returncode, 1); self.assertEqual(self.events(), ['sleep 0 0'])

    @unittest.skipUnless(os.getuid() == 0, 'Real-delay integration needs container root')
    def test_real_delay_and_late_drift(self):
        env = dict(self.env); env.pop('LD_PRELOAD')
        start = time.monotonic()
        with subprocess.Popen([str(self.binary), 'watch', '127.0.0.1', '192.0.2.10', '30'],
                              env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
            try:
                time.sleep(.2); self.assertIsNone(proc.poll()); self.assertEqual(self.events(), [])
                self.state.write_text('192.0.2.99')
                out, err = proc.communicate(timeout=35)
                self.assertGreaterEqual(time.monotonic()-start, 29.9)
                self.assertEqual((proc.returncode, out, err), (1, b'', b'Host drift; refusing overwrite\n'))
                self.assertEqual(self.state.read_text(), '192.0.2.99')
                self.assertEqual(self.events(), ['get db/sdk/develop/ip'])
            finally:
                if proc.poll() is None: proc.kill(); proc.wait()

    def test_platform_realtime_dependency_is_not_dropped(self):
        report = subprocess.check_output(['readelf', '-d', str(self.binary)], text=True)
        self.assertIn('Shared library: [librt.so.1]', report)
        fixture = subprocess.check_output(['readelf', '-Ws', str(self.out/'vconf/libvconf.so.0')], text=True)
        self.assertRegex(fixture, r'UND\s+shm_open(?:@|\s)')

    def test_build_refuses_existing_output(self):
        before = self.binary.read_bytes()
        r = subprocess.run(['sh', str(SOURCE/'build.sh'), str(self.out/'build')], capture_output=True)
        self.assertNotEqual(r.returncode, 0); self.assertEqual(self.binary.read_bytes(), before)
