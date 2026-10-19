"""Resource analysis over real verifier fixtures; synthetic identities, no TV access."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

import native_observer_series_test as fixtures

SOURCE = Path(__file__).resolve().parents[1] / 'research/autonomous-root/native-worker/analyze-observer-resources.py'
spec = importlib.util.spec_from_file_location('resources', SOURCE)
resources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resources)


class ObserverResourcesTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ObserverSeriesTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root, self.manifest = self.fixture.root, self.fixture.manifest
        self.production = dict(schema=1, phase='ready', boot_id='fixture-boot', worker_sha256='b'*64,
                               worker_identity=dict(boot_id='fixture-boot', processes={
                                   'worker': dict(pid=51, start_ticks='400'),
                                   'guardian': dict(pid=50, start_ticks='399')}))
        for index in range(2):
            self.fixture.edit(index, 'observer.json', lambda v: v.update(clock_ticks_per_second=250, page_bytes=4096))
            def populate(rows):
                for row in rows:
                    second = int(row['started_monotonic_ms']/1000)
                    row['processes'].extend(dict(role='native-worker-or-guardian', identity_valid=True, errors={}, **identity)
                                            for identity in self.production['worker_identity']['processes'].values())
                    for p in row['processes']:
                        sampled = second % 5 == 0
                        p.update(memory_detail_sampled=sampled, user_ticks=str((1 << 60)+second*250),
                                 system_ticks='0', resident_pages=25+second, descriptors=10+second,
                                 threads=3, mounts=35)
                        p.update({key: 100+second if sampled else None for key in resources.DETAIL})
            self.edit_rows(index, populate)

    def edit_rows(self, index, fn):
        path = self.root / f'window-{index}' / 'resources.ndjson'
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        fn(rows)
        raw = ''.join(json.dumps(row)+'\n' for row in rows)
        path.write_text(raw)
        self.fixture.edit(index, 'observer.json', lambda v: v.update(bytes=len(raw.encode()), samples=len(rows)))

    def analyze(self, bin_ms=6000):
        return resources.analyze(self.manifest, self.root, self.production, bin_ms)

    def test_overlap_does_not_double_weight_and_growth_is_visible(self):
        # An old collector's overlapping row must not overweight the boundary.
        self.edit_rows(0, lambda rows: rows[-1]['processes'][2].update(descriptors=999))
        result = self.analyze()
        worker = result['processes']['worker']
        self.assertEqual(result['overlap_rows_omitted'], 2)
        self.assertEqual(worker['samples'], 18)
        self.assertEqual([b['samples'] for b in worker['bins']], [6, 6, 6])
        fd = worker['metrics']['descriptors']
        self.assertEqual((fd['minimum'], fd['maximum'], fd['end_minus_start']), (10, 27, 17))
        self.assertEqual((fd['first_bin_median'], fd['last_bin_median']), (12.5, 24.5))
        self.assertEqual(result['processes']['native_combined']['metrics']['threads']['maximum'], 6)
        self.assertNotIn('mounts', result['processes']['native_combined']['metrics'])

    def test_full_width_cpu_is_subtracted_before_float_conversion(self):
        result = self.analyze()
        cpu = result['processes']['worker']['cpu']
        self.assertEqual(cpu['user_tick_delta'], '4250')
        self.assertEqual(cpu['percent_of_one_core'], 100)
        self.assertEqual(result['processes']['native_combined']['cpu']['percent_of_one_core'], 200)

    def test_sparse_memory_stays_unknown_and_lifetime_peak_is_excluded(self):
        result = self.analyze()
        worker = result['processes']['worker']
        memory = worker['metrics']['pss_kib']
        self.assertEqual((memory['known_samples'], memory['unknown_samples']), (4, 14))
        self.assertEqual(memory['minimum'], 100)
        self.assertEqual(worker['metrics']['resident_kib']['last'], 168)
        self.assertNotIn('peak_rss_kib', worker['metrics'])
        self.assertEqual(worker['metrics']['pss_plus_swap_kib']['last'], 230)

    def test_missing_detail_is_not_imputed_from_other_samples(self):
        for index in range(2):
            def missing(rows):
                for row in rows:
                    for p in row['processes']:
                        p['pss_kib'] = None
            self.edit_rows(index, missing)
        result = self.analyze()
        for role in ('worker', 'native_combined'):
            field = result['processes'][role]['metrics']['pss_kib']
            self.assertEqual(field['known_samples'], 0)
            self.assertIsNone(field['minimum'])
            self.assertIsNone(field['median_of_bin_medians'])
            self.assertIsNone(result['processes'][role]['metrics']['pss_plus_swap_kib']['maximum'])

    def test_production_binding_drift_is_refused(self):
        original = copy.deepcopy(self.production)
        for change in (lambda p: p.update(boot_id='other'),
                       lambda p: p.update(worker_sha256='c'*64),
                       lambda p: p['worker_identity'].update(boot_id='other'),
                       lambda p: p['worker_identity']['processes']['worker'].update(start_ticks='401')):
            self.production = copy.deepcopy(original)
            change(self.production)
            with self.assertRaises(resources.series.InvalidCapture):
                self.analyze()

    def test_missing_reused_duplicate_and_extra_native_identities_are_refused(self):
        path = self.root/'window-1/resources.ndjson'
        original = path.read_text()
        for change in (lambda rows: rows[0]['processes'].pop(),
                       lambda rows: rows[0]['processes'][-1].update(start_ticks='500'),
                       lambda rows: rows[0]['processes'].append(copy.deepcopy(rows[0]['processes'][-1])),
                       lambda rows: rows[0]['processes'].append(dict(rows[0]['processes'][-1], pid=900))):
            path.write_text(original)
            self.edit_rows(1, change)
            with self.assertRaises(resources.series.InvalidCapture):
                self.analyze()

    def test_counter_regression_in_discarded_overlap_is_still_refused(self):
        self.edit_rows(0, lambda rows: rows[-1]['processes'][2].update(user_ticks='0'))
        with self.assertRaisesRegex(resources.series.InvalidCapture, 'counter regressed'):
            self.analyze()

    def test_counter_regression_across_collector_boundary_is_refused(self):
        def reset(rows):
            for row in rows:
                row['processes'][2]['user_ticks'] = str(int(row['processes'][2]['user_ticks'])-5000)
        self.edit_rows(1, reset)
        with self.assertRaisesRegex(resources.series.InvalidCapture, 'counter regressed'):
            self.analyze()

    def test_invalid_resource_numbers_and_unsampled_nonnull_detail_are_refused(self):
        path = self.root/'window-1/resources.ndjson'
        original = path.read_text()
        for values in (dict(descriptors=True), dict(resident_pages=-1), dict(user_ticks=1 << 60),
                       dict(user_ticks=str(1 << 64)), dict(threads=None), dict(rss_kib=0)):
            path.write_text(original)
            self.edit_rows(1, lambda rows: rows[0]['processes'][2].update(values))
            with self.assertRaises(resources.series.InvalidCapture):
                self.analyze()

    def test_unit_change_or_missing_units_are_refused(self):
        for value in (0, None, True, 100):
            self.fixture.edit(1, 'observer.json', lambda v: v.update(clock_ticks_per_second=value))
            with self.assertRaises(resources.series.InvalidCapture):
                self.analyze()

    def test_unverified_full_duration_cannot_be_analyzed_as_completed(self):
        self.manifest['required_end_ms'] = 86400000
        with self.assertRaisesRegex(resources.series.InvalidCapture, 'ends before'):
            self.analyze()

    def test_partial_edge_bins_remain_visible_and_observers_remain_separate(self):
        self.manifest['required_start_ms'] = 500
        self.manifest['required_end_ms'] = 16500
        result = self.analyze(bin_ms=6000)
        worker = result['processes']['worker']
        self.assertEqual(worker['samples'], 16)
        self.assertEqual([b['samples'] for b in worker['bins']], [6, 6, 4])
        self.assertEqual(worker['cpu']['sample_span_ms'], 15000)
        self.assertEqual([o['samples'] for o in result['observer_windows']], [9, 9])

    def test_hash_drift_remains_refused_and_cli_fails_closed(self):
        (self.root/'series.json').write_text(json.dumps(self.manifest))
        (self.root/'production.json').write_text(json.dumps(self.production))
        run = subprocess.run([sys.executable, str(SOURCE), str(self.root/'series.json'),
                              str(self.root/'production.json')], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertTrue(json.loads(run.stdout)['analysis_complete'])
        (self.root/'window-0/resources.ndjson').write_text('{}\n')
        run = subprocess.run([sys.executable, str(SOURCE), str(self.root/'series.json'),
                              str(self.root/'production.json')], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertFalse(json.loads(run.stdout)['analysis_complete'])


if __name__ == '__main__':
    unittest.main()
