"""All Hub packaging entry points stage the same explicit runtime manifest."""
import contextlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile
from tvsetup.artifacts import Builder
from tvsetup.common import REPO, Refused
from tvsetup.installer import web_package
from tvsetup.planner import Action, hub_sources
from tvsetup.transport import paths

class Scripts(HTMLParser):
    def __init__(self, html):
        super().__init__();self.sources=[];self.feed(html)
    def handle_starttag(self, tag, attrs):
        if tag=='script' and dict(attrs).get('src'):self.sources.append(dict(attrs)['src'])

def members(path):
    with zipfile.ZipFile(path) as archive:return {n:archive.read(n) for n in archive.namelist()}

def fake_sign(argv, **kwargs):
    stage=Path(argv[-1]);out=Path(argv[argv.index('-o')+1])/'Minimal Hub.wgt'
    with zipfile.ZipFile(out,'w') as archive:
        for path in stage.rglob('*'):
            if path.is_file() and path!=out:archive.write(path,path.relative_to(stage))

ASSETS = {'index.html','style.css','tvos.css','icon.png','config.xml','logos/spotify.svg'} | {
    'logos/'+name for name in re.findall(r"logo: '([^']+)'",(REPO/'web/streaming-artwork.js').read_text())}

class ManifestTests(unittest.TestCase):
    def test_unregistered_artwork_never_enters_the_runtime_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            shutil.copytree(REPO/'web',root/'web')
            (root/'web/logos/unreviewed.png').write_bytes(b'private untracked artwork')
            with patch('tvsetup.planner.REPO',root):
                sources=hub_sources('s89c')
            self.assertNotIn('logos/unreviewed.png',sources)
            self.assertIn('logos/peacock.png',sources)

    def test_native_bundle_stages_nested_artwork_and_loads_the_native_adapter(self):
        build=(REPO/'native/webview/build.sh').read_text()
        script=build.split("<<'PY'\n",1)[1].split('\nPY\n',1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'hub'
            subprocess.run([sys.executable,'-c',script,str(REPO),str(REPO/'native/webview'),str(out)],check=True,capture_output=True)
            self.assertEqual((out/'logos/peacock.png').read_bytes(),(REPO/'web/logos/peacock.png').read_bytes())
            self.assertTrue((out/'tvos.css').is_file())
            html=(out/'index.html').read_text()
            self.assertLess(html.index('src="bridge.js"'),html.index('src="native-shim.js"'))
            self.assertIn((REPO/'native/webview/native-shim.css').read_text(),(out/'style.css').read_text())

    def test_native_sources_preserve_unconfigured_web_bytes(self):
        sources=hub_sources(None)
        scripts=Scripts((REPO/'web/index.html').read_text()).sources
        self.assertEqual(set(sources),set(scripts)|ASSETS)
        for name,data in sources.items():self.assertEqual(data,(REPO/'web'/name).read_bytes())

    def test_unsigned_packages_have_all_scripts_and_only_manifest_assets(self):
        for device in ('s89c','s90d','qn90a'):
            with self.subTest(device=device),tempfile.TemporaryDirectory() as tmp:
                expected=hub_sources(device)
                scripts=Scripts(expected['index.html'].decode()).sources
                original=Scripts((REPO/'web/index.html').read_text()).sources
                self.assertTrue(set(original)<=set(scripts))
                self.assertEqual(len(scripts),len(set(scripts)))
                self.assertEqual(set(expected),set(scripts)|ASSETS)
                web_package(device,Path(tmp)/'installer.wgt')
                self.assertEqual(members(Path(tmp)/'installer.wgt'),expected)
                subprocess.run([sys.executable,str(REPO/'scripts/package.py'),'--device',device,'--output-dir',tmp],check=True,stdout=subprocess.PIPE)
                self.assertEqual(members(Path(tmp)/('MinimalHub-'+device+'-unsigned.wgt')),expected)
                manifest=json.loads((Path(tmp)/('manifest-'+device+'.json')).read_text())
                self.assertEqual(manifest['device'],device)
                self.assertEqual(manifest['package'],'MinimalHub-'+device+'-unsigned.wgt')
                self.assertEqual({p.removeprefix('/opt/usr/apps/MiniHub001/res/wgt/') for p in paths(device) if p.startswith('/opt/usr/apps/MiniHub001/res/wgt/')},set(expected))

    def test_setup_builder_uses_identical_sources_except_forward_version(self):
        for device in ('s89c','s90d','qn90a'):
            with self.subTest(device=device),tempfile.TemporaryDirectory() as tmp:
                profile={'id':device,'signing_profile':'fixture','author_cert_sha256':'a'*64,'distributor_cert_sha256':'b'*64}
                builder=Builder(profile,{'artifacts':{}},Path(tmp))
                action=Action('hub','hub','package',None,{},dict(artifact='hub',package='MiniHub001',previous_version=None))
                with patch.object(builder,'command',side_effect=fake_sign),patch('tvsetup.artifacts.verify_package',side_effect=lambda p,*_: (members(p),'0.4.1')):
                    _,actual=builder.package(action)
                self.assertEqual(actual,hub_sources(device))

    def test_s89c_retains_gallery_logos_and_photo_policy_without_monitoring(self):
        for device in ('s89c','s90d','qn90a',None):
            with self.subTest(device=device):
                sources=hub_sources(device)
                html=sources['index.html'];config=sources['config.xml']
                self.assertIn('logos/peacock.png',sources)
                self.assertIn(b'Peacock TV',sources['streaming-artwork.js'])
                self.assertEqual(b'data-design="tvos"' in html,device=='s89c')
                self.assertEqual(b'https://images.unsplash.com' in html,device=='s89c')
                self.assertEqual(b'<access origin="https://images.unsplash.com"' in config,device=='s89c')
                self.assertEqual(b'http://tizen.org/privilege/internet' in config,device=='s89c')
                self.assertEqual('telemetry.js' in sources,device in ('s90d','qn90a'))
                self.assertNotIn(b'setting-telemetry',html)

    def test_signing_uses_toolkit_manifest_boot_version_and_verifies_before_success(self):
        for device,signer in [('s90d','MinimalHub'),('qn90a','MinimalHubQN90A')]:
            for reject in (False,True):
                with self.subTest(device=device,reject=reject),tempfile.TemporaryDirectory() as tmp:
                    trust={'id':device,'signing_profile':signer,'author_cert_sha256':'a'*64,'distributor_cert_sha256':'b'*64}
                    expected=hub_sources(device,device_id='fixture-device');seen=[]
                    def sign(argv,**kwargs):
                        self.assertEqual(argv[0],str(Path(tmp).resolve()/'tizen-sdk/cli/tools/ide/bin/tizen'))
                        fake_sign(argv,**kwargs)
                    def verify(path,profile,package):
                        self.assertEqual(profile,trust);self.assertEqual(package,'MiniHub001')
                        actual=members(path);seen.append(actual)
                        self.assertEqual(set(actual),set(expected)|{'boot-trace.js'})
                        for name in set(expected)-{'index.html','config.xml'}:self.assertEqual(actual[name],expected[name])
                        version=ET.fromstring(expected['config.xml']).get('version')
                        self.assertEqual(version,'0.4.1')
                        self.assertEqual(ET.fromstring(actual['config.xml']).get('version'),'0.4.2')
                        self.assertEqual(set(Scripts(actual['index.html'].decode()).sources),{n for n in actual if n.endswith('.js')})
                        if reject:raise Refused('signature rejected')
                    output=io.StringIO()
                    with patch.dict('os.environ',SAMSUNG_TV_TOOLKIT=tmp),patch('sys.argv',['sign.py','--profile',signer,'--device-id','fixture-device','--boot-trace']),patch('tvsetup.site.load_site',return_value={}),patch('tvsetup.site.configured_profile',return_value=trust),patch('subprocess.run',side_effect=sign),patch('tvsetup.artifacts.verify_package',side_effect=verify),contextlib.redirect_stdout(output):
                        if reject:
                            with self.assertRaisesRegex(Refused,'signature rejected'):runpy.run_path(str(REPO/'scripts/sign.py'),run_name='__main__')
                        else:runpy.run_path(str(REPO/'scripts/sign.py'),run_name='__main__')
                    self.assertEqual(len(seen),1)
                    self.assertEqual(bool(output.getvalue()),not reject)
