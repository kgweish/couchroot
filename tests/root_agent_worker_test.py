"""Explicit managed check: python3 tests/root_agent_worker_test.py."""
from pathlib import Path
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        ['dotnet', 'run', '--project', str(root/'tests/root-agent-harness/Harness.csproj')],
        cwd=root, text=True, capture_output=True, timeout=60, check=True)
    print(result.stdout, end='')
    if 'PASS large transfer' not in result.stdout:
        raise RuntimeError('Worker harness did not report transfer success')


if __name__ == '__main__':
    main()
