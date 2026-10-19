"""Run generated rescue shell against a fake systemd in a disposable container."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

from tvsetup import native_rescue as rescue
from tvsetup.common import sha


SYSTEMD = r'''
import json,sys
from pathlib import Path
file,events=map(Path,sys.argv[1:3]);kind=sys.argv[3];args=sys.argv[4:]
state=json.loads(file.read_text())
with events.open('a') as out:out.write(json.dumps([kind,*args])+'\n')
if kind=='run':
 assert '-p' in args and 'PrivateMounts=yes' in args and 'RemainAfterExit=yes' in args
 assert '--on-active=300s' in args and 'SmackProcessLabel=System' in args
 assert any(x.startswith('BindReadOnlyPaths=/opt/couchroot-native-recovery/') for x in args)
 state.update(loaded=True,timer='active',start='0',pid='0',active='inactive',remain='yes',
              description=next(x.split('=',1)[1] for x in args if x.startswith('--description=')),argv=args)
elif args[0]=='show':
 prop=args[args.index('-p')+1];timer=args[-1].endswith('.timer')
 values=dict(LoadState='loaded' if state.get('loaded') else 'not-found',
             ActiveState=state.get('timer','inactive') if timer else state.get('active','inactive'),
             ExecMainStartTimestampMonotonic=state.get('start','0'),MainPID=state.get('pid','0'),
             Description=state.get('description',''),RemainAfterExit=state.get('remain',''),Job=state.get('job',''))
 if prop!='Job' or values[prop] or '--all' in args:print(prop+'='+values[prop])
elif args[0]=='stop':
 assert args[-1].endswith('.timer'), 'Must not kill a rescue service that may be firing'
 state['timer']='inactive'
 if state.get('race'):state.update(start='123',pid='0',active='active')
 if state.get('queued'):state['job']='42'
else:raise AssertionError(args)
file.write_text(json.dumps(state))
'''


@unittest.skipUnless(sys.platform == 'linux' and os.getuid() == 0 and
                     os.environ.get('COUCHROOT_PARITY_CONTAINER') == '1',
                     'Explicit disposable Linux root container required')
class NativeRescueShellTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name); self.state = self.work/'state.json'; self.events = self.work/'events'
        self.state.write_text('{}'); self.stub = self.work/'systemd.py'; self.stub.write_text(SYSTEMD)
        self.base = Path('/opt/couchroot-native-recovery'); self.base.mkdir(exist_ok=True, mode=0o700)
        self.scope = self.base/uuid.uuid4().hex; self.scope.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, self.scope)
        self.code = self.scope/'code'; self.code.mkdir(mode=0o700)
        self.binary = self.code/'sdk-host-recovery'; self.binary.write_bytes(b'ordinary-code'); self.binary.chmod(0o500)
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.plan = rescue.plan('qn90a', boot, str(self.code), sha(self.binary.read_bytes()),
                                '127.0.0.1', '192.0.2.30')
        call = ' '.join(shlex.quote(str(p)) for p in (sys.executable, self.stub, self.state, self.events))
        self.prefix = ('systemctl() { '+call+' ctl "$@"; }\n'
                       'systemd-run() { '+call+' run "$@"; }\n'
                       'uname() { echo armv7l; }\n'
                       'grep() { if [ "${@: -1}" = /etc/prd_info.ini ]; then [ "${BAD_FIRMWARE:-0}" = 0 ]; else /usr/bin/grep "$@"; fi; }\n'
                       'vconftool() { echo "db/sdk/develop/ip, value = ${SDK_HOST:-127.0.0.1} (String)"; }\n')

    def shell(self, action, **env):
        return subprocess.run(['/bin/bash'], input=self.prefix+rescue.commands(self.plan)[action],
                              text=True, capture_output=True, env={**os.environ, **env}, timeout=5)

    def calls(self):
        return [json.loads(x) for x in self.events.read_text().splitlines()] if self.events.exists() else []

    def test_arm_then_retire_keeps_readonly_mount_clean_binary_environment_and_no_dotnet(self):
        result = self.shell('arm'); self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(self.state.read_text()); invocation = state['argv'][-1]
        self.assertIn('/usr/bin/env -i PATH=/usr/bin:/bin', invocation)
        self.assertIn('sha256sum', invocation); self.assertIn(self.plan['boot_id'], invocation)
        self.assertNotIn('dotnet', invocation)
        self.assertIn('set 127.0.0.1 192.0.2.30 0', invocation)
        result = self.shell('retire'); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'NATIVE_RESCUE_RETIRED_UNFIRED\n')
        self.assertEqual(json.loads(self.state.read_text())['timer'], 'inactive')

    def test_wrong_boot_or_firmware_refuses_before_systemd(self):
        result = self.shell('arm', BAD_FIRMWARE='1'); self.assertNotEqual(result.returncode, 0)
        self.plan['boot_id'] = '00000000-0000-4000-8000-000000000001'
        self.assertNotEqual(self.shell('arm').returncode, 0); self.assertEqual(self.calls(), [])

    def test_changed_code_or_writable_directory_refuses_before_systemd(self):
        self.binary.write_bytes(b'changed')
        self.assertNotEqual(self.shell('arm').returncode, 0)
        self.binary.write_bytes(b'ordinary-code'); self.code.chmod(0o777)
        self.assertNotEqual(self.shell('arm').returncode, 0); self.assertEqual(self.calls(), [])

    def test_symlinked_code_refuses_before_systemd(self):
        actual = self.scope/'actual'; self.code.rename(actual); self.code.symlink_to(actual)
        self.assertNotEqual(self.shell('arm').returncode, 0); self.assertEqual(self.calls(), [])

    def test_existing_unit_or_setting_drift_never_submits(self):
        self.state.write_text(json.dumps(dict(loaded=True)))
        self.assertNotEqual(self.shell('arm').returncode, 0)
        self.state.write_text('{}')
        self.assertNotEqual(self.shell('arm', SDK_HOST='192.0.2.31').returncode, 0)
        self.assertFalse(any(row[0] == 'run' for row in self.calls()))

    def test_timer_trigger_during_retirement_is_not_reported_unfired_or_killed(self):
        self.assertEqual(self.shell('arm').returncode, 0)
        state = json.loads(self.state.read_text()); state['race'] = True; self.state.write_text(json.dumps(state))
        result = self.shell('retire')
        self.assertNotEqual(result.returncode, 0); self.assertNotIn('RETIRED_UNFIRED', result.stdout)
        state = json.loads(self.state.read_text())
        self.assertEqual((state['timer'], state['active'], state['start']), ('inactive', 'active', '123'))

    def test_foreign_unit_description_cannot_be_stopped(self):
        self.assertEqual(self.shell('arm').returncode, 0)
        state = json.loads(self.state.read_text()); state['description'] = 'foreign'; self.state.write_text(json.dumps(state))
        self.assertNotEqual(self.shell('retire').returncode, 0)
        self.assertEqual(json.loads(self.state.read_text())['timer'], 'active')
        self.assertFalse(any(row[1] == 'stop' for row in self.calls() if row[0] == 'ctl'))

    def test_queued_start_during_disarm_cannot_look_unfired(self):
        self.assertEqual(self.shell('arm').returncode, 0)
        state = json.loads(self.state.read_text()); state['queued'] = True; self.state.write_text(json.dumps(state))
        result = self.shell('retire')
        self.assertNotEqual(result.returncode, 0); self.assertNotIn('RETIRED_UNFIRED', result.stdout)
        state = json.loads(self.state.read_text())
        self.assertEqual((state['job'], state['start'], state['active']), ('42', '0', 'inactive'))
