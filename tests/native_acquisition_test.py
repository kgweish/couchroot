"""Native namespace state machine and real child-process boundaries, offline."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('cc'), 'Linux syscall/child fixtures')
class NativeAcquisitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.build.name)/'fixture'
        subprocess.run(['cc','-std=c99','-O2','-Wall','-Wextra','-Werror',
                        str(ROOT/'tests/native-root-acquisition/fixture.c'),'-o',str(cls.binary)],check=True)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.set_identity(901)
        (self.work/'mountinfo').write_text('1 0 0:1 / / rw - rootfs rootfs rw\n')
        (self.work/'passwd').write_text('root:x:0:0:root:/root:/bin/sh\nowner:x:5001:100:Owner:/home/owner/:/bin/sh\n')
        (self.work/'operation.sh').write_text('echo ran > marker\nexit 0\n')

    def set_identity(self, uid, caps='200040'):
        (self.work/'status').write_text('Name: fixture\nUid:\t'+('\t'.join([str(uid)]*4))+'\nGid:\t'+('\t'.join([str(100 if uid == 5001 else uid)]*4))+'\nCapEff:\t'+caps+'\n')

    def run_case(self, name='success', *args):
        return subprocess.run([str(self.binary),name,*args],cwd=self.work,capture_output=True,text=True,timeout=4)

    def events(self):
        p=self.work/'events'; return p.read_text().splitlines() if p.exists() else []

    def test_exact_owner_only_replacement(self):
        original=(self.work/'passwd').read_text()
        self.assertEqual(self.run_case('parse').stdout,original.replace(':5001:100:',':0:0:'))
        for invalid in ['root:x:0:0:r:/root:/bin/sh\n',original+original,original.replace('5001:100','5001:5001'),
                        original.replace('5001:100','0:0'),original.replace('Owner:', 'Owner:extra:'),original+'\x00']:
            (self.work/'passwd').write_text(invalid)
            self.assertEqual(self.run_case('parse').returncode,2)

    def test_private_namespace_order_and_cleanup(self):
        r=self.run_case(); self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(self.events(),['unshare','private','bind-key','baseline-launch','bind-passwd','root-launch','unmount-passwd','unmount-key'])
        self.assertIn('NATIVE_ACQUISITION verified',r.stdout)

    def test_refuse_missing_caps_or_wrong_identity_before_staging(self):
        for uid,caps in [(901,'0'),(0,'ffffffff'),(5001,'200040')]:
            self.set_identity(uid,caps)
            self.assertEqual(self.run_case().returncode,2)
            self.assertFalse((self.work/'passwd-view').exists()); self.assertEqual(self.events(),[])
        self.assertEqual(self.run_case('bad-mode').returncode,2)

    def test_dirty_or_symlinked_view_never_overwritten(self):
        p=self.work/'passwd-view'; p.write_text('preserve')
        self.assertNotEqual(self.run_case().returncode,0); self.assertEqual(p.read_text(),'preserve')
        p.unlink(); p.symlink_to(self.work/'absent')
        self.assertNotEqual(self.run_case().returncode,0); self.assertFalse((self.work/'absent').exists())
        self.assertEqual(self.events(),[])

    def test_shared_mounts_refuse_before_bind(self):
        (self.work/'mountinfo').write_text('1 0 0:1 / / rw shared:1 - rootfs rootfs rw\n')
        self.assertNotEqual(self.run_case().returncode,0)
        self.assertEqual(self.events(),['unshare','private'])

    def test_each_partial_mount_failure_unwinds_only_owned_binds(self):
        for case,events in [('unshare-fail',['unshare']),('private-fail',['unshare','private']),
                            ('key-bind-fail',['unshare','private','bind-key']),
                            ('passwd-bind-fail',['unshare','private','bind-key','baseline-launch','bind-passwd','unmount-key']),
                            ('unmount-fail',['unshare','private','bind-key','baseline-launch','bind-passwd','root-launch','unmount-passwd','unmount-key'])]:
            with self.subTest(case=case):
                for name in ['events','passwd-view']:(self.work/name).unlink(missing_ok=True)
                self.assertNotEqual(self.run_case(case).returncode,0); self.assertEqual(self.events(),events)

    def test_launcher_identity_or_exit_failure_cannot_reach_root_launch(self):
        for case in ['wrong-identity','embedded-identity','launcher-fail']:
            for name in ['events','passwd-view']:(self.work/name).unlink(missing_ok=True)
            self.assertNotEqual(self.run_case(case).returncode,0)
            self.assertEqual(self.events(),['unshare','private','bind-key','baseline-launch','unmount-key'])

    def test_baseline_never_executes_and_root_propagates_command_exit(self):
        self.set_identity(5001)
        self.assertEqual(self.run_case('identity').returncode,0); self.assertFalse((self.work/'marker').exists())
        self.set_identity(0); (self.work/'operation.sh').write_text('echo ran > marker\necho err >&2\nexit 7\n')
        r=self.run_case('identity'); self.assertEqual(r.returncode,7); self.assertTrue((self.work/'marker').exists())
        self.assertIn('err',r.stdout)
        self.set_identity(5002); self.assertEqual(self.run_case('identity').returncode,2)

    def test_child_exit_signal_overflow_and_bounded_descendants(self):
        for script,expected in [('printf hello; exit 7',7),('kill -TERM $$',-1),('yes x',-1),('sleep 3 & wait',-1),('sleep 3 & exit 0',-1)]:
            with self.subTest(script=script):
                started=time.monotonic(); r=self.run_case('child',script)
                self.assertIn('CHILD_RESULT '+str(expected),r.stdout)
                self.assertLess(time.monotonic()-started,2)

if __name__=='__main__':unittest.main()


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('cc'), 'Linux service syscall fixtures')
class ServiceAcquisitionTests(unittest.TestCase):
    setUp = NativeAcquisitionTests.setUp
    set_identity = NativeAcquisitionTests.set_identity
    run_case = NativeAcquisitionTests.run_case
    events = NativeAcquisitionTests.events

    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.build.name)/'fixture'
        subprocess.run(['cc','-std=c99','-O2','-Wall','-Wextra','-Werror','-DSERVICE_ACQUISITION',
                        str(ROOT/'tests/native-root-acquisition/fixture.c'),'-o',str(cls.binary)],check=True)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def stage(self):
        (self.work/'passwd-view').write_text((self.work/'passwd').read_text().replace(':5001:100:', ':0:0:'))

    def test_service_uses_verified_existing_view_and_two_identity_launches(self):
        self.stage()
        before=(self.work/'passwd-view').read_bytes()
        result=self.run_case()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((self.work/'passwd-view').read_bytes(),before)
        self.assertEqual(self.events(),['unshare','private','bind-key','baseline-launch','bind-passwd','root-launch','unmount-passwd','unmount-key'])

    def test_missing_changed_and_symlinked_views_fail_before_namespace(self):
        self.assertNotEqual(self.run_case().returncode,0)
        self.stage(); (self.work/'passwd-view').write_text('foreign')
        self.assertNotEqual(self.run_case().returncode,0)
        (self.work/'passwd-view').unlink(); (self.work/'passwd-view').symlink_to('passwd')
        self.assertNotEqual(self.run_case().returncode,0)
        self.assertEqual(self.events(),[])

    def test_invalid_unique_stage_names_rejected_before_reads(self):
        for value in ['', 'archive-root-0123456789abcdef/../x', 'archive-root-0123456789abcdeF', 'other-0123456789abcdef']:
            self.assertEqual(self.run_case('bad-package',value).returncode,2)
        self.assertEqual(self.events(),[])

    def test_baseline_failure_cannot_run_root_operation(self):
        self.stage(); result=self.run_case('wrong-identity')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('root-launch',self.events())
        self.assertEqual(self.events()[-1],'unmount-key')
