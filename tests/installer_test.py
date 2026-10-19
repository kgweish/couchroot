"""Universal installer boundaries: offline means no site, signing or transport."""
import contextlib
import copy
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from tvsetup import cli, installer
from tvsetup.common import Refused, atomic_json, read_json, sha
from tvsetup.config import LAUNCHER_COMPONENTS, profile, resolve
from tvsetup.planner import Action
from tv_setup_planner_test import accepted, profile as fixture_profile


def elf():
    data = bytearray(128)
    data[:7] = b'\x7fELF\x01\x01\x01'
    struct.pack_into('<HHIIIIIHHHHHH', data, 16, 2, 40, 1, 0x10000, 52, 0,
                     0x05000200, 52, 32, 1, 0, 0, 0)
    struct.pack_into('<IIIIIIII', data, 52, 1, 0, 0x10000, 0, 128, 128, 5, 4096)
    return bytes(data)


class InstallerTests(unittest.TestCase):
    def invoke(self, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = installer.main(args)
        return code, out.getvalue(), err.getvalue()

    def test_offline_commands_and_dry_runs_never_load_site_or_device_engine(self):
        with patch.object(cli, 'main') as engine, patch.object(cli, 'load_site') as site, patch.object(installer, 'local_command') as local, patch.object(installer, 'dependency_checks', return_value=[]):
            for launcher, device in [('web', 's90d'), ('web', 'qn90a'), ('native', 'qn90a')]:
                for command in ['plan', 'doctor', 'inspect', 'apply', 'status', 'verify', 'resume', 'rollback']:
                    args = [command, '--device', device, '--launcher', launcher, '--json']
                    if command not in ('plan', 'doctor'):
                        args += ['--dry-run']
                    if command in ('resume', 'rollback'):
                        args += ['--run', 'example-run']
                    code, out, _ = self.invoke(args)
                    self.assertIn(code, (0, 2))
                    self.assertTrue(json.loads(out)['offline'])
            engine.assert_not_called(); site.assert_not_called(); local.assert_not_called()

    def test_explicit_launcher_is_required(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            installer.main(['plan', '--device', 'qn90a'])

    def test_s90d_native_is_never_silently_converted_to_web(self):
        with patch.object(cli, 'main') as engine:
            code, _, err = self.invoke(['apply', '--device', 's90d', '--launcher', 'native', '--yes'])
            self.assertEqual(code, 1)
            self.assertIn('QN90A', err)
            engine.assert_not_called()

    def test_native_live_commands_require_explicit_enrollment_before_transport(self):
        with patch.object(cli, 'main') as engine, patch.object(cli, 'load_site') as site:
            for command in ['inspect', 'apply', 'status', 'verify', 'resume', 'rollback']:
                args = [command, '--device', 'qn90a', '--launcher', 'native', '--json']
                if command in ('resume', 'rollback'):
                    args += ['--run', 'private-trial']
                code, out, _ = self.invoke(args)
                self.assertEqual(code, 1)
            engine.assert_not_called(); site.assert_not_called()

    def test_web_apply_uses_scoped_shared_engine_and_returns_failure(self):
        with patch.object(cli, 'main', return_value=3) as engine:
            code, _, _ = self.invoke(['apply', '--device', 's90d', '--launcher', 'web', '--yes', '--activate'])
        self.assertEqual(code, 3)
        args = engine.call_args.args[0]
        self.assertEqual(args[:3], ['apply', '--device', 's90d'])
        self.assertIn('--activate', args)
        self.assertEqual(args[args.index('--components') + 1], ','.join(LAUNCHER_COMPONENTS))
        self.assertEqual(engine.call_args.kwargs, {'launcher_only': True})

    def test_recovery_uses_journal_without_component_overrides_or_builds(self):
        with patch.object(cli, 'main', return_value=0) as engine, patch.object(installer, 'local_command') as build:
            code, _, _ = self.invoke(['resume', '--device', 'qn90a', '--launcher', 'web', '--run', 'saved', '--yes', '--retry-unchanged'])
            self.assertEqual(code, 0)
            args = engine.call_args.args[0]
            self.assertNotIn('--components', args)
            self.assertIn('--resume', args)
            self.assertIn('--retry-unchanged', args)
            build.assert_not_called()

    def test_web_bundle_is_model_specific_unsigned_and_repeatable(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(cli, 'main') as engine:
            root = Path(tmp)
            for device in ('qn90a', 's90d'):
                bundles = []
                for n in range(2):
                    output = root / (device + str(n))
                    code, out, err = self.invoke(['prepare', '--device', device, '--launcher', 'web', '--output', str(output), '--json'])
                    self.assertEqual(code, 0, err)
                    manifest = read_json(output/'manifest.json')
                    self.assertFalse(manifest['signed'])
                    self.assertFalse(manifest['hardware_checked'])
                    for name, details in manifest['files'].items():
                        self.assertEqual(sha((output/name).read_bytes()), details['sha256'])
                    self.assertEqual(read_json(output/'web-choices.json')['remove'], [])
                    with zipfile.ZipFile(output/'MinimalHub-unsigned.wgt') as z:
                        self.assertIn('telemetry-service.js', z.namelist())
                        self.assertEqual('qn90a-idle.js' in z.namelist(), device == 'qn90a')
                        self.assertFalse(any('signature' in name for name in z.namelist()))
                    bundles.append((output/'MinimalHub-unsigned.wgt').read_bytes())
                self.assertEqual(*bundles)
            engine.assert_not_called()

    def test_native_bundle_retains_web_fallback_without_web_boot_relay(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(cli, 'main') as engine:
            root = Path(tmp); binary = root/'input'; binary.write_bytes(elf())
            output = root/'bundle'
            code, _, err = self.invoke(['prepare', '--device', 'qn90a', '--launcher', 'native', '--native-binary', str(binary), '--output', str(output)])
            self.assertEqual(code, 0, err)
            self.assertEqual((output/'native-hub').read_bytes(), binary.read_bytes())
            self.assertTrue((output/'MinimalHub-unsigned.wgt').is_file())
            self.assertNotIn('startup', read_json(output/'web-choices.json')['components'])
            self.assertTrue(read_json(output/'manifest.json')['deployment_available'])
            self.assertEqual((output.stat().st_mode & 0o777), 0o700)
            engine.assert_not_called()

    def test_rejects_bad_native_binaries_before_creating_output(self):
        wrong_arch = bytearray(elf()); struct.pack_into('<H', wrong_arch, 18, 62)
        hardfloat = bytearray(elf()); struct.pack_into('<I', hardfloat, 36, 0x05000400)
        bad_segment = bytearray(elf()); struct.pack_into('<I', bad_segment, 68, 10000)
        bad_entry = bytearray(elf()); struct.pack_into('<I', bad_entry, 24, 0x90000)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for data in [b'not ELF', elf()[:60], wrong_arch, hardfloat, bad_segment, bad_entry]:
                binary = root/'input'; binary.write_bytes(data)
                output = root/'output'
                code, _, _ = self.invoke(['prepare', '--device', 'qn90a', '--launcher', 'native', '--native-binary', str(binary), '--output', str(output)])
                self.assertEqual(code, 1)
                self.assertFalse(output.exists())

    def test_preparation_refuses_overwrite_symlink_and_source_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); existing = root/'existing'; existing.mkdir()
            (existing/'keep').write_text('unchanged')
            link = root/'link'; link.symlink_to(root/'absent')
            for output in [existing, link, installer.REPO/'should-not-be-created']:
                code, _, _ = self.invoke(['prepare', '--device', 'qn90a', '--launcher', 'web', '--output', str(output)])
                self.assertEqual(code, 1)
            self.assertEqual((existing/'keep').read_text(), 'unchanged')
            self.assertFalse((root/'absent').exists())

    def test_build_failure_does_not_publish_partial_bundle(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(installer, 'local_command', side_effect=Refused('build failed')):
            output = Path(tmp)/'bundle'
            code, _, _ = self.invoke(['prepare', '--device', 'qn90a', '--launcher', 'native', '--build-native', '--output', str(output)])
            self.assertEqual(code, 1)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_native_requires_payload_and_web_rejects_native_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            for launcher, extra in [('native', []), ('web', ['--build-native'])]:
                code, _, _ = self.invoke(['prepare', '--device', 'qn90a', '--launcher', launcher, '--output', str(Path(tmp)/'bundle')] + extra)
                self.assertEqual(code, 1)

    def test_export_conversion_is_explicit_and_errors_do_not_leak_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); binary = root/'input'; binary.write_bytes(elf())
            export = root/'export.json'; export.write_text('{}')
            def convert(argv, **kwargs):
                self.assertEqual(argv[0], 'node')
                self.assertEqual(argv[-2], str(export.resolve()))
                Path(argv[-1]).write_text('COUCHROOT1 0 0 0 0\n')
            with patch.object(installer, 'local_command', side_effect=convert):
                code, _, err = self.invoke(['prepare', '--device', 'qn90a', '--launcher', 'native', '--native-binary', str(binary), '--web-state', str(export), '--output', str(root/'bundle')])
            self.assertEqual(code, 0, err)
            self.assertIn('native-state', read_json(root/'bundle/manifest.json')['files'])
            self.assertFalse((root/'bundle/export.json').exists())

    def test_launcher_scope_rejects_unrelated_recovery_before_transport(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(cli, 'STATE', Path(tmp)), patch.object(cli, 'load_site', return_value={}), patch.object(cli, 'configured_profile', return_value=profile('s90d')), patch.object(cli, 'binding', return_value='same'), patch.object(cli, 'Transport') as transport:
            atomic_json(Path(tmp)/'runs/other/journal.json', {'device': 's90d', 'scope': 'setup'})
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(['rollback', '--device', 's90d', '--run', 'other', '--yes'], launcher_only=True), 1)
            transport.assert_not_called()

    def test_scope_denies_unrelated_components(self):
        choices = resolve('qn90a', overrides={'components': list(LAUNCHER_COMPONENTS), 'remove': []})
        cli.launcher_scope(choices)
        with self.assertRaises(Refused):
            cli.launcher_scope(choices, [Action('x', 'cleanup', 'uninstall', None, None)])
        with self.assertRaises(Refused):
            cli.launcher_scope({**choices, 'artifacts': {'hub': '/old.wgt'}})

    def test_scoped_apply_preserves_saved_choices_and_ignores_saved_artifacts(self):
        class LauncherDriver:
            def __init__(self, tv, p, choices, *args):
                self.tv = tv
                self.assertions(choices)
            @staticmethod
            def assertions(choices):
                assert choices['artifacts'] == {}
                assert set(choices['components']) == set(LAUNCHER_COMPONENTS)
            def snapshot(self): return copy.deepcopy(self.tv.state)
            def prepare(self, action): return {}
            def backup(self, action, info, state): return info
            def execute(self, action, info, state): self.tv.state['files'].update(action.after)
            def verify(self, action, before, after):
                assert all(after['files'][p] == h for p, h in action.after.items())

        for device in ('s90d', 'qn90a'):
            with self.subTest(device=device), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                saved = {'components': ['dashboard', 'cleanup'], 'exclude': ['hub'], 'artifacts': {'hub': '/old.wgt'}}
                atomic_json(root/(device+'-choices.json'), saved)
                tv = Mock(); tv.state = accepted(device)
                tv.state['files']['/opt/usr/apps/MiniHub001/res/wgt/style.css'] = 'old-style'
                tv.snapshot.side_effect = lambda **kwargs: copy.deepcopy(tv.state)
                with patch.object(cli, 'STATE', root), patch.object(cli, 'load_site', return_value={}), patch.object(cli, 'configured_profile', return_value=fixture_profile(device)), patch.object(cli, 'binding', return_value='same'), patch.object(cli, 'Transport', return_value=tv), patch.object(cli, 'Driver', LauncherDriver), patch.object(cli, 'NAS'), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(cli.main(['apply', '--device', device, '--yes'], launcher_only=True), 0)
                self.assertEqual(read_json(root/(device+'-choices.json')), saved)
                doc = read_json(next((root/'runs').glob('*/journal.json')))
                self.assertEqual(doc['scope'], 'launcher-web')
                self.assertEqual(doc['phase'], 'complete')


if __name__ == '__main__':
    unittest.main()
