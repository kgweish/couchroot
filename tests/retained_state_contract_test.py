"""Compare service snapshot record validation with the offline import contract."""
import base64
import json
from pathlib import Path
import subprocess
import unittest
from tvsetup.native_job_migration import validate_record

ROOT = Path(__file__).resolve().parents[1]
NAME = 'retained-job-0001.json'
BASE = dict(id=NAME[:-5], boot_id='00000000-0000-0000-0000-000000000001',
            state='completed', pid=0, exit_code=7, process_start=None)

class RetainedStateContractTests(unittest.TestCase):
    def test_standard_json_records_match_offline_validation(self):
        cases = []
        def add(value, name=NAME):
            cases.append((name, value if isinstance(value, bytes) else json.dumps(value).encode()))
        for state in ('starting', 'running', 'cancelling', 'unknown', 'completed',
                      'timed_out', 'cancelled', 'interrupted', 'invalid'):
            add(dict(BASE, state=state))
        for field in ('pid', 'exit_code'):
            for value in (None, 0, 7, -1, -2147483648, 2147483647, 2147483648,
                          True, '7', 1.0):
                add(dict(BASE, **{field: value}))
        for value in (None, '', '123', 123, False):
            add(dict(BASE, process_start=value))
        add(dict(BASE, extra={'list': [1, None, {'unicode': '\u03bb'}]}))
        for raw in (b'{}', b'[]', b'null', b'{', b'x'*2048, b'\xff',
                    json.dumps(BASE).encode()+b'\0',
                    json.dumps(BASE).encode()+b'{}',
                    b'\xef\xbb\xbf'+json.dumps(BASE).encode(),
                    json.dumps(BASE).replace('"pid": 0', '"pid": 0, "p\\u0069d": 0').encode(),
                    json.dumps(BASE).replace('"pid": 0', '"pid": 0, "nested": {"x":1,"x":2}').encode()):
            add(raw)
        add(BASE, 'retained-job-0001\n.json')
        add(dict(BASE, boot_id=BASE['boot_id']+'\n'))
        expected = []
        for name, data in cases:
            try:
                validate_record(name, data)
                expected.append(True)
            except (ValueError, UnicodeError):
                expected.append(False)
        program = """const fs=require('fs'),{validateRecord}=require('./research/autonomous-root/service/retained-state');
const cases=JSON.parse(fs.readFileSync(0));process.stdout.write(JSON.stringify(cases.map(([name,bytes])=>{try{validateRecord(name,Buffer.from(bytes,'base64'));return true;}catch(_){return false;}})));"""
        result = subprocess.run(['node', '-e', program], cwd=ROOT, check=True,
                                input=json.dumps([(n,base64.b64encode(b).decode()) for n,b in cases]),
                                text=True, capture_output=True)
        observed=json.loads(result.stdout)
        for index, (actual, wanted) in enumerate(zip(observed, expected)):
            with self.subTest(case=cases[index]):
                self.assertEqual(actual,wanted)
        self.assertEqual(len(observed),len(expected))
