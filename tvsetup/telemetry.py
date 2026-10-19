"""Bounded handoff from the S90D helper to the shared signed service."""
from .common import Refused
from .transport import Q, hash_guard

DATA = '/opt/usr/home/owner/apps_rw/MiniTelemetry/data'
LEGACY_MARKER = '/opt/minimal-telemetry/enabled'
LEGACY_RUNTIME = '/run/minimal-telemetry'


def drain(runtime):
    """Wait for the collector's exclusive lease, never kill an unrelated process."""
    lock = runtime+'/lock'
    return (f'test ! -L {Q(runtime)}\ntest ! -L {Q(lock)}\n'
            f'if test -e {Q(lock)}; then flock -w 18 {Q(lock)} true; fi\n')


def legacy_action(profile, action):
    if (profile['id'] != 's90d' or action.options.get('path') != LEGACY_MARKER
            or action.after is not None):
        raise Refused('Legacy retirement is limited to the S90D collector marker')


def service_ready(profile):
    if profile['id'] == 'qn90a':return hash_guard(DATA+'/native-enabled', None)
    if profile['id'] != 's90d': return ''
    return hash_guard(LEGACY_MARKER, None)+drain(LEGACY_RUNTIME)
