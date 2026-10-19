"""Offline integrity/continuity fixtures; no TV access and no kernel writes."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]/'research/autonomous-root/native-worker/verify-observer-series.py'
spec = importlib.util.spec_from_file_location('series', SOURCE)
series = importlib.util.module_from_spec(spec)
spec.loader.exec_module(series)


class ObserverSeriesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = dict(schema=1, boot_id='fixture-boot', coordinator=dict(pid=42, start_ticks='123'),
                             observer_sha256='a'*64, native_worker_sha256='b'*64,
                             required_start_ms=0, required_end_ms=18000,
                             maximum_sample_gap_ms=1500, windows=[])
        self.add_window(0, 10000, range(1, 11))
        self.add_window(8000, 18000, range(9, 19))

    def add_window(self, start, end, sequences):
        index = len(self.manifest['windows']);directory = 'window-'+str(index)
        folder = self.root/directory;folder.mkdir()
        raw = b''.join(f'6,{n},{n*100},-;record {n}\n KEY=value\n'.encode() for n in sequences)
        records = series.parse_records(raw)
        ready = dict(pid=100+index, start_ticks=str(200+index), boot_id='fixture-boot', monotonic_start_ms=start)
        kernel = dict(schema=1, boot_id='fixture-boot', complete=True, bytes=len(raw), capacity_bytes=2*1024*1024,
                      records=len(records), first_sequence=str(next(iter(records))) if records else None,
                      last_sequence=str(next(reversed(records))) if records else None,
                      monotonic_start_ms=start, monotonic_end_ms=end,
                      boottime_start_ms=start+500, boottime_end_ms=end+500,
                      capacity_exceeded=False, suspend_detected=False, overruns=0,
                      known_sequence_gaps=0, malformed_records=0, reordered_records=0, read_error=0)
        rows = [dict(started_monotonic_ms=at, finished_monotonic_ms=at+10, coordinator_present=True, scan_error=0,
                     processes=[dict(role=role, **identity, identity_valid=True, errors={}) for role, identity in
                                [('coordinator', self.manifest['coordinator']), ('observer', dict(pid=ready['pid'], start_ticks=ready['start_ticks']))]])
                for at in range(start, end, 1000)]
        resources = b''.join(json.dumps(row).encode()+b'\n' for row in rows)
        report = dict(schema=2, interval_complete=True, kernel_complete=True, sampling_failed=False,
                      skipped_intervals=0, samples=len(rows), bytes=len(resources), interval_ms=1000,
                      monotonic_start_ms=start, monotonic_end_ms=end)
        for name, value in [('observer.ready',ready),('kernel.json',kernel),('observer.json',report)]:
            (folder/name).write_text(json.dumps(value))
        (folder/'kernel.raw').write_bytes(raw);(folder/'resources.ndjson').write_bytes(resources)
        self.manifest['windows'].append(dict(directory=directory, exit_code=0, coordinator=copy.deepcopy(self.manifest['coordinator']),
            observer_sha256='a'*64, native_worker_sha256='b'*64, sha256={}))
        self.resign(index)

    def resign(self, index):
        window = self.manifest['windows'][index]
        window['sha256'] = {name:hashlib.sha256((self.root/window['directory']/name).read_bytes()).hexdigest() for name in series.FILES}

    def edit(self, index, name, fn):
        path = self.root/self.manifest['windows'][index]['directory']/name
        value = json.loads(path.read_text());fn(value);path.write_text(json.dumps(value));self.resign(index)

    def verify(self):
        return series.verify_series(self.manifest, self.root)

    def test_overlap_is_deduplicated_without_double_counting_duration(self):
        result = self.verify()
        self.assertTrue(result['complete']);self.assertEqual(result['covered_ms'],18000)
        self.assertEqual(result['unique_kernel_records'],18);self.assertEqual(result['duplicate_kernel_records_verified'],2)
        self.assertEqual(result['resource_samples'],20);self.assertEqual(result['maximum_sample_gap_ms'],1000)

    def test_hash_drift_and_symlinked_artifacts_are_refused(self):
        path=self.root/'window-0/kernel.raw';saved=path.read_bytes();path.write_bytes(saved+b'bad')
        with self.assertRaisesRegex(series.InvalidCapture,'hash'):self.verify()
        path.unlink();(self.root/'foreign').write_bytes(saved);path.symlink_to(self.root/'foreign')
        with self.assertRaises(OSError):self.verify()

    def test_overlap_bytes_must_agree_even_with_resigned_hashes(self):
        path=self.root/'window-1/kernel.raw';path.write_bytes(path.read_bytes().replace(b'record 9',b'RECORD 9'));self.resign(1)
        with self.assertRaisesRegex(series.InvalidCapture,'bytes disagree'):self.verify()

    def test_missing_kernel_records_cannot_hide_behind_complete_metadata(self):
        path=self.root/'window-1/kernel.raw';raw=path.read_bytes().replace(b'6,11,1100,-;record 11\n KEY=value\n',b'');path.write_bytes(raw)
        self.edit(1,'kernel.json',lambda v:v.update(records=9,bytes=len(raw)));self.resign(1)
        with self.assertRaisesRegex(series.InvalidCapture,'sequence gap'):self.verify()

    def test_clock_gap_is_rejected_even_when_kernel_sequences_are_contiguous(self):
        self.edit(1,'kernel.json',lambda v:v.update(monotonic_start_ms=11000,boottime_start_ms=11500))
        self.edit(1,'observer.json',lambda v:v.update(monotonic_start_ms=11000))
        self.edit(1,'observer.ready',lambda v:v.update(monotonic_start_ms=11000))
        with self.assertRaisesRegex(series.InvalidCapture,'unobserved time'):self.verify()

    def test_boot_or_cross_window_suspend_change_is_rejected(self):
        self.edit(1,'kernel.json',lambda v:v.update(boot_id='different-boot'))
        with self.assertRaisesRegex(series.InvalidCapture,'boot changed'):self.verify()
        self.edit(1,'kernel.json',lambda v:v.update(boot_id='fixture-boot',boottime_start_ms=9000,boottime_end_ms=19000))
        with self.assertRaisesRegex(series.InvalidCapture,'clock discontinuity'):self.verify()

    def test_source_and_coordinator_binding_changes_are_refused(self):
        window=self.manifest['windows'][1];window['observer_sha256']='c'*64
        with self.assertRaisesRegex(series.InvalidCapture,'binding changed'):self.verify()
        window['observer_sha256']='a'*64;window['coordinator']['start_ticks']='124'
        with self.assertRaisesRegex(series.InvalidCapture,'binding changed'):self.verify()

    def test_resource_identity_drift_and_partial_fields_are_refused(self):
        path=self.root/'window-1/resources.ndjson';rows=[json.loads(x) for x in path.read_text().splitlines()]
        rows[0]['processes'][0]['start_ticks']='124'
        raw=b''.join(json.dumps(r).encode()+b'\n' for r in rows);path.write_bytes(raw)
        self.edit(1,'observer.json',lambda v:v.update(bytes=len(raw)));self.resign(1)
        with self.assertRaisesRegex(series.InvalidCapture,'resource identity'):self.verify()
        rows[0]['processes'][0]['start_ticks']='123';rows[0]['processes'][0]['errors']={'stat':5}
        raw=b''.join(json.dumps(r).encode()+b'\n' for r in rows);path.write_bytes(raw)
        self.edit(1,'observer.json',lambda v:v.update(bytes=len(raw)));self.resign(1)
        with self.assertRaisesRegex(series.InvalidCapture,'partial process'):self.verify()

    def test_resource_gap_is_checked_from_actual_samples(self):
        path=self.root/'window-1/resources.ndjson';rows=[json.loads(x) for x in path.read_text().splitlines()]
        rows=[r for r in rows if r['started_monotonic_ms'] not in (12000,13000)]
        raw=b''.join(json.dumps(r).encode()+b'\n' for r in rows);path.write_bytes(raw)
        self.edit(1,'observer.json',lambda v:v.update(bytes=len(raw),samples=len(rows)));self.resign(1)
        with self.assertRaisesRegex(series.InvalidCapture,'sampling gap'):self.verify()

    def test_error_flags_counts_and_missing_end_coverage_are_refused(self):
        self.edit(1,'kernel.json',lambda v:v.update(overruns=1))
        with self.assertRaisesRegex(series.InvalidCapture,'error counters'):self.verify()
        self.edit(1,'kernel.json',lambda v:v.update(overruns=0,records=9))
        with self.assertRaisesRegex(series.InvalidCapture,'record count'):self.verify()
        self.edit(1,'kernel.json',lambda v:v.update(records=10))
        self.manifest['required_end_ms']=19000
        with self.assertRaisesRegex(series.InvalidCapture,'ends before'):self.verify()

    def test_empty_kernel_windows_are_valid_but_do_not_bridge_time_gaps(self):
        for i in (0,1):
            (self.root/f'window-{i}/kernel.raw').write_bytes(b'')
            self.edit(i,'kernel.json',lambda v:v.update(records=0,bytes=0,first_sequence=None,last_sequence=None));self.resign(i)
        result=self.verify();self.assertEqual(result['unique_kernel_records'],0);self.assertIsNone(result['first_sequence'])
        self.edit(1,'kernel.json',lambda v:v.update(monotonic_start_ms=11000,boottime_start_ms=11500))
        with self.assertRaises(series.InvalidCapture):self.verify()

    def test_full_width_sequences_and_context_bytes_are_preserved(self):
        first=(1<<64)-3
        raw=f'6,{first},100,-;x\n KEY=one\n6,{first+1},200,c,extra;y\n'.encode()
        result=series.parse_records(raw);self.assertEqual(list(result),[first,first+1])
        for malformed in (b' KEY=orphan\n',raw[:-1],f'6,{1<<64},0,-;overflow\n'.encode()):
            with self.assertRaises(series.InvalidCapture):series.parse_records(malformed)

    def test_duplicate_or_reversed_windows_cannot_inflate_coverage(self):
        self.manifest['windows'].append(copy.deepcopy(self.manifest['windows'][1]))
        with self.assertRaisesRegex(series.InvalidCapture,'duplicate window'):self.verify()
        self.manifest['windows'].pop();self.manifest['windows'].reverse()
        with self.assertRaises(series.InvalidCapture):self.verify()

    def test_cross_window_sequence_hole_is_rejected(self):
        path = self.root/'window-1/kernel.raw'
        raw = b''.join(f'6,{n},{n*100},-;record {n}\n KEY=value\n'.encode() for n in range(12,19))
        path.write_bytes(raw)
        self.edit(1,'kernel.json',lambda v:v.update(bytes=len(raw),records=7,first_sequence='12'))
        with self.assertRaisesRegex(series.InvalidCapture,'sequence gap'):self.verify()

    def test_empty_middle_window_does_not_reset_sequence_history(self):
        (self.root/'window-1/kernel.raw').write_bytes(b'')
        self.edit(1,'kernel.json',lambda v:v.update(records=0,bytes=0,first_sequence=None,last_sequence=None))
        self.add_window(16000,26000,range(11,15))
        self.manifest['required_end_ms']=26000
        self.assertEqual(self.verify()['unique_kernel_records'],14)
        path=self.root/'window-2/kernel.raw'
        raw=path.read_bytes().replace(b'6,11,1100,-;record 11\n KEY=value\n',b'')
        path.write_bytes(raw)
        self.edit(2,'kernel.json',lambda v:v.update(records=3,bytes=len(raw),first_sequence='12'))
        with self.assertRaisesRegex(series.InvalidCapture,'sequence gap'):self.verify()

    def test_invalid_types_and_nonfinite_clocks_are_rejected(self):
        self.edit(1,'kernel.json',lambda v:v.update(schema=True))
        with self.assertRaisesRegex(series.InvalidCapture,'schema'):self.verify()
        self.edit(1,'kernel.json',lambda v:v.update(schema=1,boottime_end_ms=float('nan')))
        with self.assertRaisesRegex(series.InvalidCapture,'clock'):self.verify()

    def test_symlinked_directories_and_missing_start_coverage_are_rejected(self):
        path=self.root/'window-1';path.rename(self.root/'moved');path.symlink_to(self.root/'moved')
        with self.assertRaisesRegex(series.InvalidCapture,'symlinked'):self.verify()
        path.unlink();(self.root/'moved').rename(path)
        self.manifest['windows']=self.manifest['windows'][1:]
        with self.assertRaisesRegex(series.InvalidCapture,'begins after'):self.verify()

    def retain_exits(self):
        self.manifest['schema']=2
        # Use a positive monotonic epoch; zero is reserved for never executed.
        self.manifest['required_start_ms']+=1000
        self.manifest['required_end_ms']+=1000
        for index,window in enumerate(self.manifest['windows']):
            for name,keys in [('observer.ready',('monotonic_start_ms',)),
                              ('observer.json',('monotonic_start_ms','monotonic_end_ms')),
                              ('kernel.json',('monotonic_start_ms','monotonic_end_ms','boottime_start_ms','boottime_end_ms'))]:
                self.edit(index,name,lambda v:v.update({key:v[key]+1000 for key in keys}))
            path=self.root/window['directory']/'resources.ndjson'
            rows=[json.loads(line) for line in path.read_text().splitlines()]
            for row in rows:
                row['started_monotonic_ms']+=1000;row['finished_monotonic_ms']+=1000
            raw=''.join(json.dumps(row)+'\n' for row in rows);path.write_text(raw)
            self.edit(index,'observer.json',lambda v:v.update(bytes=len(raw.encode())))
            window['unit_exit']=dict(Id='couchroot-observer-'+format(index,'032x')+'.service',
                                      LoadState='loaded',RemainAfterExit='yes',ActiveState='active',SubState='exited',
                                      Result='success',ExecMainCode='1',ExecMainStatus='0',
                                      ExecMainPID=str(100+index),ExecMainStartTimestampMonotonic=str((1000+index*8000)*1000))

    def test_legacy_exit_assertions_are_distinguished_from_retained_receipts(self):
        self.assertEqual(self.verify()['successful_exit_evidence'],'caller-asserted-only')
        self.retain_exits()
        self.assertEqual(self.verify()['successful_exit_evidence'],'retained-unit-receipts')

    def test_discarded_unit_default_zero_status_cannot_prove_success(self):
        self.retain_exits()
        self.manifest['windows'][1]['unit_exit'].update(LoadState='not-found',ActiveState='inactive',ExecMainStartTimestampMonotonic='0')
        with self.assertRaisesRegex(series.InvalidCapture,'not retained'):self.verify()

    def test_retained_exit_requires_real_matching_successful_execution(self):
        self.retain_exits();window=self.manifest['windows'][1];original=copy.deepcopy(window['unit_exit'])
        for changes in (dict(ExecMainPID='1010'),dict(ExecMainStartTimestampMonotonic='0'),
                        dict(ExecMainStartTimestampMonotonic='9000001'),dict(ExecMainCode='2'),
                        dict(ExecMainStatus='1'),dict(SubState='running'),dict(RemainAfterExit='no'),
                        dict(Id='unrelated.service'),dict(ExecMainPID=101)):
            window['unit_exit']=dict(original,**changes)
            with self.assertRaises(series.InvalidCapture):self.verify()
        del window['unit_exit']
        with self.assertRaisesRegex(series.InvalidCapture,'missing retained'):self.verify()

    def test_retained_unit_identity_cannot_be_reused_across_windows(self):
        self.retain_exits()
        self.manifest['windows'][1]['unit_exit']['Id']=self.manifest['windows'][0]['unit_exit']['Id']
        with self.assertRaisesRegex(series.InvalidCapture,'unit identity reused'):self.verify()


if __name__ == '__main__':
    unittest.main()
