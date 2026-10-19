/* On-TV handoff observations, controller only. No deployed worker is stopped.
 * SPDX-License-Identifier: 0BSD */
#include <grp.h>
#include <linux/capability.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
static int handoff_ticks(pid_t pid, char ticks[32]) {
  char path[64], bytes[4097];
  snprintf(path, sizeof path, "/proc/%d/stat", pid);
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return errno == ENOENT ? 0 : -1;
  ssize_t n = read(fd, bytes, sizeof bytes - 1);
  int saved = errno;
  close(fd);
  if (n <= 0 || n == sizeof bytes - 1) { errno = saved; return -1; }
  bytes[n] = 0;
  char *end = strrchr(bytes, ')'), *save = NULL;
  if (!end || end[1] != ' ') return -1;
  int field = 0;
  for (char *p = strtok_r(end + 2, " \n", &save); p;
       p = strtok_r(NULL, " \n", &save), field++) {
    if (field != 19) continue;
    if (!*p || strlen(p) >= 32 || strspn(p, "0123456789") != strlen(p))
      return -1;
    strcpy(ticks, p);
    return 1;
  }
  return -1;
}
typedef struct {
  char label[128];
  gid_t groups[64];
  int count;
  uint64_t capabilities;
} HandoffObserver;
static pid_t handoff_watcher;
static HandoffObserver handoff_observer(void) {
  const char *value = getenv("COUCHROOT_TEST_OBSERVER_PID");
  int64_t pid;
  if (!decimal(value, &pid) || pid < 1 || pid > INT_MAX)
    fatal("observer PID required");
  char path[64], first[32], last[32], bytes[8192];
  if (handoff_ticks((pid_t)pid, first) != 1) fatal("observer identity");
  snprintf(path, sizeof path, "/proc/%lld/cmdline", (long long)pid);
  readtext(path, bytes, sizeof bytes);
  if (strcmp(bytes, "/opt/usr/apps/MiniRoot01/bin/MiniRoot01.Service"))
    fatal("observer must be installed agent service");
  HandoffObserver result = {0};
  snprintf(path, sizeof path, "/proc/%lld/attr/current", (long long)pid);
  readtext(path, result.label, sizeof result.label);
  if (strcmp(result.label, "User") && strcmp(result.label, "User::Pkg::MiniRoot01"))
    fatal("unexpected service label");
  snprintf(path, sizeof path, "/proc/%lld/status", (long long)pid);
  readtext(path, bytes, sizeof bytes);
  int uid = 0, gid = 0, groups = 0, caps = 0;
  char *save;
  for (char *line = strtok_r(bytes, "\n", &save); line;
       line = strtok_r(NULL, "\n", &save)) {
    unsigned a, b, c, d;
    if (sscanf(line, "Uid: %u %u %u %u", &a, &b, &c, &d) == 4)
      uid = a == 5001 && b == a && c == a && d == a;
    if (sscanf(line, "Gid: %u %u %u %u", &a, &b, &c, &d) == 4)
      gid = a == 100 && b == a && c == a && d == a;
    unsigned long long effective;
    if (sscanf(line, "CapEff: %llx", &effective) == 1) {
      caps = effective == 0 || effective == UINT64_C(0x100000042);
      result.capabilities = effective;
    }
    if (!strncmp(line, "Groups:", 7)) {
      groups = 1;
      char *p = line + 7;
      while (*p) {
        while (isspace((unsigned char)*p)) p++;
        if (!*p) break;
        char *end; errno = 0;
        unsigned long n = strtoul(p, &end, 10);
        if (end == p || errno || n > UINT_MAX || result.count == 64)
          fatal("observer groups");
        result.groups[result.count++] = (gid_t)n;
        p = end;
      }
    }
  }
  if (!uid || !gid || !groups || !caps || handoff_ticks((pid_t)pid, last) != 1 || strcmp(first,last))
    fatal("service credentials or identity changed");
  return result;
}
static void handoff_observe(HandoffObserver *observer, pid_t worker, pid_t guardian,
                            const char *worker_ticks, const char *guardian_ticks,
                            int present) {
  const char *mode=getenv("COUCHROOT_TEST_OBSERVER_MODE");
  int pidfds=mode&&!strcmp(mode,"pidfd");
  if(mode&&!pidfds)fatal("unknown observer mode");
  if(pidfds&&!present){
    int status=0;pid_t got;double until=stamp()+11000;
    do{got=waitpid(handoff_watcher,&status,WNOHANG);if(!got)usleep(10000);}while(!got&&stamp()<until);
    if(got!=handoff_watcher||!WIFEXITED(status)||WEXITSTATUS(status))fatal("pidfd observer exit");
    handoff_watcher=0;
    mark("service_identity_pidfds_report_process_exit");
    return;
  }
  int ready[2]={-1,-1};
  if(pidfds&&pipe2(ready,O_CLOEXEC))fatal("observer ready pipe");
  pid_t probe = fork();
  if (probe < 0) fatal("observer fork");
  if (!probe) {
    /* Close the authenticated channel before dropping to the service identity. */
    if (w.fd >= 0) close(w.fd);
    w.fd = -1;
    memset(w.secret,0,sizeof w.secret);
    memset(w.nonce,0,sizeof w.nonce);
    child = 0; /* The probe must not run the controller's guardian cleanup. */
    if(pidfds)close(ready[0]);
    int fd = open("/proc/self/attr/current", O_WRONLY | O_CLOEXEC);
    size_t length = strlen(observer->label);
    if (fd < 0 || write(fd, observer->label, length) != (ssize_t)length) _exit(81);
    close(fd);
    if (prctl(PR_SET_KEEPCAPS,1,0,0,0) || setgroups(observer->count, observer->groups) ||
        setgid(100) || setuid(5001)) _exit(82);
    struct __user_cap_header_struct header={_LINUX_CAPABILITY_VERSION_3,0};
    struct __user_cap_data_struct capabilities[2]={{0}};
    for(int i=0;i<2;i++) capabilities[i].effective=capabilities[i].permitted=(uint32_t)(observer->capabilities>>(32*i));
    if(syscall(SYS_capset,&header,capabilities) || prctl(PR_SET_KEEPCAPS,0,0,0,0) ||
       syscall(SYS_capget,&header,capabilities)) _exit(87);
    for(int i=0;i<2;i++) if(capabilities[i].effective!=(uint32_t)(observer->capabilities>>(32*i)) ||
       capabilities[i].permitted!=capabilities[i].effective || capabilities[i].inheritable) _exit(88);
    gid_t actual[64];
    if (getuid()!=5001 || geteuid()!=5001 || getgid()!=100 || getegid()!=100 ||
        getgroups(64,actual)!=observer->count || memcmp(actual,observer->groups,observer->count*sizeof(gid_t))) _exit(83);
    char label[128], ticks[32], observed_boot[80];
    readtext("/proc/self/attr/current",label,sizeof label);
    readtext("/proc/sys/kernel/random/boot_id",observed_boot,sizeof observed_boot);
    if (strcmp(label,observer->label) || strcmp(boot,observed_boot)) _exit(84);
    if(pidfds){
#ifdef SYS_pidfd_open
      struct pollfd watched[2]={{(int)syscall(SYS_pidfd_open,worker,0),POLLIN,0},
                                {(int)syscall(SYS_pidfd_open,guardian,0),POLLIN,0}};
      if(watched[0].fd<0||watched[1].fd<0||poll(watched,2,0)!=0)_exit(89);
      if(write(ready[1],"R",1)!=1)_exit(90);
      close(ready[1]);
      int remaining=2;double until=stamp()+10000;
      while(remaining){
        int ms=(int)(until-stamp());
        if(ms<=0)_exit(91);
        int n=poll(watched,2,ms);
        if(n<0&&errno==EINTR)continue;
        if(n<=0)_exit(92);
        for(int i=0;i<2;i++){
          if(watched[i].fd<0)continue;
          if(watched[i].revents&(POLLERR|POLLNVAL))_exit(93);
          if(watched[i].revents&(POLLIN|POLLHUP)){close(watched[i].fd);watched[i].fd=-1;remaining--;}
        }
      }
      _exit(0);
#else
      _exit(94);
#endif
    }
    int a=handoff_ticks(worker,ticks);
    if (a != present || (present && strcmp(ticks,worker_ticks))) {
      fprintf(stderr,"observer worker read=%d errno=%d identity_match=%d\n",a,errno,a==1&&!strcmp(ticks,worker_ticks));
#ifdef SYS_pidfd_open
      /* Diagnose the newer kernel's unprivileged alternative, without turning
       * a failed /proc observation into a successful handoff qualification. */
      errno=0;
      int process_fd=(int)syscall(SYS_pidfd_open,worker,0),open_error=errno;
      struct pollfd watched={process_fd,POLLIN,0};
      int ready=process_fd>=0?poll(&watched,1,0):-1;
      fprintf(stderr,"observer pidfd_open=%d errno=%d ready=%d revents=%d\n",process_fd>=0,open_error,ready,watched.revents);
      if(process_fd>=0)close(process_fd);
#endif
      _exit(85);
    }
    int b=handoff_ticks(guardian,ticks);
    if (b != present || (present && strcmp(ticks,guardian_ticks))) {
      fprintf(stderr,"observer guardian read=%d errno=%d identity_match=%d\n",b,errno,b==1&&!strcmp(ticks,guardian_ticks));
      _exit(86);
    }
    _exit(0);
  }
  if(pidfds){
    close(ready[1]);struct pollfd readable={ready[0],POLLIN,0};char value=0;
    int ok=poll(&readable,1,5000)==1&&read(ready[0],&value,1)==1&&value=='R';close(ready[0]);
    if(!ok)fatal("pidfd observer did not bind live identities");
    handoff_watcher=probe;
    /* A fresh authenticated reply after binding proves that the worker PID
     * still identifies this worker. The controller also still owns the live
     * guardian child; it cannot have been reaped and its PID reused. */
    J *r=call(req("status")),*p=get(get(r,"result"),"processes");int status;
    if(number(get(p,"worker"),"pid")!=worker||number(get(p,"guardian"),"pid")!=guardian||
       strcmp(textval(get(p,"worker"),"start_ticks"),worker_ticks)||
       strcmp(textval(get(p,"guardian"),"start_ticks"),guardian_ticks)||waitpid(child,&status,WNOHANG)!=0)
      fatal("pidfd binding identity changed");
    discard(r);mark("service_identity_pidfds_bound_to_live_processes");return;
  }
  int status;
  while (waitpid(probe,&status,0)<0) if(errno!=EINTR) fatal("observer wait");
  if (!WIFEXITED(status) || WEXITSTATUS(status)) {
    fprintf(stderr,"service-identity observer result=%d expected_present=%d\n",status,present);
    fatal("service-identity process visibility");
  }
  mark(present ? "service_identity_reads_live_process_start_times"
               : "service_identity_observes_process_exit");
}
static J *handoff_snapshot(const char *phase) {
  J *r=call(req("status")), *row=obj();
  str(row,"handoff_phase",phase);
  /* Parse a copy so the row and caller have independent JSON ownership. */
  json_object_object_add(row,"status",parse(json(get(r,"result"))));
  puts(json(row));fflush(stdout);discard(row);
  return r;
}
static void handoff_checks(void) {
  HandoffObserver observer=handoff_observer();
  J *initial=handoff_snapshot("initial"), *info=get(initial,"result"),
    *processes=get(info,"processes");
  char worker_ticks[32],guardian_ticks[32];
  const char *wt=textval(get(processes,"worker"),"start_ticks"),
             *gt=textval(get(processes,"guardian"),"start_ticks");
  if(!wt||!gt||strlen(wt)>=32||strlen(gt)>=32||
     number(get(processes,"worker"),"pid")!=worker_pid||
     number(get(processes,"guardian"),"pid")!=child||
     number(info,"lifetime_seconds")!=0||strcmp(textval(info,"lifetime_mode"),"production"))
    fatal("handoff process metadata");
  strcpy(worker_ticks,wt);strcpy(guardian_ticks,gt);
  pid_t old_worker=worker_pid,old_guardian=child;
  char *runtime=strdup(textval(get(info,"app_launcher"),"path")),
       *group=strdup(textval(info,"freezer_group"));
  discard(initial);
  handoff_observe(&observer,old_worker,old_guardian,worker_ticks,guardian_ticks,1);
  char *path=format("%s/handoff-upload",filescope),sha[65];digest("x",1,sha);
  char *id=begin(path,1,sha,"absent");discard(handoff_snapshot("upload"));
  transfer_op("file.close",id,1);free(id);free(path);
  char *helper_id,*helper_path=stage_helper(&helper_id);
  discard(handoff_snapshot("helper"));
  discard(start_job("native-handoff-running","sleep 1",5000,"root"));
  discard(handoff_snapshot("running"));
  discard(start_job("native-handoff-appjob",helper_path,5000,"app"));
  await_job("native-handoff-appjob","completed",0,7000);
  J *r=output("native-handoff-appjob",0,0);
  contains(r,"stdout","uid=5001 euid=5001 gid=100 smack=User");discard(r);
  await_job("native-handoff-running","completed",0,7000);
  J *release=req("helper.release");str(release,"helper_id",helper_id);discard(call(release));
  discard(handoff_snapshot("drained"));
  mark("handoff_app_helper_identity_and_release");
  finish(0);
  handoff_observe(&observer,old_worker,old_guardian,worker_ticks,guardian_ticks,0);
  char *journal=format("%s/.jobs/guardian",filescope),
       *freezer=format("/sys/fs/cgroup/freezer/%s",group);
  if(access(runtime,F_OK)==0||access(journal,F_OK)==0||access(freezer,F_OK)==0)
    fatal("handoff resources retained after exit");
  mark("handoff_shutdown_releases_runtime_journal_and_freezer");
  const char *ids[]={"native-handoff-running","native-handoff-appjob"};
  for(size_t i=0;i<2;i++){
    char *record=format("%s/.jobs/%s.json",filescope,ids[i]),bytes[2048];
    readtext(record,bytes,sizeof bytes);J *saved=parse(bytes);
    if(!saved||strcmp(textval(saved,"state"),"completed")||number(saved,"exit_code"))
      fatal("handoff retained outcome");
    discard(saved);if(unlink(record))fatal("handoff record cleanup");free(record);
  }
  char *source=format("%s/helper-source",filescope),*lock=format("%s/.jobs/lock",filescope),*jobs=format("%s/.jobs",filescope);
  if(unlink(source)||unlink(app)||unlink(lock)||rmdir(jobs))fatal("handoff fixture cleanup");
  free(source);free(lock);free(jobs);free(helper_id);free(helper_path);free(runtime);free(group);free(journal);free(freezer);
  mark("handoff_retained_outcomes_and_owned_fixture_cleanup");
}
