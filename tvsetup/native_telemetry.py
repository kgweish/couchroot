"""Offline QN90A collector bundle. No transport, deployment or new supervisor.

The generated handoff runs in the existing telemetry package context. Installation
and recovery use the shared engine through native_install; no second journal.
"""
import configparser
from pathlib import Path
import shlex

from .common import REPO, Refused, sha
from .config import profile
from .native_hook import digest
from .telemetry import DATA
from .transport import Q, hash_guard, identity_guard

UNIT = 'couchroot-native-telemetry'
LABEL = 'User::Pkg::MiniTelemetry'
RUNTIME = '/tmp/minimal-telemetry-qn90a'
SOURCE = REPO/'research/native-telemetry/collector'


def layout(version):
    digest(version)
    base = '/opt/minimal-native-collector/' + version
    return {'base': base, 'binary': base+'/collector', 'boot': base+'/boot.sh',
            'handoff': base+'/handoff.sh', 'unit': base+'/collector.service',
            'admission': base+'/admitted'}


def admission_lock():
    # Serialize boot submission with rollback's admission removal and unit stop.
    path = '/run/'+UNIT+'-admission.lock'
    return (f'test ! -L {path}\n'
            f'if test ! -e {path}; then (umask 077; set -C; : > {path}) || test -f {path}; fi\n'
            f'test -f {path}\ntest "$(stat -c %u:%g:%a:%h {path})" = 0:0:600:1\n'
            f'exec 8<> {path}\nflock -w 5 8\n')


def render(version, binary_hash):
    p = layout(version)
    digest(binary_hash)
    # Preserve the tested unit's identity, read-only view and restart limits.
    unit = (SOURCE/'collector.service.in').read_text().replace('@VERSION@', version).replace('@DEVICE@', 'qn90a')
    unit = unit.replace('--runtime '+RUNTIME, '--runtime '+RUNTIME+' --native-handoff')
    config = configparser.ConfigParser(interpolation=None)
    config.optionxform = str
    config.read_string(unit)
    properties = {**config['Unit'], **config['Service']}
    command = ['systemd-run', '--no-block', '--unit='+UNIT,
               '--description='+UNIT+'-'+version]
    properties.pop('Description')
    executable = shlex.split(properties.pop('ExecStart'))
    for name, value in properties.items():
        command += ['-p', name+'='+value]
    command += executable
    boot = ('#!/bin/sh\n'+identity_guard(profile('qn90a'))+
            f'test "$(id -u)" = 0\n'
            f'test ! -L /opt/minimal-native-collector\n'
            f'test "$(stat -c %u:%g:%a /opt/minimal-native-collector)" = 0:0:755\n'
            f'test ! -L {p["base"]}\n'
            f'test "$(stat -c %u:%g:%a {p["base"]})" = 0:0:755\n'+
            hash_guard(p['binary'], binary_hash)+
            f'test "$(stat -c %u:%g:%a {p["binary"]})" = 0:0:555\n'+
            admission_lock()+hash_guard(p['admission'], sha(b'enabled\n'))+
            # Never restart an explicitly stopped/rate-limited or foreign unit.
            f'test "$(systemctl show {UNIT}.service -p LoadState --value)" = not-found\n'
            # A GC'd transient unit or lost reply is not permission to retry.
            f'mkdir -m 700 /run/{UNIT}-claimed\n'+shlex.join(command)+'\n').encode()
    # The atomic rename preserves the existing marker's ownership/SMACK label.
    # It never rewrites pairing, preferences, package files or receiver state.
    handoff = f'''#!/bin/sh
set -eu
{identity_guard(profile('qn90a'))}test "$(id -u)" = 5001
test ! -L {DATA}
test -d {DATA}
test ! -L {RUNTIME}
if test "${{1:-}}" = managed && test ! -e {RUNTIME}; then mkdir -m 700 {RUNTIME}; fi
test -d {RUNTIME}
# After a reboot no sampler may have created the volatile lease yet. Recovery
# has already revoked admission and stopped the captured unit before this call.
if test "${{1:-}}" = managed && test ! -e {RUNTIME}/lock; then
    test ! -L {RUNTIME}/lock
    (umask 077; set -C; : > {RUNTIME}/lock)
fi
test ! -L {RUNTIME}/lock
test -f {RUNTIME}/lock
test "$(stat -c %u:%h {RUNTIME}/lock)" = 5001:1
case "${{1:-}}" in
  native) before={DATA}/enabled; after={DATA}/native-enabled ;;
  managed) before={DATA}/native-enabled; after={DATA}/enabled ;;
  *) exit 2 ;;
esac
test ! -L "$before"; test -f "$before"; test ! -s "$before"
test "$(stat -c %u:%h "$before")" = 5001:1
test ! -L "$after"; test ! -e "$after"
# Opening without truncation preserves the collector's existing shared lease.
exec 9<> {RUNTIME}/lock
if test "$1" = managed; then
    # The caller must stop the native unit first. An active sampler blocks this.
    flock -w 18 9
    mv "$before" "$after"
else
    mv "$before" "$after"
    # The managed loop sees enabled disappear and releases its lease.
    # Failure leaves native selected: journal reconciliation must inspect it,
    # never automatically replay the handoff or restore a competing sampler.
    flock -w 18 9
fi
'''.encode()
    return {'telemetry-unit.service': unit.encode(), 'telemetry-boot.sh': boot,
            'telemetry-handoff.sh': handoff}


def prepare(binary):
    """Return review payloads only; the installer publishes them atomically."""
    from .installer import validate_native_binary
    validate_native_binary(binary)
    sources = {str(path.relative_to(REPO)): sha(path.read_bytes()) for path in
               [*sorted(SOURCE.glob('*.[ch]')), SOURCE/'collector.service.in',
                SOURCE/'build.sh', SOURCE/'tv-libraries.json', Path(__file__),
                REPO/'research/qn90a-telemetry-startup/service/Program.cs']}
    # Code and template changes get a new immutable directory even if the owner
    # supplied the same ELF. This is provenance, not proof the ELF matches source.
    version = sha((sha(binary)+repr(sorted(sources.items()))).encode())
    files = {'telemetry-collector': binary, **render(version, sha(binary))}
    p = layout(version)
    metadata = {'schema': 1, 'device': 'qn90a', 'version': version,
                'binary_matches_checkout': None, 'source_sha256': sources,
                'unit': UNIT+'.service', 'runtime': RUNTIME, 'package_label': LABEL,
                'handoff_sha256': sha(files['telemetry-handoff.sh']),
                'bootstrap': {'path': p['boot'], 'sha256': sha(files['telemetry-boot.sh'])},
                'remote_files': {'telemetry-collector': p['binary'], 'telemetry-boot.sh': p['boot'],
                                 'telemetry-handoff.sh': p['handoff'], 'telemetry-unit.service': p['unit']},
                'managed_marker': DATA+'/enabled', 'native_marker': DATA+'/native-enabled',
                'inspector_available': False, 'inspector_status': 'retired', 'managed_settings_adapter_retained': True,
                'deployment_available': True, 'journaled_installation': True}
    return files, metadata


def adapter_from_ledger(ledger):
    """Require the existing signed setup flow to have installed this adapter."""
    from .planner import component_revision
    expected = {'/opt/usr/apps/MiniTelemetry/bin/'+name for name in profile('qn90a')['service_artifacts']}
    revision = component_revision('service')
    if not ledger or any(ledger.get('artifact_sources', {}).get(path) != revision for path in expected):
        raise Refused('Install the current signed telemetry adapter through web setup first; no package upgrade is performed by native setup')
    return {path: digest(ledger.get('files', {}).get(path)) for path in sorted(expected)}


def capture_bundle(bundle, manifest, ledger):
    """Validate all telemetry inputs, including generated code, before connection."""
    from .native_hook import read_bounded
    names = {name for name in manifest.get('files', {}) if name.startswith('telemetry-')}
    if not names and 'native_telemetry' not in manifest:
        return {}, None
    if 'telemetry-collector' not in names:
        raise Refused('Incomplete native telemetry bundle')
    binary = read_bounded(bundle/'telemetry-collector', 32*1024*1024)
    files, metadata = prepare(binary)
    if names != set(files) or manifest.get('native_telemetry') != metadata:
        raise Refused('Native telemetry bundle differs from this checkout; prepare it again')
    for name, data in files.items():
        entry = manifest['files'][name]
        if entry != {'sha256': sha(data), 'bytes': len(data)} or read_bounded(bundle/name, 32*1024*1024) != data:
            raise Refused('Native telemetry payload changed')
    metadata = {**metadata, 'adapter': adapter_from_ledger(ledger)}
    remote = {metadata['remote_files'][name]: data for name, data in files.items()}
    remote[layout(metadata['version'])['admission']] = b'enabled\n'
    return remote, metadata
