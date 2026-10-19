import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/'research/autonomous-root/client.py'
spec=importlib.util.spec_from_file_location('root_agent_client_tests', SOURCE)
client=importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)

class RootAgentClientTests(unittest.TestCase):
    def test_observer_probe_binds_request_and_manifest_without_retry(self):
        with patch.object(client,'request',return_value={'verified':True}) as request:
            self.assertTrue(client.probe_observer({},'a'*64,'observer-request-001')['verified'])
            self.assertEqual(request.call_args.args,({},'POST','/v1/observer/probe',{'id':'observer-request-001','manifest_sha256':'a'*64}))
            self.assertEqual(request.call_args.kwargs['timeout'],130)
        with patch.object(client,'request',side_effect=OSError('lost reply')) as request:
            with self.assertRaises(OSError):client.probe_observer({},'a'*64,'observer-request-001')
            self.assertEqual(request.call_count,1)
        with patch.object(client,'request') as request:
            for digest,identity in [('a'*64+'\n','observer-request-001'),('a'*64,'short'),(None,'observer-request-001')]:
                with self.assertRaises(ValueError):client.probe_observer({},digest,identity)
            request.assert_not_called()

    def test_native_rehearsal_and_recovery_do_not_retry(self):
        with patch.object(client,'request',return_value={'state':'submitted'}) as request:
            self.assertEqual(client.rehearse_native({},'a'*64,'b'*64,'native-request-0001')['state'],'submitted')
            self.assertEqual(request.call_args.args,({},'POST','/v1/native/rehearse',{'id':'native-request-0001','manifest_sha256':'a'*64,'runtime_sha256':'b'*64}))
            client.resume_managed_activation({},'native-request-0001','native-recovery-0001')
            self.assertEqual(request.call_args.args,({},'POST','/v1/native/resume-managed',{'id':'native-recovery-0001','rehearsal_id':'native-request-0001'}))
            client.cleanup_restart({},'c'*32,'native-cleanup-0002',cleanup_id='native-cleanup-0001')
            self.assertEqual(request.call_args.args[3],{'id':'native-cleanup-0002','transaction_id':'c'*32,'cleanup_id':'native-cleanup-0001'})
            client.cleanup_restart({},'c'*32,'native-cleanup-0001')
            self.assertEqual(request.call_args.args,({},'POST','/v1/native/cleanup-restart',{'id':'native-cleanup-0001','transaction_id':'c'*32}))
            client.migrate_native({},'a'*64,'b'*64,'native-migrate-0001')
            self.assertEqual(request.call_args.args,({},'POST','/v1/native/migrate',{'id':'native-migrate-0001','manifest_sha256':'a'*64,'runtime_sha256':'b'*64}))
            client.resume_native_activation({},'native-migrate-0001','native-recovery-0001')
            self.assertEqual(request.call_args.args,({},'POST','/v1/native/resume-native',{'id':'native-recovery-0001','migration_id':'native-migrate-0001'}))
            client.return_managed({},'b'*64,'native-return-0001')
            self.assertEqual(request.call_args.args,({},'POST','/v1/native/return-managed',{'id':'native-return-0001','runtime_sha256':'b'*64}))
        with patch.object(client,'request',side_effect=OSError('lost reply')) as request:
            with self.assertRaises(OSError):client.rehearse_native({},'a'*64,'b'*64,'native-request-0001')
            self.assertEqual(request.call_count,1)
        with patch.object(client,'request') as request:
            with self.assertRaises(ValueError):client.rehearse_native({},'a'*64,'bad','native-request-0001')
            with self.assertRaises(ValueError):client.resume_managed_activation({},'native-request-0001','native-request-0001')
            with self.assertRaises(ValueError):client.migrate_native({},'a'*64,'b'*64,'short')
            with self.assertRaises(ValueError):client.resume_native_activation({},'native-migrate-0001','native-migrate-0001')
            with self.assertRaises(ValueError):client.return_managed({},'bad','native-return-0001')
            with self.assertRaises(ValueError):client.cleanup_restart({},'C'*32,'native-cleanup-0001')
            for original in ['short','native-cleanup-0001']:
                with self.assertRaises(ValueError):client.cleanup_restart({},'c'*32,'native-cleanup-0001',cleanup_id=original)
            request.assert_not_called()

    def test_wait_requires_new_boot_and_ready_worker(self):
        observations=iter([
            dict(boot_id='old',worker_ready=True,identity={'uid':0}),
            dict(boot_id='new',worker_ready=False,identity={'uid':0}),
            dict(boot_id='new',worker_ready=True,identity={'uid':0}),
        ])
        with patch.object(client,'request',side_effect=lambda *a,**kw:next(observations)) as request,patch.object(client.time,'sleep'):
            self.assertEqual(client.wait_ready({},'old',10)['boot_id'],'new')
            self.assertEqual(request.call_count,3)
            self.assertLessEqual(request.call_args.kwargs['timeout'],10)

    def test_upload_is_chunked_and_commit_has_precondition(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'source';data=b'abc'*800000;source.write_bytes(data)
            operations=[];chunks=[]
            def operation(config,value,**kwargs):
                operations.append(value)
                if value['op']=='file.begin':return dict(transfer_id='session',chunk_bytes=1048576)
                if value['op']=='file.write':
                    chunk=kwargs['binary'];chunks.append(chunk)
                    self.assertEqual(hashlib.sha256(chunk).hexdigest(),value['sha256'])
                    return dict(offset=value['offset']+len(chunk))
                return dict(committed=True)
            with patch.object(client,'operation',side_effect=operation):
                client.upload({},source,'/opt/couchroot-agent/files/test','a'*64)
            self.assertEqual(b''.join(chunks),data)
            self.assertEqual(len(chunks),3)
            self.assertEqual(operations[0]['expected_sha256'],'a'*64)
            self.assertEqual(operations[-1]['op'],'file.commit')

    def test_changed_download_never_publishes(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'target'
            def operation(config,value,**kwargs):
                if value['op']=='file.open':return dict(transfer_id='session',chunk_bytes=1048576,size=3,sha256=hashlib.sha256(b'old').hexdigest())
                return b'new'
            with patch.object(client,'operation',side_effect=operation):
                with self.assertRaisesRegex(RuntimeError,'changed or digest mismatch'):client.download({},'/usr/lib/example',target)
            self.assertFalse(target.exists())
            self.assertEqual(len(list(Path(folder).glob('*.part-*'))),1)

    def test_uncertain_chunk_is_not_replayed_or_committed(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'source';source.write_bytes(b'abc')
            with patch.object(client,'operation',side_effect=[dict(transfer_id='session',chunk_bytes=1048576),TimeoutError('lost')]) as operation:
                with self.assertRaises(TimeoutError):client.upload({},source,'/opt/couchroot-agent/files/test')
                self.assertEqual(operation.call_count,2)

if __name__=='__main__':unittest.main()

class OperationDeadlineTests(unittest.TestCase):
    def test_client_budgets_match_contract_and_are_passed_per_operation(self):
        import json
        contract=json.loads((SOURCE.parent.parent.parent/'tests/worker-parity/contract.json').read_text())
        deadlines=contract['response_deadlines']
        for op in contract['operations']:
            expected=(deadlines['operation_ms'].get(op,deadlines['default_ms'])+deadlines['client_margin_ms'])/1000
            with self.subTest(op=op),patch.object(client,'request',return_value={}) as request:
                self.assertEqual(client.operation_timeout(op),expected)
                client.operation({},dict(op=op,timeout_ms=86400000))
                self.assertEqual(request.call_args.kwargs['timeout'],expected)
