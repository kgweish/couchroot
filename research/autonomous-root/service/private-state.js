'use strict';
const fs=require('fs');
function check(ok){if(!ok)throw Error('Private state ownership unavailable');}
// Setgid changes group inheritance, not access; package updates may restore it.
// Other special bits and all group/other permissions remain disallowed.
function privateDirectory(st){return !!st&&st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&(st.mode&0o5777)===0o700;}
function privateRead(file,limit){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd);check(st.isFile()&&st.uid===process.geteuid()&&st.nlink===1&&(st.mode&0o7777)===0o600&&st.size>0&&st.size<=limit);
  const bytes=Buffer.alloc(st.size+1);let at=0;while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,null);if(!n)break;at+=n;}check(at===st.size);return bytes.subarray(0,at).toString();
 }finally{fs.closeSync(fd);}
}
module.exports={privateRead,privateDirectory};
