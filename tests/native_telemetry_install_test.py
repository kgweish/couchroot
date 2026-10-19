"""Journal fault injection with the shared Engine; no device transport."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch, Mock

from native_install_test import MemoryIO, fixture, BASELINE, HOOK
from installer_test import elf
from tvsetup import native_cli, installer, native_telemetry as telemetry
from tvsetup.common import Refused, atomic_json, read_json, sha
from tvsetup.native_install import capture, engine_for, RemoteIO
from tvsetup.native_telemetry_io import EMPTY
from tvsetup.planner import component_revision


def bundle_fixture(root):
    bundle, baseline = fixture(root)
    files, metadata = telemetry.prepare(elf())
    manifest = read_json(bundle/'manifest.json')
    for name, data in files.items():
        (bundle/name).write_bytes(data)
        manifest['files'][name] = {'sha256':sha(data), 'bytes':len(data)}
    manifest['native_telemetry'] = metadata
    atomic_json(bundle/'manifest.json', manifest)
    adapter = {'/opt/usr/apps/MiniTelemetry/bin/'+name: ('adapter-'+name).encode()
               for name in telemetry.profile('qn90a')['service_artifacts']}
    ledger = {'files':{p:sha(data) for p,data in adapter.items()},
              'artifact_sources':{p:component_revision('service') for p in adapter}}
    return bundle, baseline, ledger, adapter


class TelemetryMemoryIO(MemoryIO):
    def __init__(self, adapter):
        super().__init__()
        self.files.update(adapter)
        self.files.update({telemetry.DATA+'/enabled':b'', telemetry.DATA+'/config.json':b'private pairing',
                           telemetry.DATA+'/preferences.json':b'disabled preferences'})
        self.running = False
        self.admitted = False
        self.owner = None
        self.fault = None
        self.stage_failure = None

    def fail(self, name):
        if self.fault == name:raise Refused('lost reply: '+name)

    def telemetry_state(self, t):
        result = self.hashes([t['managed_marker'], t['native_marker']])
        if list(result.values()) not in ([EMPTY,None], [None,EMPTY]):raise Refused('invalid markers')
        return result

    def telemetry_preflight(self, t, retry=False):
        self.guards(t['adapter'])
        if self.telemetry_state(t)[t['native_marker']] or self.running or self.admitted:raise Refused('already selected')

    def stage_telemetry(self, run, t, payloads):
        if self.owner not in (None,run):raise Refused('foreign staging')
        self.owner = run
        for index,(path,data) in enumerate(sorted(payloads.items())):
            if path in self.files and self.files[path] != data:raise Refused('payload drift')
            self.files[path] = data
            if self.stage_failure == index:raise Refused('lost stage reply')
        self.events.append('telemetry-stage')

    def verify_telemetry_payloads(self, t, files):
        self.guards(files);self.guards(t['adapter'])

    def telemetry_handoff(self, run, t, direction):
        self.fail('before-'+direction)
        if direction == 'native':before,after=t['managed_marker'],t['native_marker']
        else:
            if self.running:raise Refused('lease busy')
            before,after=t['native_marker'],t['managed_marker']
        self.guards({before:EMPTY,after:None})
        self.files[after] = self.files.pop(before)
        self.events.append(direction)
        self.fail('after-'+direction)

    def start_telemetry(self, t):
        self.fail('before-start')
        if self.admitted:raise Refused('already admitted')
        self.admitted = True;self.running = True
        self.events.append('collector-start')
        self.fail('after-start')

    def telemetry_verify(self, run, t):
        if self.telemetry_state(t)[t['managed_marker']] is not None or not self.running:raise Refused('collector not active')

    def rollback_telemetry(self, run, t):
        self.files.pop(telemetry.layout(t['version'])['admission'], None)
        self.events.append('revoke')
        self.fail('before-stop')
        self.running = False;self.events.append('collector-stop')
        self.fail('after-stop')
        if self.telemetry_state(t)[t['native_marker']] is not None:
            self.telemetry_handoff(run,t,'managed')

    def telemetry_restored(self, t):
        self.guards({t['managed_marker']:EMPTY,t['native_marker']:None,
                     telemetry.layout(t['version'])['admission']:None})
        if self.running:raise Refused('collector still active')


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle,self.baseline,self.ledger,adapter = bundle_fixture(self.root)
        self.folder = self.root/'state/runs/telemetry-run'
        self.info = capture(self.folder,self.bundle,self.baseline,ledger=self.ledger)
        self.io = TelemetryMemoryIO(adapter)
        self.driver,self.engine = engine_for(self.io,self.folder,self.info,'bound',self.root/'state')
        atomic_json(self.root/'state/qn90a-ledger.json',self.ledger)

    def start(self):
        self.driver.preflight()
        self.engine.prepare(self.driver.proposal(),self.driver.snapshot())
        self.engine.apply();self.engine.finalize()

    def reload(self):
        doc = read_json(self.engine.path)
        self.driver,self.engine = engine_for(self.io,self.folder,doc['actions'][0]['info'],'bound',self.root/'state')
        self.engine.load()

    def test_stale_adapter_ledger_and_modified_bundle_refuse_before_capture(self):
        bad_ledger = {**self.ledger, 'artifact_sources':{}}
        for ledger in (None, bad_ledger):
            with self.assertRaisesRegex(Refused, 'current signed telemetry adapter'):
                capture(self.root/'rejected', self.bundle, self.baseline, ledger=ledger)
            self.assertFalse((self.root/'rejected').exists())
        path = self.bundle/'telemetry-handoff.sh'
        path.write_bytes(path.read_bytes()+b'# modified\n')
        with self.assertRaisesRegex(Refused, 'payload changed'):
            capture(self.root/'rejected', self.bundle, self.baseline, ledger=self.ledger)
        self.assertFalse((self.root/'rejected').exists())

    def test_ordered_install_and_reverse_recovery_preserve_private_state(self):
        self.start()
        self.assertEqual(len(self.engine.doc['actions']),2)
        self.assertLess(self.io.events.index('native'),self.io.events.index('switch'))
        self.engine.rollback()
        for first,second in [('restore','revoke'),('revoke','collector-stop'),('collector-stop','managed')]:
            self.assertLess(self.io.events.index(first),self.io.events.index(second))
        self.assertEqual(self.engine.doc['phase'],'rolled-back')
        self.assertEqual(read_json(self.root/'state/qn90a-ledger.json'),self.ledger)
        self.assertEqual(self.io.files[telemetry.DATA+'/config.json'],b'private pairing')
        self.assertEqual(self.io.files[telemetry.DATA+'/preferences.json'],b'disabled preferences')

    def test_every_staging_interruption_requires_explicit_retry(self):
        paths = set(self.info['payload_paths'])-self.driver.launcher_paths
        for index in range(len(paths)):
            with self.subTest(index=index):
                self.io.stage_failure=index
                with self.assertRaises(Refused):self.engine.start(self.driver.proposal(),self.driver.snapshot())
                self.assertEqual(self.io.files[HOOK],BASELINE)
                with self.assertRaisesRegex(Refused,'retry-unchanged'):self.engine.reconcile()
                self.io.stage_failure=None;self.engine.reconcile(True);self.engine.apply()
                self.engine.rollback()
                # Next subcase uses a fresh in-memory device, preserving local fixtures.
                adapter={p:('adapter-'+p.rsplit('/',1)[1]).encode() for p in self.ledger['files']}
                self.io=TelemetryMemoryIO(adapter);self.driver.io=self.io

    def test_lost_start_reply_reconciles_without_second_handoff_or_start(self):
        self.io.fault='after-start'
        with self.assertRaises(Refused):self.start()
        self.io.fault=None;self.reload();self.engine.reconcile();self.engine.apply();self.engine.finalize()
        self.assertEqual(self.io.events.count('native'),1)
        self.assertEqual(self.io.events.count('collector-start'),1)

    def test_lost_handoff_reply_does_not_blindly_start_sampler(self):
        self.io.fault='after-native'
        with self.assertRaises(Refused):self.start()
        self.io.fault=None;self.reload()
        with self.assertRaises(Refused):self.engine.reconcile(True)
        self.engine.rollback()
        self.assertNotIn('collector-start',self.io.events)
        self.assertEqual(self.io.files[HOOK],BASELINE)
        self.assertEqual(self.engine.doc['phase'],'rolled-back')

    def test_uncertain_rollback_can_finish_after_each_inverse_boundary(self):
        for fault in ('before-stop','after-stop','after-managed'):
            with self.subTest(fault=fault):
                self.start();self.io.fault=fault
                with self.assertRaises(Refused):self.engine.rollback()
                self.assertEqual(self.io.files[HOOK],BASELINE)
                self.io.fault=None;self.reload();self.engine.rollback()
                self.assertEqual(self.engine.doc['phase'],'rolled-back')
                adapter={p:('adapter-'+p.rsplit('/',1)[1]).encode() for p in self.ledger['files']}
                self.io=TelemetryMemoryIO(adapter);self.driver.io=self.io

    def test_drift_blocks_reconcile_but_intact_handoff_still_recovers(self):
        self.io.lose_switch_reply=True
        with self.assertRaises(Refused):self.start()
        self.io.lose_switch_reply=False
        binary=telemetry.layout(self.info['telemetry']['version'])['binary']
        self.io.files[binary]=b'corrupted'
        with self.assertRaises(Refused):self.engine.reconcile()
        self.engine.rollback()
        self.assertEqual(self.io.files[HOOK],BASELINE)
        self.assertFalse(self.io.running)

    def test_hook_drift_blocks_sampler_recovery_until_known_chain_restored(self):
        self.start();self.io.files[HOOK]=b'foreign edit'
        with self.assertRaises(Refused):self.engine.rollback()
        self.assertTrue(self.io.running)
        self.assertNotIn('revoke',self.io.events)

    def test_recovery_uses_captured_inputs_after_bundle_and_ledger_deleted(self):
        self.start();shutil.rmtree(self.bundle);self.baseline.unlink()
        self.reload();self.engine.rollback();self.driver.verify_restored()
        self.assertFalse(self.io.running)

    def test_malformed_markers_and_adapter_drift_refuse_before_staging(self):
        self.io.files[telemetry.DATA+'/native-enabled']=b''
        with self.assertRaises(Refused):self.start()
        del self.io.files[telemetry.DATA+'/native-enabled']
        self.io.files[next(iter(self.ledger['files']))]=b'stale'
        with self.assertRaises(Refused):self.start()
        self.assertNotIn('telemetry-stage',self.io.events)

    def test_cli_captures_two_actions_and_verifies_recovery_without_original_inputs(self):
        state=self.root/'cli-state';atomic_json(state/'qn90a-ledger.json',self.ledger)
        common=['--device','qn90a','--launcher','native','--json']
        def invoke(args):
            output=io.StringIO()
            with contextlib.redirect_stdout(output),contextlib.redirect_stderr(io.StringIO()):code=installer.main(args)
            self.assertEqual(code,0,output.getvalue())
            return json.loads(output.getvalue())
        with patch.object(native_cli,'STATE',state),patch.object(native_cli,'load_site',return_value={}),patch.object(native_cli,'configured_profile',return_value={}),patch.object(native_cli,'agent_binding',return_value='bound'),patch.object(native_cli,'connect',return_value=self.io) as connect:
            result=invoke(['apply',*common,'--yes','--agent','unused','--bundle',str(self.bundle),'--hook-config',str(self.baseline)])
            self.assertTrue(result['native_telemetry']);run=result['run']
            shutil.rmtree(self.bundle);self.baseline.unlink();connect.reset_mock()
            invoke(['status',*common,'--run',run]);connect.assert_not_called()
            invoke(['verify',*common,'--agent','unused','--run',run])
            invoke(['rollback',*common,'--yes','--agent','unused','--run',run])
            self.assertEqual(invoke(['verify',*common,'--agent','unused','--run',run])['configuration'],'baseline-restored')


class RemoteContractTests(unittest.TestCase):
    def test_stop_is_version_bound_and_admission_is_revoked_before_stop(self):
        _,metadata=telemetry.prepare(elf());metadata['adapter']={}
        tv=Mock();remote=RemoteIO(tv)
        with patch.object(remote,'telemetry_state',return_value={metadata['native_marker']:None}):
            remote.rollback_telemetry('review-run',metadata)
        script=tv.root.call_args.args[0];p=telemetry.layout(metadata['version'])
        self.assertLess(script.index('flock -w 5'),script.index('rm '+p['admission']))
        self.assertLess(script.index('rm '+p['admission']),script.index('systemctl stop'))
        self.assertIn('path='+p['binary']+' ;',script)
        self.assertNotIn('pkill',script);self.assertNotIn('reset-failed',script)

    def test_managed_marker_write_guard_refuses_native_selection(self):
        import subprocess
        from tvsetup.telemetry import service_ready
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            script=service_ready(telemetry.profile('qn90a')).replace(telemetry.DATA,str(root))
            self.assertEqual(subprocess.run(['/bin/sh'],input=script,text=True).returncode,0)
            (root/'native-enabled').touch()
            self.assertNotEqual(subprocess.run(['/bin/sh'],input=script,text=True).returncode,0)
            (root/'native-enabled').unlink();(root/'native-enabled').symlink_to(root/'absent')
            self.assertNotEqual(subprocess.run(['/bin/sh'],input=script,text=True).returncode,0)

    def test_handoff_runs_as_package_with_bounded_lifetime_and_no_secret_read(self):
        _,metadata=telemetry.prepare(elf());tv=Mock();remote=RemoteIO(tv)
        remote.telemetry_handoff('review-run',metadata,'managed')
        script=tv.root.call_args.args[0]
        for value in ('User=5001','Group=100','SmackProcessLabel=User::Pkg::MiniTelemetry','TimeoutStartSec=22s','RemainAfterExit=yes','ExecMainStatus'):
            self.assertIn(value,script)
        self.assertNotIn('config.json',script);self.assertNotIn('preferences.json',script)


class LocalShellTests(unittest.TestCase):
    def test_preflight_checks_staging_paths_without_hashing_or_mutation(self):
        from native_install_test import SandboxTV
        for kind in ('absent', 'directory', 'file', 'dangling-link', 'directory-link', 'parent-file', 'parent-link'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();sandbox=SandboxTV(root)
                _,metadata=telemetry.prepare(elf());metadata['adapter']={}
                base=sandbox.path(telemetry.layout(metadata['version'])['base'])
                base.parent.mkdir(parents=True)
                target=root/'retained';target.mkdir();(target/'evidence').write_bytes(b'keep')
                if kind == 'directory':base.mkdir();(base/'owner').write_bytes(b'original-run\n')
                elif kind == 'file':base.write_bytes(b'keep')
                elif kind == 'dangling-link':base.symlink_to(root/'missing')
                elif kind == 'directory-link':base.symlink_to(target)
                elif kind == 'parent-file':base.parent.rmdir();base.parent.write_bytes(b'keep')
                elif kind == 'parent-link':base.parent.rmdir();base.parent.symlink_to(target)
                def contents():
                    return {str(p.relative_to(root)): ('link',str(p.readlink())) if p.is_symlink()
                            else ('file',p.read_bytes()) if p.is_file() else ('directory',None)
                            for p in root.rglob('*')}
                before=contents();unit_checks=[]
                def root_command(script):
                    if 'systemctl' in script:
                        unit_checks.append(script);return ''  # No host service-manager access.
                    return sandbox.root_command(script)
                tv=Mock();tv.root.side_effect=root_command
                tv.snapshot.return_value={'packages':[['MiniTelemetry','MiniTelemetry.Start','tpk','1',
                                                       'true','false','false','false']]}
                remote=RemoteIO(tv)
                with patch.object(remote,'telemetry_state',return_value={metadata['native_marker']:None}), \
                     patch.object(remote,'hashes',side_effect=AssertionError('directory must not be hashed')):
                    if kind == 'absent':remote.telemetry_preflight(metadata)
                    else:
                        message='original run' if not kind.startswith('parent-') else 'sandbox shell refused'
                        with self.assertRaisesRegex(Refused,message):remote.telemetry_preflight(metadata)
                    self.assertEqual(len(unit_checks),1 if kind == 'absent' else 0)
                    if kind == 'directory':
                        remote.telemetry_preflight(metadata,retry=True)
                        self.assertEqual(len(unit_checks),1)
                self.assertEqual(contents(),before)
                tv._upload.assert_not_called()

    def test_handoff_observes_queued_jobs_and_retries_only_failed_recovery(self):
        import os
        import subprocess
        from tvsetup.native_telemetry_io import handoff_unit
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();commands=root/'commands';commands.mkdir()
            files,metadata=telemetry.prepare(elf());p=telemetry.layout(metadata['version'])
            handoff=root/'handoff.sh';handoff.write_bytes(files['telemetry-handoff.sh'])
            state=root/'state';events=root/'events'
            scripts={
                'systemctl': '''if test "$1" = start; then
    echo start >> "$EVENTS"; echo exited > "$STATE"; exit 0
fi
current=$(cat "$STATE")
case "$4" in
LoadState) if test "$current" = absent; then echo not-found; exit 1; else echo loaded; fi;;
Description) echo "$DESCRIPTION";;
ExecStart) echo "$EXEC_START";;
User) echo 5001;; Group) echo 100;; SmackProcessLabel) echo User::Pkg::MiniTelemetry;;
MainPID) echo "$MAIN_PID";;
ActiveState) case "$current" in failed) echo failed;; exited) echo active;; *) echo inactive;; esac;;
SubState) if test "$current" = exited; then echo exited; else echo dead; fi;;
Result) if test "$current" = failed; then echo timeout; else echo success; fi;;
ExecMainStatus) echo 0;;
esac''',
                'systemd-run':'echo submit >> "$EVENTS"; echo "$SUBMIT_STATE" > "$STATE"',
                'sleep':'echo wait >> "$EVENTS"; echo "$NEXT_STATE" > "$STATE"',
            }
            if not shutil.which('sha256sum'):scripts['sha256sum']='exec shasum -a 256 "$@"'
            for name,body in scripts.items():
                path=commands/name;path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o755)
            def root_command(script):
                result=subprocess.run(['/bin/sh'],input=script.replace(p['handoff'],str(handoff)),
                                      text=True,env=env,capture_output=True,timeout=5)
                if result.returncode:raise Refused('sandbox refusal')
                return result.stdout
            remote=RemoteIO(type('TV',(),{'root':staticmethod(root_command)})())
            cases=[
                # New and previously submitted queued jobs must be observed.
                ('native','absent','queued','exited','0',False,True,['submit','wait']),
                ('native','queued','queued','exited','0',False,True,['wait']),
                # A fresh failure is left for a later explicit recovery call.
                ('managed','absent','failed','exited','0',False,False,['submit']),
                ('managed','failed','queued','exited','0',False,True,['start']),
                ('managed','exited','queued','exited','0',False,True,[]),
                ('native','failed','queued','exited','0',False,False,[]),
                # Foreign or unsettled helpers never authorize a retry.
                ('managed','failed','queued','exited','42',False,False,[]),
                ('managed','failed','queued','exited','0',True,False,[]),
                ('managed','queued','queued','failed','0',False,False,['wait']),
                ('managed','queued','queued','queued','0',False,False,['wait']*22),
            ]
            for direction,initial,submitted,next_state,pid,foreign,success,expected in cases:
                with self.subTest(direction=direction,initial=initial,submitted=submitted,next_state=next_state,pid=pid,foreign=foreign):
                    state.write_text(initial);events.write_text('')
                    unit=handoff_unit('shell-run',direction)
                    env={**os.environ,'PATH':str(commands)+os.pathsep+os.environ['PATH'],
                         'STATE':str(state),'EVENTS':str(events),'MAIN_PID':pid,
                         'SUBMIT_STATE':submitted,'NEXT_STATE':next_state,
                         'DESCRIPTION':'foreign' if foreign else unit.removesuffix('.service'),
                         'EXEC_START':f'{{ path={handoff} ; argv[]={handoff} {direction} ; }}'}
                    if success:remote.telemetry_handoff('shell-run',metadata,direction)
                    else:
                        with self.assertRaises(Refused):remote.telemetry_handoff('shell-run',metadata,direction)
                    self.assertEqual(events.read_text().splitlines(),expected)

    def test_stage_and_metadata_verification_use_actual_temporary_files(self):
        import native_install_test as fixtures
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();tv=fixtures.SandboxTV(root);(root/'opt').mkdir()
            # Simulate only the TV's ownership and label APIs, like the launcher
            # shell harness. Copy, upload, hashing and path checks are real.
            (root/'commands/chsmack').write_text('#!/bin/sh\nif test "$1" = -a; then exit 0; fi\ncase "$1" in */boot.sh) echo \'access="User"\';; *) echo \'access="User::Pkg::MiniTelemetry"\';; esac\n')
            adapter=type('Adapter',(),{'root':staticmethod(tv.root_command),'_upload':staticmethod(tv._upload)})()
            remote=RemoteIO(adapter)
            files,metadata=telemetry.prepare(elf());metadata['adapter']={}
            payloads={metadata['remote_files'][name]:data for name,data in files.items()}
            p=telemetry.layout(metadata['version']);payloads[p['admission']]=b'enabled\n'
            remote.stage_telemetry('shell-run',metadata,payloads)
            remote.verify_telemetry_payloads(metadata,{p:sha(v) for p,v in payloads.items()})
            uploads=tv.uploads
            remote.stage_telemetry('shell-run',metadata,payloads)
            self.assertEqual(tv.uploads,uploads)
            with self.assertRaises(Refused):remote.stage_telemetry('another-run',metadata,payloads)
            tv.path(p['binary']).chmod(0o755);tv.path(p['binary']).write_bytes(b'foreign')
            with self.assertRaises(Refused):remote.stage_telemetry('shell-run',metadata,payloads)
            self.assertEqual(tv.path(p['binary']).read_bytes(),b'foreign')

    def test_recovery_shell_refuses_foreign_unit_and_stops_only_owned_version(self):
        import os
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();commands=root/'commands';commands.mkdir();(root/'run').mkdir()
            _,metadata=telemetry.prepare(elf());p=telemetry.layout(metadata['version'])
            base=root/p['base'].lstrip('/');base.mkdir(parents=True)
            (base/'owner').write_bytes(b'shell-run\n');(base/'admitted').write_bytes(b'enabled\n')
            event=root/'events'
            scripts={
                'stat':'echo 0:0:600:1', 'flock':'exit 0',
                'systemctl': '''if test "$1" = stop; then echo "$2" >> "$EVENTS"; exit 0; fi
case "$2" in *-native.service) echo not-found; exit 0;; esac
case "$4" in
LoadState) echo loaded;;
Description) echo "$DESCRIPTION";;
ExecStart) echo "$EXEC_START";;
User) echo 5001;; Group) echo 100;; SmackProcessLabel) echo User::Pkg::MiniTelemetry;; MainPID) echo 0;;
esac'''}
            if not shutil.which('sha256sum'):scripts['sha256sum']='exec shasum -a 256 "$@"'
            for name,body in scripts.items():
                path=commands/name;path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o755)
            def root_command(script):
                script=script.replace('/opt/',str(root/'opt')+'/').replace('/run/',str(root/'run')+'/')
                result=subprocess.run(['/bin/sh'],input=script,text=True,env=env,capture_output=True,timeout=5)
                if result.returncode:raise Refused('sandbox refusal')
                return result.stdout
            env={**os.environ,'PATH':str(commands)+os.pathsep+os.environ['PATH'],'EVENTS':str(event),
                 'DESCRIPTION':'foreign','EXEC_START':f"{{ path={base}/collector ; argv[]={base}/collector --root {root}/opt/usr/home/owner/apps_rw/MiniTelemetry/data --runtime {telemetry.RUNTIME} --native-handoff ; }}"}
            remote=RemoteIO(type('TV',(),{'root':staticmethod(root_command)})())
            with patch.object(remote,'telemetry_state',return_value={metadata['native_marker']:None}):
                with self.assertRaises(Refused):remote.rollback_telemetry('shell-run',metadata)
                self.assertFalse(event.exists())
                self.assertFalse((base/'admitted').exists())
                env['DESCRIPTION']=telemetry.UNIT+'-'+metadata['version']
                remote.rollback_telemetry('shell-run',metadata)
                self.assertEqual(event.read_text(),telemetry.UNIT+'.service\n')


if __name__=='__main__':unittest.main()
