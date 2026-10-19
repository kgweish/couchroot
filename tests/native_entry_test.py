"""Wire fixtures and refusal tests for the fixed native SDK entry receipt."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from tvsetup import native_entry as entry
from tvsetup.common import Refused


class BundleTests(unittest.TestCase):
    def test_wire_records_match_explicit_little_endian_vectors(self):
        self.assertEqual(entry._record('k', ('v',)), bytes.fromhex(
            '14000000 01040000 02000000 6b00 02000000 7600'))
        self.assertEqual(entry._record('k', ('v', 'xy'), True), bytes.fromhex(
            '1f000000 01050000 02000000 6b00 02000000 02000000 7600 03000000 787900'))

    def test_fixed_bundle_has_exact_keys_checksum_and_one_library(self):
        for model, loader in entry.LOADERS.items():
            args = entry.loader_arguments(model, 'a' * 32)
            self.assertEqual(args[:1], [loader]); self.assertEqual(args[1], '100'); self.assertEqual(args[3], '0')
            self.assertEqual(len(args), 5)
            self.assertTrue(0 < int(args[2]) < 2147483647)
            # Both TVs' installed libbundle decoded and re-encoded this exact fixed
            # payload byte for byte. This vector contains no device identity.
            fixture = ('NDVjMmI1ZDZiODE0OWFiNmFiMTAxNjRkZWY4NjdmNTUqAAAAAQQAAAwAAABsb2FkZXJfdHlwZQAO'
                       'AAAAY29tbW9uLWxvYWRlcgBZAAAAAQUAAAgAAABwcmVsb2FkAAEAAAA9AAAAL29wdC91c3IvYXBw'
                       'cy9NaW5pUm9vdDAxL3Jlcy93Z3QvcGF5bG9hZC9saWJlbnRyeS1yZWNlaXB0LnNvAA==')
            self.assertEqual(args[4], fixture)
            raw = base64.b64decode(args[4], validate=True)
            self.assertEqual(raw[:32], hashlib.md5(raw[32:], usedforsecurity=False).hexdigest().encode())
            at = 32; result = {}
            def integer():
                nonlocal at
                value, = struct.unpack_from('<I', raw, at); at += 4
                return value
            def string():
                nonlocal at
                length = integer(); value = raw[at:at+length]; at += length
                self.assertEqual(value[-1:], b'\0'); self.assertNotIn(b'\0', value[:-1])
                return value[:-1].decode('ascii')
            while at < len(raw):
                start = at; size = integer(); tag = integer(); key = string()
                if tag == 0x501:
                    result[key] = [string() for _ in range(integer())]
                else:
                    self.assertEqual(tag, 0x401); result[key] = string()
                self.assertEqual(at, start + size)
            self.assertEqual(result, {'loader_type':'common-loader', 'preload':[entry.CODE_PATH]})

    def test_input_limits_and_model_nonce_refusal(self):
        for model, nonce in [('other','a'*32), ('qn90a',''), ('s90d','A'*32), ('s90d','a'*31+';'), ('qn90a',None)]:
            with self.assertRaises(Refused): entry.loader_arguments(model, nonce)
        for value in ('', 'x\0y', 'é', 'x'*1025, None):
            with self.assertRaises(Refused): entry._record('k', (value,))
        for values in ((), ('v',)*9, ['v'], ('a','b')):
            with self.assertRaises(Refused): entry._record('k', values)


class BuildTests(unittest.TestCase):
    def compiler(self, invalid=None):
        calls = []
        def command(args):
            calls.append(args)
            if 'inspect' in args: return 'unpinned' if invalid == 'image' else 'sha256:' + 'a'*64
            if '-dumpfullversion' in args: return '10.2.1'
            if 'arm-linux-gnueabi-readelf' in args:
                return '(NEEDED) Shared library: [libc.so.6]\nGLIBC_2.17\n'
            self.assertIn('--network', args); self.assertIn('none', args)
            self.assertIn('sha256:'+'a'*64, args)
            folder = Path(next(a[:-5] for a in args if a.endswith(':/out')))/'native'
            folder.mkdir()
            data = bytearray(52); data[:7] = b'\x7fELF\x01\x01\x01'
            struct.pack_into('<HH',data,16,3,40); struct.pack_into('<I',data,36,5 << 24)
            if invalid == 'different' and folder.parent.name == '2': data += b'drift'
            (folder/entry.ARTIFACT).write_bytes(data)
            return ''
        return command, calls

    def test_reproducible_outputs_pin_model_source_and_toolchain(self):
        for model in entry.LOADERS:
            with tempfile.TemporaryDirectory() as temp:
                command, calls = self.compiler()
                folder = Path(temp)/'bundle'
                manifest = entry.build({'id':model}, folder, command)
                self.assertEqual(manifest['reproducible_builds'],2)
                self.assertEqual(manifest['loader'],entry.LOADERS[model])
                self.assertEqual(manifest['code_path'],entry.CODE_PATH)
                self.assertEqual(set(manifest['source']),{'probe.c','receipt.h','build.sh'})
                self.assertEqual(set(manifest['artifacts']),{entry.ARTIFACT})
                self.assertEqual(len([c for c in calls if '/src/build.sh' in c]),2)
                self.assertTrue((folder/'artifacts'/entry.ARTIFACT).is_file())
                self.assertFalse(any('dotnet' in c for c in calls))

    def test_build_refuses_drift_unpinned_image_and_existing_output(self):
        for invalid in ('different','image'):
            with tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)/'bundle'; command, _ = self.compiler(invalid)
                with self.assertRaises(Refused): entry.build({'id':'qn90a'},folder,command)
                self.assertFalse((folder/'manifest.json').exists())
        with tempfile.TemporaryDirectory() as temp:
            command, calls = self.compiler()
            with self.assertRaises(Refused): entry.build({'id':'qn90a'},temp,command)
            self.assertEqual(calls,[])


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('gcc'), 'Linux C fixture required')
class ReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.folder = Path(cls.temp.name)
        harness = cls.folder/'fixture.c'
        harness.write_text(r'''
#include <stdio.h>
#include "receipt.h"
int main(void) {
 char text[16384]; size_t length = fread(text, 1, sizeof(text)-1, stdin);
 struct entry_status status; text[length] = 0;
 if (!entry_parse(text, &status)) return 65;
 printf("%d %d\n", entry_capable(&status), status.no_new_privs);
 return 0;
}
''')
        cls.exe = cls.folder/'fixture'
        subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror','-I',str(entry.SOURCE),str(harness),'-o',str(cls.exe)],check=True)
        cls.dso = cls.folder/entry.ARTIFACT
        # Test-only linker wrapper supplies a label even on Docker kernels with
        # no active LSM. Production source and ARM build contain no wrapper.
        io = cls.folder/'fixture-io.c'
        io.write_text(r'''
#include <string.h>
extern int __real_open(const char *, int, ...);
int __wrap_open(const char *path, int flags, ...) {
 return __real_open(!strcmp(path,"/proc/self/attr/current") ? "/proc/sys/kernel/hostname" : path, flags);
}
''')
        subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror','-fPIC','-shared',
                        '-DENTRY_LOADER="/usr/bin/launchpad-loader"',str(entry.SOURCE/'probe.c'),str(io),'-Wl,--wrap=open','-o',str(cls.dso)],check=True)

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def status(self, **changes):
        fields = dict(Uid='901\t901\t901\t901', Gid='901\t901\t901\t901',
                      CapInh='0000000000200040', CapPrm='0000000000200040',
                      CapEff='0000000000200040', CapBnd='000001ffffffffff')
        fields.update(changes)
        return ''.join(k+':\t'+v+'\n' for k,v in fields.items() if v is not None)

    def parse(self, text):
        return subprocess.run([str(self.exe)], input=text, text=True, capture_output=True)

    def test_missing_optional_nnp_is_unknown(self):
        result = self.parse(self.status())
        self.assertEqual((result.returncode,result.stdout), (0,'1 -1\n'))
        self.assertEqual(self.parse(self.status(NoNewPrivs='0')).stdout, '1 0\n')
        self.assertEqual(self.parse(self.status(NoNewPrivs='1')).stdout, '1 1\n')

    def test_all_credential_slots_and_required_cap_sets(self):
        for key in ('Uid','Gid'):
            for index in range(4):
                values = ['901']*4; values[index] = '0'
                self.assertEqual(self.parse(self.status(**{key:' '.join(values)})).stdout, '0 -1\n')
        for key in ('CapInh','CapPrm','CapEff'):
            for value in ('0000000000000040','0000000000200000'):
                self.assertEqual(self.parse(self.status(**{key:value})).stdout, '0 -1\n')

    def test_malformed_partial_duplicate_status_refuses(self):
        bad = [self.status(Uid=x) for x in ('901 901 901','901 901 901 901 901','-1 901 901 901','4294967296 901 901 901','18446744073709551616000000000000901 901 901 901')]
        bad += [self.status(CapEff=x) for x in ('20','000000000020004z','0000000000200040junk')]
        bad += [self.status(CapInh=None), self.status(NoNewPrivs='2'), self.status()+'Uid:\t901 901 901 901\n', self.status()[:-1]]
        for text in bad: self.assertEqual(self.parse(text).returncode, 65)

    def test_constructor_rejects_nonce_before_returning_to_caller(self):
        code = 'import ctypes; ctypes.CDLL('+repr(str(self.dso))+'); raise SystemExit(99)'
        for nonce in (None, '', 'a'*31, 'A'*32, 'a'*33):
            env = dict(os.environ); env.pop('COUCHROOT_ENTRY_NONCE', None)
            if nonce is not None: env['COUCHROOT_ENTRY_NONCE'] = nonce
            result = subprocess.run([sys.executable,'-c',code],env=env,capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,64); self.assertEqual(result.stdout,'')

    def test_constructor_never_returns_on_non_vendor_host(self):
        env = dict(os.environ, COUCHROOT_ENTRY_NONCE='b'*32)
        code = 'import ctypes; ctypes.CDLL('+repr(str(self.dso))+'); raise SystemExit(99)'
        result = subprocess.run([sys.executable,'-c',code],env=env,capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,2, result.stderr)
        receipt = json.loads(result.stdout.removeprefix('COUCHROOT_ENTRY_RECEIPT '))
        self.assertEqual(receipt['nonce'],'b'*32); self.assertFalse(receipt['capable'])
        self.assertEqual(bytes.fromhex(receipt['label_hex']),Path('/proc/sys/kernel/hostname').read_bytes())
        self.assertEqual(receipt['uid'],[os.getuid()]*4)
        self.assertLess(len(result.stdout),2048)
