#!/usr/bin/env python3
"""Offline host dependency check. Never contacts a TV or a NAS."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tvsetup.dependencies import COMPONENTS, checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component', choices=COMPONENTS, default='setup',
                        help='prepare: Python only; web: preview/package; offline: Python tests; '
                             'managed: C# builds/harnesses; setup: full setup (default)')
    args = parser.parse_args()
    result = checks(args.component)
    for item in result:
        print(('OK: ' if item['available'] else 'MISSING: ') + item['name'])
    if args.component == 'setup':
        print('Component tools checked separately: TIZEN/tizen, SDB/toolkit, emcc for QN90A saver, ARM compiler and private GLES library for S90D renderer.')
    print('No device, certificate enrollment or firmware validation performed.')
    return 0 if all(item['available'] for item in result) else 1


if __name__ == '__main__':
    sys.exit(main())
