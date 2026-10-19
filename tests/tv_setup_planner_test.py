import copy
import json
from pathlib import Path
import sqlite3
import unittest
from tvsetup.common import Refused, sha
from tvsetup.config import profile as saved_profile, resolve
from tvsetup.planner import (plan, hub_sources, HOME_DESIRED, AIRPLAY_RULES, BOOT_RULE,
                            CACHE_PATCHED,CACHE_TABLE,DIAGNOSTIC,SPLASH_NATIVE,SPLASH_RESOURCE,
                            RENDERER,EMPTY,HUB,source_revision,component_revision,MANAGED)
from tvsetup.transport import CACHE,SAVER,STOCK,PREFS,TABLES,decode_rows,managed_guard
from tvsetup.operations import route_sql

# An accepted fixture represents a reviewed build of the current source. Pin
# this once so tests that deliberately change component_revision still detect
# drift, without depending on the historical binary hashes in the live profile.
FIXTURE_SOURCES = {kind: component_revision(kind) for kind in ('boot', 'service', 'helper', 'saver')}

def profile(device):
    result = saved_profile(device)
    result['source_hashes'].update(FIXTURE_SOURCES)
    return result


def accepted(device):
    p=profile(device)
    state=dict(device=device,boot='a-boot',uptime=100,files={},packages=[],apps=[],dependencies=[],catalog=[],package_files={},
               settings={'db/appfw/home_appid':HUB,'db/menu/smart_hub/ontvsetting/auto_start':1},
               preferences={'schema':1,'enabled':True,'endpoint':'https://192.0.2.20:20490/v1/devices/'+device},
               home_operation=[['http://tizen.org/appcontrol/operation/main','NULL','NULL',HUB]],telemetry_status='',boot_status='')
    def pkg(id):state['packages'].append([id,*MANAGED[id],'0.4.1','true','false','false','false'])
    pkg('MiniHub001')
    state['files'].update({'/opt/usr/apps/MiniHub001/res/wgt/'+n:sha(data) for n,data in hub_sources(device).items()})
    state['files'][PREFS]=sha(json.dumps(state['preferences']).encode())
    if device=='qn90a':
        for id in ('MiniSave01','MiniHubBoot'):pkg(id)
        state.update(key_filter=[HOME_DESIRED],managed_app=[[HUB,None,None],['MiniHubBoot.Start',None,None]],task_filter=AIRPLAY_RULES+[BOOT_RULE])
        from tvsetup.common import REPO
        state['files'].update({'/opt/usr/apps/MiniSave01/res/wgt/'+n:sha((REPO/'research/qn90a-screensaver/web'/n).read_bytes()) for n in ('index.html','saver.js','icon.png')})
        state['files'].update({'/opt/usr/apps/MiniSave01/res/wgt/'+n:h for n,h in p['saver_generated'].items()})
        state['files'].update({'/opt/usr/apps/MiniHubBoot/bin/'+n:h for n,h in p['boot_artifacts'].items()})
        root='/opt/usr/home/owner/apps_rw/MiniTelemetry/data'
    else:
        state['files'].update({CACHE:CACHE_PATCHED,CACHE+'.table':CACHE_TABLE,'/opt/etc/parseinfo.sh':DIAGNOSTIC,STOCK:RENDERER,
                              '/usr/bin/boot_splashscreen':SPLASH_NATIVE,'/usr/apps/com.samsung.tv.csfs/shared/res/homeloading.edj':SPLASH_RESOURCE,
                              SAVER+'/Boot.dll':p['helper_sha256'],SAVER+'/Boot.runtimeconfig.json':sha(b'runtime'),SAVER+'/Boot.deps.json':sha(b'deps'),
                              SAVER+'/libgl-demo-app.so':RENDERER,SAVER+'/enabled':EMPTY,'/opt/minimal-splash/enabled':EMPTY,
                              '/opt/minimal-telemetry/Telemetry.dll':p['collector_sha256']})
    pkg('MiniTelemetry')
    state['files'].update({'/opt/usr/apps/MiniTelemetry/bin/'+n:h for n,h in p['service_artifacts'].items()})
    root='/opt/usr/home/owner/apps_rw/MiniTelemetry/data'
    state['files'].update({root+'/config.json':sha(b'private'),root+'/enabled':EMPTY})
    return copy.deepcopy(state)


class PlannerTests(unittest.TestCase):
    def test_accepted_both_are_idempotent(self):
        for d in ('qn90a','s90d'):
            p=plan(profile(d),resolve(d),accepted(d))
            self.assertEqual(p.actions,[]);self.assertEqual(p.issues,[])

    def test_cli_precedence_and_preserve(self):
        pkg=next(iter(profile('qn90a')['cleanup']))
        c=resolve('qn90a',{'telemetry_enabled':False,'keep':[pkg]}, {'telemetry_enabled':True}, {'telemetry_enabled':False,'remove':[pkg]})
        self.assertFalse(c['telemetry_enabled']);self.assertNotIn(pkg,c['keep']);self.assertEqual(c['remove'],[pkg])
        s=accepted('qn90a');s['preferences']['enabled']=False;s['preferences']['extra']='preserve'
        self.assertEqual(plan(profile('qn90a'),resolve('qn90a'),s).actions,[])

    def test_identity_and_protected_overrides_rejected(self):
        for option in ({'firmware':'anything'},{'host':'1.2.3.4'},{'remove':['com.samsung.tv.csfs']},{'artifacts':{'cache':'x'}}):
            with self.assertRaises(Refused):resolve('qn90a',overrides=option)
        for url in ('http://192.0.2.20/v1/devices/qn90a','https://a/v1/devices/s90d','https://user:pass@a/v1/devices/qn90a','https://a/v1/devices/qn90a?token=x'):
            with self.assertRaises(Refused):resolve('qn90a',overrides={'endpoint':url})

    def test_cleanup_is_reviewed_identity_version_and_dependencies(self):
        d='qn90a';p=profile(d);pkg=next(iter(p['cleanup']));entry=p['cleanup'][pkg]
        s=accepted(d);row=[pkg,entry['app'],entry['type'],entry['reviewed_version'],'true','false','false','false']
        s['packages'].append(row);s['apps'].append([entry['app'],pkg]);s['catalog'].append([pkg,entry['app'],'1','0','0','3','1','0'])
        self.assertEqual([a.kind for a in plan(p,resolve(d),s).actions],['uninstall'])
        for field in (1,2,3,4,5,6,7):
            changed=copy.deepcopy(s);changed['packages'][-1][field]='changed'
            self.assertTrue(plan(p,resolve(d),changed).issues)
        s['dependencies']=[['dependent',pkg]]
        self.assertTrue(plan(p,resolve(d),s).issues)

    def test_partial_cleanup_is_not_retried(self):
        s=accepted('qn90a');pkg=next(iter(profile('qn90a')['cleanup']))
        s['package_files'][pkg]=True
        p=plan(profile('qn90a'),resolve('qn90a'),s)
        self.assertEqual(p.states['cleanup'],'partially applied');self.assertFalse(p.actions)

    def test_remove_subset_and_keep(self):
        c=resolve('s90d',overrides={'remove':[]})
        self.assertEqual(c['remove'],[])
        c=resolve('s90d',overrides={'keep':['com.microsoft.copilot']})
        self.assertNotIn('com.microsoft.copilot',c['remove'])

    def test_qn_never_uses_s90d_cache_or_memory_patches(self):
        s=accepted('qn90a');s['packages']=[];s['files']={};s.update(key_filter=[],managed_app=[],task_filter=[])
        p=plan(profile('qn90a'),resolve('qn90a'),s)
        self.assertFalse(any(a.kind=='cache' for a in p.actions))
        self.assertFalse(any('minimal-saver' in str(a.options) for a in p.actions))
        self.assertNotIn('memory', [a.kind for a in p.actions])

    def test_excluded_dependencies_require_live_install(self):
        s=accepted('qn90a');s['packages']=[r for r in s['packages'] if r[0]!='MiniHub001']
        p=plan(profile('qn90a'),resolve('qn90a',overrides={'components':['startup']}),s)
        self.assertTrue(any('Requires hub' in e for e in p.issues))

    def test_model_protections_and_unknown_bytes(self):
        s=accepted('s90d');s['files'][CACHE]='a'*64
        p=plan(profile('s90d'),resolve('s90d'),s)
        self.assertEqual(p.states['startup'],'unsupported');self.assertTrue(p.issues)
        self.assertIn(profile('qn90a')['host_sha256'],managed_guard(profile('qn90a')))
        self.assertNotIn(profile('s90d')['host_sha256'],managed_guard(profile('qn90a')))

    def test_signer_update_ledger_makes_reapply_noop(self):
        s=accepted('s90d');path=SAVER+'/Boot.dll';s['files'][path]='b'*64
        ledger=dict(source_revision=source_revision(),files={path:'b'*64},artifact_sources={path:component_revision('helper')})
        self.assertFalse(plan(profile('s90d'),resolve('s90d'),s,ledger).actions)

    def test_managed_package_protection_cannot_be_bypassed(self):
        s=accepted('qn90a');s['packages'][0][-1]='true'
        p=plan(profile('qn90a'),resolve('qn90a'),s)
        self.assertEqual(p.states['hub'],'unsupported')
        self.assertFalse(any(a.options.get('package')=='MiniHub001' for a in p.actions))

    def test_changed_native_source_requires_update(self):
        from unittest.mock import patch
        real=component_revision
        with patch('tvsetup.planner.component_revision',side_effect=lambda kind:'changed' if kind=='boot' else real(kind)):
            p=plan(profile('qn90a'),resolve('qn90a'),accepted('qn90a'))
        self.assertTrue(any(a.kind=='package' and a.options['package']=='MiniHubBoot' for a in p.actions))

    def test_hex_rows_and_nulls(self):
        self.assertEqual(decode_rows('610A627C|-|\n'),[['a\nb|',None,'']])

    def test_routing_compare_and_swap_and_inverse(self):
        from tvsetup.planner import Action,HOME_STOCK
        db=sqlite3.connect(':memory:');self.addCleanup(db.close);cols=TABLES['key_filter'][2]
        db.execute('CREATE TABLE key_filter('+','.join(c+' TEXT' for c in cols)+')')
        original=HOME_STOCK
        db.execute('INSERT INTO key_filter VALUES('+','.join('?' for _ in cols)+')',original);db.commit()
        a=Action('a','home','routes',[original],[HOME_DESIRED],dict(table='key_filter',scope='home'))
        db.executescript(route_sql(a));self.assertEqual(list(db.execute('SELECT * FROM key_filter')),[tuple(HOME_DESIRED)])
        with self.assertRaises(sqlite3.IntegrityError):db.executescript(route_sql(a))
        db.rollback();db.executescript(route_sql(a,True))
        self.assertEqual(list(db.execute('SELECT * FROM key_filter')),[tuple(original)])

if __name__=='__main__':unittest.main()
