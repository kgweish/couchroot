"""Small, offline prerequisite checks shared by the installer and CI."""
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys

from .common import REPO

COMPONENTS = ('prepare', 'web', 'offline', 'managed', 'setup')


def tool_check(name, executable=None):
    return dict(name=name, available=shutil.which(executable or name) is not None)


def checks(component):
    if component not in COMPONENTS:
        raise ValueError('Unknown dependency component: ' + component)
    result = [dict(name='Python 3.12+', available=sys.version_info >= (3, 12)),
              dict(name='macOS or Linux', available=platform.system() in ('Darwin', 'Linux'))]
    if component == 'web':
        result += [tool_check('node'), tool_check('npm')]
        if result[-2]['available']:
            try:
                version = subprocess.run(['node', '--version'], capture_output=True, text=True,
                                         check=True, timeout=20).stdout.strip()
                supported = int(version.lstrip('v').split('.')[0]) >= 20
            except (OSError, ValueError, subprocess.SubprocessError):
                supported = False
            result.append(dict(name='Node.js 20+', available=supported))
    if component in ('offline', 'setup'):
        try:
            installed = importlib.metadata.version('lxml') == '6.1.1'
        except importlib.metadata.PackageNotFoundError:
            installed = False
        result.append(dict(name='lxml 6.1.1', available=installed))
        result += [tool_check(name) for name in ('git', 'openssl', 'ssh', 'scp')]
    if component in ('managed', 'setup'):
        expected = json.loads((REPO / 'global.json').read_text())['sdk']['version']
        available = False
        if shutil.which('dotnet'):
            try:
                version = subprocess.run(['dotnet', '--version'], cwd=REPO, capture_output=True,
                                         text=True, check=True, timeout=20).stdout.strip()
                available = version == expected
            except (OSError, subprocess.SubprocessError):
                pass
        result.append(dict(name='.NET SDK ' + expected, available=available))
    if component == 'managed':
        result.append(tool_check('git'))
        result.append(tool_check('C compiler (relay harness)', os.environ.get('CC', 'cc')))
    return result
