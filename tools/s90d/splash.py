#!/usr/bin/env python3
"""S90D boot recovery entry point. Legacy splash-only apply/rollback is retired."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tvsetup.s90d_recovery import main

if __name__ == '__main__':
    raise SystemExit(main())
