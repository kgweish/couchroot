"""Native rescue request binding, lost replies and no-replay semantics."""
import json
from pathlib import Path
import tempfile
import unittest

from tvsetup import native_rescue as rescue
from tvsetup.common import Refused


def fixture_plan():
    return rescue.plan('qn90a', '00000000-0000-4000-8000-000000000001',
                       '/opt/couchroot-native-recovery/'+'a'*32+'/code',
                       'b'*64, '127.0.0.1', '192.0.2.30', tag='c'*32)


class NativeRescueTests(unittest.TestCase):
    def test_invalid_bindings_cannot_generate_commands(self):
        good = fixture_plan()
        for field, value in [('model', '../qn90a'), ('boot_id', 'boot; touch marker'),
                             ('code_directory', '/opt/../foreign'), ('binary_sha256', 'x'*64),
                             ('expected', '127.01.0.1'), ('target', '0.0.0.0'),
                             ('target', '127.0.0.1'), ('tag', 'a\n'),
                             ('firmware', 'other'), ('delay_seconds', 0), ('extra', True)]:
            with self.subTest(field=field):
                wrong = {**good, field:value}
                with self.assertRaises(Refused): rescue.commands(wrong)
        for value in ({}, None, [], {'model':'qn90a'}):
            with self.assertRaises(Refused): rescue.commands(value)

    def test_intent_precedes_dispatch_and_success_cannot_be_replayed(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); p = fixture_plan(); calls = []
            def execute(request, script):
                action = 'retire' if script.endswith('echo NATIVE_RESCUE_RETIRED_UNFIRED\n') else 'arm'
                recorded = json.loads((folder/(action+'.json')).read_text())
                self.assertEqual(recorded['id'], request); self.assertEqual(recorded['state'], 'submitted')
                self.assertEqual(recorded['script'], script); calls.append(request)
                return dict(exit_code=0, timed_out=False, stdout=script.splitlines()[-1][5:]+'\n')
            for action in ('arm', 'retire'):
                result = rescue.submit(p, action, folder, execute)
                self.assertEqual(result['state'], 'completed')
                with self.assertRaisesRegex(Refused, 'already submitted'):
                    rescue.submit(p, action, folder, execute)
            self.assertEqual(len(set(calls)), 2)

    def test_lost_reply_is_unknown_and_only_bound_retirement_can_follow(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp); p = fixture_plan(); calls = []
            def lost(request, script):
                calls.append(request); raise TimeoutError('lost response')
            with self.assertRaises(TimeoutError): rescue.submit(p, 'arm', folder, lost)
            self.assertEqual(json.loads((folder/'arm.json').read_text())['state'], 'unknown')
            with self.assertRaisesRegex(Refused, 'already submitted'): rescue.submit(p, 'arm', folder, lost)
            changed = {**p, 'target':'192.0.2.31'}
            with self.assertRaisesRegex(Refused, 'binding changed'): rescue.submit(changed, 'retire', folder, lost)
            self.assertFalse((folder/'retire.json').exists()); self.assertEqual(len(calls), 1)
            result = rescue.submit(p, 'retire', folder, lambda *_:dict(exit_code=0, timed_out=False, stdout='NATIVE_RESCUE_RETIRED_UNFIRED\n'))
            self.assertEqual(result['state'], 'completed')
            self.assertEqual(json.loads((folder/'arm.json').read_text())['state'], 'unknown')

    def test_failed_or_incomplete_result_is_not_success(self):
        for result in (dict(exit_code=1, timed_out=False, stdout='NATIVE_RESCUE_ARMED\n'),
                       dict(exit_code=0, timed_out=True, stdout='NATIVE_RESCUE_ARMED\n'),
                       dict(exit_code=0, timed_out=False, stdout=''), {}):
            with tempfile.TemporaryDirectory() as temp:
                with self.assertRaises(Refused): rescue.submit(fixture_plan(), 'arm', temp, lambda *_:result)
                record = json.loads((Path(temp)/'arm.json').read_text())
                self.assertEqual(record['state'], 'unknown')
                self.assertEqual(record['result'], result)

    def test_altered_arm_receipt_cannot_authorize_retirement(self):
        with tempfile.TemporaryDirectory() as temp:
            p = fixture_plan(); folder = Path(temp)
            rescue.submit(p, 'arm', folder, lambda *_:dict(exit_code=0, timed_out=False, stdout='NATIVE_RESCUE_ARMED\n'))
            file = folder/'arm.json'; value = json.loads(file.read_text()); value['script'] = 'foreign'
            file.write_text(json.dumps(value))
            with self.assertRaisesRegex(Refused, 'binding changed'):
                rescue.submit(p, 'retire', folder, lambda *_:self.fail('unexpected execution'))
            self.assertFalse((folder/'retire.json').exists())

    def test_retirement_without_original_intent_and_symlink_journals_refuse(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp); execute = lambda *_:self.fail('unexpected execution')
            with self.assertRaises(Refused): rescue.submit(fixture_plan(), 'retire', parent/'new', execute)
            link = parent/'link'; link.symlink_to(parent/'absent')
            with self.assertRaises(Refused): rescue.submit(fixture_plan(), 'arm', link, execute)
            folder = parent/'journal'; folder.mkdir(); (folder/'plan.json').symlink_to(parent/'absent')
            with self.assertRaises(Refused): rescue.submit(fixture_plan(), 'arm', folder, execute)
