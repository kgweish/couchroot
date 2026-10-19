/* Deterministic credential-drop fault injection. Never changes host credentials. */
#define _GNU_SOURCE
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <linux/capability.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
static int step, fail_at, stage, caps_written, label_written, bounds, corrupt;
static int fault(void) { step++; if (step==fail_at) { errno=EPERM;return 1; }return 0; }
static uid_t fake_getuid(void) { return fault()?5001:0; }
static int capacity(int needed) { assert(needed==1);return !fault(); }
static int close_inherited(void) { assert(stage==0);if(fault())return 0;stage=1;return 1; }
static int fake_open(const char *p,int flags,...) { assert(stage==1&&!strcmp(p,"/proc/self/attr/current"));assert(flags&O_NOFOLLOW);return fault()?-1:99; }
static ssize_t fake_write(int fd,const void *data,size_t n) { assert(fd==99&&n==strlen("User::Pkg::MiniRoot01")&&!memcmp(data,"User::Pkg::MiniRoot01",n));if(fault())return -1;label_written=1;return (ssize_t)n; }
static int fake_close(int fd) { assert(fd==99);return fault()?-1:0; }
static int fake_prctl(int option,...) {
 va_list ap;va_start(ap,option);long value=va_arg(ap,long);va_end(ap);
 if(fault())return -1;
 if(option==PR_CAPBSET_DROP){assert(value==bounds);bounds++;return 0;}
 if(option==PR_SET_KEEPCAPS){assert(value==0&&label_written);return 0;}
 if(option==PR_SET_NO_NEW_PRIVS){assert(value==1&&label_written);return 0;}
 assert(option==PR_GET_NO_NEW_PRIVS&&stage==4);return corrupt==5?0:1;
}
static int fake_setgroups(size_t n,const gid_t *g) { assert(stage==1&&bounds==64&&n==3&&g[0]==29&&g[1]==100&&g[2]==201);if(fault())return -1;stage=2;return 0; }
static int fake_setgid(gid_t gid) { assert(stage==2&&gid==100);if(fault())return -1;stage=3;return 0; }
static int fake_setuid(uid_t uid) { assert(stage==3&&uid==5001);if(fault())return -1;stage=4;return 0; }
static long fake_syscall(long call,...) {
 assert(stage==4);va_list ap;va_start(ap,call);
 struct __user_cap_header_struct *h=va_arg(ap,void*);struct __user_cap_data_struct *c=va_arg(ap,void*);va_end(ap);
 assert(h->version==_LINUX_CAPABILITY_VERSION_3&&h->pid==0);if(fault())return -1;
 if(call==SYS_capset){for(int i=0;i<2;i++)assert(!c[i].effective&&!c[i].permitted&&!c[i].inheritable);caps_written=1;}
 else {assert(call==SYS_capget&&caps_written);memset(c,0,2*sizeof(*c));if(corrupt==1)c[1].permitted=1;}return 0;
}
static int fake_getresuid(uid_t *r,uid_t *e,uid_t *s) { if(fault())return -1;*r=*e=*s=5001;if(corrupt==2)*s=0;return 0; }
static int fake_getresgid(gid_t *r,gid_t *e,gid_t *s) { if(fault())return -1;*r=*e=*s=100;if(corrupt==3)*s=0;return 0; }
static int fake_getgroups(int n,gid_t *g) { assert(n==32);if(fault())return -1;g[0]=29;g[1]=100;g[2]=corrupt==4?202:201;return 3; }
#define getuid fake_getuid
#define geteuid fake_getuid
#define open fake_open
#define close fake_close
#define write fake_write
#define prctl fake_prctl
#define setgroups fake_setgroups
#define setgid fake_setgid
#define setuid fake_setuid
#define syscall fake_syscall
#define getresuid fake_getresuid
#define getresgid fake_getresgid
#define getgroups fake_getgroups
#include "service-profile.h"
int main(void) {
 gid_t groups[32];assert(parse_service_groups("29,100,201",groups)==3);
 const char *bad[]={"","0,100","100,100","201,100","0100","100,","100,,201","100,2147483648","100,4294967396","100,999999999999999999999","100\n","29,201",NULL};
 for(int i=0;bad[i];i++)assert(!parse_service_groups(bad[i],groups));
 assert(parse_service_groups("29,100,201",groups)==3);
 fail_at=0;assert(drop_service_profile(groups,3));int steps=step;
 for(int i=1;i<=steps;i++){step=stage=caps_written=label_written=bounds=0;fail_at=i;assert(!drop_service_profile(groups,3));assert(step>=i);}
 for(corrupt=1;corrupt<=5;corrupt++){step=stage=caps_written=label_written=bounds=fail_at=0;assert(!drop_service_profile(groups,3));}
 printf("Credential profile: %d fault boundaries passed\n",steps);
 return 0;
}
