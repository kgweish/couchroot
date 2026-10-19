"""One journaled checksum transfer for the private endurance adapter.

Each index owns a distinct local download. Any existing intent forbids replay,
including after upload, download or cleanup loses its response. The adapter must
authenticate the TV, serialize calls, bound their duration, journal API mutations
and hash-guard cleanup. This helper never retries or reconciles remote state.
"""
import hashlib
import json
import os
from pathlib import Path
import re


def _record(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def transfer(api, config, payload, directory, index, remote, cleanup):
    """Verify downloaded bytes before cleanup; preserve prior samples and intent."""
    if type(index) is not int or not 0 <= index <= 9999:
        raise ValueError('invalid transfer index')
    if not isinstance(remote, str) or not re.fullmatch(
            r'/opt/couchroot-agent/files/endurance-transfer-[a-f0-9]{32}', remote):
        raise ValueError('invalid owned transfer path')
    payload, directory = Path(payload), Path(directory)
    stem = directory / ('transfer-%04d' % index)
    intent = stem.with_name(stem.name + '-intent.json')
    complete = stem.with_name(stem.name + '-complete.json')
    destination = stem.with_name(stem.name + '-download')
    for path in (intent, complete, destination):
        if path.exists() or path.is_symlink():
            raise FileExistsError('transfer already has evidence; reconcile without replay: ' + str(path))
    digest, size = _digest(payload), payload.stat().st_size
    _record(intent, dict(path=remote, sha256=digest, size=size,
                         destination=destination.name))
    api.upload(config, payload, remote)
    received = api.download(config, remote, destination)
    if (received.get('sha256') != digest or received.get('size') != size
            or destination.stat().st_size != size or _digest(destination) != digest):
        raise ValueError('checksum transfer mismatch; preserve remote and local evidence')
    cleanup(remote, digest)
    result = dict(sha256=digest, size=size, destination=destination.name,
                  owned_remote_removed=True)
    _record(complete, result)
    return result
