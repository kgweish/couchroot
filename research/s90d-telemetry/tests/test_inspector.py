import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
import json
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'nas'))
from inspector import validate, carry, APP_TEXT, APP_FLAGS
from metrics import validate as validate_sample
from test_metrics import sample


def inventory(uptime=100):
    app=dict.fromkeys(APP_TEXT, 'test.app')
    app.update(dict.fromkeys(APP_FLAGS, False))
    app.update(label='<img src=x onerror=alert(1)>', on_boot=True, app_disabled=None)
    return {'schema':1,'uptime':uptime,
            'apps':{'status':'ok','rows':[app],'truncated':False,'skipped':0},
            'processes':{'status':'partial','rows':[{'pid':42,'name':'test','state':'S','rss_bytes':4096,'cpu_percent':None}],'truncated':False,'skipped':1}}


class InspectorTests(unittest.TestCase):
    def test_allowlist_preserves_unknown_and_drops_private_fields(self):
        value=inventory();value['token']='secret';value['processes']['rows'][0]['cmdline']='private'
        result=validate_sample(dict(sample(),inspector=value))['inspector']
        self.assertNotIn('token',result)
        self.assertNotIn('cmdline',result['processes']['rows'][0])
        self.assertIsNone(result['apps']['rows'][0]['app_disabled'])
        self.assertTrue(result['apps']['rows'][0]['on_boot'])

    def test_reject_bad_time_flags_counts_and_duplicates(self):
        mutations=[lambda v:v.update(uptime=101),lambda v:v.update(uptime=float('nan')),
                   lambda v:v['apps']['rows'][0].update(on_boot='false'),
                   lambda v:v['processes']['rows'][0].update(cpu_percent=float('inf')),
                   lambda v:v['apps'].update(rows=v['apps']['rows']*1025),
                   lambda v:v['apps']['rows'].append(copy.deepcopy(v['apps']['rows'][0])),
                   lambda v:v['apps'].update(status='unavailable'),
                   lambda v:v['apps'].update(truncated=True)]
        for change in mutations:
            with self.subTest(change=change):
                value=inventory();change(value)
                with self.assertRaises(ValueError):validate(value,100)

    def test_carry_is_bound_to_device_boot_and_session(self):
        old={'device':'s90d','boot':'a','session':'b','inspector':inventory()}
        new={k:v for k,v in old.items() if k!='inspector'};carry(new,old)
        self.assertEqual(new['inspector']['uptime'],100)
        for key in ('device','boot','session'):
            new={k:v for k,v in old.items() if k!='inspector'};new[key]='other';carry(new,old)
            self.assertNotIn('inspector',new)
        new=dict(old,inspector=inventory(120));carry(new,old)
        self.assertEqual(new['inspector']['uptime'],120)

    def test_qn90a_drops_legacy_inventory_and_never_carries_it_forward(self):
        for value in (inventory(), {'malformed':'retired inventory'}):
            clean=validate_sample(dict(sample(),device='qn90a',inspector=value))
            self.assertNotIn('inspector',clean)
            self.assertEqual(clean['stat'],sample()['stat'])
        old={'device':'qn90a','boot':'a','session':'b','inspector':inventory()}
        for current in (dict(old),{k:v for k,v in old.items() if k!='inspector'}):
            carry(current,old)
            self.assertNotIn('inspector',current)

    def test_managed_context_scope_preserves_unknown_memory(self):
        value=inventory();value['processes']['scope']='managed-apps'
        value['processes']['rows'][0].update(rss_bytes=None,state='?')
        result=validate(value,100)['processes']
        self.assertEqual(result['scope'],'managed-apps')
        self.assertIsNone(result['rows'][0]['rss_bytes'])
        value['processes']['scope']='all-processes'
        with self.assertRaises(ValueError):validate(value,100)

    def test_dashboard_exposes_selected_device_only(self):
        spec=importlib.util.spec_from_file_location('inspector_dashboard',Path(__file__).resolve().parents[1]/'dashboard/server.py')
        server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);registry={d:{'name':d.upper(),'chart_prefix':d,'snapshot':d+'.json'} for d in ('s90d','qn90a')}
            (root/'devices.json').write_text(json.dumps(registry))
            for d in registry:
                value=sample();value.update(received_at=100,inspector=inventory())
                value['inspector']['apps']['rows'][0]['label']=d
                (root/(d+'.json')).write_text(json.dumps(value))
            with patch.object(server,'DATA',root),patch.object(server,'query',return_value={'labels':[],'data':[]}):
                for d in registry:
                    result=server.snapshot(900,d)
                    if d=='qn90a':self.assertIsNone(result['inspector'])
                    else:self.assertEqual(result['inspector']['apps']['rows'][0]['label'],d)
                    self.assertTrue(all('inspector' not in entry['latest'] for entry in result['devices']))
        server.POOL.shutdown()


if __name__=='__main__':unittest.main()
