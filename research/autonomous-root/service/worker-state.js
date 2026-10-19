'use strict';
// Bootstrap a private child of the app-owned, searchable data directory.
// Never move or ignore a legacy selection journal or unfinished writer.
const fs=require('fs'),path=require('path');
const {privateDirectory}=require('./private-state');
function requireDirectory(stat,privateMode){
 // An inherited setgid bit changes group inheritance, not access. Accept it
 // on reuse so a crash between mkdir and fchmod does not strand private state.
 if(!stat.isDirectory()||stat.uid!==process.geteuid()||(privateMode?!privateDirectory(stat):!!(stat.mode&0o022)))throw Error('Worker state directory ownership or permissions invalid');
}
function absent(file){
 try{fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return;throw e;}
 throw Error('Legacy worker selection requires reconciliation');
}
function sameDirectory(file,stat){
 const now=fs.lstatSync(file);
 if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==stat.dev||now.ino!==stat.ino)throw Error('Worker state directory changed');
}
function prepareWorkerState(data){
 if(typeof data!=='string'||!path.isAbsolute(data))throw Error('Absolute app data directory required');
 data=path.resolve(data);
 const flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
 const parent=fs.openSync(data,flags);
 try{
  const parentStat=fs.fstatSync(parent);requireDirectory(parentStat,false);sameDirectory(data,parentStat);
  const legacy=path.join(data,'worker-selection.json');
  const checkLegacy=()=>{absent(legacy);absent(legacy+'.writer');};
  checkLegacy();
  const directory=path.join(data,'worker-state');let created=false;
  try{fs.mkdirSync(directory,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  const child=fs.openSync(directory,flags);
  try{
   const initial=fs.fstatSync(child);
   if(!initial.isDirectory()||initial.uid!==process.geteuid())throw Error('Worker state directory owner invalid');
   sameDirectory(directory,initial);
   // The 2755 parent on both TVs makes a new child inherit setgid. Clear only
   // this newly created child's inherited bits; never repair existing paths.
   if(created)fs.fchmodSync(child,0o700);
   const stat=fs.fstatSync(child);requireDirectory(stat,true);
   sameDirectory(directory,stat);sameDirectory(data,parentStat);checkLegacy();
   // Sync even on reuse: a prior publication may have ended before its sync.
   fs.fsyncSync(child);fs.fsyncSync(parent);
   return Object.freeze({directory,selectionFile:path.join(directory,'worker-selection.json')});
  }finally{fs.closeSync(child);}
 }finally{fs.closeSync(parent);}
}
module.exports={prepareWorkerState};
