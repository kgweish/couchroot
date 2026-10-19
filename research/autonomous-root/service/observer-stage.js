'use strict';
// Enable execution of the manifest-bound, installer-owned package member.
// No copying, new mounts, label changes or worker-owned helper directories.
const path=require('path');
const {loadCandidate}=require('./native-candidate');
const PAYLOADS=['/opt/usr/apps/MiniRoot01/res/wgt/payload','/opt/usr/apps/MiniRoot01/payload'];
const BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const quote=v=>"'"+v.replace(/'/g,"'\\''")+"'";
function stageCommand(binary,sha256,bootId){
 if(!PAYLOADS.some(p=>binary===p+'/native-process-observer')||typeof sha256!=='string'||sha256.length!==64||!/^[a-f0-9]{64}$/.test(sha256)||typeof bootId!=='string'||bootId.length!==36||!BOOT.test(bootId))throw Error('Invalid observer staging identity');
 const parents=[];let current=path.dirname(binary);
 while(current!=='/'){parents.unshift(current);current=path.dirname(current);}
 return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\n'+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+quote(bootId)+'\n'+
  'for p in '+parents.map(quote).join(' ')+'; do test -d "$p"; test ! -L "$p"; done\n'+
  'p='+quote(binary)+'\n'+
  'test -f "$p"; test ! -L "$p"\n'+
  'test "$(stat -c %u "$p")" = 201\n'+
  'test "$(stat -c %h "$p")" = 1\n'+
  'before=$(stat -c %a "$p")\ncase "$before" in 644|755) ;; *) exit 74 ;; esac\n'+
  'identity=$(stat -c "%d:%i:%u:%g:%h:%s" "$p")\n'+
  'test "$(sha256sum "$p" | cut -d " " -f 1)" = '+quote(sha256)+'\n'+
  'chmod 755 "$p"\n'+
  'test ! -L "$p"\n'+
  'test "$(stat -c "%d:%i:%u:%g:%h:%s" "$p")" = "$identity"\n'+
  'test "$(stat -c %a "$p")" = 755\n'+
  'test "$(sha256sum "$p" | cut -d " " -f 1)" = '+quote(sha256)+'\n'+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+quote(bootId)+'\n'+
  'printf "OBSERVER-STAGED %s 755\\n" "$before"\n';
}
async function stageObserver({payload,device,bootId,expectedManifest,execute}){
 let before,artifact,binary,command;
 try{
  if(!PAYLOADS.includes(payload)||typeof execute!=='function')throw Error('Installed observer package required');
  before=loadCandidate(payload,device);artifact=before&&before.artifacts['native-process-observer'];
  if(!artifact||before.manifest_sha256!==expectedManifest)throw Error('Expected verified packaged observer unavailable');
  binary=path.join(payload,'native-process-observer');command=stageCommand(binary,artifact.sha256,bootId);
 }catch(error){throw Object.assign(error,{outcome:'rejected'});}
 const result=await execute(command,25000);
 // Any failed/unknown execution may have changed mode; never replay it here.
 if(!result||!Number.isInteger(result.exit_code))throw Error('Observer staging command outcome unavailable');
 try{
  if(result.exit_code!==0||result.timed_out||result.stderr||!['OBSERVER-STAGED 644 755\n','OBSERVER-STAGED 755 755\n'].includes(result.stdout))throw Error('Observer permission staging not confirmed');
  const after=loadCandidate(payload,device);
  if(!after||after.manifest_sha256!==before.manifest_sha256||after.artifacts['native-process-observer'].sha256!==artifact.sha256)throw Error('Observer package changed during staging');
 }catch(error){throw Object.assign(error,{outcome:'failed'});}
 return Object.freeze({binary,sha256:artifact.sha256,manifest_sha256:before.manifest_sha256,prior_mode:result.stdout.split(' ')[1],mode:'755',boot_id:bootId});
}
module.exports={stageObserver,stageCommand};
