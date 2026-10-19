#!/usr/bin/env python3
"""Describe resources in a verified private capture series; never contact a TV.

Inputs must be immutable completed captures and independently authenticated live
receipts. This analysis does not authenticate them or decide endurance acceptance.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from statistics import median

spec = importlib.util.spec_from_file_location('observer_series', Path(__file__).with_name('verify-observer-series.py'))
series = importlib.util.module_from_spec(spec)
spec.loader.exec_module(series)
require = series.require

DETAIL = ('rss_kib', 'pss_kib', 'private_clean_kib', 'private_dirty_kib', 'swap_kib', 'swap_pss_kib')
METRICS = ('descriptors', 'threads', 'mounts', 'resident_kib') + DETAIL + ('pss_plus_swap_kib',)
COMBINED = tuple(key for key in METRICS if key != 'mounts')


def checked_json(base, window, name):
    raw = series.read_bounded(Path(base) / window['directory'] / name, series.FILES[name])
    require(hashlib.sha256(raw).hexdigest() == window['sha256'][name], 'artifact changed after verification')
    return [json.loads(line) for line in raw.splitlines()] if name.endswith('.ndjson') else json.loads(raw)


def values(process, page_bytes):
    result = {key: series.counter(process.get(key)) for key in ('descriptors', 'threads', 'mounts')}
    result['resident_kib'] = series.counter(process.get('resident_pages')) * page_bytes / 1024
    sampled = process.get('memory_detail_sampled')
    require(type(sampled) is bool, 'missing memory sampling flag')
    for key in DETAIL:
        require(key in process, 'missing memory field')
        value = process[key]
        require(sampled or value is None, 'unsampled memory must be unknown')
        result[key] = None if value is None else series.counter(value)
    result['pss_plus_swap_kib'] = (result['pss_kib'] + result['swap_kib']
                                 if result['pss_kib'] is not None and result['swap_kib'] is not None else None)
    result['user_ticks'] = series.u64(process.get('user_ticks'))
    result['system_ticks'] = series.u64(process.get('system_ticks'))
    return result


def cpu(points, hz):
    if len(points) < 2:
        return None
    start, first = points[0]
    end, last = points[-1]
    user = last['user_ticks'] - first['user_ticks']
    system = last['system_ticks'] - first['system_ticks']
    return dict(sample_span_ms=end-start, user_tick_delta=str(user), system_tick_delta=str(system),
                percent_of_one_core=100000 * (user + system) / hz / (end-start))


def advancing(points):
    for (at, before), (later, after) in zip(points, points[1:]):
        require(later > at, 'resource sample times do not advance')
        require(all(after[key] >= before[key] for key in ('user_ticks', 'system_ticks')),
                'CPU counter regressed')


def metric(points, key):
    known = [value[key] for _, value in points if value[key] is not None]
    return dict(known_samples=len(known), unknown_samples=len(points)-len(known),
                minimum=min(known) if known else None, maximum=max(known) if known else None,
                median=median(known) if known else None,
                first=known[0] if known else None, last=known[-1] if known else None,
                end_minus_start=known[-1]-known[0] if known else None)


def summarize(points, keys, hz, start, end, bin_ms):
    require(bool(points), 'no resource samples in requested interval')
    advancing(points)
    buckets = [[] for _ in range(math.ceil((end-start)/bin_ms))]
    for point in points:
        index = min(int((point[0]-start)//bin_ms), len(buckets)-1)
        buckets[index].append(point)
    bins = [dict(start_ms=start+i*bin_ms, end_ms=min(end, start+(i+1)*bin_ms),
                 samples=len(bucket), cpu=cpu(bucket, hz),
                 metrics={key: metric(bucket, key) for key in keys})
            for i, bucket in enumerate(buckets)]
    metrics = {key: metric(points, key) for key in keys}
    for key in keys:
        medians = [part['metrics'][key]['median'] for part in bins
                   if part['metrics'][key]['median'] is not None]
        metrics[key]['median_of_bin_medians'] = median(medians) if medians else None
        metrics[key]['first_bin_median'] = bins[0]['metrics'][key]['median']
        metrics[key]['last_bin_median'] = bins[-1]['metrics'][key]['median']
    return dict(samples=len(points), first_sample_ms=points[0][0], last_sample_ms=points[-1][0],
                maximum_selected_sample_gap_ms=max((b[0]-a[0] for a, b in zip(points, points[1:])), default=0),
                cpu=cpu(points, hz), metrics=metrics, bins=bins)


def analyze(manifest, base, production, bin_ms=600000):
    coverage = series.verify_series(manifest, base)
    require(type(bin_ms) is int and 1000 <= bin_ms <= 3600000, 'invalid resource bin size')
    start, end = manifest['required_start_ms'], manifest['required_end_ms']
    require((end-start)/bin_ms <= 10000, 'too many resource bins')
    require(isinstance(production, dict) and type(production.get('schema')) is int and
            production['schema'] == 1 and production.get('phase') == 'ready', 'invalid production receipt')
    require(production.get('worker_sha256') == manifest['native_worker_sha256'] and
            production.get('boot_id') == manifest['boot_id'], 'production source or boot mismatch')
    bound = production.get('worker_identity', {})
    require(isinstance(bound, dict) and bound.get('boot_id') == manifest['boot_id'], 'production identity boot mismatch')
    processes = bound.get('processes', {})
    require(isinstance(processes, dict) and set(processes) == {'worker', 'guardian'}, 'missing production process binding')
    identities = {role: series.identity(value) for role, value in processes.items()}
    identities['coordinator'] = series.identity(manifest['coordinator'])
    require(len(set(identities.values())) == 3, 'production process identities are not distinct')
    windows = manifest['windows']
    metadata = [checked_json(base, window, 'observer.json') for window in windows]
    units = [(series.counter(meta.get('clock_ticks_per_second')), series.counter(meta.get('page_bytes'))) for meta in metadata]
    hz, page_bytes = units[0]
    require(hz > 0 and page_bytes > 0 and all(unit == units[0] for unit in units), 'resource units missing or changed')
    # Switching at the next collector's first sample gives each instant one
    # owner. Taking every overlapping row would overweight boundary periods.
    starts = []
    for window in windows:
        rows = checked_json(base, window, 'resources.ndjson')
        starts.append(rows[0]['started_monotonic_ms'])
    require(all(b > a for a, b in zip(starts, starts[1:])), 'collector first samples do not advance')
    grouped = {role: [] for role in (*identities, 'native_combined')}
    observers = []
    omitted = 0
    for index, window in enumerate(windows):
        rows = checked_json(base, window, 'resources.ndjson')
        ready = checked_json(base, window, 'observer.ready')
        observer_id = series.identity(ready)
        require(observer_id not in identities.values(), 'observer aliases a bound process')
        prior = {}
        own = []
        for row in rows:
            at = row['started_monotonic_ms']
            by_id = {series.identity(p): p for p in row['processes']}
            require(len(by_id) == len(row['processes']), 'duplicate process identity')
            native_ids = {identity for identity, p in by_id.items() if p.get('role') == 'native-worker-or-guardian'}
            require(native_ids == {identities['worker'], identities['guardian']}, 'native process identity missing or changed')
            readings = {}
            for role, identity in {**identities, 'observer': observer_id}.items():
                require(identity in by_id, 'bound process missing')
                expected_role = 'native-worker-or-guardian' if role in ('worker', 'guardian') else role
                require(by_id[identity].get('role') == expected_role, 'bound process role changed')
                value = values(by_id[identity], page_bytes)
                if role in prior:
                    advancing([(at-1, prior[role]), (at, value)])
                prior[role] = value
                readings[role] = value
            if not start <= at <= end:
                continue
            own.append((at, readings['observer']))
            if index+1 < len(windows) and at >= starts[index+1]:
                omitted += 1
                continue
            for role in identities:
                grouped[role].append((at, readings[role]))
            a, b = readings['worker'], readings['guardian']
            combined = {key: a[key]+b[key] if a[key] is not None and b[key] is not None else None
                        for key in (*COMBINED, 'user_ticks', 'system_ticks')}
            grouped['native_combined'].append((at, combined))
        if own:
            # Each collector sees itself, not all concurrent collectors. Keep
            # windows separate rather than claiming a total observer footprint.
            observers.append(dict(window_index=index, samples=len(own), cpu=cpu(own, hz),
                                  metrics={key: metric(own, key) for key in METRICS}))
    return dict(schema=1, analysis_complete=True, continuity=coverage,
                required_start_ms=start, required_end_ms=end, bin_ms=bin_ms,
                clock_ticks_per_second=hz, page_bytes=page_bytes,
                overlap_rows_omitted=omitted,
                processes={role: summarize(points, COMBINED if role == 'native_combined' else METRICS,
                                            hz, start, end, bin_ms) for role, points in grouped.items()},
                observer_windows=observers,
                limits=[
                    'Descriptive evidence only; no automatic leak-free, performance or endurance acceptance.',
                    'Caller authenticates receipt, binaries and live provenance. Input hashes alone do not do so.',
                    'CPU spans first to last retained sample; ticks are subtracted as integers before conversion.',
                    'Sampled extrema miss short-lived descendants and intervening peaks; idle wakeups are unknown.',
                    'Memory detail is sparse; null is unknown. VmHWM is a lifetime high-water mark and is excluded.',
                    'Native combined sums same-row worker/guardian readings, not atomic tree peaks; shared RSS may double count.',
                    'PSS plus Swap is an accounting proxy. Mount counts describe each process namespace and are not summed.',
                    'Coordinator may be a shared host. Observer windows are per collector, not total simultaneous overhead.',
                    'Bins use sample medians; median of bin medians weights nonempty bins equally, including a partial final bin.'
                ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('production', type=Path)
    parser.add_argument('--bin-ms', type=int, default=600000)
    args = parser.parse_args()
    try:
        manifest_raw = series.read_bounded(args.manifest, 2*1024*1024)
        production_raw = series.read_bounded(args.production, 65536)
        result = analyze(json.loads(manifest_raw), args.manifest.parent, json.loads(production_raw), args.bin_ms)
        result['input_sha256'] = dict(manifest=hashlib.sha256(manifest_raw).hexdigest(),
                                     production=hashlib.sha256(production_raw).hexdigest())
    except (series.InvalidCapture, OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps(dict(analysis_complete=False, reason=str(error))))
        return 1
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
