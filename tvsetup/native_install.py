"""Native launcher transactions on the shared setup Engine; no implicit launch.

The transport is injected. CLI construction is the only place that may connect.
Recovery consumes captured per-run bytes, never the original bundle/enrollment.
"""
import json
from pathlib import Path
import re

from .common import Refused, atomic_json, sha
from .config import resolve
from .engine import Engine
from .native_hook import HOOK, SCOPE, STATE_PATH, enrollment, layout, read_bounded, render, digest
from .planner import Action, Plan, HOME_DESIRED, AIRPLAY_RULES, HUB, managed_package_ok, plan
from .transport import Q, hash_guard


def parents_guard(path):
    return ''.join('test ! -L '+Q(str(parent))+'\nif test -e '+Q(str(parent))+'; then test -d '+Q(str(parent))+'; fi\n'
                   for parent in reversed(Path(path).parents) if str(parent) != '/')


def replacement(path, source, before, after, temporary):
    # Reconcile a complete temporary file after a lost reply. Unknown bytes are
    # never removed. Rename is the only change to the live hook.
    return ('set -eu\n'+parents_guard(path)+hash_guard(path, before)+hash_guard(source, after)+
            'test ! -L '+Q(temporary)+'\n'+
            'if test -e '+Q(temporary)+'; then\n'+hash_guard(temporary, after)+
            'else\ncp --preserve=all '+Q(path)+' '+Q(temporary)+'\ncat '+Q(source)+' > '+Q(temporary)+'\nfi\n'+
            hash_guard(temporary, after)+hash_guard(path, before)+
            'mv '+Q(temporary)+' '+Q(path)+'\n'+hash_guard(path, after))


from .native_telemetry_io import TelemetryIO


class RemoteIO(TelemetryIO):
    def __init__(self, transport):
        self.tv = transport

    def hashes(self, paths):
        script = 'set -eu\n'
        for index, path in enumerate(paths):
            script += parents_guard(path)+'test ! -L '+Q(path)+'\n'
            script += ('printf '+Q(str(index)+' ')+'\nif test -e '+Q(path)+'; then test -f '+Q(path)+
                       '; sha256sum '+Q(path)+'; else echo ABSENT; fi\n')
        output = self.tv.root(script)
        rows = output.splitlines()
        if len(rows) != len(paths):
            raise Refused('Incomplete native file inspection')
        result = {}
        for index, (path, row) in enumerate(zip(paths, rows)):
            match = re.fullmatch(str(index)+r' (ABSENT|[a-f0-9]{64})(?:  .+)?', row)
            if not match:
                raise Refused('Invalid native file readback')
            result[path] = None if match[1] == 'ABSENT' else match[1]
        return result

    def guards(self, files):
        self.tv.root('set -eu\n'+''.join(parents_guard(p)+hash_guard(p, h) for p, h in files.items()))

    def prerequisites(self):
        state = self.tv.snapshot()
        packages = [r for r in state['packages'] if r[0] == 'MiniHub001']
        if len(packages) != 1 or not managed_package_ok(packages[0]):
            raise Refused('Install the signed web Hub fallback with the web installer first')
        if state['key_filter'] != [HOME_DESIRED] or sorted([r for r in state['task_filter'] if r[0] == HUB], key=str) != sorted(AIRPLAY_RULES, key=str):
            raise Refused('Native requires the existing reviewed web Home/AirPlay fallback routes')
        choices = resolve('qn90a', overrides={'components':['hub','home','airplay'], 'exclude':[], 'keep':[], 'remove':[], 'artifacts':{}})
        fallback = plan(self.tv.profile, choices, state)
        if fallback.actions or fallback.issues:
            raise Refused('Web fallback content/routes need an update through the web installer first')
        self.tv.root('set -eu\nvconftool get db/was/isp_app_id | grep -Fx '+Q('db/was/isp_app_id, value = MiniHub001.Hub (String)')+
                     '\nvconftool get db/boot/last_service | grep -Fx '+Q('db/boot/last_service, value = isp-service (String)')+'\n')

    def backup(self, identity, before):
        p = layout(identity)
        owner = (identity+'\n').encode()
        # Interrupted allocation is recoverable only if still empty. Existing
        # nonempty unowned directories never become owned by this installer.
        script = 'set -eu\n'+parents_guard(p['base'])+'test ! -L '+Q(p['base'])+'\n'
        script += 'if test ! -e '+Q(p['base'])+'; then mkdir -m 700 '+Q(p['base'])+'; fi\ntest -d '+Q(p['base'])+'\n'
        script += 'if test ! -e '+Q(p['base']+'/owner')+'; then test -z "$(ls -A '+Q(p['base'])+')"; printf %s '+Q(owner.decode())+' > '+Q(p['base']+'/owner')+'; fi\n'
        script += hash_guard(p['base']+'/owner', sha(owner))+hash_guard(HOOK, before)
        script += 'test ! -L '+Q(p['previous'])+'\nif test ! -e '+Q(p['previous'])+'; then cp --preserve=all '+Q(HOOK)+' '+Q(p['previous'])+'; fi\n'+hash_guard(p['previous'], before)
        self.tv.root(script)

    def stage(self, identity, payloads, preference):
        p = layout(identity)
        self.guards({p['base']+'/owner': sha((identity+'\n').encode())})
        # Remote uploads use exclusive temporary files and are submitted once by
        # AgentTransport. Retrying only fills absent final files, never appends.
        script = 'set -eu\n'+parents_guard(p['binary'])+'test ! -L '+Q(p['bin'])+'\nmkdir -p '+Q(p['bin'])+'\n'
        script += 'chown 0:0 '+Q(p['base'])+' '+Q(p['bin'])+'\nchmod 755 '+Q(p['base'])+' '+Q(p['bin'])+'\nchsmack -a User '+Q(p['base'])+' '+Q(p['bin'])+'\n'
        self.tv.root(script)
        for remote, content in payloads.items():
            current = self.hashes([remote])[remote]
            if current is None:
                self.tv._upload(content, remote)
            elif current != sha(content):
                raise Refused('Native staging differs; preserve it for inspection')
            self.tv.root('set -eu\n'+hash_guard(remote, sha(content))+'chown 0:0 '+Q(remote)+'\nchmod 555 '+Q(remote)+'\nchsmack -a User '+Q(remote)+'\n')
        # Preferences are runtime-owned and retained on rollback. Never overwrite
        # an existing state, including after a partially completed first install.
        parent = str(Path(STATE_PATH).parent)
        marker = parent+'/.couchroot'
        owner = b'couchroot-native-state-v1\n'
        script = 'set -eu\n'+parents_guard(STATE_PATH)+'test ! -L '+Q(STATE_PATH)+'\n'
        script += 'if test ! -e '+Q(parent)+'; then mkdir -m 700 '+Q(parent)+'; fi\n'
        script += 'test ! -L '+Q(marker)+'\nif test ! -e '+Q(marker)+'; then test -z "$(ls -A '+Q(parent)+')"; printf %s '+Q(owner.decode())+' > '+Q(marker)+'; fi\n'
        script += hash_guard(marker, sha(owner))+'chown 5001:100 '+Q(parent)+'\nchmod 700 '+Q(parent)+'\nchsmack -a User '+Q(parent)+'\n'
        self.tv.root(script)
        if self.hashes([STATE_PATH])[STATE_PATH] is None:
            self.tv._upload(preference, STATE_PATH)
        # Also finish metadata if a reply was lost after the exclusive upload.
        # Existing preference bytes are never replaced, even if runtime edited.
        self.tv.root('set -eu\n'+hash_guard(marker, sha(owner))+'test ! -L '+Q(STATE_PATH)+'\ntest -f '+Q(STATE_PATH)+
                     '\nchown 5001:100 '+Q(STATE_PATH)+'\nchmod 600 '+Q(STATE_PATH)+'\nchsmack -a User '+Q(STATE_PATH)+'\n')

    def verify_payloads(self, identity, files):
        p = layout(identity)
        script = 'set -eu\n'
        for path, h in files.items():
            script += parents_guard(path)+hash_guard(path, h)
            script += 'test "$(stat -c %u:%g:%a '+Q(path)+')" = 0:0:555\n'
            script += 'chsmack '+Q(path)+' | grep -F '+Q('access="User"')+' >/dev/null\n'
        for path in (p['base'], p['bin']):
            script += 'test ! -L '+Q(path)+'\ntest "$(stat -c %u:%g:%a '+Q(path)+')" = 0:0:755\n'
        script += 'test ! -L '+Q(STATE_PATH)+'\ntest -f '+Q(STATE_PATH)+'\ntest "$(stat -c %u:%g:%a '+Q(STATE_PATH)+')" = 5001:100:600\n'
        script += 'chsmack '+Q(STATE_PATH)+' | grep -F '+Q('access="User"')+' >/dev/null\n'
        self.tv.root(script)

    def switch(self, identity, before, after, reverse=False):
        p = layout(identity)
        source = p['previous'] if reverse else p['hook']
        self.tv.root(replacement(HOOK, source, before, after,
                                 HOOK+'.couchroot-'+identity+('.restore' if reverse else '.new')))


def capture(folder, bundle, baseline, rearm=False, ledger=None):
    """Copy all inputs before mutation; caller holds the shared device lock."""
    from .installer import validate_native_binary
    bundle = Path(bundle).expanduser().resolve()
    manifest = json.loads(read_bounded(bundle/'manifest.json').decode())
    from .native_telemetry import capture_bundle
    telemetry_files, telemetry = capture_bundle(bundle, manifest, ledger)
    from .config import profile
    target = profile('qn90a')
    if manifest.get('target') != {key:target[key] for key in ('model','firmware','platform','architecture')}:
        raise Refused('Native bundle target profile differs')
    if manifest.get('kind') != 'couchroot-preparation' or manifest.get('device') != 'qn90a' or manifest.get('launcher') != 'native':
        raise Refused('Expected a native QN90A preparation bundle')
    files = manifest.get('files', {})
    loaded = {}
    for name in ('native-hub', 'native-state'):
        if name not in files:
            if name == 'native-state':continue
            raise Refused('Bundle has no native payload')
        content = read_bounded(bundle/name, 32*1024*1024 if name == 'native-hub' else 1024*1024)
        if sha(content) != files[name].get('sha256') or len(content) != files[name].get('bytes'):
            raise Refused('Bundle input hash/size mismatch')
        loaded[name] = content
    validate_native_binary(loaded['native-hub'])
    pref = loaded.get('native-state', b'COUCHROOT1 0 0 0 0\n')
    validate_preferences(pref)
    enrolled = enrollment(baseline)
    previous = enrolled['files'][HOOK]
    rendered = render(folder.name, sha(loaded['native-hub']), sha(previous),
                      {**{k: sha(v) for k, v in enrolled['files'].items() if k != HOOK}, **enrolled['guards']}, rearm=rearm,
                      telemetry_boot=telemetry['bootstrap'] if telemetry else None)
    p = layout(folder.name)
    remote = {**telemetry_files, p['binary']: loaded['native-hub'], **{p['base']+'/'+n: v for n, v in rendered.items()}}
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    saved = folder/'native-inputs';saved.mkdir(mode=0o700)
    entries = {}
    for number, (path, content) in enumerate(sorted({**enrolled['files'], **remote}.items())):
        name = str(number).zfill(3)
        target = saved/name
        with target.open('xb') as stream:
            stream.write(content);stream.flush()
            import os
            os.fsync(stream.fileno())
        target.chmod(0o600)
        entries[path] = {'file': name, 'sha256': sha(content)}
    with (saved/'preferences').open('xb') as stream:
        stream.write(pref);stream.flush()
        import os
        os.fsync(stream.fileno())
    (saved/'preferences').chmod(0o600)
    info = {'schema': 1, 'run': folder.name, 'files': entries, 'payload_paths': sorted(remote),
            'guards': enrolled['guards'], 'baseline_paths': sorted(enrolled['files']),
            'preference_sha256': sha(pref), 'rearm': rearm}
    if telemetry:info['telemetry'] = telemetry
    atomic_json(saved/'manifest.json', info)
    return info


def validate_preferences(content):
    # Same bounded format as hub-model.h; reject duplicate/reserved IDs and
    # control characters without interpreting arbitrary uploaded preference data.
    try:
        lines = content.decode('utf-8').splitlines()
        header = re.fullmatch(r'COUCHROOT1 ([01]) ([012]) ([01]) ([0-9]+)', lines[0])
        if not header or len(lines) > 129 or int(header[4]) >= max(1, len(lines)-1):raise ValueError()
        seen = set()
        for line in lines[1:]:
            app, name = line.split('\t')
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,256}', app) or app in seen or app in ('MiniHub001.Hub', 'com.samsung.tv.csfs') or not name.strip() or len(name.encode()) > 120 or any(ord(c) < 32 or ord(c) == 127 for c in name):raise ValueError()
            seen.add(app)
    except (UnicodeError, ValueError, IndexError):
        raise Refused('Invalid native preference candidate') from None


class NativeDriver:
    def __init__(self, io, folder, info):
        self.io, self.folder, self.info = io, Path(folder), info
        self.p = layout(self.folder.name)
        captured = json.loads(read_bounded(self.folder/'native-inputs/manifest.json').decode())
        if {k:v for k,v in info.items() if k != 'attempt'} != captured:
            raise Refused('Native journal and capture manifest differ')
        if info.get('schema') != 1 or info.get('run') != self.folder.name:
            raise Refused('Native capture identity mismatch')
        self.telemetry = info.get('telemetry')
        expected = {self.p['binary'], self.p['dispatch'], self.p['watch'], self.p['hook'], self.p['enabled']}
        self.launcher_paths = expected.copy()
        if self.telemetry:
            from .native_telemetry import layout as telemetry_layout, UNIT, DATA
            t = self.telemetry
            p = telemetry_layout(t['version'])
            if t['remote_files'] != dict(zip(('telemetry-collector', 'telemetry-boot.sh', 'telemetry-handoff.sh', 'telemetry-unit.service'), (p['binary'], p['boot'], p['handoff'], p['unit']))) or t['unit'] != UNIT+'.service' or t['native_marker'] != DATA+'/native-enabled' or t['managed_marker'] != DATA+'/enabled':
                raise Refused('Invalid captured telemetry paths')
            from .config import profile
            if set(t['adapter']) != {'/opt/usr/apps/MiniTelemetry/bin/'+n for n in profile('qn90a')['service_artifacts']}:
                raise Refused('Invalid captured adapter paths')
            for h in t['adapter'].values():digest(h)
            expected |= set(t['remote_files'].values()) | {p['admission']}
        if set(info.get('payload_paths', [])) != expected or HOOK not in info.get('baseline_paths', []):
            raise Refused('Native capture path mismatch')
        if set(info['files']) != set(info['baseline_paths']) | expected or set(info['baseline_paths']) & expected:
            raise Refused('Native capture file set mismatch')
        from .native_hook import remote_path
        for path in info['baseline_paths']:
            remote_path(path)
        for path, h in info['guards'].items():remote_path(path);digest(h)
        for entry in info['files'].values():
            if set(entry) != {'file', 'sha256'} or not re.fullmatch(r'[0-9]{3}', entry['file']):raise Refused('Invalid native capture filename')
            digest(entry['sha256'])
        self.before = info['files'][HOOK]['sha256']
        self.after = info['files'][self.p['hook']]['sha256']
        if self.telemetry:
            t = self.telemetry; p = telemetry_layout(t['version'])
            if t['bootstrap'] != {'path':p['boot'], 'sha256':info['files'][p['boot']]['sha256']} or t['handoff_sha256'] != info['files'][p['handoff']]['sha256']:
                raise Refused('Telemetry execution hashes differ from captured payloads')

    def contents(self, path):
        entry = self.info['files'][path]
        data = read_bounded(self.folder/'native-inputs'/entry['file'], 32*1024*1024)
        if sha(data) != entry['sha256']:raise Refused('Captured native input changed; use the intact run backup')
        return data

    def baseline_guards(self):
        return {**{p: self.info['files'][p]['sha256'] for p in self.info['baseline_paths'] if p != HOOK}, **self.info['guards']}

    def payload_hashes(self):
        return {p: self.info['files'][p]['sha256'] for p in sorted(self.launcher_paths)}

    def snapshot(self):
        files = self.io.hashes([HOOK])
        if self.telemetry:files.update(self.io.telemetry_state(self.telemetry))
        return {'files': files}

    def proposal(self):
        proposal = Plan('qn90a', states={'startup': 'drifted'}, reasons={'startup': 'Stage native payload and atomically replace the enrolled boot hook; preserve web fallback'},
                    actions=[Action('001-native-hook', 'startup', 'file', self.before, self.after, {'path': HOOK})])
        if self.telemetry:
            proposal.actions.insert(0, Action('000-native-telemetry', 'telemetry', 'file', None, sha(b''), {'path': self.telemetry['native_marker']}))
        return proposal

    def preflight(self):
        self.io.prerequisites()
        if self.telemetry:self.io.telemetry_preflight(self.telemetry)
        self.io.guards({HOOK: self.before, **self.baseline_guards()})
        existing = self.io.hashes([self.p['hook'], self.p['binary']])
        if any(existing.values()):raise Refused('New run staging already exists')

    def prepare(self, action):
        self.validate_action(action)
        # Only captured local files. Never restage/rebuild on resume/rollback.
        for path in self.info['files']:self.contents(path)
        return self.info

    def validate_action(self, action):
        if action not in self.proposal().actions:raise Refused('Native journal action differs from captured transaction')

    def backup(self, action, info, state):
        self.validate_action(action)
        self.io.guards(self.baseline_guards())
        if action.component == 'telemetry':return info
        self.io.backup(self.folder.name, self.before)
        return info

    def execute(self, action, info, state):
        self.validate_action(action)
        self.io.prerequisites()
        self.io.guards({HOOK: self.before, **self.baseline_guards()})
        if action.component == 'telemetry':
            self.io.telemetry_preflight(self.telemetry, retry=True)
            paths = set(self.info['payload_paths']) - self.launcher_paths
            self.io.stage_telemetry(self.folder.name, self.telemetry, {p:self.contents(p) for p in paths})
            self.io.verify_telemetry_payloads(self.telemetry, {p:self.info['files'][p]['sha256'] for p in paths})
            self.io.telemetry_handoff(self.folder.name, self.telemetry, 'native')
            self.io.start_telemetry(self.telemetry)
            return
        if self.telemetry:self.verify_telemetry()
        pref = read_bounded(self.folder/'native-inputs/preferences', 1024*1024)
        if sha(pref) != self.info['preference_sha256']:raise Refused('Captured preferences changed')
        self.io.stage(self.folder.name, {p: self.contents(p) for p in self.launcher_paths}, pref)
        self.io.verify_payloads(self.folder.name, self.payload_hashes())
        self.io.guards({self.p['previous']: self.before, **self.baseline_guards()})
        self.io.switch(self.folder.name, self.before, self.after)

    def verify(self, action, before, after):
        self.validate_action(action)
        if self.telemetry:self.verify_telemetry()
        if action.component == 'telemetry':return
        if after['files'][HOOK] != self.after:raise Refused('Native hook readback differs')
        self.io.verify_payloads(self.folder.name, self.payload_hashes())
        self.io.guards({self.p['previous']: self.before, **self.baseline_guards()})

    def verify_telemetry(self):
        paths = set(self.info['payload_paths']) - self.launcher_paths
        self.io.verify_telemetry_payloads(self.telemetry, {p:self.info['files'][p]['sha256'] for p in paths})
        self.io.telemetry_verify(self.folder.name, self.telemetry)

    def verify_restored(self):
        self.io.guards({HOOK: self.before, **self.baseline_guards()})
        if self.telemetry:self.io.telemetry_restored(self.telemetry)

    def rollback(self, action, info, state):
        self.validate_action(action)
        if action.component == 'telemetry':
            self.io.guards({HOOK: self.before, **self.baseline_guards()})
            self.io.rollback_telemetry(self.folder.name, self.telemetry)
            self.io.telemetry_restored(self.telemetry)
            return
        current = state['files'][HOOK]
        if current not in (self.before, self.after):raise Refused('Native rollback would overwrite a later hook change')
        self.io.guards(self.baseline_guards())
        if current == self.after:
            self.io.guards({self.p['previous']: self.before})
            self.io.switch(self.folder.name, self.after, self.before, reverse=True)
        # Deliberately retain data, backups and staged binaries. A current boot
        # may still execute them. No process stop, source write or reboot here.


def engine_for(io, folder, info, target_binding, state_dir):
    driver = NativeDriver(io, folder, info)
    choices = resolve('qn90a', overrides={'components': [], 'exclude': [], 'keep': [], 'remove': [], 'artifacts': {}})
    engine = Engine(driver, folder, 'qn90a', choices, target_binding=target_binding,
                    state_dir=state_dir, scope=SCOPE)
    return driver, engine
