'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sdb=require('../research/autonomous-root/service/vendor/sdb');
const {launchSdk}=require('../research/autonomous-root/service/agent');
test('SDK diagnostics are captured by the app into an exclusive owner-only log',async()=>{
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'launcher-log-')), original=sdb.exec;
 let calls=0;
 try{
  sdb.exec=async(client,command)=>{
   calls++;assert.equal(fs.statSync(stage+'/launcher.log').mode&0o777,0o600);
   // The SDK request sources the launch script; it must not open launcher.log.
   const encoded=command.match(/%s\$\{IFS\}([^|]+)/)[1];
   assert.doesNotMatch(Buffer.from(encoded,'base64').toString(),/launcher\.log/);
   assert.equal(fs.readFileSync(stage+'/launcher.log','utf8'),'');
   return 'SDK diagnostic\n';
  };
  assert.equal(await launchSdk({},stage,'/tmp/test-gate',true),'SDK diagnostic\n');
  assert.equal(fs.readFileSync(stage+'/launcher.log','utf8'),'SDK diagnostic\n');
  assert.equal(fs.statSync(stage+'/launcher.log').mode&0o777,0o600);
  await assert.rejects(launchSdk({},stage,'/tmp/test-gate',true),/EEXIST/);
  assert.equal(calls,1,'existing log must refuse before executing SDK');
 }finally{sdb.exec=original;fs.rmSync(stage,{recursive:true,force:true});}
});
