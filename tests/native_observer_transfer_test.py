"""Endurance transfers: consecutive samples, corrupt bytes and uncertain results."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'research/autonomous-root/native-worker/observer-transfer.py'
spec = importlib.util.spec_from_file_location('observer_transfer', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeAPI:
    def __init__(self):
        self.files = {}
        self.calls = []
        self.fail = None
        self.corrupt = False

    def upload(self, config, payload, remote):
        self.calls.append('upload')
        self.files[remote] = payload.read_bytes()
        if self.fail == 'upload':
            raise ConnectionError('upload response lost')

    def download(self, config, remote, destination):
        self.calls.append('download')
        data = self.files[remote]
        with destination.open('xb') as stream:
            stream.write(b'x' * len(data) if self.corrupt else data)
        if self.fail == 'download':
            raise ConnectionError('download response lost')
        return dict(sha256=hashlib.sha256(data).hexdigest(), size=len(data))

    def cleanup(self, remote, digest):
        self.calls.append('cleanup')
        assert hashlib.sha256(self.files[remote]).hexdigest() == digest
        del self.files[remote]
        if self.fail == 'cleanup':
            raise ConnectionError('cleanup response lost')


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.payload = self.directory / 'payload'
        self.payload.write_bytes(b'first checksum payload')
        self.api = FakeAPI()

    def transfer(self, index=0):
        remote = '/opt/couchroot-agent/files/endurance-transfer-' + ('%032x' % index)
        return m.transfer(self.api, {}, self.payload, self.directory, index,
                          remote, self.api.cleanup)

    def test_two_hourly_transfers_preserve_distinct_downloads(self):
        first = self.transfer(0)
        self.payload.write_bytes(b'next hourly checksum payload')
        second = self.transfer(1)
        self.assertNotEqual(first['destination'], second['destination'])
        self.assertEqual((self.directory / first['destination']).read_bytes(), b'first checksum payload')
        self.assertEqual((self.directory / second['destination']).read_bytes(), self.payload.read_bytes())
        self.assertFalse(self.api.files)
        self.assertEqual(self.api.calls, ['upload', 'download', 'cleanup'] * 2)

    def test_completed_transfer_cannot_be_replayed(self):
        self.transfer()
        with self.assertRaises(FileExistsError):
            self.transfer()
        self.assertEqual(self.api.calls, ['upload', 'download', 'cleanup'])

    def test_each_uncertain_boundary_preserves_intent_and_refuses_replay(self):
        for index, boundary in enumerate(('upload', 'download', 'cleanup')):
            with self.subTest(boundary=boundary):
                self.api.fail = boundary
                with self.assertRaises(ConnectionError):
                    self.transfer(index)
                before = list(self.api.calls)
                with self.assertRaises(FileExistsError):
                    self.transfer(index)
                self.assertEqual(self.api.calls, before)
                intent = self.directory / ('transfer-%04d-intent.json' % index)
                self.assertEqual(json.loads(intent.read_text())['size'], self.payload.stat().st_size)
                self.assertFalse((self.directory / ('transfer-%04d-complete.json' % index)).exists())

    def test_corrupt_download_is_checked_independently_of_receipt(self):
        self.api.corrupt = True
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            self.transfer()
        self.assertEqual(self.api.calls, ['upload', 'download'])
        self.assertTrue(self.api.files)

    def test_existing_download_and_dangling_symlink_refuse_before_upload(self):
        dest = self.directory / 'transfer-0000-download'
        for kind in ('file', 'symlink'):
            with self.subTest(kind=kind):
                if kind == 'file':
                    dest.write_bytes(b'keep')
                else:
                    dest.symlink_to(self.directory / 'absent')
                with self.assertRaises(FileExistsError):
                    self.transfer()
                self.assertFalse(self.api.calls)
                dest.unlink()

    def test_invalid_index_or_path_does_not_submit(self):
        for index in (-1, True, 10000, '0'):
            with self.assertRaises(ValueError):
                m.transfer(self.api, {}, self.payload, self.directory, index,
                           '/opt/couchroot-agent/files/endurance-transfer-' + '0' * 32, self.api.cleanup)
        with self.assertRaises(ValueError):
            m.transfer(self.api, {}, self.payload, self.directory, 0, '/unowned', self.api.cleanup)
        self.assertFalse(self.api.calls)


if __name__ == '__main__':
    unittest.main()
