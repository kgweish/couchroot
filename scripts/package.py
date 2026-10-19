#!/usr/bin/env python3
"""Create an explicitly unsigned source package; never installs on the TV."""
import argparse
import sys
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from tvsetup.planner import hub_sources
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', choices=('s90d', 'qn90a'), default='s90d')
parser.add_argument('--output-dir', type=Path, default=root / 'dist')
args = parser.parse_args()
files = hub_sources(args.device)
ET.fromstring(files['config.xml'])
out = args.output_dir
out.mkdir(parents=True, exist_ok=True)
package = out / ('MinimalHub-' + args.device + '-unsigned.wgt')
with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        info = zipfile.ZipInfo(name, (2026, 9, 19, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, files[name])
manifest = {'device': args.device, 'package': package.name, 'signed': False,
            'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
            'bytes': package.stat().st_size,
            'files': {name: hashlib.sha256(files[name]).hexdigest() for name in files}}
(out / ('manifest-' + args.device + '.json')).write_text(json.dumps(manifest, indent=2) + '\n')
print(f'{package}\nUnsigned; requires a Samsung TV developer signing profile before installation.')
