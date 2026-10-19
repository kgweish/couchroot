const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {privateDirectory,privateRead}=require('../research/autonomous-root/service/private-state');
test('private directory accepts only owner-only access and optional inherited setgid',()=>{
 const stat=mode=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:process.geteuid(),mode});
 assert(privateDirectory(stat(0o700)));assert(privateDirectory(stat(0o2700)));
 for(const mode of [0o750,0o770,0o701,0o2750,0o2770,0o1700,0o4700,0o6700])assert.equal(privateDirectory(stat(mode)),false);
 assert.equal(privateDirectory({...stat(0o2700),uid:process.geteuid()+1}),false);
 assert.equal(privateDirectory({...stat(0o2700),isSymbolicLink:()=>true}),false);
 assert.equal(privateDirectory({...stat(0o2700),isDirectory:()=>false}),false);
});
test('directory allowance does not relax private file modes or alter metadata',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-directory-'));
 try{
  fs.chmodSync(dir,0o2700);assert(privateDirectory(fs.lstatSync(dir)));assert.equal(fs.lstatSync(dir).mode&0o7777,0o2700);
  const file=dir+'/receipt';fs.writeFileSync(file,'receipt',{mode:0o600});assert.equal(privateRead(file,32),'receipt');
  fs.chmodSync(file,0o2600);assert.throws(()=>privateRead(file,32));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
