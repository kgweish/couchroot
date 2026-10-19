"""Telemetry operations for NativeDriver's existing injected RemoteIO.

No connection creation and no independent journal. The shared Engine records
intent before these methods run; all uncertain results need readback.
"""
from pathlib import Path

from .common import Refused, sha
from .native_telemetry import DATA, LABEL, RUNTIME, UNIT, layout, admission_lock
from .transport import Q, hash_guard

EMPTY = sha(b'')


def unit_guard(unit, executable, description, arguments):
    # A familiar unit name alone never authorizes stopping/reusing a process.
    return (f'test "$(systemctl show {Q(unit)} -p Description --value)" = {Q(description)}\n'
            f'systemctl show {Q(unit)} -p ExecStart --value | grep -F {Q("path="+executable+" ;")} >/dev/null\n'
            f'systemctl show {Q(unit)} -p ExecStart --value | grep -F {Q("argv[]="+executable+" "+arguments+" ;")} >/dev/null\n'
            f'test "$(systemctl show {Q(unit)} -p User --value)" = 5001\n'
            f'test "$(systemctl show {Q(unit)} -p Group --value)" = 100\n'
            f'test "$(systemctl show {Q(unit)} -p SmackProcessLabel --value)" = {Q(LABEL)}\n')


def handoff_unit(run, direction):
    from .common import safe_id
    return UNIT+'-'+safe_id(run)+'-'+direction+'.service'


class TelemetryIO:
    def telemetry_state(self, metadata):
        # Reject malformed/ambiguous selection rather than treating it as a
        # normal absent file and permitting Engine's unchanged-state retry.
        paths = [metadata['managed_marker'], metadata['native_marker']]
        values = self.hashes(paths)
        if list(values.values()) not in ([EMPTY, None], [None, EMPTY]):
            raise Refused('Telemetry markers are missing, ambiguous or changed')
        present = next(p for p in paths if values[p] is not None)
        from .native_install import parents_guard
        self.tv.root('set -eu\n'+parents_guard(present)+hash_guard(present, EMPTY)+
                     f'test "$(stat -c %u:%g:%a:%h {Q(present)})" = 5001:100:600:1\n'+
                     f'chsmack {Q(present)} | grep -F {Q("access="+chr(34)+LABEL+chr(34))} >/dev/null\n')
        return values

    def telemetry_preflight(self, metadata, retry=False):
        state = self.tv.snapshot()
        from .planner import managed_package_ok
        packages = [r for r in state['packages'] if r[0] == 'MiniTelemetry']
        if len(packages) != 1 or not managed_package_ok(packages[0]):
            raise Refused('The signed telemetry adapter is not installed with its reviewed identity')
        self.guards(metadata['adapter'])
        if self.telemetry_state(metadata)[metadata['native_marker']] is not None:
            raise Refused('Recover the existing telemetry selection before installing')
        p = layout(metadata['version'])
        if not retry:
            from .native_install import parents_guard
            # Inspect the directory itself, including dangling symlinks. Hashing
            # it as a file obscures the reason an existing stage is refused.
            status = self.tv.root('set -eu\n'+parents_guard(p['base'])+
                                  f'if test -e {Q(p["base"])} || test -L {Q(p["base"])}; '
                                  'then echo PRESENT; else echo ABSENT; fi\n').strip()
            if status != 'ABSENT':
                raise Refused('Telemetry staging path already exists or could not be inspected; use the original run')
        self.tv.root('set -eu\n'+
                     f'test "$(systemctl show {UNIT}.service -p LoadState --value)" = not-found\n'+
                     f'test ! -e /run/{UNIT}-claimed\ntest ! -L /run/{UNIT}-claimed\n')

    def stage_telemetry(self, run, metadata, payloads):
        from .native_install import parents_guard
        p = layout(metadata['version']); parent = str(Path(p['base']).parent)
        owner = p['base']+'/owner'; token = (run+'\n').encode()
        script = 'set -eu\n'+parents_guard(owner)
        script += f'if test ! -e {parent}; then mkdir -m 755 {parent}; fi\n'
        script += f'test "$(stat -c %u:%g:%a {parent})" = 0:0:755\n'
        script += f'if test ! -e {p["base"]}; then mkdir -m 755 {p["base"]}; fi\n'
        script += f'test ! -L {owner}\nif test ! -e {owner}; then test -z "$(ls -A {p["base"]})"; (umask 077; set -C; printf %s {Q(token.decode())} > {owner}); fi\n'
        script += hash_guard(owner, sha(token))
        script += f'chown 0:0 {p["base"]}\nchmod 755 {p["base"]}\nchsmack -a {Q(LABEL)} {p["base"]}\n'
        self.tv.root(script)
        for path, data in sorted(payloads.items()):
            current = self.hashes([path])[path]
            if current is None:self.tv._upload(data, path)
            elif current != sha(data):raise Refused('Telemetry staging drift; preserve it for inspection')
            label = 'User' if path == p['boot'] else LABEL
            self.tv.root('set -eu\n'+hash_guard(owner, sha(token))+hash_guard(path, sha(data))+
                         f'chown 0:0 {Q(path)}\nchmod 555 {Q(path)}\nchsmack -a {Q(label)} {Q(path)}\n')

    def verify_telemetry_payloads(self, metadata, files):
        from .native_install import parents_guard
        p = layout(metadata['version'])
        script = 'set -eu\n'
        for path, h in sorted(files.items()):
            label = 'User' if path == p['boot'] else LABEL
            script += parents_guard(path)+hash_guard(path, h)
            script += f'test "$(stat -c %u:%g:%a {Q(path)})" = 0:0:555\n'
            script += f'chsmack {Q(path)} | grep -F {Q("access="+chr(34)+label+chr(34))} >/dev/null\n'
        for path in (str(Path(p['base']).parent), p['base']):
            script += f'test ! -L {path}\ntest "$(stat -c %u:%g:%a {path})" = 0:0:755\n'
        self.tv.root(script)
        self.guards(metadata['adapter'])

    def telemetry_handoff(self, run, metadata, direction):
        p = layout(metadata['version']); unit = handoff_unit(run, direction)
        description = unit.removesuffix('.service')
        # RemainAfterExit retains the result across a lost reply. Only a later
        # rollback may retry a settled, failed inverse; never replay admission.
        # No pairing data crosses the transport.
        script = 'set -eu\n'+hash_guard(p['handoff'], metadata['handoff_sha256'])
        script += (f'load=$(systemctl show {unit} -p LoadState --value) || test "$load" = not-found\n'
                   'if test "$load" = not-found; then\n')
        script += (f'systemd-run --no-block --unit={unit} --description={description} '
                   f'-p User=5001 -p Group=100 -p SmackProcessLabel={Q(LABEL)} '
                   f'-p BindReadOnlyPaths={p["base"]} -p Type=oneshot -p RemainAfterExit=yes '
                   f'-p TimeoutStartSec=22s -p TimeoutStopSec=4s {p["handoff"]} {direction}\nfi\n')
        script += unit_guard(unit, p['handoff'], description, direction)
        if direction == 'managed':
            script += (f'if test "$load" != not-found && test "$(systemctl show {unit} -p ActiveState --value)" = failed; then\n'
                       f'test "$(systemctl show {unit} -p MainPID --value)" = 0\n'
                       f'systemctl start {unit}\nfi\n')
        # --no-block can return while the job is still queued (inactive), before
        # it becomes activating. Wait for completion, not just activation to end.
        script += (f'i=0\nwhile test "$(systemctl show {unit} -p SubState --value)" != exited; do\n'
                   f'test "$(systemctl show {unit} -p ActiveState --value)" != failed\n'
                   'test "$i" -lt 22; sleep 1; i=$((i+1)); done\n'
                   f'test "$(systemctl show {unit} -p Result --value)" = success\n'
                   f'test "$(systemctl show {unit} -p SubState --value)" = exited\n'
                   f'test "$(systemctl show {unit} -p ExecMainStatus --value)" = 0\n')
        self.tv.root(script)

    def start_telemetry(self, metadata):
        p = layout(metadata['version'])
        self.tv.root('set -eu\n'+hash_guard(p['boot'], metadata['bootstrap']['sha256'])+f'/bin/sh {p["boot"]}\n')

    def telemetry_verify(self, run, metadata):
        if self.telemetry_state(metadata)[metadata['managed_marker']] is not None:
            raise Refused('Managed telemetry still selected')
        # Configuration readback does not establish receiver freshness or runtime
        # health. It proves the unit admitted is ours and has not failed already.
        p = layout(metadata['version'])
        self.tv.root('set -eu\n'+unit_guard(UNIT+'.service', p['binary'], UNIT+'-'+metadata['version'], f'--root {DATA} --runtime {RUNTIME} --native-handoff')+
                     f'test "$(systemctl show {UNIT}.service -p ActiveState --value)" = active\n')

    def rollback_telemetry(self, run, metadata):
        p = layout(metadata['version']); unit = UNIT+'.service'
        # Serialize with any in-flight boot invocation. Disable future admission
        # before stopping this exact version; never clear the per-boot claim.
        from .native_install import parents_guard
        script = 'set -eu\n'+parents_guard(p['base']+'/owner')
        script += f'if test -e {p["base"]}; then\nif test -e {p["base"]}/owner; then\n'+hash_guard(p['base']+'/owner', sha((run+'\n').encode()))+f'else test ! -L {p["base"]}/owner; test -z "$(ls -A {p["base"]})"; fi\nfi\n'
        script += admission_lock()
        script += f'test ! -L {p["admission"]}\nif test -e {p["admission"]}; then\n'
        script += hash_guard(p['admission'], sha(b'enabled\n'))+f'rm {p["admission"]}\nfi\n'
        script += f'if test "$(systemctl show {unit} -p LoadState --value)" != not-found; then\n'
        script += unit_guard(unit, p['binary'], UNIT+'-'+metadata['version'], f'--root {DATA} --runtime {RUNTIME} --native-handoff')
        script += f'systemctl stop {unit}\ntest "$(systemctl show {unit} -p MainPID --value)" = 0\nfi\n'
        # Stop an uncertain forward handoff before inspecting/restoring markers.
        forward = handoff_unit(run, 'native')
        script += f'if test "$(systemctl show {forward} -p LoadState --value)" != not-found; then\n'
        script += unit_guard(forward, p['handoff'], forward.removesuffix('.service'), 'native')
        script += f'systemctl stop {forward}\ntest "$(systemctl show {forward} -p MainPID --value)" = 0\nfi\n'
        self.tv.root(script)
        state = self.telemetry_state(metadata)
        if state[metadata['native_marker']] is not None:
            self.telemetry_handoff(run, metadata, 'managed')

    def telemetry_restored(self, metadata):
        p = layout(metadata['version'])
        if self.telemetry_state(metadata)[metadata['native_marker']] is not None:
            raise Refused('Native selection remains after recovery')
        self.guards({p['admission']: None})
        self.tv.root('set -eu\n'+
                     f'state=$(systemctl show {UNIT}.service -p ActiveState --value)\n'
                     'test "$state" = inactive || test "$state" = failed\n'+
                     f'test "$(systemctl show {UNIT}.service -p MainPID --value)" = 0\n')
