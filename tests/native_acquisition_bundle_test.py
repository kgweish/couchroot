"""Offline bundle binding and opt-in transport failure/replay boundaries."""
import json
import struct
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from tvsetup.common import Refused, sha
from tvsetup.config import profile
from tvsetup import native_root, root


class NativeBundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.folder=Path(self.tmp.name); self.bundle=self.folder/'bundle'; self.bundle.mkdir()
        self.artifacts=self.bundle/'artifacts'; self.artifacts.mkdir()
        self.out=self.folder/'out'; self.out.mkdir()
        self.profile={**profile('qn90a'),'host':'192.0.2.11','device_id':'uuid:00000000-0000-4000-8000-000000000001'}
        self.manifest=dict(schema=1,kind='native-acquisition-managed-entry',model='qn90a',
                           framework=self.profile['framework'],runtime=self.profile['runtime'],reproducible_builds=2,
                           source={n:sha((native_root.SOURCE/n).read_bytes()) for n in ('acquire.c','build.sh','NativeEntry.cs')},artifacts={})
        for name in native_root.FILES:
            data=('fixture '+name).encode(); (self.artifacts/name).write_bytes(data)
            self.manifest['artifacts'][name]=dict(sha256=sha(data),size=len(data))
        self.save()

    def save(self):
        (self.bundle/'manifest.json').write_text(json.dumps(self.manifest))

    def test_validated_bytes_are_snapshotted_with_guarded_operation(self):
        outputs=native_root.prepare(self.profile,self.bundle,self.out,'guard\necho ok\n')
        self.assertEqual(set(outputs.values()),(set(native_root.FILES)-{'libacquire.so'})|{'code/libacquire.so','operation.sh'})
        (self.artifacts/'NativeEntry.dll').write_bytes(b'changed later')
        self.assertEqual((self.out/'NativeEntry.dll').read_bytes(),b'fixture NativeEntry.dll')
        self.assertEqual((self.out/'operation.sh').read_text(),'guard\necho ok\n')

    def test_wrong_profile_or_source_and_cleanup_refuse(self):
        for key,value in [('model','s90d'),('framework','net9.0'),('runtime','0.0.0'),('source',{}),('reproducible_builds',1)]:
            with self.subTest(key=key):
                old=self.manifest[key];self.manifest[key]=value;self.save()
                with self.assertRaises(Refused):native_root.prepare(self.profile,self.bundle,self.out,'true')
                self.manifest[key]=old;self.save()
        with self.assertRaisesRegex(Refused,'cleanup'):native_root.prepare(self.profile,self.bundle,self.out,'true',0)
        for script in ['echo\0bad', 'x'*65536]:
            with self.assertRaisesRegex(Refused,'64 KiB'):native_root.prepare(self.profile,self.bundle,self.out,script)

    def test_artifact_drift_and_symlinks_refuse(self):
        p=self.artifacts/'libacquire.so'; data=p.read_bytes();p.write_bytes(b'drift')
        with self.assertRaisesRegex(Refused,'drift'):native_root.prepare(self.profile,self.bundle,self.out,'true')
        p.unlink(); other=self.folder/'other';other.write_bytes(data);p.symlink_to(other)
        with self.assertRaisesRegex(Refused,'regular'):native_root.prepare(self.profile,self.bundle,self.out,'true')

    def test_lost_native_reply_cleans_owned_files_without_managed_fallback(self):
        calls=[];uploads=[]
        class Client:
            def __init__(self,*args):pass
            def connect(self):pass
            def require_device(self):pass
            def capture(self,*args,**kwargs):
                return SimpleNamespace(transport_returncode=0,output='a'*64+'  /etc/passwd\n'+'b'*64+'  /usr/share/sdbd/public.pem\n[exit:0]\n')
            def push(self,source,target):uploads.append(str(target))
        def capture(cfg,callback,script,timeout,label):
            calls.append((label,script))
            if label=='setup-root-operation':raise Refused('lost native reply')
        def command(argv,**kwargs):
            if '-out' in argv:Path(argv[argv.index('-out')+1]).write_bytes(b'fixture')
            return ''
        toolkit=SimpleNamespace(device=lambda cfg:'192.0.2.30',SdbClient=Client,capture=capture)
        with patch.object(root,'PRIVATE',self.folder),patch.object(root,'load',return_value=toolkit),patch.object(root,'run',side_effect=command),patch.object(root,'build',side_effect=AssertionError('managed fallback replay')):
            with self.assertRaisesRegex(Refused,'lost native reply'):root.execute(self.profile,'true',native_bundle=self.bundle)
        self.assertEqual([x[0] for x in calls],['setup-root-stage','setup-root-operation','setup-root-cleanup'])
        self.assertIn('/NativeEntry.dll probe',calls[1][1]);self.assertIn('env -i ',calls[1][1])
        self.assertNotIn('NamespaceRootProbe.dll',calls[1][1])
        self.assertTrue(all('test-private.pem' not in x for x in uploads))
        self.assertIn('rm -f /home/owner/share/tmp/sdk_tools/couchroot-native-root-qn90a/code/libacquire.so',calls[2][1])
        self.assertIn('sha256sum /etc/passwd',calls[2][1])

    def test_bad_bundle_fails_before_device_contact(self):
        self.manifest['model']='s90d';self.save()
        toolkit=SimpleNamespace(device=lambda cfg:(_ for _ in ()).throw(AssertionError('device contacted')))
        with patch.object(root,'PRIVATE',self.folder),patch.object(root,'load',return_value=toolkit):
            with self.assertRaisesRegex(Refused,'mismatch'):root.execute(self.profile,'true',native_bundle=self.bundle)

    def transport(self, bundle=None, model='qn90a'):
        from tvsetup.transport import Transport
        p={**self.profile, **profile(model)}
        client=SimpleNamespace(connect=lambda:None, require_device=lambda:None,
            capture=lambda *a, **kw:SimpleNamespace(output='\n[exit:0]\n',transport_returncode=0))
        toolkit=SimpleNamespace(device=lambda cfg:'192.0.2.30',SdbClient=lambda *a:client)
        with patch('tvsetup.toolkit.load',return_value=toolkit):
            return Transport(p,self.folder/'transport',native_bundle=bundle)

    def test_transport_snapshots_bundle_before_contact_and_dispatches_native(self):
        from tvsetup import worker
        tv=self.transport(self.bundle,model=self.profile['id'])
        self.assertNotEqual(tv.native_bundle,self.bundle)
        self.assertEqual(tv.root_acquisition['manifest_sha256'],sha((tv.native_bundle/'manifest.json').read_bytes()))
        (self.artifacts/'libacquire.so').write_bytes(b'changed original')
        def dispatch(argv, **kwargs):
            self.assertEqual(kwargs['timeout'],360)
            # Execute the real subprocess argument parser; stop at the root executor.
            with patch.object(worker,'execute') as execute:
                worker.main(argv[3:])
            p,script,index=execute.call_args.args
            self.assertIsNone(index)
            self.assertIn('sha256sum /usr/bin/dotnet',script)
            self.assertTrue(script.endswith('echo once'))
            bundle=execute.call_args.kwargs['native_bundle']
            native_root.prepare(p,bundle,self.out,script)
            self.assertEqual((self.out/'libacquire.so').read_bytes(),b'fixture libacquire.so')
            return 'done'
        with patch('tvsetup.transport.run',side_effect=dispatch) as command:
            self.assertEqual(tv.root('echo once'),'done')
        self.assertEqual(command.call_count,1)

    def test_s90d_native_dispatch_uses_its_own_runtime_bound_bundle(self):
        self.profile.update(profile('s90d'))
        self.manifest.update(model='s90d',framework=self.profile['framework'],runtime=self.profile['runtime'])
        self.save()
        self.test_transport_snapshots_bundle_before_contact_and_dispatches_native()

    def test_transport_rejects_bad_bundle_before_loading_sdk(self):
        from tvsetup.transport import Transport
        self.manifest['model']='s90d';self.save()
        with patch('tvsetup.toolkit.load',side_effect=AssertionError('SDK loaded')):
            with self.assertRaisesRegex(Refused,'mismatch'):
                Transport(self.profile,self.folder/'transport',native_bundle=self.bundle)

    def test_transport_uncertain_reply_is_saved_and_never_falls_back(self):
        tv=self.transport(self.bundle)
        error=Refused('completion unknown');error.output='partial receipt'
        with patch('tvsetup.transport.run',side_effect=error) as command:
            with self.assertRaisesRegex(Refused,'completion unknown'):tv.root('echo once')
        self.assertEqual(command.call_count,1)
        self.assertIn('--native-bundle',command.call_args.args[0])
        logs=list(tv.evidence.glob('root-*.log'))
        self.assertEqual(len(logs),1)
        self.assertEqual(logs[0].read_text(),'partial receipt')

    def test_native_transport_refuses_cleanup_without_dispatch(self):
        tv=self.transport(self.bundle)
        with patch('tvsetup.transport.run',side_effect=AssertionError('dispatched')):
            with self.assertRaisesRegex(Refused,'explicit managed'):tv.root('true',cleanup_index=0)
            with self.assertRaisesRegex(Refused,'S90D-only'):tv.root('true',namespace=True)

    def test_managed_worker_argument_compatibility_and_s90d_namespace(self):
        from tvsetup import worker
        tv=self.transport(model='s90d')
        self.assertEqual(tv.root_acquisition,dict(kind='managed'))
        def dispatch(argv, **kwargs):
            self.assertNotIn('--native-bundle',argv)
            with patch.object(worker,'execute') as execute:worker.main(argv[3:])
            self.assertEqual(execute.call_args.args[2],3)
            self.assertIn('nsenter -t 1 -m -- sh -c',execute.call_args.args[1])
            self.assertIsNone(execute.call_args.kwargs['native_bundle'])
            return 'done'
        with patch('tvsetup.transport.run',side_effect=dispatch):
            self.assertEqual(tv.root('echo managed',namespace=True,cleanup_index=3),'done')

    def test_snapshot_cannot_overwrite_and_revalidates_saved_artifacts(self):
        snapshot=native_root.snapshot(self.profile,self.bundle,self.folder/'snapshot')
        with self.assertRaisesRegex(Refused,'must be new'):
            native_root.snapshot(self.profile,self.bundle,snapshot)
        (snapshot/'artifacts/NativeEntry.dll').write_bytes(b'drift')
        with self.assertRaisesRegex(Refused,'drift'):
            native_root.prepare(self.profile,snapshot,self.out,'true')

    def test_library_abi_dependency_and_version_gate(self):
        data=bytearray(52);data[:7]=b'\x7fELF\x01\x01\x01'
        struct.pack_into('<H',data,16,3);struct.pack_into('<H',data,18,40)
        struct.pack_into('<I',data,36,5<<24)
        report='(NEEDED) Shared library: [libc.so.6]\nGLIBC_2.17\n'
        self.assertEqual(native_root.inspect_library(data,report)['glibc_max'],'2.17.0')
        for offset,value in [(16,2),(18,183)]:
            wrong=bytearray(data);struct.pack_into('<H',wrong,offset,value)
            with self.assertRaises(Refused):native_root.inspect_library(wrong,report)
        wrong=bytearray(data);struct.pack_into('<I',wrong,36,(5<<24)|0x400)
        with self.assertRaises(Refused):native_root.inspect_library(wrong,report)
        for suffix in ['GLIBC_2.28','(NEEDED) Shared library: [libforeign.so]',
                       'Requesting program interpreter: /lib/ld-linux.so.3']:
            with self.assertRaises(Refused):native_root.inspect_library(data,report+suffix)

if __name__=='__main__':unittest.main()
