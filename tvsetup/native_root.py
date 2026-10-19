"""Opt-in native acquisition pilot with the trusted managed capability-entry bridge.

The default transport remains managed. This bundle never changes file capabilities
or platform policy and does not replace service acquisition/bootstrap.
"""
from pathlib import Path
import json
import re
import shutil
import struct
from .common import REPO, Refused, atomic_json, sha
from .root_launcher import IMAGE

SOURCE = REPO / 'research/native-root-acquisition'
FILES = ('libacquire.so', 'NativeEntry.dll', 'NativeEntry.deps.json', 'NativeEntry.runtimeconfig.json')


def probe_name(profile):
    if profile['id'] not in ('qn90a', 's90d'):
        raise Refused('Unsupported native acquisition model')
    return 'couchroot-native-root-' + profile['id']


def inspect_library(data, report):
    if (len(data) < 52 or len(data) > 131072 or data[:7] != b'\x7fELF\x01\x01\x01' or
            struct.unpack_from('<H', data, 16)[0] != 3 or struct.unpack_from('<H', data, 18)[0] != 40):
        raise Refused('Acquisition library must be ARM ELF32 shared code')
    flags = struct.unpack_from('<I', data, 36)[0]
    if flags >> 24 != 5 or flags & 0x400 or 'Requesting program interpreter:' in report:
        raise Refused('Acquisition library ABI mismatch')
    needed = sorted(set(re.findall(r'\(NEEDED\).*?\[([^\]]+)\]', report)))
    if 'libc.so.6' not in needed or set(needed) - {'libc.so.6', 'librt.so.1', 'ld-linux.so.3', 'libgcc_s.so.1'}:
        raise Refused('Unexpected acquisition library dependencies')
    versions = [tuple(int(v or 0) for v in m) for m in re.findall(r'GLIBC_(\d+)\.(\d+)(?:\.(\d+))?', report)]
    if not versions or max(versions) > (2, 17, 0):
        raise Refused('Unsupported acquisition library GLIBC requirement')
    return dict(abi='armv7-eabi5-softfp', needed=needed, glibc_max='.'.join(map(str, max(versions))))


def build(profile, destination, command, *, service=False):
    probe_name(profile)
    folder = Path(destination).resolve()
    if folder.exists():
        raise Refused('Native acquisition output must be new')
    folder.mkdir(mode=0o700, parents=True)
    source = folder/'source'; source.mkdir()
    hashes = {}
    entry = 'ServiceEntry.cs' if service else 'NativeEntry.cs'
    for name in ('acquire.c', 'build.sh', entry):
        path = SOURCE/name
        if path.is_symlink() or not path.is_file():
            raise Refused('Native acquisition source must be regular')
        data = path.read_bytes(); (source/name).write_bytes(data); hashes[name] = sha(data)
    image = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE]).strip()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise Refused('Cannot pin native acquisition toolchain')
    base = ['docker', 'run', '--rm', '--platform', 'linux/amd64', '--network', 'none']
    compiler = command(base + [image, 'arm-linux-gnueabi-gcc', '-dumpfullversion', '-dumpversion']).strip()
    rounds = []
    for number in (1, 2):
        work = folder/str(number); work.mkdir()
        command(base + ['-v', str(source)+':/src:ro', '-v', str(work)+':/out', image,
                        'sh', '/src/build.sh', '/out/native', 'service' if service else profile['id']])
        project = work/'managed'; project.mkdir()
        shutil.copyfile(source/entry, project/'Program.cs')
        csproj = project/'NativeEntry.csproj'
        csproj.write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                          '<OutputType>Exe</OutputType><UseAppHost>false</UseAppHost>'
                          '<CheckEolTargetFramework>false</CheckEolTargetFramework><TargetFramework>'+profile['framework']+'</TargetFramework>'
                          '<RuntimeFrameworkVersion>'+profile['runtime']+'</RuntimeFrameworkVersion><RollForward>Disable</RollForward>'
                          '<DefineConstants>'+('QN90A' if profile['id']=='qn90a' else '')+'</DefineConstants>'
                          '</PropertyGroup></Project>')
        command(['dotnet', 'build', str(csproj), '-c', 'Release', '--nologo', '-v', 'quiet',
                 '-p:Deterministic=true', '-p:PathMap='+str(project)+'=/src/NativeEntry', '-o', str(work/'bridge')])
        records = {}
        for name in FILES:
            path = work/('native' if name.endswith('.so') else 'bridge')/name
            data = path.read_bytes(); records[name] = dict(sha256=sha(data), size=len(data))
            if name.endswith('.so'):
                report = command(base + ['-v', str(work/'native')+':/out:ro', image,
                                        'arm-linux-gnueabi-readelf', '-l', '-d', '-V', '/out/'+name])
                records[name].update(inspect_library(data, report))
        rounds.append(records)
    if rounds[0] != rounds[1]:
        raise Refused('Native acquisition builds differ')
    artifacts = folder/'artifacts'; artifacts.mkdir()
    for name in FILES:
        shutil.copyfile(folder/'1'/('native' if name.endswith('.so') else 'bridge')/name, artifacts/name)
    manifest = dict(schema=1, kind='native-service-acquisition' if service else 'native-acquisition-managed-entry', model=profile['id'],
                    framework=profile['framework'], runtime=profile['runtime'], source=hashes,
                    toolchain=dict(image=image, compiler=compiler), reproducible_builds=2, artifacts=rounds[0])
    atomic_json(folder/'manifest.json', manifest)
    return manifest


def validated_bundle(profile, bundle):
    """Read and validate once; callers publish these exact bytes."""
    probe_name(profile)
    bundle = Path(bundle)
    manifest = json.loads((bundle/'manifest.json').read_text())
    if (manifest.get('schema') != 1 or manifest.get('kind') != 'native-acquisition-managed-entry' or
            any(manifest.get(k) != profile[k] for k in ('framework', 'runtime')) or
            manifest.get('model') != profile['id'] or manifest.get('reproducible_builds') != 2 or
            set(manifest.get('artifacts', {})) != set(FILES) or
            manifest.get('source') != {name:sha((SOURCE/name).read_bytes()) for name in ('acquire.c','build.sh','NativeEntry.cs')}):
        raise Refused('Native acquisition bundle/source/profile mismatch')
    artifacts = {}
    for name in FILES:
        path = bundle/'artifacts'/name
        if path.is_symlink() or not path.is_file():
            raise Refused('Native acquisition artifact must be regular')
        data = path.read_bytes(); expected = manifest['artifacts'][name]
        if expected['sha256'] != sha(data) or expected['size'] != len(data):
            raise Refused('Native acquisition artifact drift')
        artifacts[name] = data
    return manifest, artifacts


def snapshot(profile, bundle, destination):
    manifest, artifacts = validated_bundle(profile, bundle)
    folder = Path(destination).absolute()
    if folder.exists() or folder.is_symlink():
        raise Refused('Native acquisition snapshot must be new')
    folder.mkdir(parents=True, mode=0o700)
    (folder/'artifacts').mkdir(mode=0o700)
    for name, data in artifacts.items():
        path = folder/'artifacts'/name
        path.write_bytes(data); path.chmod(0o600)
    atomic_json(folder/'manifest.json', manifest)
    return folder


def prepare(profile, bundle, folder, script, cleanup_index=None):
    if '\0' in script or len(script.encode()) >= 65536:
        raise Refused('Native acquisition script must be NUL-free and below 64 KiB')
    if cleanup_index is not None:
        raise Refused('Allowlisted app cleanup remains on the managed transport')
    _, artifacts = validated_bundle(profile, bundle)
    outputs = {}
    for name, data in artifacts.items():
        # Snapshot bytes after validation; later bundle edits cannot alter staging.
        copy = folder/name; copy.write_bytes(data)
        outputs[copy] = 'code/'+name if name.endswith('.so') else name
    operation = folder/'operation.sh'; operation.write_text(script); outputs[operation] = operation.name
    return outputs
