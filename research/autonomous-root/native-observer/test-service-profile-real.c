/* Linux container-only real credential/descriptor checks. The Smack write is
 * redirected to /dev/null because the host test kernel has no TV Smack policy. */
#define _GNU_SOURCE
#include <assert.h>
#include <stdarg.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>
static int profile_test_open(const char *p,int flags,...) {
 mode_t mode=0;if(flags&O_CREAT){va_list ap;va_start(ap,flags);mode=(mode_t)va_arg(ap,int);va_end(ap);}
 if(!strcmp(p,"/proc/self/attr/current"))p="/dev/null";
 return open(p,flags,mode);
}
#define open profile_test_open
#define main observer_main
#include "process-observer.c"
#undef main
#undef open
int main(int argc,char **argv) {
 if(argc>1)return observer_main(argc,argv);
 assert(getuid()==0&&geteuid()==0);
 gid_t inherited[]={0,100,100,1901};assert(!setgroups(4,inherited));
 int sentinel=open("/dev/null",O_RDONLY);assert(sentinel>2);
 assert(dup2(sentinel,123)==123);
 gid_t groups[32];assert(parse_service_groups("29,100,201",groups)==3);
 assert(drop_service_profile(groups,3));
 assert(getuid()==5001&&geteuid()==5001&&getgid()==100&&getegid()==100);
 errno=0;assert(fcntl(sentinel,F_GETFD)==-1&&errno==EBADF);
 errno=0;assert(fcntl(123,F_GETFD)==-1&&errno==EBADF);
 assert(setuid(0)==-1&&setgroups(0,NULL)==-1);
 puts("host-test-without-Smack: real credential drop and inherited descriptor cleanup passed");
 return 0;
}
