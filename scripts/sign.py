#!/usr/bin/env python3
"""Sign a private staged copy using an existing TV-specific certificate profile."""
import argparse
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', choices=['MinimalHub', 'MinimalHubQN90A'], default='MinimalHub')
parser.add_argument('--device-id', help='Configured telemetry device ID; defaults to the signing profile')
parser.add_argument('--boot-trace', action='store_true', help='Include bounded boot timing instrumentation')
parser.add_argument('--boot-trace-ms', type=int, default=120000, choices=[5000, 120000])
args = parser.parse_args()
import re
if args.device_id and not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}', args.device_id):
    parser.error('Invalid device ID')
os.umask(0o077)
root = Path(__file__).resolve().parents[1]
private = Path.home() / '.local/share/samsung-tv-research'
cli = private / 'tizen-sdk/cli/tools/ide/bin/tizen'
output = private / 'signing/builds'
output.mkdir(parents=True, exist_ok=True, mode=0o700)
build = Path(tempfile.mkdtemp(prefix='hub-', dir=output))
source = build / 'web'
source.mkdir()
for name in ('index.html', 'style.css', 'bridge.js', 'presentation.js', 'model.js', 'feedback.js', 'hub.js', 'config.xml', 'icon.png', 'tvos.js', 'tvos.css', 'streaming-artwork.js'):
    shutil.copyfile(root / 'web' / name, source / name)
(source / 'logos').mkdir()
for image in (root / 'web/logos').iterdir():
    if image.suffix in ('.svg','.png','.jpg'): shutil.copyfile(image, source / 'logos' / image.name)
# Compatibility adapter for the existing S90D/QN90A signing profiles.
for name in ('telemetry.js', 'telemetry-service.js'):
    shutil.copyfile(root / 'research/s90d-telemetry/legacy-hub' / name, source / name)
(source / 'telemetry.js').write_text('window.HUB_DEVICE_ID = '+json.dumps(args.device_id or ('qn90a' if args.profile == 'MinimalHubQN90A' else 's90d'))+';\n'+(source / 'telemetry.js').read_text())
if args.boot_trace:
    trace = (root / 'research/s90d-boot-inventory/dashboard-trace.js').read_text()
    (source / 'boot-trace.js').write_text('window.HUB_BOOT_TRACE_MS = ' + str(args.boot_trace_ms) + ';\n' + trace)
    index = source / 'index.html'
    index.write_text(index.read_text().replace('<title>', '<script src="boot-trace.js"></script>\n  <title>', 1))
    config = source / 'config.xml'
    config.write_text(config.read_text().replace('version="0.3.9"', 'version="0.3.10"'))
index = source / 'index.html'
index.write_text(index.read_text().replace('</head>', '  <script src="telemetry.js" defer></script>\n  <script src="telemetry-service.js" defer></script>\n</head>'))
if args.profile == 'MinimalHubQN90A':
    # QN90A-only policy. The other TV's staged package remains unchanged.
    shutil.copyfile(root / 'research/qn90a-screensaver/hub-idle.js', source / 'qn90a-idle.js')
    index = source / 'index.html'
    index.write_text(index.read_text().replace('</head>', '  <script src="qn90a-idle.js" defer></script>\n</head>'))
    import xml.etree.ElementTree as ET
    config = source / 'config.xml'
    version = ET.fromstring(config.read_text()).attrib['version']
    if tuple(map(int, version.split('.'))) < (0, 4, 0):
        config.write_text(config.read_text().replace('version="' + version + '"', 'version="0.4.0"'))
with (build / 'sign.log').open('w') as log:
    subprocess.run([str(cli), 'package', '-t', 'wgt', '-s', args.profile,
                    '-o', str(build), '--', str(source)],
                   stdout=log, stderr=subprocess.STDOUT, check=True)
# The TV installer failed with a space in the original artifact's filename.
original = build / 'Minimal Hub.wgt'
package = build / 'MinimalHub.wgt'
original.rename(package)
manifest = {'package': package.name, 'signed': True, 'profile': args.profile,
            'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
            'bytes': package.stat().st_size, 'boot_trace': args.boot_trace}
(build / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(package)
