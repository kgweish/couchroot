'use strict';
// Explicit signed-package opt-in. A malformed opt-in never falls back silently.
const fs=require('fs'),path=require('path');
const {read,hash}=require('./policy');
const FILES=['libacquire.so','NativeEntry.dll','NativeEntry.deps.json','NativeEntry.runtimeconfig.json'];
function loadAcquisition(payload,device){
 const manifest=JSON.parse(read(path.join(payload,'manifest.json'))),name='service-acquisition.json';
 if(!Object.prototype.hasOwnProperty.call(manifest,name)){
  if([name,...FILES].some(n=>Object.prototype.hasOwnProperty.call(manifest,n)||fs.existsSync(path.join(payload,n))))throw Error('Unbound native acquisition metadata');
  return null;
 }
 const data=read(path.join(payload,name));if(hash(data)!==manifest[name])throw Error('Native acquisition manifest mismatch');
 const m=JSON.parse(data),profile={qn90a:['netcoreapp3.1','3.1.3'],s90d:['net6.0','6.0.9']}[device];
 if(!profile||m.schema!==1||m.kind!=='native-service-acquisition'||m.model!==device||m.framework!==profile[0]||m.runtime!==profile[1]||m.reproducible_builds!==2||Object.keys(m.artifacts||{}).sort().join('|')!==FILES.slice().sort().join('|'))throw Error('Native acquisition profile mismatch');
 const files={};for(const n of FILES){const b=read(path.join(payload,n),4*1024*1024),a=m.artifacts[n];if(b.length!==a.size||hash(b)!==a.sha256||manifest[n]!==a.sha256)throw Error('Native acquisition artifact mismatch');files[n]=b;}
 return {files,manifest_sha256:hash(data)};
}
function stageAcquisition(stage,bundle){
 fs.mkdirSync(stage+'/code',{mode:0o755});
 for(const [n,b] of Object.entries(bundle.files))fs.writeFileSync(stage+(n.endsWith('.so')?'/code/':'/')+n,b,{mode:0o644,flag:'wx'});
}
module.exports={loadAcquisition,stageAcquisition,FILES};
