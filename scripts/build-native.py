#!/usr/bin/env python3
"""Repeatable source builds; never sign, install, or copy vendor binaries."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
projects=[
 'research/autonomous-root/payload/SamsungTvRootAgent.csproj',
 'research/autonomous-root/payload/SamsungTvArchiveRoot.csproj',
 'tvsetup/native/Control.csproj',
 'research/namespace-root-probe/NamespaceRootProbe.csproj',
 'research/qn90a-root-probe/NamespaceRootProbe.csproj',
 'research/root-identity-probe/RootIdentity.csproj',
 'research/qn90a-root-probe/RootIdentity.csproj',
 'research/qn90a-hub-boot/relay/Boot.csproj',
 'research/qn90a-telemetry-startup/service/Service.csproj',
 'research/qn90a-telemetry-startup/bootstrap/Bootstrap.csproj',
 'research/s90d-telemetry/collector/Telemetry.csproj',
]


def project_outputs(project):
    """Only declared assemblies, never unrelated/stale DLLs in bin directories."""
    source = ET.parse(project).getroot()
    frameworks = source.findtext('./PropertyGroup/TargetFrameworks') or source.findtext('./PropertyGroup/TargetFramework')
    if not frameworks:
        raise ValueError('Missing explicit target framework: ' + str(project))
    assembly = source.findtext('./PropertyGroup/AssemblyName') or project.stem
    return [project.parent / 'bin/Release' / framework / (assembly + '.dll')
            for framework in frameworks.split(';')]


def record_project(project, manifest):
    for path in project_outputs(root / project):
        # Missing declared output is an error, not an incomplete success manifest.
        manifest[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = {}
    for project in projects:
        subprocess.run(['dotnet', 'build', str(root/project), '-c', 'Release', '--nologo', '-v', 'quiet'],
                       cwd=root, check=True, timeout=180)
        record_project(project, manifest)
    subprocess.run([sys.executable, str(root/'research/s90d-telemetry/build.py')],
                   cwd=root, check=True, timeout=240)
    record_project('research/s90d-telemetry/bin/helper/Boot.csproj', manifest)
    from tvsetup.root import build
    from tvsetup.config import profile
    for device in ('qn90a', 's90d'):
        with tempfile.TemporaryDirectory(prefix='setup-build-') as folder:
            for path, name in build(profile(device), Path(folder), 'true\n').items():
                manifest['generated/'+device+'/'+name] = hashlib.sha256(path.read_bytes()).hexdigest()
    for index in range(10):
        with tempfile.TemporaryDirectory(prefix='setup-cleanup-build-') as folder:
            for path, name in build(profile('qn90a'), Path(folder), '', cleanup_index=index).items():
                manifest['generated/cleanup-'+str(index)+'/'+name] = hashlib.sha256(path.read_bytes()).hexdigest()
    out = root/'dist'
    out.mkdir(exist_ok=True)
    (out/'native-manifest.json').write_text(json.dumps(dict(
        sdk=json.loads((root/'global.json').read_text())['sdk']['version'], files=manifest), indent=2)+'\n')
    print('Unsigned managed build hashes: dist/native-manifest.json. No hardware validation implied.')


if __name__ == '__main__':
    main()
