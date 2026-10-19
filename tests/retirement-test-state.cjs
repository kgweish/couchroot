// Container-only fixtures share the exact service state path required by the
// production record validator. Serialize that path across Node test processes.
const fs=require('node:fs');
async function withRetirementState(fn){
 if(!process.env.COUCHROOT_PARITY_CONTAINER||process.geteuid()!==0)throw Error('Retirement fixture requires the Linux test container');
 const app='/opt/usr/home/owner/apps_rw/MiniRoot01',lock='/tmp/couchroot-service-state-test.lock',deadline=Date.now()+10000;
 for(;;){try{fs.mkdirSync(lock,{mode:0o700});break;}catch(error){if(error.code!=='EEXIST'||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,20));}}
 try{if(fs.existsSync(app))throw Error('Isolated app fixture required');try{return await fn();}finally{fs.rmSync(app,{recursive:true,force:true});}}finally{fs.rmdirSync(lock);}
}
module.exports={withRetirementState};
