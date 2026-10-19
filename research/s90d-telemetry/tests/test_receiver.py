import http.client
import http.server
import json
from pathlib import Path
import tempfile
import threading
import unittest
from test_metrics import sample
from receiver import Handler, configure
from concurrent.futures import ThreadPoolExecutor

class ReceiverTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
  self.secret={'devices':{id:dict(allowed_ip='127.0.0.1',token=token) for id,token in [('s90d','test-secret'),('qn90a','other-secret')]}}
  configure(self.server,self.secret,self.temp.name)
  self.device=self.server.routes['/v1/s90d']
  self.server.destination=self.device['destination']
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
 def post(self,data,auth='Bearer test-secret',path='/v1/s90d'):
  conn=http.client.HTTPConnection(*self.server.server_address,timeout=2)
  conn.request('POST',path,json.dumps(data),{'Authorization':auth})
  response=conn.getresponse();code=response.status;response.read();conn.close();return code
 def test_authentication_validation_and_atomic_ingestion(self):
  self.assertEqual(self.post(sample(),auth='Bearer wrong'),401)
  self.assertFalse(self.server.destination.exists())
  self.assertEqual(self.post({'schema':1}),400)
  self.assertEqual(self.post(sample()),204)
  self.assertEqual(json.loads(self.server.destination.read_text())['boot'],sample()['boot'])
  self.assertFalse(self.server.destination.with_suffix('.new').exists())
 def test_reject_stale_source_and_rate_limit(self):
  self.assertEqual(self.post(sample()),204)
  self.assertEqual(self.post(sample(110,2)),429)
  self.device['last_request']=0
  self.assertEqual(self.post(sample(99,2)),409)
  self.device['allowed_ip']='192.0.2.1';self.assertEqual(self.post(sample(120,3)),403)
 def test_mixed_simultaneous_samples_and_credentials(self):
  with ThreadPoolExecutor(2) as pool:
   a=pool.submit(self.post,sample())
   b=pool.submit(self.post,dict(sample(),device='qn90a'),'Bearer other-secret','/v1/devices/qn90a')
   self.assertEqual([a.result(),b.result()],[204,204])
  self.assertEqual(self.post(sample(110,2),path='/v1/devices/qn90a'),401)
  self.device['last_request']=0
  self.assertEqual(self.post(dict(sample(110,2),device='qn90a')),403)
  self.assertTrue((Path(self.temp.name)/'qn90a.json').exists())
  self.assertEqual(self.post(sample(),path='/v1/devices/unknown'),404)
 def test_restart_sequence_and_reboot_replay(self):
  session='00000000-0000-4000-8000-000000000034'
  self.assertEqual(self.post(dict(sample(),session=session)),204)
  configure(self.server,self.secret,self.temp.name)
  self.device=self.server.routes['/v1/s90d']
  self.assertEqual(self.post(dict(sample(110,1),session=session)),409)
  restarted=dict(sample(110,1),session='00000000-0000-4000-8000-000000000035')
  self.assertEqual(self.post(restarted),204)
  self.assertNotIn('collector_cpu',json.loads(self.server.destination.read_text())['metrics'])
  self.device['last_request']=0
  reboot=dict(sample(10,1),boot='00000000-0000-4000-8000-000000000036')
  self.assertEqual(self.post(reboot),204)
  self.device['last_request']=0
  self.assertEqual(self.post(dict(sample(120,2),session=session)),409)
 def test_legacy_process_restart(self):
  self.assertEqual(self.post(sample(100,80)),204)
  self.device['last_request']=0
  self.assertEqual(self.post(sample(110,1)),204)
  self.assertNotIn('cpu',json.loads(self.server.destination.read_text())['metrics'])
 def test_legacy_configuration_and_route(self):
  configure(self.server,dict(allowed_ip='127.0.0.1',token='test-secret'),self.temp.name)
  self.assertEqual(self.post(sample()),204)
  self.assertIs(self.server.routes['/v1/s90d'],self.server.routes['/v1/devices/s90d'])
 def test_qn90a_accepts_old_sender_without_retaining_or_carrying_inventory(self):
  from test_inspector import inventory
  session='00000000-0000-4000-8000-000000000046'
  qn=self.server.routes['/v1/devices/qn90a']
  # Simulate stored data from before retirement, in the same collector session.
  old=dict(sample(90),device='qn90a',session=session,inspector=inventory(90))
  qn['destination'].write_text(json.dumps(old))
  configure(self.server,self.secret,self.temp.name)
  qn=self.server.routes['/v1/devices/qn90a']
  for seq,extra in enumerate(({}, {'inspector':inventory(110)}, {'inspector':{'retired':'malformed'}}),2):
   qn['last_request']=0
   # Older senders may omit device; authenticated route still sets QN90A policy.
   value=dict(sample(90+seq*10,seq),session=session,**extra)
   self.assertEqual(self.post(value,'Bearer other-secret','/v1/devices/qn90a'),204)
   stored=json.loads(qn['destination'].read_text())
   self.assertNotIn('inspector',stored)
   self.assertEqual(stored['device'],'qn90a')
   self.assertEqual(stored['stat'],value['stat'])
   self.assertIn('memory',stored['metrics'])

 def test_inventory_survives_metrics_only_samples_but_not_collector_restart(self):
  from test_inspector import inventory
  session='00000000-0000-4000-8000-000000000044'
  self.assertEqual(self.post(dict(sample(),session=session,inspector=inventory())),204)
  self.device['last_request']=0
  self.assertEqual(self.post(dict(sample(110,2),session=session)),204)
  self.assertEqual(json.loads(self.server.destination.read_text())['inspector']['uptime'],100)
  self.device['last_request']=0
  self.assertEqual(self.post(dict(sample(120,1),session='00000000-0000-4000-8000-000000000045')),204)
  self.assertNotIn('inspector',json.loads(self.server.destination.read_text()))
if __name__=='__main__':unittest.main()
