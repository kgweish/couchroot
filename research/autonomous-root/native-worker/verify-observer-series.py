#!/usr/bin/env python3
"""Verify a caller-bound series of private observer captures; never contact a TV.

Hashes bind the files supplied by the caller, not the truth of their provenance.
The live controller must separately verify binary, firmware and process receipts.
Overlapping windows prove capture continuity, not exact process-tree resource peaks.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat

FILES = {'observer.ready': 4096, 'observer.json': 65536, 'kernel.json': 65536,
         'kernel.raw': 2 * 1024 * 1024, 'resources.ndjson': 8 * 1024 * 1024}
UINT64 = (1 << 64) - 1


class InvalidCapture(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidCapture(message)


def number(value):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0,
            'invalid nonnegative clock or counter')
    return value


def counter(value):
    require(type(value) is int and value >= 0, 'invalid integer counter')
    return value


def u64(value):
    require(isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value)
            and int(value) <= UINT64, 'invalid full-width counter')
    return int(value)


def read_bounded(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        st = os.fstat(stream.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_size <= limit,
                'artifact is not a bounded regular file')
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'artifact grew beyond its limit')
    return data


def parse_records(raw):
    require(not raw or raw.endswith(b'\n'), 'truncated kernel record')
    records = []
    for line in raw.split(b'\n')[:-1]:
        if line.startswith(b' '):
            require(bool(records), 'orphan kernel context')
            records[-1][1].extend(line + b'\n')
        else:
            match = re.match(rb'([0-9]+),([0-9]+),([0-9]+),[^;\n]*;', line)
            require(match is not None and all(int(v) <= UINT64 for v in match.groups()),
                    'malformed kernel header')
            sequence = int(match[2])
            require(not records or sequence == records[-1][0] + 1,
                    'kernel sequence gap or reordering within window')
            records.append([sequence, bytearray(line + b'\n')])
    return {sequence: hashlib.sha256(data).digest() for sequence, data in records}


def identity(value):
    require(isinstance(value, dict) and counter(value.get('pid')) > 0,
            'invalid process identity')
    return value['pid'], u64(value.get('start_ticks'))


def retained_exit(window, observer, started_ms):
    receipt = window.get('unit_exit')
    require(isinstance(receipt, dict), 'missing retained unit exit receipt')
    expected = dict(LoadState='loaded', RemainAfterExit='yes', ActiveState='active',
                    SubState='exited', Result='success', ExecMainCode='1', ExecMainStatus='0')
    require(all(receipt.get(key) == value for key, value in expected.items()),
            'unit exit was not retained or successful')
    name = receipt.get('Id')
    require(isinstance(name, str) and re.fullmatch(r'couchroot-observer-[a-f0-9]{32}\.service', name),
            'invalid collector unit identity')
    require(u64(receipt.get('ExecMainPID')) == observer[0], 'unit exit process differs from observer')
    require(0 < u64(receipt.get('ExecMainStartTimestampMonotonic')) <= started_ms * 1000,
            'unit execution timestamp is missing or after observer readiness')
    return name


def verify_series(manifest, base):
    require(isinstance(manifest, dict) and type(manifest.get('schema')) is int and manifest['schema'] in (1, 2), 'unknown series schema')
    boot = manifest.get('boot_id')
    require(isinstance(boot, str) and bool(boot), 'missing boot binding')
    coordinator = identity(manifest.get('coordinator'))
    for field in ('observer_sha256', 'native_worker_sha256'):
        require(isinstance(manifest.get(field), str) and re.fullmatch('[a-f0-9]{64}', manifest[field]),
                'missing executable digest binding')
    start, end = number(manifest.get('required_start_ms')), number(manifest.get('required_end_ms'))
    require(end > start, 'empty requested coverage')
    gap_limit = number(manifest.get('maximum_sample_gap_ms'))
    require(250 <= gap_limit <= 4000, 'invalid sample gap budget')
    windows = manifest.get('windows')
    require(isinstance(windows, list) and 1 <= len(windows) <= 1024, 'invalid window count')
    previous = None
    last_records = {}
    first_sequence = last_sequence = None
    unique_records = duplicates = resource_rows = 0
    sample_times = []
    offsets = []
    directories = set()
    observer_identities = set()
    unit_identities = set()
    for window in windows:
        require(isinstance(window, dict), 'invalid window entry')
        require(isinstance(window.get('directory'), str), 'invalid window directory')
        relative = Path(window['directory'])
        require(str(relative) not in ('', '.') and not relative.is_absolute() and '..' not in relative.parts,
                'window path must be a contained relative directory')
        directory = Path(base) / relative
        require(directory.is_dir() and not any((Path(base).joinpath(*relative.parts[:i])).is_symlink()
                for i in range(1, len(relative.parts) + 1)), 'window directory is missing or symlinked')
        require(str(relative) not in directories, 'duplicate window directory')
        directories.add(str(relative))
        require(type(window.get('exit_code')) is int and window['exit_code'] == 0, 'observer did not exit successfully')
        require(window.get('coordinator') == manifest['coordinator'] and
                all(window.get(key) == manifest[key] for key in ('observer_sha256', 'native_worker_sha256')),
                'window source or coordinator binding changed')
        digests = window.get('sha256', {})
        require(isinstance(digests, dict) and set(digests) == set(FILES), 'incomplete artifact hash set')
        data = {name: read_bounded(directory / name, limit) for name, limit in FILES.items()}
        require(all(hashlib.sha256(data[name]).hexdigest() == digests[name] for name in FILES),
                'artifact hash mismatch')
        ready, report, kernel = (json.loads(data[name]) for name in ('observer.ready', 'observer.json', 'kernel.json'))
        require(all(isinstance(v, dict) for v in (ready, report, kernel)), 'invalid capture metadata')
        require(ready.get('boot_id') == kernel.get('boot_id') == boot, 'boot changed')
        self_identity = identity(ready)
        require(self_identity not in observer_identities, 'observer identity reused across windows')
        observer_identities.add(self_identity)
        require(type(report.get('schema')) is int and report['schema'] == 2 and
                type(kernel.get('schema')) is int and kernel['schema'] == 1, 'unknown capture schema')
        require(report.get('interval_complete') is True and report.get('kernel_complete') is True
                and report.get('sampling_failed') is False and counter(report.get('skipped_intervals')) == 0,
                'incomplete resource window')
        require(kernel.get('complete') is True and kernel.get('capacity_exceeded') is False
                and kernel.get('suspend_detected') is False, 'incomplete kernel window')
        require(all(counter(kernel.get(key)) == 0 for key in ('overruns', 'known_sequence_gaps', 'malformed_records',
                                                    'reordered_records', 'read_error')), 'kernel error counters')
        ks, ke = number(kernel.get('monotonic_start_ms')), number(kernel.get('monotonic_end_ms'))
        rs, re_ = number(report.get('monotonic_start_ms')), number(report.get('monotonic_end_ms'))
        require(ks <= rs < re_ <= ke and ready.get('monotonic_start_ms') == rs, 'invalid window clock bounds')
        if manifest['schema'] == 2:
            unit = retained_exit(window, self_identity, rs)
            require(unit not in unit_identities, 'collector unit identity reused')
            unit_identities.add(unit)
        offsets.extend((number(kernel.get('boottime_start_ms')) - ks,
                        number(kernel.get('boottime_end_ms')) - ke))
        require(max(offsets) - min(offsets) < 100, 'suspend or clock discontinuity across windows')
        if previous:
            pks, pke, prs, pre = previous
            require(ks > pks and ke > pke and rs > prs and re_ > pre, 'window order does not advance')
            require(ks <= pke and rs <= pre, 'unobserved time between windows')
        else:
            require(ks <= start and rs <= start, 'series begins after requested coverage')
        previous = ks, ke, rs, re_
        require(counter(kernel.get('bytes')) == len(data['kernel.raw']) and
                counter(kernel.get('capacity_bytes')) <= FILES['kernel.raw'] and
                kernel['bytes'] <= kernel['capacity_bytes'], 'kernel byte count or capacity mismatch')
        records = parse_records(data['kernel.raw'])
        require(counter(kernel.get('records')) == len(records), 'kernel record count mismatch')
        expected_first = str(next(iter(records))) if records else None
        expected_last = str(next(reversed(records))) if records else None
        require(kernel.get('first_sequence') == expected_first and kernel.get('last_sequence') == expected_last,
                'kernel sequence metadata mismatch')
        if records:
            first, last = next(iter(records)), next(reversed(records))
            if last_sequence is not None:
                require(first <= last_sequence + 1 and first >= next(iter(last_records)),
                        'kernel sequence gap or backwards window')
                for sequence, digest in records.items():
                    if sequence <= last_sequence:
                        require(last_records.get(sequence) == digest, 'overlapping kernel bytes disagree')
                        duplicates += 1
                    else:
                        unique_records += 1
                require(last >= last_sequence, 'new window loses the observed sequence tail')
            else:
                first_sequence = first
                unique_records = len(records)
            last_sequence = last
            last_records = records
        raw = data['resources.ndjson']
        require(raw.endswith(b'\n') and counter(report.get('bytes')) == len(raw), 'resource byte count or truncation')
        rows = [json.loads(line) for line in raw.splitlines()]
        require(counter(report.get('samples')) == len(rows) and 0 < len(rows) <= 1000, 'resource sample count mismatch')
        interval = counter(report.get('interval_ms'))
        require(250 <= interval <= 2000 and interval <= gap_limit, 'sample interval exceeds budget')
        times = []
        for row in rows:
            require(isinstance(row, dict), 'invalid resource row')
            at, finished = number(row.get('started_monotonic_ms')), number(row.get('finished_monotonic_ms'))
            require(rs <= at <= finished <= re_ and (not times or at > times[-1]), 'invalid resource clocks')
            require(row.get('coordinator_present') is True and counter(row.get('scan_error')) == 0,
                    'coordinator missing or proc scan failed')
            processes = row.get('processes')
            require(isinstance(processes, list) and len(processes) <= 32, 'invalid process sample set')
            roles = {}
            for process in processes:
                require(isinstance(process, dict), 'invalid process row')
                require(process.get('identity_valid') is True and process.get('errors') == {}, 'invalid or partial process sample')
                if process.get('role') in ('coordinator', 'observer'):
                    require(process['role'] not in roles, 'duplicate bound role')
                    roles[process['role']] = identity(process)
            require(roles.get('coordinator') == coordinator and roles.get('observer') == self_identity,
                    'resource identity does not match bound receipt')
            times.append(at)
        sample_times.extend(times)
        resource_rows += len(rows)
    require(previous[1] >= end and previous[3] >= end, 'series ends before requested coverage')
    points = sorted(set([start, end] + [max(start, min(end, value)) for value in sample_times]))
    max_gap = max(b - a for a, b in zip(points, points[1:]))
    require(max_gap <= gap_limit, 'periodic resource sampling gap exceeds budget')
    return dict(schema=1, complete=True, windows=len(windows), covered_ms=end-start,
                successful_exit_evidence='retained-unit-receipts' if manifest['schema'] == 2 else 'caller-asserted-only',
                resource_samples=resource_rows, maximum_sample_gap_ms=max_gap,
                unique_kernel_records=unique_records, duplicate_kernel_records_verified=duplicates,
                first_sequence=str(first_sequence) if first_sequence is not None else None,
                last_sequence=str(last_sequence) if last_sequence is not None else None,
                limits='Caller must verify source/process provenance; periodic snapshots are not exact process-tree peaks or complete short-lived-process coverage.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    try:
        result = verify_series(json.loads(read_bounded(args.manifest, 2 * 1024 * 1024)), args.manifest.parent)
    except (InvalidCapture, OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps(dict(complete=False, reason=str(error))))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
