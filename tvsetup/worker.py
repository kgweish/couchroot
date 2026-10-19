"""Private subprocess boundary for the tracked, bounded root transport."""
import argparse
import json
from pathlib import Path
from .root import execute


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', type=Path)
    parser.add_argument('script', type=Path)
    parser.add_argument('cleanup_index', type=int, nargs='?')
    parser.add_argument('--native-bundle', type=Path)
    args = parser.parse_args(argv)
    execute(json.loads(args.profile.read_text()), args.script.read_text(),
            args.cleanup_index, native_bundle=args.native_bundle)


if __name__ == '__main__':
    main()
