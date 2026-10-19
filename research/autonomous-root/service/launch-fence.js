'use strict';
// Shared single-launch fence for bootstrap and selected-native startup.
const ID=/^[a-f0-9]{32}$/,BOOT=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const check=v=>{if(!v)throw Error('Launch fence evidence unavailable');};
// The lock and seal survive scope removal until explicit verified retirement.
// A delayed original SDK command will acquire this same lock and refuse the seal.
// A new boot may seal an old attempt; it can never use that attempt to launch.
function fenceCommand(r,body,{seal=false,kind='bootstrap',bootId=r.boot_id}={}){
 check(['bootstrap','startup'].includes(kind)&&ID.test(r.id)&&r.fence==='/opt/couchroot-'+kind+'-fence-'+r.id&&BOOT.test(r.boot_id));
 check(typeof bootId==='string'&&bootId.length===36&&BOOT.test(bootId)&&(bootId===r.boot_id||seal));
 const f=r.fence;
 const fixed=n=>'test -f '+f+'/'+n+'; test ! -L '+f+'/'+n+'; test "$(stat -c "%u:%h:%a:%s" '+f+'/'+n+')" = 0:1:600:33; test "$(cat '+f+'/'+n+')" = '+r.id+'\n';
 const inner='set -eu\ntest /proc/self/fd/9 -ef '+f+'/lock\n'+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+bootId+'\n'+
  'for name in '+f+'/*; do case "$name" in '+f+'/lock) ;; '+f+'/started|'+f+'/sealed) ;; *) exit 1;; esac; done\n'+
  'if test -e '+f+'/started || test -L '+f+'/started; then '+fixed('started')+'fi\n'+
  (seal?'if test -e '+f+'/sealed || test -L '+f+'/sealed; then '+fixed('sealed')+'else (set -C; printf "%s\\n" '+r.id+' > '+f+'/sealed); fi\n':
   'test ! -e '+f+'/sealed; test ! -L '+f+'/sealed; test ! -e '+f+'/started; test ! -L '+f+'/started\n(set -C; printf "%s\\n" '+r.id+' > '+f+'/started)\n')+body;
 return 'set -eu\nPATH=/usr/bin:/bin\nexport PATH\nexport DBUS_SYSTEM_BUS_ADDRESS=kernel:path=/sys/fs/kdbus/0-system/bus\numask 077\n'+
  'test "$(cat /proc/sys/kernel/random/boot_id)" = '+bootId+'\n'+
  'if ! mkdir '+f+' 2>/dev/null; then test -d '+f+'; test ! -L '+f+'; fi\ntest "$(stat -c "%u:%a" '+f+')" = 0:700\n'+
  'if test ! -e '+f+'/lock && test ! -L '+f+'/lock; then (set -C; : > '+f+'/lock) 2>/dev/null || true; fi\n'+
  'test -f '+f+'/lock; test ! -L '+f+'/lock; test "$(stat -c "%u:%h:%a:%s" '+f+'/lock)" = 0:1:600:0\n'+
  'exec 9<'+f+'/lock\n/usr/bin/flock -n 9\n'+inner;
}
module.exports={fenceCommand};
