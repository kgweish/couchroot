'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {launchCommand}=require('../research/autonomous-root/service/native-startup');
const linux={skip:process.platform!=='linux'||process.env.COUCHROOT_PARITY_CONTAINER!=='1'||process.getuid()!==0};
function fixture({crossBoot,loaded},run){
 const id=crypto.randomBytes(16).toString('hex'),attemptId=crypto.randomBytes(16).toString('hex'),directory='/opt/couchroot-worker-'+id,scope=directory+'/state',fence='/opt/couchroot-startup-fence-'+attemptId,tmp=fs.mkdtempSync(os.tmpdir()+'/startup-unit-'),bin=tmp+'/bin',tokenDirectory=tmp+'/tokens';
 const boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),old='00000000-0000-0000-0000-000000000001',digest=b=>crypto.createHash('sha256').update(b).digest('hex');
 const write=(p,s,mode)=>fs.writeFileSync(p,s,{mode});
 for(const p of [directory,directory+'/code',scope,bin,tokenDirectory])fs.mkdirSync(p,{mode:0o700});
 write(directory+'/code/worker','fixture worker',0o500);write(scope+'/launcher','fixture launcher',0o400);
 const tokenFile=tokenDirectory+'/restart-'+attemptId;write(tokenFile,'x'.repeat(44),0o600);fs.chownSync(tokenFile,5001,100);
 const record={boot_id:crossBoot?old:boot,unit:'couchroot-worker-'+id+'.service',directory,scope,token_file:tokenDirectory+'/token',worker_sha256:digest('fixture worker'),launcher_sha256:digest('fixture launcher')};
 const attempt={schema:crossBoot?3:2,id:attemptId,origin_id:id,boot_id:boot,...(crossBoot?{source_boot_id:old}:{}),fence,port:12345,token_file:tokenFile,token_sha256:digest('x'.repeat(44))};
 write(bin+'/systemctl',`#!/bin/sh
case "$1" in
 show) case "$3" in LoadState) echo LoadState=${loaded?'loaded':'not-found'};; MainPID) echo MainPID=0;; ControlGroup) echo ControlGroup=;; *) exit 9;; esac;;
 stop) echo stop >> '${tmp}/calls'; ${loaded?'exit 0':"echo 'Unit not loaded' >&2; exit 5"};;
 reset-failed) echo reset >> '${tmp}/calls';;
 *) exit 9;;
esac
`,0o700);
 write(bin+'/systemd-run',`#!/bin/sh\necho launch >> '${tmp}/calls'\n`,0o700);
 const command=launchCommand(record,attempt).replaceAll('PATH=/usr/bin:/bin','PATH='+bin+':/usr/bin:/bin');
 try{run({result:spawnSync('/bin/sh',['-c',command],{encoding:'utf8',timeout:5000}),calls:()=>fs.existsSync(tmp+'/calls')?fs.readFileSync(tmp+'/calls','utf8').trim().split('\n'):[],scope});}
 finally{for(const p of [directory,fence,tmp])fs.rmSync(p,{recursive:true,force:true});}
}
test('cross-boot launch accepts an absent old unit without stopping or resetting it',linux,()=>fixture({crossBoot:true,loaded:false},f=>{assert.equal(f.result.status,0,f.result.stderr);assert.equal(f.result.stdout,'NATIVE-RESTART-SUBMITTED\n');assert.deepEqual(f.calls(),['launch']);}));
test('cross-boot launch refuses a reused inactive unit before token publication or unit mutation',linux,()=>fixture({crossBoot:true,loaded:true},f=>{assert.notEqual(f.result.status,0);assert.deepEqual(f.calls(),[]);assert.equal(fs.existsSync(f.scope+'/token'),false);}));
test('same-boot launch preserves stop and reset for a known empty loaded unit',linux,()=>fixture({crossBoot:false,loaded:true},f=>{assert.equal(f.result.status,0,f.result.stderr);assert.deepEqual(f.calls(),['stop','reset','launch']);}));
test('same-boot launch accepts a collected absent unit without issuing a failing stop',linux,()=>fixture({crossBoot:false,loaded:false},f=>{assert.equal(f.result.status,0,f.result.stderr);assert.deepEqual(f.calls(),['launch']);}));
