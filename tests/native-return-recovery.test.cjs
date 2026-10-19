'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {recoveryCommand}=require('../research/autonomous-root/service/native-return-recovery');
const id='a'.repeat(32),boot='00000000-0000-0000-0000-000000000001',sha='b'.repeat(64);
test('offline command pins owned read-only code, boot and journal without publishing a worker',()=>{
 for(const kind of ['worker','retirement']){
  const directory='/opt/couchroot-'+kind+'-'+id,record={id,directory,scope:directory+'/state',worker_sha256:sha};
  const command=recoveryCommand(record,boot,id,sha);assert.equal(spawnSync('/bin/sh',['-n'],{input:command}).status,0);
  assert.match(command,/unshare -m/);assert.match(command,/mount --make-rprivate/);assert.match(command,/remount,bind,ro/);assert.match(command,/sha256sum/);assert.match(command,/--reconcile-state/);
  assert.doesNotMatch(command,/systemd-run|systemctl (stop|kill)|--production|rm |rmdir /);
  for(const changed of [{id:id+'\n'},{directory:'/tmp/foreign'},{scope:'/opt/foreign'},{worker_sha256:sha+'\n'}])assert.throws(()=>recoveryCommand({...record,...changed},boot,id,sha));
  for(const value of [id+'\n','bad'])assert.throws(()=>recoveryCommand(record,boot,value,sha));
  assert.throws(()=>recoveryCommand(record,boot,id,sha+'\n'));assert.throws(()=>recoveryCommand(record,boot+'\n',id,sha));
 }
});
