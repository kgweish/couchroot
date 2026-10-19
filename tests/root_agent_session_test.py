"""Pinned reuse must never reconnect implicitly or replay an uncertain request."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

spec=importlib.util.spec_from_file_location('session_client',Path(__file__).resolve().parents[1]/'research/autonomous-root/client.py')
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)
CONFIG=dict(host='example.invalid',port=28443,server_certificate='server.pem',client_certificate='client.pem',client_key='client.key',server_sha256=hashlib.sha256(b'certificate').hexdigest())

def connection(*, close=False, certificate=b'certificate'):
    conn=MagicMock();conn.sock.getpeercert.return_value=certificate
    response=conn.getresponse.return_value;response.status=200;response.read.return_value=b'{"ok":true}';response.will_close=close
    return conn

class SessionTests(unittest.TestCase):
    def test_reuses_pinned_socket_and_closes_at_scope_exit(self):
        conn=connection()
        with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',return_value=conn) as factory:
            with client.Session(CONFIG) as session:
                for _ in range(3):self.assertEqual(client.request(CONFIG,'GET','/v1/status',session=session),{'ok':True})
                self.assertEqual(factory.call_count,1);conn.connect.assert_called_once();conn.sock.getpeercert.assert_called_once()
                self.assertEqual(conn.auto_open,0);self.assertEqual(conn.request.call_args.kwargs['headers']['Connection'],'keep-alive')
            conn.close.assert_called_once()

    def test_count_idle_and_peer_close_rotate_before_next_request(self):
        for reason in ('count','idle','peer'):
            with self.subTest(reason=reason):
                first,second=connection(close=reason=='peer'),connection()
                with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',side_effect=[first,second]):
                    with client.Session(CONFIG) as session:
                        session.request('GET','/v1/status')
                        if reason=='count':session.requests=session.MAX_REQUESTS
                        if reason=='idle':session.last_response-=session.MAX_IDLE_SECONDS+1
                        session.request('GET','/v1/status')
                        first.close.assert_called_once();second.connect.assert_called_once();second.sock.getpeercert.assert_called_once()

    def test_rotated_connection_is_repinned_before_submission(self):
        first,second=connection(close=True),connection(certificate=b'wrong certificate')
        with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',side_effect=[first,second]):
            with client.Session(CONFIG) as session:
                session.request('GET','/v1/status')
                with self.assertRaisesRegex(RuntimeError,'pin mismatch'):session.request('POST','/v1/exec',{'command':'true'})
                second.request.assert_not_called();second.close.assert_called_once();self.assertTrue(session.failed)

    def test_failed_request_is_not_replayed_and_poisoned_session_cannot_continue(self):
        for error in (BrokenPipeError('stale socket'),TimeoutError('lost response'),client.http.client.IncompleteRead(b'partial',10)):
            with self.subTest(error=type(error).__name__):
                conn=connection()
                if isinstance(error,BrokenPipeError):conn.request.side_effect=error
                else:conn.getresponse.return_value.read.side_effect=error
                with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',return_value=conn) as factory:
                    with client.Session(CONFIG) as session:
                        with self.assertRaises(type(error)):session.request('POST','/v1/exec',{'id':'synthetic-request-id'})
                        with self.assertRaisesRegex(RuntimeError,'Session failed'):session.request('POST','/v1/exec',{'id':'another-request-id'})
                        self.assertEqual(factory.call_count,1);conn.request.assert_called_once();conn.close.assert_called_once()

    def test_invalid_http_json_size_or_digest_closes_session(self):
        for kind in ('http','json','size','digest'):
            with self.subTest(kind=kind):
                conn=connection();response=conn.getresponse.return_value
                if kind=='http':response.status=409;response.read.return_value=b'{"outcome":"unknown"}'
                if kind=='json':response.read.return_value=b'not json'
                if kind=='size':response.read.return_value=b'x'*(4*1024*1024+1)
                if kind=='digest':response.read.return_value=b'bytes';response.getheader.return_value='0'*64
                with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',return_value=conn):
                    with client.Session(CONFIG) as session:
                        with self.assertRaises((RuntimeError,ValueError)):session.request('POST','/v1/files/read',raw_response=kind=='digest')
                        self.assertTrue(session.failed);conn.close.assert_called_once()

    def test_reused_socket_applies_each_operation_budget(self):
        conn=connection()
        with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',return_value=conn) as factory:
            with client.Session(CONFIG) as session:
                for op in ('file.open','file.write','file.status'):
                    client.operation(CONFIG,dict(op=op),session=session)
                self.assertEqual([call.args[0] for call in conn.sock.settimeout.call_args_list],[130,70,40])
                self.assertEqual(factory.call_count,1)

    def test_one_off_requests_close_and_destination_changes_are_rejected(self):
        conn=connection()
        with patch.object(client.ssl,'create_default_context'),patch.object(client.http.client,'HTTPSConnection',return_value=conn):
            client.request(CONFIG,'GET','/v1/status');self.assertEqual(conn.request.call_args.kwargs['headers']['Connection'],'close');conn.close.assert_called_once()
            with client.Session(CONFIG) as session:
                with self.assertRaises(ValueError):client.request({**CONFIG,'host':'different.invalid'},'GET','/v1/status',session=session)

if __name__=='__main__':unittest.main()
