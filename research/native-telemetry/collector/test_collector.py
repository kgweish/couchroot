"""Linux integration tests against real TLS, production C code and receiver parsing."""
import hashlib
import fcntl
import http.server
import json
import os
from pathlib import Path
import signal
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 's90d-telemetry/nas'))
from metrics import validate, calculate

BINARY = os.environ.get('COLLECTOR_BINARY', '/out/collector-host')


class CollectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.certdir = tempfile.TemporaryDirectory()
        root = Path(cls.certdir.name)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(root/'key'), '-out', str(root/'cert'),
                        '-days', '1', '-subj', '/CN=deliberately-unmatched.invalid'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.pin = hashlib.sha256(ssl.PEM_cert_to_DER_cert((root/'cert').read_text())).hexdigest()
        cls.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.context.load_cert_chain(root/'cert', root/'key')

    @classmethod
    def tearDownClass(cls):
        cls.certdir.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = self.root/'data'; self.data.mkdir(mode=0o700)
        self.runtime = self.root/'runtime'
        self.requests = []; self.mode = 'ok'; self.children = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *args):
                pass
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                owner.requests.append((self.path, self.headers.get('Authorization'), json.loads(body), self.client_address))
                if owner.mode == 'timeout': time.sleep(4)
                self.send_response(302 if owner.mode == 'redirect' else 503 if owner.mode == 'error' else 204)
                self.send_header('Content-Length', '0')
                if owner.mode == 'redirect': self.send_header('Location', owner.endpoint)
                self.end_headers()

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.socket = self.context.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.endpoint = f'https://127.0.0.1:{self.server.server_port}/v1/devices/qn90a'
        self.config = dict(device_id='qn90a', endpoint=self.endpoint, token='test_' + 'a'*40,
                           certificate_sha256=self.pin, dashboard_config_path=str(self.data/'preferences.json'),
                           firmware='host-fixture')
        self.write_config(); self.preferences(True)
        (self.data/'enabled').touch()

    def tearDown(self):
        for process in self.children:
            if process.poll() is None:
                process.terminate(); process.wait(timeout=5)
            process.communicate()
        self.server.shutdown(); self.server.server_close(); self.tmp.cleanup()

    def write_config(self):
        path = self.data/'config.json'; path.write_text(json.dumps(self.config)); path.chmod(0o600)

    def preferences(self, enabled, endpoint=None):
        temp = self.data/'preferences.new'
        temp.write_text(json.dumps(dict(schema=1, enabled=enabled, endpoint=endpoint or self.endpoint)))
        temp.replace(self.data/'preferences.json')

    def start(self, duration=2, native=False):
        env = dict(os.environ, HTTPS_PROXY='http://127.0.0.1:1', ALL_PROXY='http://127.0.0.1:1')
        process = subprocess.Popen([BINARY, '--root', str(self.data), '--runtime', str(self.runtime),
                                    '--run-for', str(duration)] + (['--native-handoff'] if native else []),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.children.append(process); return process

    def finish(self, duration=2):
        process = self.start(duration); out, error = process.communicate(timeout=duration+6)
        self.assertEqual(process.returncode, 0, error.decode())
        self.assertNotIn(self.config['token'].encode(), out+error)
        return json.loads((self.runtime/'status.json').read_text())

    def wait_for(self, predicate, timeout=5):
        end = time.monotonic()+timeout
        while time.monotonic() < end:
            if predicate(): return
            time.sleep(.05)
        self.fail('Timed out waiting for collector')

    def test_real_sample_and_receiver_contract(self):
        sample = json.loads(subprocess.check_output([BINARY, '--sample']))
        validate(sample)
        self.assertGreater(sample['collector_rss_bytes'], 0)

    def test_preflight_checks_pairing_without_starting_or_sending(self):
        command = [BINARY, '--check-config', '--root', str(self.data)]
        result = subprocess.run(command, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b'')
        self.assertFalse(self.runtime.exists())
        self.assertEqual(self.requests, [])
        (self.data/'config.json').chmod(0o644)
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)

    def test_pinned_tls_reuses_connection_and_preserves_rate_contract(self):
        status = self.finish(12)
        self.assertEqual(status['sent'], 1)  # Status refresh is deliberately only once/minute.
        self.assertEqual(len(self.requests), 2)
        first, second = self.requests
        self.assertEqual(first[1], 'Bearer '+self.config['token'])
        self.assertEqual(first[3], second[3])
        current, previous = validate(second[2]), validate(first[2])
        self.assertEqual(current['seq'], 2)
        self.assertIn('cpu', calculate(current, previous))

    def test_wrong_certificate_sends_no_credentials(self):
        self.config['certificate_sha256'] = '00'*32; self.write_config()
        status = self.finish()
        self.assertEqual(self.requests, [])
        self.assertEqual(status['sent'], 0); self.assertEqual(status['failures'], 1)
        self.assertEqual(status['retry_seconds'], 20)

    def test_redirect_is_not_followed(self):
        self.mode = 'redirect'; status = self.finish()
        self.assertEqual(len(self.requests), 1); self.assertEqual(status['last_error'], -302)

    def test_deadline(self):
        self.mode = 'timeout'; started = time.monotonic(); status = self.finish()
        self.assertLess(time.monotonic()-started, 4)
        self.assertEqual(status['last_error'], 28)

    def test_failure_backoff_and_settings_recovery(self):
        self.mode = 'error'; process = self.start(35)
        self.wait_for(lambda: len(self.requests) == 1)
        self.preferences(False)
        self.wait_for(lambda: (self.runtime/'status.json').exists() and
                      not json.loads((self.runtime/'status.json').read_text())['monitoring'], 12)
        self.assertEqual(len(self.requests), 1)
        self.mode = 'ok'; self.preferences(True)
        self.wait_for(lambda: len(self.requests) == 2, 12)
        process.terminate(); self.assertEqual(process.wait(timeout=4), 0)
        self.assertLess(self.requests[1][2]['uptime']-self.requests[0][2]['uptime'], 25)

    def test_one_lock_and_signal_shutdown(self):
        first = self.start(30); self.wait_for(lambda: (self.runtime/'status.json').exists())
        second = self.start(); self.assertEqual(second.wait(timeout=2), 0)
        self.assertEqual(len(self.requests), 1)
        first.send_signal(signal.SIGTERM); self.assertEqual(first.wait(timeout=2), 0)

    def test_invalid_preferences_disable_collection(self):
        for endpoint in [self.endpoint.replace('https:', 'http:'), self.endpoint+'?x=1',
                         self.endpoint.replace('qn90a', 's90d'), self.endpoint.replace('127.0.0.1', 'user@127.0.0.1')]:
            with self.subTest(endpoint=endpoint):
                self.preferences(True, endpoint); status = self.finish(1)
                self.assertFalse(status['monitoring']); self.assertEqual(len(self.requests), 0)

    def test_invalid_config_and_symlinks_fail_closed(self):
        path = self.data/'config.json'
        for text in ['{}', json.dumps(self.config)+'{}', 'x'*4097,
                     json.dumps({**self.config, 'token': 'a'*32+'\r\nInjected: yes'})]:
            path.write_text(text)
            process = self.start(); self.assertEqual(process.wait(timeout=2), 1)
        self.write_config(); target = self.data/'saved'; path.rename(target); path.symlink_to(target)
        process = self.start(); self.assertEqual(process.wait(timeout=2), 1)
        self.assertEqual(self.requests, [])

    def test_lock_symlink_cannot_overwrite_target(self):
        self.runtime.mkdir(mode=0o700)
        target = self.root/'keep'; target.write_text('unchanged')
        (self.runtime/'lock').symlink_to(target)
        process = self.start(); self.assertEqual(process.wait(timeout=2), 1)
        self.assertEqual(target.read_text(), 'unchanged')

    def select_native(self):
        (self.data/'enabled').rename(self.data/'native-enabled')

    def test_native_handoff_requires_explicit_exclusive_selection(self):
        process = self.start(native=True)
        self.assertEqual(process.wait(timeout=3), 0)
        self.assertFalse(self.runtime.exists())
        (self.data/'native-enabled').touch()  # Both markers is an invalid handoff.
        self.assertEqual(self.start(native=True).wait(timeout=3), 0)
        self.assertEqual(self.requests, [])

    def test_native_selection_reuses_pairing_preferences_and_receiver_contract(self):
        original = (self.data/'config.json').read_bytes()
        self.select_native()
        self.preferences(False)
        process = self.start(35, native=True)
        self.wait_for(lambda: (self.runtime/'status.json').exists())
        self.assertEqual(self.requests, [])
        self.preferences(True)
        self.wait_for(lambda: len(self.requests) == 1, 12)
        validate(self.requests[0][2])
        self.assertNotIn('inspector', self.requests[0][2])
        self.assertEqual(self.requests[0][1], 'Bearer '+self.config['token'])
        (self.data/'native-enabled').unlink()
        self.assertEqual(process.wait(timeout=12), 0)
        self.assertEqual((self.data/'config.json').read_bytes(), original)
        self.assertFalse((self.data/'enabled').exists())

    def test_native_selection_is_qn90a_only(self):
        self.select_native()
        self.config['device_id'] = 's90d'
        self.config['endpoint'] = self.endpoint.replace('qn90a', 's90d')
        self.write_config()
        self.assertEqual(self.start(native=True).wait(timeout=3), 1)
        self.assertEqual(subprocess.run([BINARY, '--check-config', '--native-handoff', '--root', str(self.data)],
                                       capture_output=True).returncode, 1)
        self.assertEqual(self.requests, [])

    def test_native_marker_symlink_content_and_hardlink_are_rejected(self):
        self.select_native()
        marker = self.data/'native-enabled'
        marker.write_text('unknown selection')
        self.assertEqual(self.start(native=True).wait(timeout=3), 0)
        marker.unlink()
        target = self.data/'keep'; target.touch()
        marker.symlink_to(target)
        self.assertEqual(self.start(native=True).wait(timeout=3), 0)
        marker.unlink(); os.link(target, marker)
        self.assertEqual(self.start(native=True).wait(timeout=3), 0)
        self.assertEqual(self.requests, [])

    def test_native_uses_the_existing_managed_lease(self):
        self.select_native()
        self.runtime.mkdir(mode=0o700)
        with (self.runtime/'lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.start(native=True).wait(timeout=3), 0)
            self.assertEqual(self.requests, [])
        process = self.start(native=True)
        self.assertEqual(process.wait(timeout=5), 0)
        self.assertEqual(len(self.requests), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
