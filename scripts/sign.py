#!/usr/bin/env python3
"""Sign a private staged copy using an existing TV-specific certificate profile."""
import argparse
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', choices=['MinimalHub', 'MinimalHubQN90A'], default='MinimalHub')
parser.add_argument('--site', type=Path, help='Private site config containing independently reviewed signing trust')
parser.add_argument('--device-id', help='Configured telemetry device ID; defaults to the signing profile')
parser.add_argument('--boot-trace', action='store_true', help='Include bounded boot timing instrumentation')
parser.add_argument('--boot-trace-ms', type=int, default=120000, choices=[5000, 120000])
args = parser.parse_args()
import re
if args.device_id and not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}', args.device_id):
    parser.error('Invalid device ID')
os.umask(0o077)
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from tvsetup.planner import hub_sources
from tvsetup.artifacts import next_version, require_trust, verify_package
from tvsetup.site import configured_profile, load_site
from tvsetup.common import Refused
device = 'qn90a' if args.profile == 'MinimalHubQN90A' else 's90d'
profile = configured_profile(device, load_site(args.site))
require_trust(profile)
if profile['signing_profile'] != args.profile:
    raise Refused('Requested signing profile differs from enrolled trust')
private = Path(os.environ.get('SAMSUNG_TV_TOOLKIT', Path.home() / '.local/share/samsung-tv-research')).expanduser().resolve()
cli = private / 'tizen-sdk/cli/tools/ide/bin/tizen'
output = private / 'signing/builds'
output.mkdir(parents=True, exist_ok=True, mode=0o700)
build = Path(tempfile.mkdtemp(prefix='hub-', dir=output))
source = build / 'web'
source.mkdir()
for name, data in hub_sources(device, device_id=args.device_id).items():
    (source / name).write_bytes(data)
if args.boot_trace:
    trace = (root / 'research/s90d-boot-inventory/dashboard-trace.js').read_text()
    (source / 'boot-trace.js').write_text('window.HUB_BOOT_TRACE_MS = ' + str(args.boot_trace_ms) + ';\n' + trace)
    index = source / 'index.html'
    index.write_text(index.read_text().replace('<title>', '<script src="boot-trace.js"></script>\n  <title>', 1))
    config = source / 'config.xml'
    version = ET.fromstring(config.read_bytes()).get('version')
    bumped = next_version(version, version)
    config.write_text(re.sub(r'(<widget\b[^>]*\bversion=")[^"]+', lambda m: m[1] + bumped, config.read_text(), count=1))
with (build / 'sign.log').open('w') as log:
    subprocess.run([str(cli), 'package', '-t', 'wgt', '-s', args.profile,
                    '-o', str(build), '--', str(source)],
                   stdout=log, stderr=subprocess.STDOUT, check=True)
# The TV installer failed with a space in the original artifact's filename.
original = build / 'Minimal Hub.wgt'
package = build / 'MinimalHub.wgt'
original.rename(package)
verify_package(package, profile, 'MiniHub001')
manifest = {'package': package.name, 'signed': True, 'profile': args.profile,
            'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
            'bytes': package.stat().st_size, 'boot_trace': args.boot_trace}
(build / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(package)
