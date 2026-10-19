"""Build native agent components offline, without .NET, signing or TV access.

This is an artifact bundle, not an installable native-only agent. Capability
entry remains unresolved; ordinary signed packages retain their managed fallback.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import sys

from .common import REPO, Refused, atomic_json, run, sha
from .config import profile
from .native_root import inspect_library
from .native_worker import build as build_worker, inspect_binary
from .root_launcher import IMAGE


def new_directory(path):
    path = Path(path).absolute()
    if path.exists() or path.is_symlink():
        raise Refused('Native component output must be new')
    path.mkdir(parents=True, mode=0o700)
    return path.resolve()


def inspect_recovery(data, report):
    result = inspect_binary(data, report, (2, 17, 0))
    if len(data) > 128 * 1024 or 'librt.so.1' not in result['needed']:
        raise Refused('Native recovery requires bounded code and explicit librt')
    return result


def build_component(model, kind, destination, command=run):
    if model not in ('qn90a', 's90d'):
        raise Refused('Unsupported native component model')
    safety = profile(model)
    if kind not in ('setup-acquisition', 'service-acquisition', 'sdk-recovery'):
        raise Refused('Unknown native component')
    recovery = kind == 'sdk-recovery'
    source = REPO / ('research/autonomous-root/recovery/native' if recovery
                     else 'research/native-root-acquisition')
    artifact = 'sdk-host-recovery' if recovery else 'libacquire.so'
    inputs = ('recovery.c' if recovery else 'acquire.c', 'build.sh')
    folder = new_directory(destination)
    snapshot = folder/'source'; snapshot.mkdir()
    hashes = {}
    for name in inputs:
        path = source/name
        if path.is_symlink() or not path.is_file():
            raise Refused('Native component source must be regular')
        data = path.read_bytes(); hashes[name] = sha(data)
        (snapshot/name).write_bytes(data)
    image = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE]).strip()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise Refused('Cannot pin native component compiler image')
    base = ['docker', 'run', '--rm', '--platform', 'linux/amd64', '--network', 'none']
    compiler = command(base + [image, 'arm-linux-gnueabi-gcc', '-dumpfullversion', '-dumpversion']).strip()
    if not re.fullmatch(r'\d+(?:\.\d+){1,2}', compiler):
        raise Refused('Cannot identify native compiler version')
    rounds = []
    for index in (1, 2):
        work = folder/str(index); work.mkdir()
        args = [] if recovery else ['service' if kind == 'service-acquisition' else model]
        command(base + ['-v', str(snapshot)+':/src:ro', '-v', str(work)+':/out',
                        image, 'sh', '/src/build.sh', '/out/native', *args])
        output = work/'native'
        if output.is_symlink() or {p.name for p in output.iterdir()} != {artifact}:
            raise Refused('Unexpected native component output')
        binary = output/artifact
        if binary.is_symlink() or not binary.is_file():
            raise Refused('Native component artifact must be regular')
        data = binary.read_bytes()
        report = command(base + ['-v', str(output)+':/out:ro', image,
                                'arm-linux-gnueabi-readelf', '-l', '-d', '-V', '/out/'+artifact])
        inspect = inspect_recovery if recovery else inspect_library
        rounds.append(dict(sha256=sha(data), size=len(data), **inspect(data, report)))
    if rounds[0] != rounds[1]:
        raise Refused('Repeated native component builds differ')
    artifacts = folder/'artifacts'; artifacts.mkdir()
    shutil.copyfile(folder/'1/native'/artifact, artifacts/artifact)
    (artifacts/artifact).chmod(0o755)
    if sha((artifacts/artifact).read_bytes()) != rounds[0]['sha256']:
        raise Refused('Published native component drift')
    manifest = dict(schema=1, kind='native-'+kind+'-component', model=model,
                    firmware=safety['firmware'], source=hashes,
                    toolchain=dict(image=image, compiler=compiler), reproducible_builds=2,
                    artifacts={artifact:rounds[0]}, managed_build_required=False,
                    standalone_acquisition=False, device_qualified=False)
    atomic_json(folder/'manifest.json', manifest)
    return folder


def build(model, destination, command=run):
    if model not in ('qn90a', 's90d'):
        raise Refused('Unsupported native component model')
    safety = profile(model)
    folder = new_directory(destination)
    worker = build_worker(folder/'worker', command)
    components = {'worker': json.loads((worker/'native-manifest.json').read_text())}
    for kind in ('setup-acquisition', 'service-acquisition', 'sdk-recovery'):
        component = build_component(model, kind, folder/kind, command)
        components[kind] = json.loads((component/'manifest.json').read_text())
    if len({json.dumps(m['toolchain'], sort_keys=True) for m in components.values()}) != 1:
        raise Refused('Native component toolchains differ')
    artifacts = folder/'artifacts'; artifacts.mkdir()
    records = {}
    for component, manifest in components.items():
        for name, record in manifest['artifacts'].items():
            source = folder/component/('' if component == 'worker' else 'artifacts')/name
            data = source.read_bytes()
            if source.is_symlink() or sha(data) != record['sha256'] or len(data) != record['size']:
                raise Refused('Native component drift before bundle publication')
            target = component+'/'+name
            (artifacts/component).mkdir(exist_ok=True)
            (artifacts/target).write_bytes(data); (artifacts/target).chmod(0o755)
            records[target] = record
    manifest = dict(schema=1, kind='native-agent-components', model=model,
                    firmware=safety['firmware'], managed_build_required=False,
                    deployable_agent=False, capability_entry='unresolved',
                    managed_fallback_required=True, device_qualified=False,
                    components=components, artifacts=records)
    atomic_json(folder/'manifest.json', manifest)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=('qn90a', 's90d'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        manifest = build(args.model, args.output)
        print(json.dumps(dict(output=str(args.output), kind=manifest['kind'],
                              deployable_agent=False, managed_build_required=False)))
    except Refused as error:
        print(str(error), file=sys.stderr); return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
