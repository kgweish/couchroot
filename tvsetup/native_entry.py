"""Experimental read-only SDK entry receipt; no acquisition or fallback selection.

The codec is an original implementation of the two scalar/array record forms
observed in both pinned libbundle artifacts. Only a fixed, reviewed preload is
exposed. MD5 is the vendor wire checksum, not an authenticity mechanism.
"""
import base64
import hashlib
from pathlib import Path
import re
import shutil
import struct
from .common import REPO, Refused, atomic_json, sha
from .native_root import inspect_library
from .root_launcher import IMAGE

SOURCE = REPO / 'research/native-root-acquisition/entry'
ARTIFACT = 'libentry-receipt.so'
CODE_PATH = '/opt/usr/apps/MiniRoot01/res/wgt/payload/' + ARTIFACT
LOADERS = {'qn90a': '/usr/bin/launchpad-loader', 's90d': '/usr/bin/app-defined-loader'}


def _cstring(value):
    if not isinstance(value, str) or not value or '\0' in value:
        raise Refused('Invalid loader bundle string')
    try:
        data = value.encode('ascii')
    except UnicodeEncodeError as error:
        raise Refused('Loader bundle strings must be ASCII') from error
    if len(data) > 1024:
        raise Refused('Loader bundle string too long')
    return data + b'\0'


def _record(key, values, array=False):
    key = _cstring(key)
    if not isinstance(values, tuple) or not values or len(values) > 8 or (not array and len(values) != 1):
        raise Refused('Invalid loader bundle cardinality')
    body = struct.pack('<II', 0x501 if array else 0x401, len(key)) + key
    if array:
        body += struct.pack('<I', len(values))
    for value in values:
        data = _cstring(value)
        body += struct.pack('<I', len(data)) + data
    return struct.pack('<I', 4 + len(body)) + body


def loader_arguments(model, nonce):
    """Fixed preload only; caller pins loader/code hashes and absent IPC path."""
    if model not in LOADERS or not isinstance(nonce, str) or not re.fullmatch('[a-f0-9]{32}', nonce):
        raise Refused('Invalid native entry model or nonce')
    records = _record('loader_type', ('common-loader',)) + _record('preload', (CODE_PATH,), array=True)
    raw = hashlib.md5(records, usedforsecurity=False).hexdigest().encode('ascii') + records
    encoded = base64.b64encode(raw).decode('ascii')
    # Vendor parses signed ints. Avoid zero/overflow and bind a fresh nonce.
    loader_id = str(1 + int(nonce[:8], 16) % 2147483646)
    return [LOADERS[model], '100', loader_id, '0', encoded]


def build(profile, destination, command):
    model = profile.get('id')
    if model not in LOADERS:
        raise Refused('Unsupported native entry model')
    folder = Path(destination).resolve()
    if folder.exists():
        raise Refused('Native entry output must be new')
    folder.mkdir(mode=0o700, parents=True)
    source = folder/'source'; source.mkdir()
    hashes = {}
    for name in ('probe.c', 'receipt.h', 'build.sh'):
        path = SOURCE/name
        if path.is_symlink() or not path.is_file():
            raise Refused('Native entry source must be regular')
        data = path.read_bytes(); (source/name).write_bytes(data); hashes[name] = sha(data)
    image = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE]).strip()
    if not re.fullmatch('sha256:[a-f0-9]{64}', image):
        raise Refused('Cannot pin native entry toolchain')
    base = ['docker', 'run', '--rm', '--platform', 'linux/amd64', '--network', 'none']
    compiler = command(base + [image, 'arm-linux-gnueabi-gcc', '-dumpfullversion', '-dumpversion']).strip()
    rounds = []
    for number in (1, 2):
        work = folder/str(number); work.mkdir()
        command(base + ['-v', str(source)+':/src:ro', '-v', str(work)+':/out', image,
                        'sh', '/src/build.sh', '/out/native', model])
        data = (work/'native'/ARTIFACT).read_bytes()
        report = command(base + ['-v', str(work/'native')+':/out:ro', image,
                                'arm-linux-gnueabi-readelf', '-l', '-d', '-V', '/out/'+ARTIFACT])
        rounds.append(dict(sha256=sha(data), size=len(data), **inspect_library(data, report)))
    if rounds[0] != rounds[1]:
        raise Refused('Native entry builds differ')
    artifacts = folder/'artifacts'; artifacts.mkdir()
    shutil.copyfile(folder/'1/native'/ARTIFACT, artifacts/ARTIFACT)
    manifest = dict(schema=1, kind='native-entry-receipt', model=model, loader=LOADERS[model],
                    code_path=CODE_PATH, source=hashes, toolchain=dict(image=image, compiler=compiler),
                    reproducible_builds=2, artifacts={ARTIFACT:rounds[0]})
    atomic_json(folder/'manifest.json', manifest)
    return manifest
