"""Offline recovery tests: real generated shell in a temporary filesystem.

Only ownership/SMACK and GNU utility spelling are simulated on the host. No
Transport instance, SDK, root worker, TV, or network is used.
"""
import contextlib
import copy
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tvsetup import s90d_recovery as recovery
from tvsetup.common import Refused, atomic_json, read_json, sha
from tvsetup.config import profile
from tvsetup.engine import Engine, pending


class ShellTV:
    def __init__(self, root):
        self.root = root
        self.commands = []
        self.lose_reply = False
        self.fail_reload = False
        self.fail_backup = False
        self.bin = root/'bin'; self.bin.mkdir()
        utility = self.bin/'utility'
        utility.write_text('#!'+sys.executable+'\n'+'''import hashlib, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
if name == 'cp':
    shutil.copy2(args[-2], args[-1])
elif name == 'sha256sum':
    print(hashlib.sha256(pathlib.Path(args[0]).read_bytes()).hexdigest()+'  '+args[0])
elif name == 'stat':
    p = pathlib.Path(args[-1]); s = p.stat()
    print('0:0:'+format(s.st_mode & 0o7777, 'o')+':'+str(s.st_nlink))
elif name == 'chsmack':
    print(args[0]+' access="User"')
elif name == 'systemctl':
    assert args == ['daemon-reload']
    with open(os.environ['RELOAD_LOG'], 'a') as f: f.write('reload\\n')
    sys.exit(int(os.environ.get('FAIL_RELOAD', '0')))
''')
        utility.chmod(0o755)
        for name in ('cp','sha256sum','stat','chsmack','systemctl'):
            (self.bin/name).symlink_to(utility)

    def path(self, remote):
        return self.root/'fs'/remote.lstrip('/')

    def root_call(self, script, namespace=False):
        self.commands.append(script)
        if self.fail_backup and 'cp --preserve=all' in script and '/original' in script:
            raise Refused('backup interrupted')
        # The script has only allowlisted TV absolute paths. Redirect all of
        # those, including symlink/parent guards, into our disposable root.
        for prefix in ('/opt', '/usr'):
            script = script.replace(prefix, str(self.path(prefix)))
        result = subprocess.run(['sh','-eu','-c',script], capture_output=True, text=True,
                                env=dict(os.environ, PATH=str(self.bin)+os.pathsep+os.environ['PATH'],
                                         RELOAD_LOG=str(self.root/'reload.log'),
                                         FAIL_RELOAD='1' if self.fail_reload else '0'))
        if result.returncode:raise Refused('sandbox shell refused: '+result.stderr)
        if self.lose_reply and '\nmv ' in script:
            self.lose_reply = False
            raise Refused('reply lost after atomic restore')
        return result.stdout


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.tv = ShellTV(self.root)
        # Transport-compatible facade; ShellTV.root stores its local root path.
        self.transport = type('TransportFake', (), {'root': self.tv.root_call})()
        for path in recovery.PATHS:
            if path in recovery.MARKERS[2:]:continue
            p = self.tv.path(path); p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(('fixture:'+path).encode()); p.chmod(0o600)
        self.folder = self.root/'state/runs/offline-test'
        self.driver = recovery.RecoveryDriver(self.transport, profile('s90d'), self.folder)
        self.state = self.driver.snapshot()
        self.pins = patch.object(recovery, 'PINS', {p:self.state['files'][p] for p in recovery.PINS})
        self.pins.start(); self.addCleanup(self.pins.stop)
        self.helpers = patch.object(recovery, 'HELPERS', {self.state['files'][recovery.HELPER]})
        self.helpers.start(); self.addCleanup(self.helpers.stop)
        self.engine = Engine(self.driver, self.folder, 's90d', {}, target_binding='fixture', scope=recovery.SCOPE)

    def arm(self, kind='helper'):
        plan = recovery.proposal(self.state, kind, sha(b'trial'))
        self.driver.baseline, self.driver.action = self.state, plan.actions[0]
        recovery.arm(self.engine, self.state, plan)
        return plan.actions[0]

    def test_checkpoint_and_helper_restore_preserve_all_other_bytes_and_markers(self):
        action = self.arm()
        self.assertEqual(self.driver.snapshot(), self.state)
        self.assertTrue(self.engine.doc['checkpoint_ready'])
        recovery.load_checkpoint(self.folder, 'fixture')
        self.tv.path(action.options['path']).write_bytes(b'trial')
        self.engine.rollback()
        self.assertEqual(self.driver.snapshot(), self.state)
        self.assertEqual(self.engine.doc['phase'], 'rolled-back')
        self.assertFalse((self.root/'reload.log').exists())

    def test_cache_restores_exact_prior_patch_not_stock(self):
        action = self.arm('cache')
        self.tv.path(recovery.CACHE).write_bytes(b'trial')
        self.engine.rollback()
        self.assertEqual(self.driver.snapshot(), self.state)
        self.assertEqual((self.root/'reload.log').read_text(), 'reload\n')
        self.assertNotEqual(action.before, recovery.CACHE_STOCK)

    def test_no_trial_and_repeat_rollback_are_idempotent(self):
        self.arm()
        self.engine.rollback(); self.engine.rollback()
        self.assertEqual(self.driver.snapshot(), self.state)

    def test_lost_restore_reply_is_reconciled_without_recopy(self):
        action = self.arm()
        self.tv.path(action.options['path']).write_bytes(b'trial')
        self.tv.lose_reply = True
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertEqual(self.engine.doc['phase'], 'rollback-partial')
        count = sum('\nmv ' in c for c in self.tv.commands)
        self.engine.rollback()
        self.assertEqual(count, sum('\nmv ' in c for c in self.tv.commands))
        self.assertEqual(self.driver.snapshot(), self.state)

    def test_failed_reload_retries_after_bytes_already_restored(self):
        self.arm('cache'); self.tv.path(recovery.CACHE).write_bytes(b'trial')
        self.tv.fail_reload = True
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertEqual(self.driver.snapshot(), self.state)
        self.tv.fail_reload = False; self.engine.rollback()
        self.assertEqual((self.root/'reload.log').read_text(), 'reload\nreload\n')

    def test_drift_anywhere_refuses_before_restore(self):
        for path in (recovery.HELPER, recovery.CACHE, recovery.CACHE+'.table', *recovery.MARKERS[:2]):
            with self.subTest(path=path):
                original = self.tv.path(path).read_bytes()
                self.driver.baseline = None
                plan = recovery.proposal(self.state, 'helper', sha(b'trial'))
                self.driver.baseline, self.driver.action = self.state, plan.actions[0]
                self.tv.path(path).write_bytes(b'drift')
                with self.assertRaises(Refused):self.driver.snapshot()
                self.tv.path(path).write_bytes(original)

    def test_absent_legacy_marker_must_stay_absent(self):
        self.arm()
        p = self.tv.path(recovery.MARKERS[2]); p.parent.mkdir(parents=True, exist_ok=True); p.touch()
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertTrue(p.exists())

    def test_corrupt_backup_refuses_without_touching_trial(self):
        self.arm(); self.tv.path(recovery.HELPER).write_bytes(b'trial')
        backup = self.engine.doc['actions'][0]['info']['backup']
        self.tv.path(backup).write_bytes(b'corrupt')
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertEqual(self.tv.path(recovery.HELPER).read_bytes(), b'trial')

    def test_missing_backup_refuses_without_touching_trial(self):
        self.arm(); self.tv.path(recovery.HELPER).write_bytes(b'trial')
        self.tv.path(self.engine.doc['actions'][0]['info']['backup']).unlink()
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertEqual(self.tv.path(recovery.HELPER).read_bytes(), b'trial')

    def test_metadata_drift_refuses(self):
        self.arm(); self.tv.path(recovery.HELPER).chmod(0o644)
        with self.assertRaises(Refused):self.engine.rollback()

    def test_symlink_and_hardlink_refuse(self):
        p = self.tv.path(recovery.HELPER); other = p.with_name('other')
        p.rename(other); p.symlink_to(other)
        with self.assertRaises(Refused):self.driver.snapshot()
        p.unlink(); os.link(other, p)
        with self.assertRaises(Refused):self.driver.snapshot()

    def test_parent_symlink_refuses(self):
        p = self.tv.path(recovery.SAVER); other = p.with_name('alias-target')
        p.rename(other); p.symlink_to(other, target_is_directory=True)
        with self.assertRaises(Refused):self.driver.snapshot()

    def test_interrupted_restore_stage_reused_only_if_exact(self):
        action = self.arm(); self.tv.path(recovery.HELPER).write_bytes(b'trial')
        stage = self.tv.path(recovery.HELPER+'.tv-setup-'+self.folder.name+'-'+action.id+'.restore')
        stage.write_bytes(b'unknown')
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertEqual(stage.read_bytes(), b'unknown')
        stage.write_bytes(('fixture:'+recovery.HELPER).encode())
        self.engine.rollback(); self.assertFalse(stage.exists())

    def test_checkpoint_failure_never_admits_trial_or_strands_pending_run(self):
        self.tv.fail_backup = True
        with self.assertRaises(Refused):self.arm()
        self.assertFalse(self.engine.doc.get('checkpoint_ready'))
        self.assertEqual(pending(self.root/'state', 's90d'), [])
        with self.assertRaises(Refused):recovery.load_checkpoint(self.folder, 'fixture')

    def test_checkpoint_binding_and_action_tampering_refused(self):
        self.arm()
        with self.assertRaises(Refused):recovery.load_checkpoint(self.folder, 'other-tv')
        doc = read_json(self.folder/'journal.json')
        doc['actions'][0]['info']['backup'] = '/opt/unrelated'
        atomic_json(self.folder/'journal.json', doc)
        with self.assertRaises(Refused):recovery.load_checkpoint(self.folder, 'fixture')

    def test_cancel_interrupted_checkpoint_is_offline_and_refuses_armed_run(self):
        self.arm()
        with patch.object(recovery, 'STATE', self.root/'state'), patch.object(recovery, 'Transport', side_effect=AssertionError('network')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(recovery.main(['cancel-incomplete','--run',self.folder.name,'--yes']), 1)
            doc = read_json(self.folder/'journal.json')
            del doc['checkpoint_ready']; doc['phase'] = 'prepared'
            doc['actions'][0]['phase'] = 'backing-up'
            atomic_json(self.folder/'journal.json', doc)
            self.assertEqual(recovery.main(['cancel-incomplete','--run',self.folder.name,'--yes']), 0)
            self.assertEqual(pending(self.root/'state', 's90d'), [])

    def test_offline_plan_and_status_never_create_transport_or_load_site(self):
        snap = self.root/'snapshot.json'; atomic_json(snap, self.state)
        with patch.object(recovery, 'Transport', side_effect=AssertionError('network')), patch.object(recovery, 'load_site', side_effect=AssertionError('private site')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(recovery.main(['plan','--snapshot',str(snap),'--kind','helper','--trial-sha256',sha(b'trial')]), 0)
            self.arm()
            with patch.object(recovery, 'STATE', self.root/'state'):
                self.assertEqual(recovery.main(['status','--run',self.folder.name]), 0)
            self.assertEqual(recovery.main(['checkpoint','--site','missing','--kind','helper','--trial-sha256',sha(b'trial')]), 1)
            self.assertEqual(recovery.main(['rollback','--site','missing','--run','test','--live']), 1)

    def test_bad_firmware_helper_cache_or_incomplete_snapshot_refused(self):
        for field in ('firmware', 'helper', 'cache', 'missing'):
            state = copy.deepcopy(self.state)
            if field == 'firmware':state['firmware'] = 'new-firmware'
            elif field == 'missing':del state['files'][recovery.MARKERS[2]]
            else:state['files'][recovery.HELPER if field == 'helper' else recovery.CACHE] = sha(b'unknown')
            with self.assertRaises(Refused):recovery.proposal(state, 'helper', sha(b'trial'))

    def test_cli_checkpoint_pending_guard_restore_and_verify(self):
        with patch.object(recovery, 'STATE', self.root/'state'), patch.object(recovery, 'run_id', return_value=self.folder.name), patch.object(recovery, 'load_site', return_value={}), patch.object(recovery, 'binding', return_value='fixture'), patch.object(recovery, 'configured_profile', return_value=profile('s90d')), patch.object(recovery, 'Transport', return_value=self.transport) as connect, contextlib.redirect_stdout(io.StringIO()):
            checkpoint = ['checkpoint','--site','fixture','--live','--yes','--kind','helper','--trial-sha256',sha(b'trial')]
            self.assertEqual(recovery.main(checkpoint), 0)
            count = connect.call_count
            self.assertEqual(recovery.main(checkpoint), 1)
            self.assertEqual(connect.call_count, count)
            self.tv.path(recovery.HELPER).write_bytes(b'trial')
            verify = ['verify','--site','fixture','--live','--run',self.folder.name]
            self.assertEqual(recovery.main(verify), 1)
            rollback = ['rollback','--site','fixture','--live','--yes','--run',self.folder.name]
            self.assertEqual(recovery.main(rollback), 0)
            self.assertEqual(recovery.main(verify), 0)
            self.tv.path(recovery.HELPER).write_bytes(b'trial')
            self.assertEqual(recovery.main(rollback), 1)
            self.assertEqual(self.tv.path(recovery.HELPER).read_bytes(), b'trial')


if __name__ == '__main__':
    unittest.main()
