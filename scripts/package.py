#!/usr/bin/env python3
"""Create an explicitly unsigned source package; never installs on the TV."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parents[1]
web = root / 'web'
files = ['index.html', 'style.css', 'bridge.js', 'presentation.js', 'model.js', 'feedback.js', 'hub.js', 'config.xml', 'icon.png', 'tvos.js', 'tvos.css', 'streaming-artwork.js']
files += ['logos/'+p.name for p in sorted((web/'logos').iterdir()) if p.suffix in ('.svg','.png','.jpg')]
ET.parse(web / 'config.xml')
out = root / 'dist'
out.mkdir(exist_ok=True)
package = out / 'MinimalHub-unsigned.wgt'
with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        info = zipfile.ZipInfo(name, (2026, 9, 19, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (web / name).read_bytes())
manifest = {'package': package.name, 'signed': False,
            'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
            'bytes': package.stat().st_size,
            'files': {name: hashlib.sha256((web / name).read_bytes()).hexdigest() for name in files}}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'{package}\nUnsigned; requires a Samsung TV developer signing profile before installation.')
