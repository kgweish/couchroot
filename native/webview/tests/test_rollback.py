"""Recovery fault tests; no TV or setup credentials."""
import hashlib
import os
from pathlib import Path
import shlex
import stat
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollback import Recovery


def digest(data):
    return hashlib.sha256(data).hexdigest()


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='webview-recovery-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'state with spaces'
        self.state.mkdir()
        self.target, self.backup = self.root / 'hook', self.root / 'original'
        self.target.write_bytes(b'candidate hook\n')
        self.backup.write_bytes(b'original hook\n')
        self.backup.chmod(0o640)
        self.recovery = Recovery(str(self.target), str(self.backup), str(self.state),
                                 digest(self.target.read_bytes()), digest(self.backup.read_bytes()),
                                 'webview-test', 0)
        self.bin = self.root / 'bin'; self.bin.mkdir()
        # The TV has sha256sum; stock macOS CI may only have shasum. Supply
        # the same file-digest contract in that host fixture, with real bytes.
        if not shutil.which('sha256sum'):
            checksum = self.bin / 'sha256sum'
            checksum.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' -c ' + shlex.quote(
                'import hashlib, pathlib, sys\n'
                'for name in sys.argv[1:]:\n'
                ' print(hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest() + "  " + name)\n') + ' "$@"\n')
            checksum.chmod(0o755)
        # Model the firmware's unsigned-file rejection. Running command text is
        # permitted; submitting a script filename must fail this integration test.
        runner = self.bin / 'systemd-run'
        runner.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' -c ' + shlex.quote(
            'import os,sys,subprocess\n'
            'a=sys.argv[1:]\n'
            'with open(os.environ["CALLS"],"a") as f:f.write("systemd-run " + repr(a) + "\\n")\n'
            'if "/bin/sh" in a:\n'
            ' a=a[a.index("/bin/sh"):]\n'
            ' if a[1]!="-c":sys.exit(71)\n'
            ' sys.exit(subprocess.call(a))\n') + ' "$@"\n')
        runner.chmod(0o755)
        control = self.bin / 'systemctl'
        control.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n')
        control.chmod(0o755)
        self.calls = self.root / 'calls'
        self.env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'], CALLS=str(self.calls))

    def run_shell(self, script):
        return subprocess.run(['/bin/sh', '-c', script], env=self.env, capture_output=True, text=True, timeout=5)

    def dispatch(self):
        (self.state / 'rollback-command').write_text(self.recovery.watch())
        return self.run_shell(self.recovery.dispatch())

    def test_unaccepted_dispatch_restores_exact_hook_and_metadata(self):
        result = self.dispatch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.target.read_bytes(), self.backup.read_bytes())
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o640)
        self.assertTrue((self.state / 'rolled-back').is_file())
        calls = self.calls.read_text()
        self.assertIn('stop couchroot-native-hub-boot.service', calls)
        self.assertIn('MiniHub001.Hub', calls)
        self.assertIn('restored-hook', (self.state / 'rollback.log').read_text())

    def test_accept_preserves_candidate_and_skips_dispatch(self):
        self.assertEqual(self.run_shell(self.recovery.accept()).returncode, 0)
        self.assertEqual(self.dispatch().returncode, 0)
        self.assertEqual(digest(self.target.read_bytes()), self.recovery.expected)
        self.assertFalse(self.calls.exists())

    def test_accept_after_watcher_started_wins_at_deadline(self):
        from dataclasses import replace
        watcher = subprocess.Popen(['/bin/sh', '-c', replace(self.recovery, delay=1).watch()], env=self.env)
        try:
            self.assertEqual(self.run_shell(self.recovery.accept()).returncode, 0)
            self.assertEqual(watcher.wait(timeout=5), 0)
            self.assertEqual(digest(self.target.read_bytes()), self.recovery.expected)
        finally:
            if watcher.poll() is None: watcher.kill(); watcher.wait()

    def test_changed_candidate_or_backup_refuses_without_stopping_launcher(self):
        for path in (self.target, self.backup):
            with self.subTest(path=path):
                before = path.read_bytes(); path.write_bytes(b'unexpected')
                result = self.run_shell(self.recovery.watch())
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(path.read_bytes(), b'unexpected')
                self.assertFalse(self.calls.exists())
                self.assertFalse((self.state / 'rolled-back').exists())
                path.write_bytes(before)

    def test_accept_cannot_race_or_override_completed_rollback(self):
        (self.state / 'decision.lock').mkdir()
        self.assertNotEqual(self.run_shell(self.recovery.accept()).returncode, 0)
        self.assertFalse((self.state / 'accepted').exists())
        (self.state / 'decision.lock').rmdir()
        self.assertEqual(self.dispatch().returncode, 0)
        self.assertNotEqual(self.run_shell(self.recovery.accept()).returncode, 0)
        self.assertFalse((self.state / 'accepted').exists())

    def test_target_symlink_is_refused(self):
        self.target.unlink(); self.target.symlink_to(self.backup)
        self.assertNotEqual(self.run_shell(self.recovery.watch()).returncode, 0)
        self.assertTrue(self.target.is_symlink())
        self.assertFalse(self.calls.exists())

    def test_invalid_configuration_is_rejected(self):
        from dataclasses import replace
        for changes in ({'target':'relative'}, {'state':'/tmp/../etc'}, {'unit':'x;false'},
                        {'original':'bad'}, {'delay':-1}, {'backup':str(self.target)}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                replace(self.recovery, **changes)


if __name__ == '__main__': unittest.main()
