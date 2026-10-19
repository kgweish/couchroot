"""Fixed service profile: real Linux IDs and pidfd protocol, stubbed Smack write."""
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]/'research/autonomous-root/native-observer'
ENABLED = sys.platform == 'linux' and os.environ.get('COUCHROOT_PARITY_CONTAINER') == '1'

@unittest.skipUnless(ENABLED, 'isolated root Linux container required')
class ObserverProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.getuid() != 0: raise RuntimeError('Root disposable container required')
        cls.temp = tempfile.TemporaryDirectory(prefix='observer-profile-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.directory = Path(cls.temp.name); cls.directory.chmod(0o755)
        cls.binaries = {}
        for name in ('test-service-profile', 'test-service-profile-real'):
            binary=cls.directory/name
            subprocess.run(['cc','-std=c99','-O2','-Wall','-Wextra','-Werror',str(SOURCE/(name+'.c')),'-o',str(binary)],check=True)
            cls.binaries[name]=str(binary)

    def test_fault_boundaries_and_real_irreversible_drop(self):
        for binary in self.binaries.values():
            result=subprocess.run([binary],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_profile_protocol_and_receipt_with_real_peer_credentials(self):
        with tempfile.TemporaryDirectory(prefix='obs-profile-wire-') as folder:
            root=Path(folder);root.chmod(0o700);os.chown(root,5001,100)
            token=root/'token';token.write_text('a'*64);token.chmod(0o600);os.chown(token,5001,100)
            controller_code=r'''
import os,socket,sys
os.setgroups([29,100,201]);os.setgid(100);os.setuid(5001)
s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.listen(1);print('LISTENING',flush=True)
c,_=s.accept();c.settimeout(10);f=c.makefile('rb')
assert f.readline()==b'AUTH '+b'a'*64+b'\n'
assert f.readline()==b'BOUND\n';c.sendall(b'ARM\n');assert f.readline()==b'ARMED\n';print('ARMED',flush=True)
assert f.readline()==b'EXITED\n';assert f.read()==b'';f.close();c.close();s.close()
'''
            controller=subprocess.Popen([sys.executable,'-c',controller_code,str(root/'control')],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            target=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
            supervisor=None
            try:
                self.assertTrue(select.select([controller.stdout],[],[],5)[0]);self.assertEqual(controller.stdout.readline(),b'LISTENING\n')
                boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                supervisor=subprocess.Popen([self.binaries['test-service-profile-real'],'--service-supervise','29,100,201',str(root/'control'),str(token),boot,str(target.pid)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                self.assertTrue(select.select([controller.stdout],[],[],5)[0]);self.assertEqual(controller.stdout.readline(),b'ARMED\n')
                status=Path('/proc/'+str(supervisor.pid)+'/status').read_text()
                fields=dict(line.split(':',1) for line in status.splitlines() if ':' in line)
                self.assertEqual(fields['Uid'].split(),['5001']*4);self.assertEqual(fields['Gid'].split(),['100']*4)
                self.assertEqual(fields['Groups'].split(),['29','100','201']);self.assertEqual(fields['NoNewPrivs'].strip(),'1')
                for key in ('CapEff','CapPrm','CapInh','CapBnd','CapAmb'):self.assertEqual(int(fields[key],16),0)
                target.terminate();target.wait(timeout=3)
                _,err=supervisor.communicate(timeout=5);self.assertEqual(supervisor.returncode,0,err)
                _,err=controller.communicate(timeout=5);self.assertEqual(controller.returncode,0,err)
                receipt=json.loads((root/'result').read_text());self.assertEqual(receipt['worker_pid'],target.pid);self.assertEqual(receipt['exit_code'],0);self.assertIsNone(receipt['signal'])
                self.assertEqual((root/'result').stat().st_uid,5001);self.assertFalse((root/'result.next').exists())
            finally:
                for process in (supervisor,controller,target):
                    if process:
                        if process.poll() is None:process.kill()
                        process.wait(timeout=3)
                        for stream in (process.stdout,process.stderr):
                            if stream:stream.close()

if __name__ == '__main__':unittest.main()
