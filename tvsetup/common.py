from pathlib import Path
import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
PRIVATE = Path(os.environ.get('SAMSUNG_TV_TOOLKIT', Path.home() / '.local/share/samsung-tv-research')).expanduser().resolve()
STATE = Path(os.environ.get('TV_SETUP_STATE', PRIVATE / 'setup')).expanduser().resolve()

class Refused(RuntimeError):
    """An unsafe or unsupported transition; do not retry blindly."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path, default=None):
    try:
        return json.loads(path.read_text()) if path.exists() else default
    except json.JSONDecodeError as error:
        raise Refused('Invalid JSON in '+str(path)+' at line '+str(error.lineno)+'; fix the configuration before retrying') from error


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(value, out, indent=2, sort_keys=True)
            out.write('\n'); out.flush(); os.fsync(out.fileno())
        os.replace(name, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if os.path.exists(name): os.unlink(name)


def atomic_remove(path):
    """Durably remove a local transaction record (including after a lost fsync)."""
    with contextlib.suppress(FileNotFoundError):path.unlink()
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


@contextlib.contextmanager
def lock(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('a') as stream:
        try: fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise Refused('Another setup operation holds ' + str(path))
        yield


class DeadlineExpired(Refused):
    """The observation supervisor exhausted its total wall-clock budget."""


def run(argv, timeout=180, supervise=False, **kwargs):
    """Bound host subprocesses; supervised observers keep nested tools in one group."""
    import signal
    if timeout<=0:raise DeadlineExpired('Observation deadline expired')
    grouped=os.environ.get('TV_SETUP_SUPERVISED_PGID')==str(os.getpgrp())
    own_group=not grouped
    with subprocess.Popen([str(x) for x in argv], start_new_session=own_group,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs) as child:
        def stop_group(sig):
            with contextlib.suppress(ProcessLookupError):
                try:os.killpg(child.pid,sig)
                except PermissionError as error:
                    # Darwin reports EPERM for a group containing only zombies.
                    if sys.platform != 'darwin' or error.errno != errno.EPERM:raise
        def stop(sig):
            if child.returncode is not None:return
            if own_group:stop_group(sig)
            else:
                with contextlib.suppress(ProcessLookupError):child.send_signal(sig)
        try:
            try:output,_=child.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Observation deadlines have no extra grace window. No mutation retry.
                stop(signal.SIGKILL if supervise else signal.SIGTERM)
                try:child.communicate(timeout=0.5 if supervise else 5)
                except subprocess.TimeoutExpired:
                    stop(signal.SIGKILL);child.communicate()
                if supervise:raise DeadlineExpired('Observation deadline expired; inspect private evidence for diagnostic cleanup')
                raise Refused('Operation interrupted or timed out; reconcile the journal before retrying')
            except KeyboardInterrupt:
                stop(signal.SIGKILL);child.communicate();raise
            text=output.decode(errors='replace')
            if child.returncode:
                error=Refused('Command failed: '+Path(str(argv[0])).name)
                error.output=text
                raise error
            return text
        finally:
            # Helpers can outlive a reaped leader; their group ID stays reserved.
            if supervise and own_group:stop_group(signal.SIGKILL)


def safe_id(value):
    if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}', value) or value in ('.', '..'):
        raise Refused('Invalid identifier')
    return value
