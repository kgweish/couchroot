"""Read-only SDK inspection; mutations use the existing guarded temporary root chain."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import sys
import uuid
from .common import PRIVATE, REPO, Refused, run, sha

Q = shlex.quote
PKG_DB = '/opt/dbspace/.pkgmgr_parser.db'
CONTEXT_DB = '/opt/dbspace/.app-context.db'
WAS_DB = '/opt/dbspace/.webappservice.db'
KEYS = ('db/appfw/home_appid', 'db/appfw/overlay_home_appid', 'db/first_screen/type',
        'db/menu/smart_hub/ontvsetting/auto_start', 'memory/appfw/current_fullscreen_appid')
TABLES = {
    'packages': (PKG_DB, 'package_info', ('package','mainapp_id','package_type','package_version','package_removable','package_preload','package_readonly','package_system'), ''),
    'apps': (PKG_DB, 'package_app_info', ('app_id','package'), ''),
    'dependencies': (PKG_DB, 'package_dependency_info', ('package','depends_on'), ''),
    'key_filter': (CONTEXT_DB, 'key_filter', ('appid','key','longpress','override','on_selector','request','target_selector','args'), " WHERE appid='com.samsung.tv.csfs' AND key='XF86Home'"),
    'managed_app': (CONTEXT_DB, 'managed_app', ('appid','ui_type','source'), " WHERE appid IN ('MiniHub001.Hub','MiniHubBoot.Start')"),
    'task_filter': (CONTEXT_DB, 'task_filter', ('appid','source_selector','source_event','request','target_selector','target','args'), " WHERE appid IN ('MiniHub001.Hub','MiniHubBoot.Start')"),
    'catalog': (WAS_DB, 'widgetinfo', ('pkgname','tizen_id','is_removable','is_system','is_lock','install_state','is_app_available','is_need_reset'), ''),
    'home_operation': ('/opt/dbspace/user/5001/.appsvc.db', 'appsvc', ('operation','mime_type','uri','pkg_name'), " WHERE operation='http://tizen.org/appcontrol/operation/main'"),
}
PREFS = '/opt/usr/home/owner/apps_rw/MiniHub001/data/telemetry.json'
SAVER = '/opt/minimal-saver'
STOCK = '/usr/apps/com.samsung.tv.spotlight-ss/lib/arm/libgl-demo-app.so'
CACHE = '/opt/etc/systemd/oneservice'


def identity_guard(profile):
    """Firmware/architecture checks independent of a managed execution path."""
    script = 'set -eu\n'
    script += f"grep -qx {Q('Version='+profile['firmware']+';')} /etc/prd_info.ini\n"
    script += f'test "$(uname -m)" = {Q(profile["architecture"])}\n'
    return script


def managed_guard(profile):
    """Retain the runtime and signed-host pins wherever .NET still executes."""
    script = identity_guard(profile)
    script += f'test -d /usr/share/dotnet/shared/Microsoft.NETCore.App/{Q(profile["runtime"])}\n'
    script += hash_guard('/usr/bin/dotnet', profile['host_sha256'])
    if profile.get('launcher_sha256'): script += hash_guard('/usr/bin/dotnet-launcher', profile['launcher_sha256'])
    return script


def hash_guard(path, digest):
    if digest is None: return f'test ! -e {Q(path)} && test ! -L {Q(path)}\n'
    if not re.fullmatch('[a-f0-9]{64}', digest): raise Refused('Invalid hash guard')
    return f'test ! -L {Q(path)}\ntest "$(sha256sum {Q(path)} | cut -d " " -f 1)" = {digest}\n'


def table_query(name):
    db, table, columns, where = TABLES[name]
    # Hex encoding is unambiguous even for NULL, tabs, pipes and embedded newlines.
    expr = ','.join(f"CASE WHEN {c} IS NULL THEN '-' ELSE hex({c}) END" for c in columns)
    return f"sqlite3 -readonly -separator '|' {Q(db)} {Q('SELECT '+expr+' FROM '+table+where+' ORDER BY '+','.join(columns)+';')}"


def decode_rows(text):
    return [[None if v == '-' else bytes.fromhex(v).decode() for v in line.split('|')]
            for line in text.splitlines() if line]


def paths(device):
    from .planner import hub_sources
    files = [f'/opt/usr/apps/MiniHub001/res/wgt/{name}' for name in hub_sources(device)]
    # WGT layout differs: the observer resolves res/wgt versus the package root.
    files += [PREFS]
    files += [f'/opt/usr/apps/MiniTelemetry/bin/{name}' for name in ('Service.dll','Service.deps.json','Service.runtimeconfig.json','Bootstrap.dll','Bootstrap.deps.json','Bootstrap.runtimeconfig.json','Telemetry.dll')]
    files += ['/opt/usr/home/owner/apps_rw/MiniTelemetry/data/config.json', '/opt/usr/home/owner/apps_rw/MiniTelemetry/data/enabled', '/opt/usr/home/owner/apps_rw/MiniTelemetry/data/preferences.json']
    if device == 'qn90a':
        files += [f'/opt/usr/apps/MiniSave01/res/wgt/{name}' for name in ('config.xml','index.html','saver.js','core.js','shaders.js','icon.png')]
        files += [f'/opt/usr/apps/MiniHubBoot/bin/{name}' for name in ('Boot.dll','Boot.deps.json','Boot.runtimeconfig.json')]
    else:
        files += [CACHE, CACHE+'.table', '/opt/etc/parseinfo.sh', STOCK, '/usr/bin/boot_splashscreen', '/usr/apps/com.samsung.tv.csfs/shared/res/homeloading.edj']
        files += [SAVER+'/'+name for name in ('Boot.dll','Boot.runtimeconfig.json','Boot.deps.json','libgl-demo-app.so','enabled')]
        files += ['/opt/minimal-splash/enabled', '/opt/minimal-telemetry/Telemetry.dll', '/opt/minimal-telemetry/config.json', '/opt/minimal-telemetry/enabled']
    return files


class Transport:
    def __init__(self, profile, evidence, *, native_bundle=None):
        self.profile, self.evidence = profile, evidence
        self.evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.native_bundle = None
        self.root_acquisition = dict(kind='managed')
        if native_bundle is not None:
            from .native_root import snapshot
            self.native_bundle = snapshot(profile, native_bundle, self.evidence/'native-acquisition')
            self.root_acquisition = dict(kind='native-acquisition-managed-entry',
                bundle=str(self.native_bundle),
                manifest_sha256=sha((self.native_bundle/'manifest.json').read_bytes()))
        from .toolkit import load
        toolkit=load();device,SdbClient=toolkit.device,toolkit.SdbClient
        self.cfg = dict(tv_host=profile['host'],expected_model=profile['model'],expected_platform=profile['platform'],expected_device_id=profile['device_id'])
        with contextlib.redirect_stdout(io.StringIO()): self.callback = device(self.cfg)
        self.client = SdbClient(PRIVATE/'bin/sdb', profile['host'])
        self.client.connect(); self.client.require_device()
        self.sdk(identity_guard(profile))

    def sdk(self, script, timeout=30):
        result = self.client.capture('(\n'+script+'\n)',callback_host=self.callback,bind_host=self.callback,timeout=timeout)
        path = self.evidence / ('sdk-'+uuid.uuid4().hex+'.log')
        path.write_text(result.output); path.chmod(0o600)
        match = re.search(r'\n\[exit:(\d+)\]\s*\Z', result.output)
        if not match or int(match[1]) or result.transport_returncode not in (0,1):
            raise Refused('SDK command incomplete/failed; private evidence: '+str(path))
        return result.output[:match.start()]

    def root(self, script, namespace=False, cleanup_index=None):
        if self.native_bundle is not None and cleanup_index is not None:
            raise Refused('Allowlisted app cleanup requires an explicit managed transport')
        if namespace:
            if self.profile['id'] != 's90d': raise Refused('Writable-cache/mount-namespace operation is S90D-only')
            script = 'nsenter -t 1 -m -- sh -c '+Q('set -eu\n'+script)
        path = self.evidence / ('root-'+uuid.uuid4().hex+'.sh')
        path.write_text(managed_guard(self.profile)+script); path.chmod(0o600)
        # The worker keeps Python root-transport imports isolated and bounds descendants.
        from .common import atomic_json
        configuration=path.with_suffix('.json');atomic_json(configuration,self.profile)
        argv = [sys.executable, '-m', 'tvsetup.worker', str(configuration), str(path)]
        if cleanup_index is not None:argv.append(str(cleanup_index))
        if self.native_bundle is not None:
            argv.extend(['--native-bundle', str(self.native_bundle)])
        try: output = run(argv, timeout=360, cwd=REPO)
        except Refused as error:
            path.with_suffix('.log').write_text(getattr(error,'output','Interrupted; completion unknown'))
            raise
        path.with_suffix('.log').write_text(output)
        return output

    def push(self, source, target):
        from pathlib import PurePosixPath
        self.client.push(Path(source), PurePosixPath(target))

    def snapshot(self, privileged=False):
        queries = {'identity': 'cat /etc/prd_info.ini; uname -m', 'boot': 'cat /proc/sys/kernel/random/boot_id',
                   'uptime': 'cat /proc/uptime', 'settings': '\n'.join('vconftool get '+Q(k) for k in KEYS)}
        for name in ('packages','apps','dependencies','home_operation'):
            queries[name] = table_query(name)
        if self.profile['id'] == 'qn90a':
            for name in ('key_filter','task_filter','managed_app','catalog'): queries[name] = table_query(name)
        optional=json.loads((REPO/'tvsetup/profiles'/(self.profile['id']+'.json')).read_text())['cleanup']
        for pkg in optional:
            queries['optional_'+pkg]=f'if test -e /opt/usr/apps/{pkg} || test -e /opt/share/packages/{pkg}.xml; then echo present; else echo absent; fi'
        queries['integrity'] = f"sqlite3 -readonly {PKG_DB} 'pragma quick_check;'"
        for n,path in enumerate(paths(self.profile['id'])):
            queries['file'+str(n)] = (f'if test -L {Q(path)}; then echo SYMLINK; elif test -r {Q(path)}; then sha256sum {Q(path)}; '
                                      f'elif test -e {Q(path)}; then echo UNREADABLE; else echo ABSENT; fi')
        queries['preferences'] = f'if test -r {Q(PREFS)}; then cat {Q(PREFS)}; elif test -e {Q(PREFS)}; then exit 4; fi'
        diagnostics = {'telemetry_status': '/tmp/minimal-telemetry-'+self.profile['id']+'/status.json',
                       'boot_status': '/tmp/minimal-hub-boot/status.json' if self.profile['id']=='qn90a' else '/opt/minimal-splash/last-boot.log'}
        for name,path in diagnostics.items(): queries[name] = f'if test -r {Q(path)}; then head -c 16384 {Q(path)}; fi'
        script = identity_guard(self.profile)
        for name, command in queries.items():
            script += f"printf '\\nTVSETUP_BEGIN:{name}\\n'\n{command}\nprintf '\\nTVSETUP_END:{name}\\n'\n"
        output = self.sdk(script, 45)
        blocks = {}
        for name in queries:
            match = re.search(r'\nTVSETUP_BEGIN:'+name+r'\n(.*?)\nTVSETUP_END:'+name+r'\n', output, re.S)
            if not match: raise Refused('Incomplete snapshot: '+name)
            blocks[name] = match[1].strip()
        if blocks['integrity'] != 'ok': raise Refused('Package database integrity failure')
        state = dict(device=self.profile['id'],boot=blocks['boot'],uptime=float(blocks['uptime'].split()[0]),files={},settings={})
        state['package_files']={pkg:blocks['optional_'+pkg]=='present' for pkg in optional}
        for name in TABLES:
            if name in blocks: state[name] = decode_rows(blocks[name])
        for path,n in zip(paths(self.profile['id']),range(len(paths(self.profile['id'])))):
            value = blocks['file'+str(n)]
            state['files'][path] = None if value=='ABSENT' else value.split()[0]
        for line in blocks['settings'].splitlines():
            match = re.fullmatch(r'([^,]+), value = (.*) \((String|Integer|Int|Int32)\)',line)
            if not match: raise Refused('Unrecognized vconf value; inspect the private SDK log')
            state['settings'][match[1]] = int(match[2]) if match[3]!='String' else match[2]
        try: state['preferences'] = json.loads(blocks['preferences']) if blocks['preferences'] else None
        except ValueError: raise Refused('Telemetry preference file is malformed; preserve and inspect it')
        for name in diagnostics: state[name] = blocks[name]
        state['pairing_config']=None
        if privileged:
            # A private parent can make SDK test -e falsely report absence.
            unreadable = [p for p,h in state['files'].items() if h=='UNREADABLE'
                          or p.startswith(('/opt/minimal-telemetry/','/opt/usr/home/owner/apps_rw/MiniTelemetry/'))]
            script=''
            for number,path in enumerate(unreadable):
                script+=f'printf "TV_SETUP_HASH_{number}="; if test -L {Q(path)}; then echo SYMLINK; elif test -f {Q(path)}; then sha256sum {Q(path)}; else echo ABSENT; fi\n'
            protected={name:path for name,path in diagnostics.items() if not state[name]}
            pairing_path='/opt/usr/home/owner/apps_rw/MiniTelemetry/data/config.json'
            if self.profile['id']=='s90d':
                protected['legacy_pairing_config']='/opt/minimal-telemetry/config.json'
            protected['pairing_config']=pairing_path
            for name,path in protected.items():
                script+=f'printf "\\nSETUP_{name}_BEGIN\\n"; test ! -L {Q(path)}; if test -f {Q(path)}; then head -c 4096 {Q(path)}; fi; printf "\\nSETUP_{name}_END\\n"\n'
            output=self.root(script) if script else ''
            for number,path in enumerate(unreadable):
                match=re.search(r'TV_SETUP_HASH_'+str(number)+r'=([a-f0-9]{64}|ABSENT|SYMLINK)',output)
                if not match:raise Refused('Privileged checksum unavailable: '+path)
                state['files'][path]=None if match[1]=='ABSENT' else match[1]
            for name,path in protected.items():
                match=re.search(r'\nSETUP_'+name+r'_BEGIN\n(.*?)\nSETUP_'+name+r'_END',output,re.S)
                if not match:raise Refused('Privileged inspection incomplete: '+name)
                if name in ('pairing_config','legacy_pairing_config'):
                    try:state[name]=json.loads(match[1]) if match[1].strip() else None
                    except ValueError:raise Refused('Malformed private pairing file; preserve and inspect it')
                else:state[name]=match[1].strip()
        return state
