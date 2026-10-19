"""Offline checks must not turn a missing SDK into a UI/setup-test dependency."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tvsetup import dependencies, installer
from tvsetup.common import REPO


class DependencyTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(dependencies.platform, 'system', return_value='Linux').start()
        patch.object(dependencies.sys, 'version_info', (3, 12)).start()
        patch.object(dependencies.importlib.metadata, 'version', return_value='6.1.1').start()

    def test_nonmanaged_checks_never_probe_dotnet(self):
        def which(name):
            self.assertNotEqual(name, 'dotnet')
            return '/tools/' + name
        with patch.object(dependencies.shutil, 'which', side_effect=which), \
             patch.object(dependencies.subprocess, 'run', return_value=SimpleNamespace(stdout='v22.0.0')) as run:
            for component in ('prepare', 'web', 'offline'):
                self.assertTrue(all(row['available'] for row in dependencies.checks(component)))
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0], ['node', '--version'])

    def test_managed_and_full_setup_require_the_exact_pinned_sdk(self):
        expected = json.loads((REPO/'global.json').read_text())['sdk']['version']
        for component in ('managed', 'setup'):
            with self.subTest(component=component), patch.object(dependencies.shutil, 'which', return_value='/tools/tool'):
                for version in ('wrong-version', expected):
                    with patch.object(dependencies.subprocess, 'run', return_value=SimpleNamespace(stdout=version)):
                        rows = dependencies.checks(component)
                        sdk = next(row for row in rows if row['name'].startswith('.NET'))
                        self.assertEqual(sdk['available'], version == expected)
                with patch.object(dependencies.subprocess, 'run', side_effect=subprocess.TimeoutExpired('dotnet', 20)):
                    self.assertFalse(all(row['available'] for row in dependencies.checks(component)))
            with patch.object(dependencies.shutil, 'which', side_effect=lambda name: None if name == 'dotnet' else '/tools/'+name), \
                 patch.object(dependencies.subprocess, 'run') as run:
                self.assertFalse(all(row['available'] for row in dependencies.checks(component)))
                run.assert_not_called()

    def test_old_node_is_rejected_without_requiring_managed_tools(self):
        with patch.object(dependencies.shutil, 'which', return_value='/tools/tool'), \
             patch.object(dependencies.subprocess, 'run', return_value=SimpleNamespace(stdout='v18.0.0')):
            self.assertFalse(all(row['available'] for row in dependencies.checks('web')))

    def test_installer_preparation_and_enrolled_native_install_work_without_tools(self):
        with patch.object(dependencies.shutil, 'which', return_value=None), \
             patch.object(dependencies.subprocess, 'run') as run:
            for launcher, stage in [('web', 'prepare'), ('native', 'prepare'), ('native', 'install')]:
                result = installer.doctor('qn90a', launcher, stage)
                self.assertTrue(all(row['available'] for row in result['checks']))
            self.assertFalse(all(row['available'] for row in installer.doctor('qn90a', 'web')['checks']))
            self.assertTrue(all(not row['available'] for row in result['optional_checks']))
            run.assert_not_called()


class BuildManifestTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('managed_build_fixture', REPO/'scripts/build-native.py')
        self.build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.build)

    def test_only_declared_outputs_enter_the_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root/'helper/Control.csproj'
            project.parent.mkdir()
            project.write_text('<Project><PropertyGroup><TargetFrameworks>net6.0;netcoreapp3.1</TargetFrameworks>'
                               '<AssemblyName>Helper</AssemblyName></PropertyGroup></Project>')
            for output in self.build.project_outputs(project):
                output.parent.mkdir(parents=True)
                output.write_bytes(b'current assembly')
                (output.parent/'Unrelated.dll').write_bytes(b'stale assembly')
            stale = root/'research/old/bin/Release/Stale.dll'
            stale.parent.mkdir(parents=True)
            stale.write_bytes(b'stale research')
            manifest = {}
            with patch.object(self.build, 'root', root):
                self.build.record_project('helper/Control.csproj', manifest)
                self.assertEqual(set(manifest), {'helper/bin/Release/net6.0/Helper.dll',
                                                'helper/bin/Release/netcoreapp3.1/Helper.dll'})
                self.build.project_outputs(project)[0].unlink()
                with self.assertRaises(FileNotFoundError):
                    self.build.record_project('helper/Control.csproj', {})


if __name__ == '__main__':
    unittest.main()
