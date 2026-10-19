import base64
import hashlib
import tempfile
from pathlib import Path
import unittest
import zipfile
from tvsetup.artifacts import verify_package,next_version,DS,EXC
from tvsetup.common import Refused,run,sha

class SignatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name)
        run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',cls.root/'key.pem','-out',cls.root/'cert.pem','-days','1','-subj','/CN=Setup unit test'])
        run(['openssl','x509','-in',cls.root/'cert.pem','-outform','DER','-out',cls.root/'cert.der'])
        cls.cert=(cls.root/'cert.der').read_bytes();cls.profile={'id':'test','author_cert_sha256':sha(cls.cert),'distributor_cert_sha256':sha(cls.cert)}
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()

    def signature(self,files):
        from lxml import etree as E
        ns='{'+DS+'}';root=E.Element(ns+'Signature',nsmap={None:DS});signed=E.SubElement(root,ns+'SignedInfo')
        E.SubElement(signed,ns+'CanonicalizationMethod',Algorithm=EXC)
        E.SubElement(signed,ns+'SignatureMethod',Algorithm='http://www.w3.org/2001/04/xmldsig-more#rsa-sha256')
        for name,data in files.items():
            ref=E.SubElement(signed,ns+'Reference',URI=name)
            E.SubElement(ref,ns+'DigestMethod',Algorithm='http://www.w3.org/2001/04/xmlenc#sha256')
            E.SubElement(ref,ns+'DigestValue').text=base64.b64encode(hashlib.sha256(data).digest()).decode()
        (self.root/'signed').write_bytes(E.tostring(signed,method='c14n',exclusive=True))
        run(['openssl','dgst','-sha256','-sign',self.root/'key.pem','-out',self.root/'sig',self.root/'signed'])
        E.SubElement(root,ns+'SignatureValue').text=base64.b64encode((self.root/'sig').read_bytes()).decode()
        info=E.SubElement(root,ns+'KeyInfo');x=E.SubElement(info,ns+'X509Data');E.SubElement(x,ns+'X509Certificate').text=base64.b64encode(self.cert).decode()
        return E.tostring(root)

    def package(self,tamper=None):
        files={'config.xml':b'<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="1.0.0"><tizen:application package="MiniHub001" id="MiniHub001.Hub"/></widget>','index.html':b'<html>test</html>'}
        files['author-signature.xml']=self.signature(files)
        files['signature1.xml']=self.signature(files)
        if tamper:tamper(files)
        path=self.root/'test.wgt'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        return path

    def test_valid_signatures_and_identity(self):
        members,version=verify_package(self.package(),self.profile,'MiniHub001')
        self.assertEqual(version,'1.0.0');self.assertIn('index.html',members)

    def test_signed_content_tamper_fails(self):
        with self.assertRaisesRegex(Refused,'digest mismatch'):
            verify_package(self.package(lambda f:f.update({'index.html':b'changed'})),self.profile,'MiniHub001')

    def test_extra_unsigned_file_fails(self):
        with self.assertRaisesRegex(Refused,'unsigned content'):
            verify_package(self.package(lambda f:f.update({'extra.js':b'new'})),self.profile,'MiniHub001')

    def test_other_model_certificate_cannot_be_overridden(self):
        p=dict(self.profile,distributor_cert_sha256='0'*64)
        with self.assertRaisesRegex(Refused,'Signing identity'):verify_package(self.package(),p,'MiniHub001')

    def test_wrong_package_and_signature_bytes_fail(self):
        with self.assertRaisesRegex(Refused,'package identity'):verify_package(self.package(),self.profile,'MiniTelemetry')
        def alter(files):
            from lxml import etree as E
            root=E.fromstring(files['signature1.xml']);root.find('{'+DS+'}SignatureValue').text=base64.b64encode(b'bad signature').decode();files['signature1.xml']=E.tostring(root)
        with self.assertRaises(Refused):verify_package(self.package(alter),self.profile,'MiniHub001')

    def test_forward_version(self):
        self.assertEqual(next_version('0.4.3','0.4.1'),'0.4.4')
        self.assertEqual(next_version('0.4.3','0.5.0'),'0.5.0')
        with self.assertRaises(Refused):next_version('0.4.65535','0.4.1')

if __name__=='__main__':unittest.main()

class ArchiveBoundaryTests(unittest.TestCase):
    def test_rejects_symlinks_and_ambiguous_paths_before_signatures(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'archive.wgt'
            for name,mode in [('a/../b',0),('a//b',0),('./b',0),('/b',0),('link',0o120777)]:
                with self.subTest(name=name):
                    with zipfile.ZipFile(path,'w') as archive:
                        entry=zipfile.ZipInfo(name);entry.external_attr=mode<<16
                        archive.writestr(entry,b'payload')
                    with self.assertRaises(Refused):verify_package(path,{'id':'test','author_cert_sha256':'a'*64,'distributor_cert_sha256':'b'*64},'MiniHub001')

class S89CStagingTests(unittest.TestCase):
    def test_nested_assets_and_external_image_policy_are_scoped_to_s89c(self):
        from tvsetup.artifacts import Builder
        from tvsetup.planner import Action
        from unittest.mock import patch
        for device in ('s89c','qn90a'):
            with self.subTest(device=device), tempfile.TemporaryDirectory() as folder:
                profile=dict(id=device,signing_profile='test',author_cert_sha256='a'*64,distributor_cert_sha256='b'*64)
                builder=Builder(profile,{'artifacts':{}},Path(folder))
                def pack(argv):
                    stage=Path(argv[-1]);(stage/'packed.wgt').write_bytes(b'test')
                builder.command=pack
                action=Action('001-hub','hub','package',{}, {}, dict(artifact='hub',package='MiniHub001',previous_version='0.4.1'))
                with patch('tvsetup.artifacts.verify_package',return_value=({},'0.4.2')):
                    builder.package(action)
                stage=Path(folder)/'MiniHub001-source'
                self.assertTrue((stage/'logos/netflix.png').is_file())
                html=(stage/'index.html').read_text();config=(stage/'config.xml').read_text()
                self.assertEqual('data-design="tvos"' in html,device=='s89c')
                self.assertEqual('<access origin="https://images.unsplash.com"' in config,device=='s89c')
                self.assertEqual('http://tizen.org/privilege/internet' in config,device=='s89c')
                self.assertIn('version="0.4.2"',config)
                self.assertNotIn('DemoStream',(stage/'streaming-artwork.js').read_text())
