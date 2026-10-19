"""Offline retained-job import/export. Never connects to a TV or signals a PID.

Use only quiesced snapshots, never a live managed job directory (the managed
worker does not share this lock). The original source remains byte-for-byte
unchanged. Native startup refuses an unfinished destination transaction.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat

ID = re.compile(r'[A-Za-z0-9-]{16,64}')
STATES = {'starting', 'running', 'cancelling', 'unknown', 'completed',
          'timed_out', 'cancelled', 'interrupted'}
PENDING = '.import-pending'
MANIFEST = '.import-manifest'


def validate_record(name, data):
    if not name.endswith('.json') or not ID.fullmatch(name[:-5]):
        raise ValueError('Invalid job filename')
    if not 0 < len(data) < 2048 or b'\0' in data:
        raise ValueError('Invalid job record size or encoding')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate record field')
            result[key] = value
        return result
    doc = json.loads(data, object_pairs_hook=unique)
    if not isinstance(doc, dict) or doc.get('id') != name[:-5]:
        raise ValueError('Record ID does not match filename')
    if doc.get('state') not in STATES or not isinstance(doc.get('boot_id'), str):
        raise ValueError('Invalid record state or boot')
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', doc['boot_id']):
        raise ValueError('Invalid boot identity')
    for field in ('pid', 'exit_code'):
        value = doc.get(field)
        if value is not None and (type(value) is not int or not -(2**31) <= value < 2**31):
            raise ValueError('Invalid record integer')
    if doc.get('pid', 0) is not None and doc.get('pid', 0) < 0:
        raise ValueError('Invalid record process')
    if doc.get('process_start') is not None and not isinstance(doc['process_start'], str):
        raise ValueError('Invalid process identity')
    return doc


def _directory(path):
    path = Path(path).absolute()
    if path.resolve() != path:
        raise ValueError('Directory path must not contain symlinks')
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    st = os.fstat(fd)
    if st.st_uid != os.geteuid() or st.st_mode & 0o077:
        os.close(fd)
        raise ValueError('Private owned directory required')
    return fd


def _read(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_mode & 0o077 or st.st_nlink != 1:
            raise ValueError('Private singly-linked record required')
        if st.st_size > 65536:
            raise ValueError('Oversized migration data')
        data = os.read(fd, st.st_size + 1)
        after = os.fstat(fd)
        if len(data) != st.st_size or (st.st_mtime_ns, st.st_ctime_ns, st.st_size) != (after.st_mtime_ns, after.st_ctime_ns, after.st_size):
            raise ValueError('Record changed while reading')
        return data
    finally:
        os.close(fd)


def _write(directory, name, data):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    try:
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            if not count:
                raise OSError('Short migration write')
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(directory)


def _snapshot(directory):
    records = {}
    for name in os.listdir(directory):
        if name.endswith('.next') or name.startswith(('.intent-', '.repair-')) or name.startswith('guardian'):
            raise ValueError('Unreconciled source; inspect before migration')
        if not name.endswith('.json'):
            if name not in ('lock', MANIFEST):
                raise ValueError('Unexpected snapshot entry')
            continue
        data = _read(directory, name)
        validate_record(name, data)
        records[name] = data
    if len(records) > 64:
        raise ValueError('Saved job retention exceeded')
    return records


def migrate(source, target, direction='import', checkpoint=lambda phase: None):
    """Copy/import, or export into an offline managed rollback snapshot.

    checkpoint is a local test hook, not an on-device worker operation.
    Existing identical records can be retained; differing ID collisions refuse.
    A pending transaction is resumed only with the same source bytes and direction.
    """
    if direction not in ('import', 'rollback'):
        raise ValueError('Unknown migration direction')
    src = _directory(source)
    dst = lock = None
    try:
        dst = _directory(target)
        if (os.fstat(src).st_dev, os.fstat(src).st_ino) == (os.fstat(dst).st_dev, os.fstat(dst).st_ino):
            raise ValueError('Source and destination must differ')
        lock = os.open('lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=dst)
        st = os.fstat(lock)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_mode & 0o077 or st.st_nlink != 1:
            raise ValueError('Invalid destination lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        records = _snapshot(src)
        plan = {'schema': 1, 'direction': direction,
                'records': {n: hashlib.sha256(b).hexdigest() for n, b in sorted(records.items())}}
        encoded = (json.dumps(plan, sort_keys=True) + '\n').encode()
        names = set(os.listdir(dst))
        if 'guardian' in names or any(n.startswith(('guardian.', '.intent-', '.repair-')) or n.endswith('.next') for n in names):
            raise ValueError('Destination has unresolved worker state')
        allowed = {'lock', PENDING, MANIFEST, '.import-record'} | {n for n in names if n.endswith('.json')}
        if names - allowed:
            raise ValueError('Unexpected destination entry')
        existing = {}
        for name in names:
            if name.endswith('.json'):
                data = _read(dst, name); validate_record(name, data); existing[name] = data
        if len(set(existing) | set(records)) > 64:
            raise ValueError('Combined saved job retention exceeded')
        for name, data in records.items():
            if name in existing and existing[name] != data:
                raise ValueError('Conflicting job ID; neither record overwritten')
        if PENDING in names:
            if _read(dst, PENDING) != encoded:
                raise ValueError('Pending migration source or direction changed')
        elif MANIFEST in names:
            if _read(dst, MANIFEST) != encoded or any(existing.get(n) != b for n, b in records.items()):
                raise ValueError('Completed migration differs; use a fresh snapshot')
            return plan
        else:
            if '.import-record' in names:
                raise ValueError('Unowned migration scratch file')
            _write(dst, PENDING, encoded)
        if '.import-record' in names:
            _read(dst, '.import-record')  # Verify ownership/type before removal.
            os.unlink('.import-record', dir_fd=dst)
            os.fsync(dst)
        checkpoint('pending')
        for name, data in sorted(records.items()):
            if name not in existing:
                _write(dst, '.import-record', data)
                checkpoint('record_staged')
                os.rename('.import-record', name, src_dir_fd=dst, dst_dir_fd=dst)
                os.fsync(dst)
            checkpoint(name)
        if _snapshot(src) != records:
            raise ValueError('Source changed; destination remains unavailable')
        checkpoint('before_commit')
        # The same pending bytes become the committed manifest atomically.
        os.replace(PENDING, MANIFEST, src_dir_fd=dst, dst_dir_fd=dst)
        os.fsync(dst)
        return plan
    finally:
        if lock is not None: os.close(lock)
        if dst is not None: os.close(dst)
        os.close(src)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--target', type=Path, required=True)
    p.add_argument('--direction', choices=('import', 'rollback'), default='import')
    p.add_argument('--offline-snapshot', action='store_true', required=True,
                   help='Confirm both directories are quiesced offline snapshots')
    args = p.parse_args()
    result = migrate(args.source, args.target, args.direction)
    print(json.dumps({'completed': True, 'direction': result['direction'], 'record_count': len(result['records'])}))


if __name__ == '__main__':
    main()
