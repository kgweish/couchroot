const {test}=require('node:test'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('managed short-job identity capture preserves completed results and retained records',{
 skip:process.platform!=='linux'||!process.env.COUCHROOT_PARITY_CONTAINER||!process.env.MANAGED_PARITY,
 timeout:15000
},async()=>{
 const result=await promisify(execFile)('dotnet',[process.env.MANAGED_PARITY,'--job-identity-test'],{timeout:12000,maxBuffer:32768});
 assert.equal(result.stderr,'');assert.equal(result.stdout.trim(),'JOB_IDENTITY_OK 64 short jobs');
});
