"""Local preparation and generated-script behavior; never connects to a TV."""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from installer_test import elf
from tvsetup import installer, native_hook, native_telemetry
from tvsetup.common import Refused, sha
from tvsetup.native_install import capture


class PreparationTests(unittest.TestCase):
    def test_opt_in_bundle_is_deterministic_private_and_requires_adapter(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root/'input'; binary.write_bytes(elf())
            manifests = []
            with patch('tvsetup.cli.load_site', side_effect=AssertionError('private site read')), \
                 patch('tvsetup.native_cli.connect', side_effect=AssertionError('TV connection')), \
                 patch.object(installer, 'local_command', side_effect=AssertionError('unexpected build')):
                for name in ('first', 'second'):
                    out = root/name
                    with contextlib.redirect_stdout(io.StringIO()):
                        code = installer.main(['prepare', '--device', 'qn90a', '--launcher', 'native',
                                               '--native-binary', str(binary), '--native-telemetry-binary', str(binary),
                                               '--output', str(out)])
                    self.assertEqual(code, 0)
                    manifest = json.loads((out/'manifest.json').read_text())
                    self.assertTrue(manifest['deployment_available'])
                    self.assertTrue(manifest['apply_consumes_bundle'])
                    self.assertFalse(manifest['native_telemetry']['inspector_available'])
                    self.assertEqual(manifest['native_telemetry']['inspector_status'], 'retired')
                    self.assertFalse(any('inspector' in item.lower() for item in manifest['blockers']))
                    self.assertTrue(manifest['native_telemetry']['managed_settings_adapter_retained'])
                    self.assertIsNone(manifest['native_telemetry']['binary_matches_checkout'])
                    self.assertTrue(manifest['blockers'])
                    for filename, details in manifest['files'].items():
                        self.assertEqual(sha((out/filename).read_bytes()), details['sha256'])
                    self.assertEqual((out/'telemetry-collector').stat().st_mode & 0o777, 0o600)
                    self.assertNotIn('telemetry', json.loads((out/'web-choices.json').read_text())['components'])
                    with self.assertRaisesRegex(Refused, 'current signed telemetry adapter'):
                        capture(root/'run', out, root/'not-read')
                    self.assertFalse((root/'run').exists())
                    manifests.append(manifest)
            self.assertEqual(*manifests)

    def test_bad_elf_and_unsupported_selection_publish_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); good = root/'hub'; good.write_bytes(elf())
            bad = root/'collector'; bad.write_bytes(b'not an ARM ELF')
            for device, launcher in [('qn90a', 'native'), ('qn90a', 'web'), ('s90d', 'native')]:
                with contextlib.redirect_stderr(io.StringIO()):
                    code = installer.main(['prepare', '--device', device, '--launcher', launcher,
                                           '--native-binary', str(good), '--native-telemetry-binary', str(bad),
                                           '--output', str(root/'bundle')])
                self.assertEqual(code, 1)
                self.assertFalse((root/'bundle').exists())

    def test_candidate_cannot_be_silently_ignored_by_removing_metadata(self):
        with self.assertRaises(Refused):
            native_telemetry.capture_bundle(Path('/unused'), {'files': {'telemetry-boot.sh': {}}}, None)

    def test_unit_retains_existing_security_and_lifecycle_properties(self):
        files, metadata = native_telemetry.prepare(elf())
        unit = files['telemetry-unit.service'].decode()
        for value in ('User=5001', 'Group=100', 'SmackProcessLabel=User::Pkg::MiniTelemetry',
                      'BindReadOnlyPaths=', 'Restart=on-failure', 'RestartSec=10s',
                      'StartLimitIntervalSec=300', 'StartLimitBurst=3', '--native-handoff'):
            self.assertIn(value, unit)
        self.assertNotIn('RuntimeMaxSec', unit)
        self.assertNotIn('--run-for', unit)
        self.assertIn(native_telemetry.RUNTIME, unit)
        self.assertIn(native_telemetry.DATA, unit)
        self.assertNotIn('token', unit)
        for name in ('telemetry-boot.sh', 'telemetry-handoff.sh'):
            syntax = subprocess.run(['/bin/sh', '-n'], input=files[name], capture_output=True)
            self.assertEqual(syntax.returncode, 0, syntax.stderr)
        self.assertEqual(metadata['bootstrap']['sha256'], sha(files['telemetry-boot.sh']))


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.commands = self.root/'commands'; self.commands.mkdir()
        self.env = dict(os.environ, PATH=str(self.commands)+os.pathsep+os.environ['PATH'],
                        EVENTS=str(self.root/'events'), LOCK_BUSY='0', UNIT_STATE='not-found', SUBMIT_FAIL='0')
        self.stub('id', 'echo 5001')
        self.stub('uname', 'echo armv7l')
        self.stub('stat', 'echo 5001:1')  # Device-only ownership; files/renames are real.
        self.stub('flock', 'echo lease >> "$EVENTS"\ntest "$LOCK_BUSY" = 0')
        self.stub('systemctl', 'echo "$UNIT_STATE"')
        self.stub('systemd-run', 'echo submit >> "$EVENTS"\ntest "$SUBMIT_FAIL" = 0')
        if not shutil.which('sha256sum'):
            self.stub('sha256sum', 'exec shasum -a 256 "$@"')
        firmware = self.root/'firmware'; firmware.write_text('Version=T-NKM2AKUC-2301.1;\n')
        self.data = self.root/'data'; self.data.mkdir()
        self.runtime = self.root/'runtime'; self.runtime.mkdir()
        (self.runtime/'lock').write_bytes(b'unchanged lock')
        (self.data/'config.json').write_bytes(b'private pairing fixture')
        (self.data/'preferences.json').write_bytes(b'owner preferences fixture')
        self.files, self.metadata = native_telemetry.prepare(elf())

    def stub(self, name, body):
        path = self.commands/name
        path.write_text('#!/bin/sh\n'+body+'\n'); path.chmod(0o755)

    def run_script(self, script, *args):
        # Replace absolute TV paths before executing anything; no real /opt or
        # /run path or real service manager is reachable from this harness.
        text = script.decode().replace(native_telemetry.DATA, str(self.data))
        text = text.replace(native_telemetry.RUNTIME, str(self.runtime))
        text = text.replace('/etc/prd_info.ini', str(self.root/'firmware'))
        text = text.replace('/opt/', str(self.root/'opt')+'/').replace('/run/', str(self.root/'run')+'/')
        return subprocess.run(['/bin/sh', '-s', '--', *args], input=text, text=True,
                              capture_output=True, env=self.env, timeout=5)

    def handoff(self, direction):
        return self.run_script(self.files['telemetry-handoff.sh'], direction)

    def test_handoff_and_rollback_preserve_pairing_preferences_and_lease(self):
        (self.data/'enabled').touch()
        before = {name: (self.data/name).read_bytes() for name in ('config.json', 'preferences.json')}
        result = self.handoff('native'); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.data/'enabled').exists())
        self.assertEqual((self.data/'native-enabled').read_bytes(), b'')
        result = self.handoff('managed'); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.data/'enabled').exists())
        self.assertFalse((self.data/'native-enabled').exists())
        self.assertEqual(before, {name: (self.data/name).read_bytes() for name in before})
        self.assertEqual((self.runtime/'lock').read_bytes(), b'unchanged lock')

    def test_recovery_after_reboot_can_recreate_absent_volatile_lease(self):
        (self.data/'native-enabled').touch()
        shutil.rmtree(self.runtime)
        result = self.handoff('managed')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.runtime/'lock').is_file())
        self.assertTrue((self.data/'enabled').is_file())

    def test_busy_lease_never_restores_a_competing_managed_sampler(self):
        (self.data/'enabled').touch(); self.env['LOCK_BUSY'] = '1'
        self.assertNotEqual(self.handoff('native').returncode, 0)
        self.assertFalse((self.data/'enabled').exists())
        self.assertTrue((self.data/'native-enabled').exists())
        self.assertNotEqual(self.handoff('managed').returncode, 0)
        self.assertFalse((self.data/'enabled').exists())
        self.env['LOCK_BUSY'] = '0'
        self.assertEqual(self.handoff('managed').returncode, 0)

    def test_unknown_dual_and_symlink_marker_states_are_not_adopted(self):
        self.assertNotEqual(self.handoff('native').returncode, 0)  # Disabled/uninstalled.
        enabled = self.data/'enabled'; enabled.write_bytes(b'foreign')
        self.assertNotEqual(self.handoff('native').returncode, 0)
        self.assertEqual(enabled.read_bytes(), b'foreign')
        enabled.write_bytes(b''); native = self.data/'native-enabled'; native.touch()
        self.assertNotEqual(self.handoff('native').returncode, 0)
        self.assertNotEqual(self.handoff('managed').returncode, 0)
        native.unlink(); native.symlink_to(self.data/'absent')
        self.assertNotEqual(self.handoff('native').returncode, 0)
        self.assertTrue(enabled.exists())

    def test_boot_submission_is_once_per_boot_even_after_a_lost_reply(self):
        p = native_telemetry.layout(self.metadata['version'])
        base = self.root/p['base'].lstrip('/'); base.mkdir(parents=True)
        (base/'collector').write_bytes(elf()); (base/'admitted').write_bytes(b'enabled\n')
        (self.root/'run').mkdir()
        self.stub('id', 'echo 0')
        self.stub('stat', 'case "$3" in *-admission.lock) echo 0:0:600:1;; */collector) echo 0:0:555;; *) echo 0:0:755;; esac')
        self.env['SUBMIT_FAIL'] = '1'
        self.assertNotEqual(self.run_script(self.files['telemetry-boot.sh']).returncode, 0)
        self.env['SUBMIT_FAIL'] = '0'
        self.assertNotEqual(self.run_script(self.files['telemetry-boot.sh']).returncode, 0)
        self.assertEqual((self.root/'events').read_text().count('submit\n'), 1)

    def test_existing_unit_is_never_restarted_and_changed_binary_never_runs(self):
        p = native_telemetry.layout(self.metadata['version'])
        base = self.root/p['base'].lstrip('/'); base.mkdir(parents=True)
        (base/'collector').write_bytes(elf()); (base/'admitted').write_bytes(b'enabled\n'); (self.root/'run').mkdir()
        self.stub('id', 'echo 0')
        self.stub('stat', 'case "$3" in *-admission.lock) echo 0:0:600:1;; */collector) echo 0:0:555;; *) echo 0:0:755;; esac')
        self.env['UNIT_STATE'] = 'loaded'
        self.assertNotEqual(self.run_script(self.files['telemetry-boot.sh']).returncode, 0)
        self.env['UNIT_STATE'] = 'not-found'; (base/'collector').write_bytes(b'changed')
        self.assertNotEqual(self.run_script(self.files['telemetry-boot.sh']).returncode, 0)
        self.assertNotIn('submit', (self.root/'events').read_text() if (self.root/'events').exists() else '')

    def test_revoked_admission_blocks_boot_submission(self):
        p = native_telemetry.layout(self.metadata['version'])
        base = self.root/p['base'].lstrip('/'); base.mkdir(parents=True)
        (base/'collector').write_bytes(elf()); (self.root/'run').mkdir()
        self.stub('id', 'echo 0')
        self.stub('stat', 'case "$3" in *-admission.lock) echo 0:0:600:1;; */collector) echo 0:0:555;; *) echo 0:0:755;; esac')
        result = self.run_script(self.files['telemetry-boot.sh'])
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('submit', (self.root/'events').read_text())

    def test_optional_telemetry_failure_preserves_the_previous_boot_hook(self):
        baseline = b'#!/usr/bin/awk -f\nBEGIN { print "BASELINE_OK" }\n'
        files = native_hook.render('test', sha(elf()), sha(baseline), {},
                                   telemetry_boot=self.metadata['bootstrap'])
        encoded = re.search(r'rc=system\((.*)\); exit', files['hook.awk'].decode())[1]
        script = shlex.split(json.loads(encoded))[2]
        previous = self.root/native_hook.layout('test')['previous'].lstrip('/')
        previous.parent.mkdir(parents=True); previous.write_bytes(baseline)
        result = self.run_script(script.encode())  # Both optional dispatches are absent.
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'BASELINE_OK')


if __name__ == '__main__':
    unittest.main()
