"""Pure, testable state classification and dependency-ordered changes."""
from dataclasses import asdict, dataclass, field
import json
from .common import REPO, Refused, sha
from .config import selected, validate_endpoint
from .transport import CACHE, PREFS, SAVER, STOCK

HUB = 'MiniHub001.Hub'
STOCK_HOME = 'com.samsung.tv.csfs'
EMPTY = sha(b'')
RENDERER = 'db5656113275e613d9475c09af1c768cd8ad57d60eac31213214684721cc418a'
STOCK_RENDERER = '4f0b36d9639a194936def6250a03db1383db284f11f74d83ec7dda50420befaa'
CACHE_STOCK = '3ffa26a62b1550c3e85993953bb59cf3cc38d688ddfd4f9d500cc37b6db15123'
CACHE_PATCHED = '6cf17c5e96002b350bc7a7f4ba9a4c1b55a2d3fe9213570bcb7c3beab750598c'
CACHE_TABLE = 'afba7a1d0bf0d2ae60b9f1d63c44001efff868eea03238c1ff2b4fd70f9b5433'
DIAGNOSTIC = 'c6369e7dec69408e176daa252d436acf6f8e265f560504d8bd831c8023c71d61'
SPLASH_NATIVE = 'da40cc2088fd63d06fd3170fcb0e797b45125335e154b67912108bce21b29882'
SPLASH_RESOURCE = '9895cdeba1abef45c60cf13057cc662f159caf94db17436713cbc9d5649b587f'
KNOWN_HELPERS = {'628205965e629530c645fb069b1f6006abe2431ce6ad5d7066c007ce6fa95ccb',
                 '4a6fdb3d979ab13ed8d38b2bc6e1b9b94e5a04294312d0f9b50cc7f1f0a6c987',
                 '93dec0d4ce234dbdae288f0747134447771a6680f36e11483b62c90f4820579f'}
MANAGED = {'MiniHub001':('MiniHub001.Hub','wgt'),'MiniSave01':('MiniSave01.Saver','wgt'),
           'MiniHubBoot':('MiniHubBoot.Start','tpk'),'MiniTelemetry':('MiniTelemetry.Start','tpk')}

def managed_package_ok(row):
    return row[0] in MANAGED and tuple(row[1:3])==MANAGED[row[0]] and row[4:]==['true','false','false','false']


BOOT_RULE = ['MiniHubBoot.Start','package:org.tizen.welcome-mode','start','launch','package:MiniHubBoot.Start',None,None]
AIRPLAY_RULES = [[HUB,'package:'+app+',~context:standby,vconf:(ready=memory/menu/network/airplay_status)',event,'launch','package:'+HUB,None,None]
                for app,event in [('NRi6kdBYJ0.AirPlayWebApp','pause'),('com.samsung.tv.airplay-app','deactivate')]]
HOME_STOCK = [STOCK_HOME,'XF86Home',None,None,'','launch','package:'+STOCK_HOME,'entry_point:smarthub_key']
HOME_DESIRED = [STOCK_HOME,'XF86Home',None,None,'','launch','package:'+HUB,None]

@dataclass
class Action:
    id: str
    component: str
    kind: str
    before: object
    after: object
    options: dict = field(default_factory=dict)

@dataclass
class Plan:
    device: str
    states: dict = field(default_factory=dict)
    reasons: dict = field(default_factory=dict)
    actions: list = field(default_factory=list)
    issues: list = field(default_factory=list)

    def add(self, component, kind, before, after, **options):
        if before == after: return
        self.actions.append(Action(str(len(self.actions)+1).zfill(3)+'-'+component, component, kind, before, after, options))
        status = 'missing' if before in (None, [], {}) else 'drifted'
        old = self.states.get(component)
        self.states[component] = old if old=='unsupported' else 'partially applied' if old in ('missing','drifted') and old != status else status

    def unsupported(self, component, message):
        self.states[component] = 'unsupported'; self.issues.append(component+': '+message)

    def json(self):
        result=asdict(self)
        for action in result['actions']:
            if action['kind']=='preferences':
                for side in ('before','after'):
                    if isinstance(action[side],dict):
                        action[side]={k:v for k,v in action[side].items() if k in ('schema','enabled','endpoint')}
        return result


def hub_sources(device, *, device_id=None):
    """Exact Hub inputs; None preserves the unconfigured native WebView source."""
    names = ('index.html','style.css','bridge.js','presentation.js','model.js','feedback.js','telemetry.js','hub.js','icon.png','config.xml')
    result = {name:(REPO/'web'/name).read_bytes() for name in names}
    if device is None:return result
    result['telemetry.js'] = ('window.HUB_DEVICE_ID = '+json.dumps(device_id or device)+';\n').encode()+result['telemetry.js']
    result['index.html'] = result['index.html'].replace(b'</head>', b'  <script src="telemetry-service.js" defer></script>\n</head>')
    result['telemetry-service.js'] = (REPO/'web/telemetry-service.js').read_bytes()
    if device == 'qn90a':
        result['index.html'] = result['index.html'].replace(b'</head>', b'  <script src="qn90a-idle.js" defer></script>\n</head>')
        result['qn90a-idle.js'] = (REPO/'research/qn90a-screensaver/hub-idle.js').read_bytes()
    return result


def source_revision():
    roots = [REPO/'research/toolkit', REPO/'tvsetup', REPO/'web',REPO/'research/s90d-telemetry',REPO/'research/system-screensaver',
             REPO/'research/s90d-splash',REPO/'research/namespace-root-probe',REPO/'research/qn90a-app-cleanup',REPO/'research/qn90a-screensaver',REPO/'research/qn90a-hub-boot/relay',
             REPO/'research/qn90a-telemetry-startup/service', REPO/'research/qn90a-telemetry-startup/bootstrap']
    files = sorted({p for root in roots for p in root.rglob('*') if p.is_file() and p.suffix in ('.py','.json','.cs','.c','.h','.js','.css','.html','.xml','.csproj','.glsl') and not {'bin','obj'} & set(p.relative_to(root).parts) and p.name not in ('core.js','shaders.js')})
    files=sorted(set(files)|{REPO/'tools/qn90a/root-check.py',REPO/'global.json',REPO/'Directory.Build.props'})
    return sha(b''.join(str(p.relative_to(REPO)).encode()+b'\0'+p.read_bytes() for p in files))


def artifact_group(path):
    if '/MiniHubBoot/bin/' in path:return 'boot'
    if '/MiniTelemetry/bin/' in path:return 'service'
    if path in ('/opt/minimal-saver/Boot.dll','/opt/minimal-saver/Boot.deps.json','/opt/minimal-saver/Boot.runtimeconfig.json','/opt/minimal-telemetry/Telemetry.dll'):return 'helper'
    if path.endswith(('/MiniSave01/res/wgt/core.js','/MiniSave01/res/wgt/shaders.js')):return 'saver'
    return None


def component_revision(kind):
    groups = {
        'boot': ['research/qn90a-hub-boot/relay'],
        'service': ['research/qn90a-telemetry-startup/service','research/qn90a-telemetry-startup/bootstrap','research/s90d-telemetry/collector'],
        'helper': ['research/system-screensaver/boot','research/s90d-splash/Splash.cs','research/s90d-telemetry/collector','research/s90d-telemetry/build.py'],
        'saver': ['research/qn90a-screensaver/core.c','research/qn90a-screensaver/fragment.glsl','research/qn90a-screensaver/build-web.sh','research/system-screensaver/renderer.c','research/system-screensaver/simulation.h','research/system-screensaver/mesh.h']}
    files=[]
    for name in groups[kind]:
        path=REPO/name
        files.extend([path] if path.is_file() else [p for p in path.rglob('*') if p.is_file() and not {'bin','obj'} & set(p.relative_to(path).parts)])
    return sha(b''.join(str(p.relative_to(REPO)).encode()+b'\0'+p.read_bytes() for p in sorted(files)))


def package_files(state, pkg, expected):
    return {path:state['files'].get(path) for path in expected}


def cleanup_eligibility(profile, state, pkg):
    entry = profile['cleanup'][pkg]
    rows = [r for r in state['packages'] if r[0]==pkg]
    apps = [r for r in state['apps'] if r[1]==pkg]
    catalogs = [r for r in state.get('catalog',[]) if r[0]==pkg]
    if not rows:
        if apps or catalogs or state.get('package_files',{}).get(pkg,False): return 'partially applied', 'Registration remains after an incomplete uninstall'
        return 'already correct', None
    expected = [pkg,entry['app'],entry['type'],entry['reviewed_version'],'true','false','false','false']
    if rows != [expected] or not any(r[0]==entry['app'] for r in apps):
        return 'unsupported', 'Identity, reviewed version, registration, or protection flags changed'
    if any(r[1]==pkg for r in state['dependencies']): return 'unsupported','Another package depends on this app'
    if profile['id']=='qn90a' and catalogs != [[pkg,entry['app'],'1','0','0','3','1','0']]:
        return 'unsupported','Samsung catalog identity/protection check failed'
    return 'drifted', None


def plan(profile, choices, state, ledger=None):
    device = profile['id']; want = selected(choices); p = Plan(device)
    for c in want: p.states[c]='already correct'; p.reasons[c]=profile['reasons'][c]
    ledger = ledger or {}
    overrides = ledger.get('files',{})
    def desired(path, fallback):
        kind = artifact_group(path)
        if kind and ledger.get('artifact_sources',{}).get(path)==component_revision(kind):return overrides.get(path,fallback)
        return fallback
    def compiled(kind, value): return value if profile.get('source_hashes',{}).get(kind)==component_revision(kind) else 'build'
    def package(component, key, pkg, expected):
        expected = {path:desired(path,h) for path,h in expected.items()}
        before = package_files(state,pkg,expected)
        exists = [r for r in state['packages'] if r[0]==pkg]
        if exists and (len(exists)!=1 or not managed_package_ok(exists[0])):
            p.unsupported(component,'Managed package identity/type/protection flags changed: '+pkg);return
        if not exists and any(before.values()): p.unsupported(component,'Unregistered package files: '+pkg); return
        if not exists or before != expected:
            p.add(component,'package',before if exists else None,expected,artifact=key,package=pkg,previous_version=exists[0][3] if exists else None)
    if 'hub' in want:
        expected = {'/opt/usr/apps/MiniHub001/res/wgt/'+n:sha(b) for n,b in hub_sources(device).items() if n != 'config.xml'}
        # The signer advances the widget version; compare runtime content only.
        package('hub','hub','MiniHub001',expected)
    if device=='qn90a':
        if 'screensaver' in want:
            expected = {'/opt/usr/apps/MiniSave01/res/wgt/'+n:sha((REPO/'research/qn90a-screensaver/web'/n).read_bytes()) for n in ('index.html','saver.js','icon.png')}
            expected.update({'/opt/usr/apps/MiniSave01/res/wgt/'+n:h for n,h in {n:compiled('saver',h) for n,h in profile['saver_generated'].items()}.items()})
            package('screensaver','saver','MiniSave01',expected)
        if 'home' in want:
            current = state['key_filter']
            if current not in ([HOME_STOCK],[HOME_DESIRED]): p.unsupported('home','Unknown Home key row; cannot overwrite')
            else: p.add('home','routes',current,[HOME_DESIRED],table='key_filter',scope='home')
            current = [r for r in state['managed_app'] if r[0]==HUB]
            if current not in ([],[[HUB,None,None]]): p.unsupported('home','Unknown Hub managed row')
            else: p.add('home','routes',current,[[HUB,None,None]],table='managed_app',scope=HUB)
        if 'airplay' in want:
            current = [r for r in state['task_filter'] if r[0]==HUB]
            if any(r not in AIRPLAY_RULES for r in current) or len({tuple(r) for r in current})!=len(current): p.unsupported('airplay','Unknown/duplicate AirPlay rules')
            else: p.add('airplay','routes',sorted(current,key=str),sorted(AIRPLAY_RULES,key=str),table='task_filter',scope=HUB)
        if 'startup' in want:
            package('startup','boot','MiniHubBoot',{'/opt/usr/apps/MiniHubBoot/bin/'+n:h for n,h in {n:compiled('boot',h) for n,h in profile['boot_artifacts'].items()}.items()})
            for table, expected in [('managed_app',[['MiniHubBoot.Start',None,None]]),('task_filter',[BOOT_RULE])]:
                current = [r for r in state[table] if r[0]=='MiniHubBoot.Start']
                if current not in ([],expected): p.unsupported('startup','Unknown boot relay rows')
                else: p.add('startup','routes',current,expected,table=table,scope='MiniHubBoot.Start')
    else:
        # These native protections are checked even with custom artifact paths/settings.
        integration = set(want) & {'screensaver','splash','startup'}
        if integration:
            for path, expected in [(CACHE+'.table',CACHE_TABLE),('/opt/etc/parseinfo.sh',DIAGNOSTIC),('/usr/bin/boot_splashscreen',SPLASH_NATIVE),('/usr/apps/com.samsung.tv.csfs/shared/res/homeloading.edj',SPLASH_RESOURCE)]:
                if state['files'].get(path)!=expected:
                    for c in integration: p.unsupported(c,'Firmware resource changed or unreadable: '+path)
            for path, known in [(CACHE,{CACHE_STOCK,CACHE_PATCHED}),(STOCK,{STOCK_RENDERER,RENDERER}),(SAVER+'/Boot.dll',KNOWN_HELPERS|{None,overrides.get(SAVER+'/Boot.dll')})]:
                if state['files'].get(path) not in known:
                    for c in integration: p.unsupported(c,'Unreviewed integration bytes: '+path)
        if 'screensaver' in want:
            for path, value, artifact in [(SAVER+'/libgl-demo-app.so',RENDERER,'renderer'),(SAVER+'/enabled',EMPTY,'empty')]:
                p.add('screensaver','file',state['files'].get(path),value,path=path,artifact=artifact)
        if integration:
            # Preserve the combined saver/splash helper. Its dormant legacy
            # telemetry code is retained only for migration rollback.
            component = next(c for c in ('startup','splash','screensaver') if c in want)
            path=SAVER+'/Boot.dll';p.add(component,'file',state['files'].get(path),desired(path,compiled('helper',profile['helper_sha256'])),path=path,artifact='helper')
            for name in ('Boot.runtimeconfig.json','Boot.deps.json'):
                path=SAVER+'/'+name
                if not state['files'].get(path): p.add(component,'file',None,'build',path=path,artifact=name)
            if state['files'].get(CACHE)!=CACHE_PATCHED:
                p.add(component,'cache',state['files'].get(CACHE),CACHE_PATCHED,path=CACHE)
        if 'splash' in want: p.add('splash','file',state['files'].get('/opt/minimal-splash/enabled'),EMPTY,path='/opt/minimal-splash/enabled',artifact='empty')
        if 'home' in want or 'startup' in want:
            c = 'home' if 'home' in want else 'startup'
            current=state['settings'].get('db/appfw/home_appid')
            if current not in (HUB,STOCK_HOME): p.unsupported(c,'Unknown Home assignment')
            else: p.add(c,'setting',current,HUB,key='db/appfw/home_appid')
            current=state['settings'].get('db/menu/smart_hub/ontvsetting/auto_start')
            if current not in (0,1): p.unsupported(c,'Unknown autostart value')
            else: p.add(c,'setting',current,1,key='db/menu/smart_hub/ontvsetting/auto_start')
            rows=state.get('home_operation',[])
            if len(rows)!=1 or rows[0][3] not in (HUB,STOCK_HOME): p.unsupported(c,'Native Home operation is missing or ambiguous')
            else: p.add(c,'home_operation',rows[0][3],HUB)
    if 'telemetry' in want:
        if device=='s90d':
            legacy='/opt/minimal-telemetry/enabled'
            if state['files'].get(legacy) not in (None,EMPTY):p.unsupported('telemetry','Unreviewed legacy collector marker; inspect before migrating')
            else:p.add('telemetry','file',state['files'].get(legacy),None,path=legacy,artifact='legacy-disable')
        package('telemetry','service','MiniTelemetry',{'/opt/usr/apps/MiniTelemetry/bin/'+n:compiled('service',h) for n,h in profile['service_artifacts'].items()})
        config_path = '/opt/usr/home/owner/apps_rw/MiniTelemetry/data/config.json'
        if state['files'].get(config_path) in ('UNREADABLE','SYMLINK'): p.unsupported('telemetry','Private pairing is inaccessible; use --privileged-inspection for a bounded read through the existing root transport')
        if state['files'].get(config_path) is None: p.add('telemetry','pairing',None,'paired',path=config_path)
        enabled=config_path.rsplit('/',1)[0]+'/enabled'
        if state['files'].get(enabled) not in ('UNREADABLE','SYMLINK'):
            p.add('telemetry','file',state['files'].get(enabled),EMPTY,path=enabled,artifact='empty',private_package=True)
        prefs=state.get('preferences')
        if prefs is not None:
            if not isinstance(prefs,dict) or prefs.get('schema')!=1 or type(prefs.get('enabled')) is not bool:
                p.unsupported('telemetry','Malformed telemetry preferences')
            else: validate_endpoint(device,prefs.get('endpoint'))
        desired_prefs = dict(prefs or dict(schema=1,enabled=False,endpoint='https://receiver.example.invalid/v1/devices/'+device))
        if prefs is None and choices['endpoint'] is None:
            p.unsupported('telemetry','First pairing requires an explicit --endpoint HTTPS URL; monitoring defaults to disabled')
        if choices['telemetry_enabled'] is not None: desired_prefs['enabled']=choices['telemetry_enabled']
        if choices['endpoint'] is not None: desired_prefs['endpoint']=choices['endpoint']
        p.add('telemetry','preferences',prefs,desired_prefs,path=PREFS,before_hash=state['files'].get(PREFS))
    if 'cleanup' in want:
        for pkg in profile['cleanup']:
            if pkg in choices['keep'] or pkg not in choices['remove']: continue
            status, why = cleanup_eligibility(profile,state,pkg)
            if why:
                p.states['cleanup']=status;p.issues.append('cleanup '+pkg+': '+why)
            elif status!='already correct':
                p.add('cleanup','uninstall',[r for r in state['packages'] if r[0]==pkg],None,package=pkg)
    # Explicit dependencies may be excluded only when already satisfied live.
    installed={r[0] for r in state['packages']}
    installed.update(a.options['package'] for a in p.actions if a.kind=='package')
    for c in ('home','airplay','startup','screensaver','telemetry'):
        if c in want and 'MiniHub001' not in installed: p.unsupported(c,'Requires hub; include --components hub,'+c)
    if 'telemetry' in want and 'hub' not in want:
        expected=sha(hub_sources(device)['telemetry-service.js'])
        if state['files'].get('/opt/usr/apps/MiniHub001/res/wgt/telemetry-service.js')!=expected:
            p.unsupported('telemetry','Requires the current Hub service adapter; include --components hub,telemetry')
    if device=='qn90a' and 'startup' in want:
        home_ok = state['key_filter']==[HOME_DESIRED] or 'home' in want
        air_ok = sorted([r for r in state['task_filter'] if r[0]==HUB],key=str)==sorted(AIRPLAY_RULES,key=str) or 'airplay' in want
        if not home_ok or not air_ok: p.unsupported('startup','Requires accepted Home/AirPlay routes; include those components')
    # Drain the legacy collector before packages; pair before enabling service.
    order_actions(p)
    return p


def order_actions(p):
    rank={'nas':-1,'package':0,'pairing':1,'file':2,'preferences':3,'routes':4,'setting':5,'home_operation':5,'cache':6,'uninstall':9}
    p.actions.sort(key=lambda a:-2 if a.options.get('artifact')=='legacy-disable' else rank[a.kind])
