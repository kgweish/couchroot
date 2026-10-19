"""Offline native-only component publication and failure boundaries."""
import json
from pathlib import Path
import struct
import tempfile
import unittest

from tvsetup import native_components as components
from tvsetup import native_root
from tvsetup.config import profile
from tvsetup.common import Refused, sha


def elf():
    data = bytearray(64); data[:7] = b'\x7fELF\x01\x01\x01'
    struct.pack_into('<HH', data, 16, 3, 40)
    struct.pack_into('<I', data, 36, 0x05000200)
    return bytes(data)


class Compiler:
    def __init__(self, failure=None):
        self.calls = []; self.failure = failure; self.component_builds = 0

    def __call__(self, args):
        self.calls.append(args)
        if args[0] != 'docker':
            raise AssertionError('Non-container build dependency: '+args[0])
        if 'inspect' in args:
            return 'mutable-tag' if self.failure == 'image' else 'sha256:'+'a'*64
        assert '--network' in args and args[args.index('--network')+1] == 'none'
        if '-dumpfullversion' in args:
            return 'unknown' if self.failure == 'compiler' else '10.2.1'
        if 'arm-linux-gnueabi-readelf' in args:
            library = args[-1].endswith('.so')
            report = '' if library else '[Requesting program interpreter: /lib/ld-linux.so.3]\n'
            report += '(NEEDED) Shared library: [libc.so.6]\nGLIBC_2.17\n'
            if args[-1].endswith('sdk-host-recovery') and self.failure != 'librt':
                report += '(NEEDED) Shared library: [librt.so.1]\n'
            if self.failure == 'dependency': report += '(NEEDED) Shared library: [foreign.so]\n'
            return report
        output = Path(next(a[:-5] for a in args if a.endswith(':/out')))
        if '/src/native-worker/build.sh' in args:
            for name in ('worker', 'app-launcher'): (output/name).write_bytes(elf())
        elif '/src/native-observer/build.sh' in args:
            (output/'process-observer').write_bytes(elf())
        else:
            self.component_builds += 1
            source = Path(next(a[:-8] for a in args if a.endswith(':/src:ro')))
            self.assert_no_managed(source)
            name = 'sdk-host-recovery' if (source/'recovery.c').exists() else 'libacquire.so'
            output = output/'native'; output.mkdir()
            data = elf()
            if self.failure == 'different' and self.component_builds == 2: data += b'drift'
            (output/name).write_bytes(data)
            if self.failure == 'extra': (output/'extra').write_bytes(b'foreign')
            if self.failure == 'symlink':
                (output/name).unlink(); (output/name).symlink_to(source/'build.sh')
        return ''

    @staticmethod
    def assert_no_managed(source):
        assert {p.suffix for p in source.iterdir()} <= {'.c', '.sh'}


class NativeComponentsTests(unittest.TestCase):
    def test_full_bundle_has_no_managed_build_or_deployable_claim(self):
        for model in ('qn90a', 's90d'):
            with self.subTest(model=model), tempfile.TemporaryDirectory() as temp:
                output = Path(temp)/'bundle'; compiler = Compiler()
                result = components.build(model, output, compiler)
                self.assertFalse(result['managed_build_required'])
                self.assertFalse(result['deployable_agent'])
                self.assertTrue(result['managed_fallback_required'])
                self.assertEqual(result['capability_entry'], 'unresolved')
                self.assertEqual(len(result['artifacts']), 6)
                self.assertEqual(compiler.component_builds, 6)
                for name, record in result['artifacts'].items():
                    self.assertEqual(sha((output/'artifacts'/name).read_bytes()), record['sha256'])
                    self.assertNotIn('.dll', name)
                self.assertEqual(json.loads((output/'manifest.json').read_text()), result)
                stage = Path(temp)/'stage'; stage.mkdir()
                with self.assertRaisesRegex(Refused, 'mismatch'):
                    native_root.prepare(profile(model), output, stage, 'true')
                self.assertEqual(list(stage.iterdir()), [])

    def test_component_refusals_never_publish_success_manifest(self):
        for failure in ('image', 'compiler', 'librt', 'dependency', 'different', 'extra', 'symlink'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                output = Path(temp)/'component'
                with self.assertRaises(Refused):
                    components.build_component('s90d', 'sdk-recovery', output, Compiler(failure))
                self.assertFalse((output/'manifest.json').exists())

    def test_existing_and_dangling_output_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/'occupied'; output.mkdir(); (output/'keep').write_text('keep')
            dangling = Path(temp)/'dangling'; dangling.symlink_to(Path(temp)/'absent')
            compiler = Compiler()
            for path in (output, dangling):
                with self.assertRaises(Refused): components.build('qn90a', path, compiler)
            self.assertEqual(compiler.calls, [])
            self.assertEqual((output/'keep').read_text(), 'keep')
            self.assertFalse((Path(temp)/'absent').exists())

    def test_bad_profile_or_component_refused_before_build(self):
        with tempfile.TemporaryDirectory() as temp:
            compiler = Compiler(); output = Path(temp)/'bundle'
            with self.assertRaises(Refused): components.build('../qn90a', output, compiler)
            with self.assertRaises(Refused): components.build_component('qn90a', 'entry', output, compiler)
            self.assertFalse(output.exists()); self.assertEqual(compiler.calls, [])
