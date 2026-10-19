/* On-TV native lifecycle acceptance; never replaces the deployed worker.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
#include "common.h"
#include <dirent.h>
#include <sched.h>
#include <sys/file.h>
#include <sys/mount.h>

#include "controller.h"
static const char *binary, *app, *appsha, *source_helper;
static int production_resources;
static char boot[80], namespace_before[80];
/* Count only descriptors surviving exec; controller sockets and pipes marked
 * CLOEXEC do not consume the candidate's startup budget. Runs in a forked child.
 */
static void startup_slots(unsigned slots) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_NOFILE, &limit))
    fatal("startup limit read");
  unsigned available = 0, bound = 0;
  while (bound < 4096 && available < slots) {
    int flags = fcntl((int)bound++, F_GETFD);
    if (flags < 0 && errno != EBADF)
      fatal("startup descriptor inventory");
    if (flags < 0 || (flags & FD_CLOEXEC))
      available++;
  }
  if (available != slots || bound > limit.rlim_cur)
    fatal("startup limit cannot be established");
  limit.rlim_cur = bound;
  if (setrlimit(RLIMIT_NOFILE, &limit))
    fatal("startup limit set");
}
static void launch(void) {
  sequence = 0;
  memset(&w, 0, sizeof w);
  random_bytes(w.secret, 32);
  random_bytes(w.nonce, 32);
  char *token = format("%s/token", scope), *encoded = base64(w.secret, 32);
  int fd = open(token, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("token create");
  writeall(fd, encoded, strlen(encoded));
  close(fd);
  free(encoded);
  int listener = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0)
    fatal("listener");
  struct sockaddr_in a = {.sin_family = AF_INET,
                          .sin_addr = {htonl(INADDR_LOOPBACK)}};
  if (bind(listener, (struct sockaddr *)&a, sizeof a) || listen(listener, 1))
    fatal("listen");
  socklen_t n = sizeof a;
  if (getsockname(listener, (struct sockaddr *)&a, &n))
    fatal("listener port");
  char port[16];
  snprintf(port, sizeof port, "%u", ntohs(a.sin_port));
  child = fork();
  if (child < 0)
    fatal("fork");
  if (!child) {
    if (production_resources)
      startup_slots(32);
    execl(binary, binary, "127.0.0.1", port, token, filescope, app, appsha,
          production_resources || getenv("COUCHROOT_NATIVE_HANDOFF_ONLY") ? "--production" :
          getenv("COUCHROOT_NATIVE_PARITY_ONLY") ? "--production-files"
                                                 : (char *)NULL,
          (char *)NULL);
    _exit(127);
  }
  struct pollfd ready = {listener, POLLIN, 0};
  if (poll(&ready, 1, 15000) != 1)
    fatal("native connection timeout");
  w.fd = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
  close(listener);
  if (w.fd < 0)
    fatal("accept");
  int one = 1;
  setsockopt(w.fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
  struct timeval timeout = {40, 0};
  setsockopt(w.fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout);
  setsockopt(w.fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof timeout);
  char nonce[65];
  hex(w.nonce, 32, nonce);
  char *hello = format("SAMSUNG-TV-ROOT/1\t%s\n", nonce);
  writeall(w.fd, hello, strlen(hello));
  free(hello);
  char *auth = receive(&w), *f[10];
  if (fields(auth, f, 10) != 8 || strcmp(f[0], "AUTH") || atoi(f[1]) <= 0 ||
      atoi(f[1]) == child)
    fatal("AUTH");
  for (int i = 2; i <= 5; i++)
    if (strcmp(f[i], "0"))
      fatal("not root");
  worker_pid = atoi(f[1]);
  free(auth);
  J *r = call(req("status"));
  if (production_resources &&
      (number(get(r, "result"), "lifetime_seconds") != 0 ||
       strcmp(textval(get(r, "result"), "lifetime_mode"), "production")))
    fatal("resource acceptance requires production lifetime");
  if (strcmp(textval(get(r, "result"), "boot_id"), boot))
    fatal("boot changed");
  if (number(get(r, "result"), "guardian_pid") != child ||
      number(get(r, "result"), "worker_dumpable") != 0 ||
      strcmp(textval(get(r, "result"), "fault_supervision"),
             "ptrace-owned-descendants") ||
      !json_object_get_boolean(
          get(get(get(r, "result"), "app_launcher"), "independently_staged")))
    fatal("native guardian or launcher status");
  json_object_put(r);
  char path[64], ns[80];
  snprintf(path, sizeof path, "/proc/%d/ns/mnt", worker_pid);
  ssize_t len = readlink(path, ns, sizeof ns - 1);
  if (len < 0)
    fatal("native mount namespace");
  ns[len] = 0;
  if (!strcmp(ns, namespace_before))
    fatal("native mount namespace not isolated");
}
static void finish(int disconnect) {
  double stop_started = stamp();
#ifdef NATIVE_WORKER_FAULT_TEST
  if (disconnect == 8 || disconnect == 9) {
    J *fault = req("test.stall");
    num(fault, "thread", disconnect == 9);
    json_object_put(call(fault));
  } else if (disconnect == 6 || disconnect == 7) {
    J *fault = req("test.fault");
    num(fault, "thread", disconnect == 7);
    json_object_put(call(fault));
  } else
#endif
      if (disconnect == 5)
    kill(worker_pid, SIGSTOP);
  else if (disconnect == 3 || disconnect == 4)
    kill(worker_pid, disconnect == 3 ? SIGKILL : SIGSEGV);
  else if (disconnect == 2)
    kill(child, SIGTERM);
  else if (disconnect)
    shutdown(w.fd, SHUT_RDWR);
  else {
    char *bye = format("SHUTDOWN\t%d", ++sequence);
    sendframe(&w, bye);
    free(bye);
    char *s = receive(&w);
    char *expected = format("BYE\t%d", sequence);
    if (strcmp(s, expected))
      fatal("shutdown");
    free(expected);
    free(s);
    if (getenv("COUCHROOT_NATIVE_HANDOFF_ONLY")) {
      struct pollfd eof = {w.fd, POLLIN, 0};
      char extra;
      if (w.at != w.end || poll(&eof, 1, 10000) != 1 || read(w.fd, &extra, 1) != 0)
        fatal("shutdown disconnect not confirmed");
    }
  }
  close(w.fd);
  w.fd = -1;
  int status;
  double deadline = stamp() + 30000;
  pid_t got;
  do {
    got = waitpid(child, &status, WNOHANG);
    if (got == 0)
      usleep(10000);
  } while (got == 0 && stamp() < deadline);
  if (got != child)
    fatal("native did not stop");
  child = 0;
  if (getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
    fprintf(stderr, "prototype: controller stop mode=%d %.0f ms\n", disconnect,
            stamp() - stop_started);
  if (disconnect >= 3 && disconnect <= 9) {
    int expected =
        (disconnect == 3 || disconnect == 5 || disconnect >= 8) ? 137 : 139;
    if (!WIFEXITED(status) || WEXITSTATUS(status) != expected)
      fatal("guardian crash status");
    if (stamp() - stop_started > 2000)
      fatal("worker fault recovery exceeded two seconds");
  }
  if (!disconnect && (!WIFEXITED(status) || WEXITSTATUS(status)))
    fatal("native shutdown failed");
}
static J *job_req(const char *op, const char *id) {
  J *j = req(op);
  str(j, "id", id);
  return j;
}
static J *start_job(const char *id, const char *cmd, int timeout,
                    const char *profile) {
  J *j = job_req("job.start", id);
  str(j, "command", cmd);
  num(j, "timeout_ms", timeout);
  str(j, "profile", profile);
  return call(j);
}
static void discard(J *r) { json_object_put(r); }
static void await_job(const char *id, const char *state, int code, int max_ms) {
  double deadline = stamp() + max_ms;
  for (;;) {
    J *r = call(job_req("job.status", id));
    J *result = get(r, "result");
    J *exit_code = get(result, "exit_code");
    if (exit_code && !json_object_is_type(exit_code, 0)) {
      if (strcmp(textval(result, "state"), state) ||
          number(result, "exit_code") != code ||
          json_object_get_boolean(get(result, "persistence_failed"))) {
        fprintf(stderr, "job mismatch %s\n", json(r));
        fatal("job completion");
      }
      discard(r);
      return;
    }
    discard(r);
    if (stamp() >= deadline)
      fatal("job wait timeout");
    usleep(20000);
  }
}
static J *output(const char *id, int64_t out, int64_t err) {
  J *j = job_req("job.output", id);
  num(j, "stdout_cursor", out);
  num(j, "stderr_cursor", err);
  return call(j);
}
static void contains(J *r, const char *stream, const char *expected) {
  const char *s = textval(get(get(r, "result"), stream), "data");
  size_t n;
  unsigned char *bytes = s ? decode(s, &n) : NULL;
  if (!bytes || !strstr((char *)bytes, expected))
    fatal("job output mismatch");
  free(bytes);
}
static void mark(const char *check) {
  J *j = obj();
  str(j, "check", check);
  boolean(j, "passed", 1);
  puts(json(j));
  fflush(stdout);
  discard(j);
}
static char *stage_helper_from(char **id, const char *input, const char *name) {
  char *path = format("%s/%s", filescope, name);
  int fd = open(input, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || st.st_size < 1 || st.st_size > CHUNK)
    fatal("helper source");
  unsigned char *data = allocate(st.st_size);
  ssize_t n = read(fd, data, st.st_size);
  close(fd);
  if (n != st.st_size)
    fatal("helper read");
  char sha[65];
  digest(data, n, sha);
  char *transfer = begin(path, n, sha, "absent");
  upload(transfer, 0, data, n, 1);
  transfer_op("file.commit", transfer, 1);
  free(transfer);
  free(data);
  J *j = req("helper.prepare");
  str(j, "path", path);
  str(j, "sha256",
      "0000000000000000000000000000000000000000000000000000000000000000");
  rejected(j);
  j = req("helper.prepare");
  str(j, "path", path);
  str(j, "sha256", sha);
  J *r = call(j);
  *id = strdup(textval(get(r, "result"), "helper_id"));
  char *staged = strdup(textval(get(r, "result"), "path"));
  discard(r);
  char *cmd = format("test \"$(sha256sum '%s' | cut -d' ' -f1)\" = '%s' && if "
                     "printf x > '%s'; then exit 1; else exit 0; fi",
                     staged, sha, staged);
  command(cmd, 5000, 0, 0);
  free(cmd);
  /* The controller's separate test namespace must not see native bind mounts.
   */
  FILE *mounts = fopen("/proc/self/mountinfo", "r");
  char linebuf[8192];
  if (!mounts)
    fatal("mountinfo");
  while (fgets(linebuf, sizeof linebuf, mounts))
    if (strstr(linebuf, *id))
      fatal("helper mount leaked into controller");
  fclose(mounts);
  free(path);
  mark("helper_digest_readonly_and_namespace");
  return staged;
}
static char *stage_helper(char **id) {
  return stage_helper_from(id, source_helper, "helper-source");
}
static void command_fault_checks(void) {
  for (int app_profile = 0; app_profile < 2; app_profile++) {
    double started = stamp();
    if (app_profile) {
      J *j = req("app.exec");
      str(j, "command", "kill -SEGV $$");
      num(j, "timeout_ms", 5000);
      J *r = call(j);
      if (number(get(r, "result"), "exit_code") != 137)
        fatal("app command fault result");
      discard(r);
    } else {
      command("kill -SEGV $$", 5000, 137, 0);
    }
    discard(start_job("native-child-fault-01", "kill -ABRT $$", 5000,
                      app_profile ? "app" : "root"));
    await_job("native-child-fault-01", "completed", 137, 2000);
    discard(call(job_req("job.forget", "native-child-fault-01")));
    if (stamp() - started > 2000)
      fatal("command faults exceeded two seconds");
    discard(call(req("status")));
  }
  mark("root_and_app_command_faults_preserve_worker");
#ifdef NATIVE_WORKER_FAULT_TEST
  char *id, *path = stage_helper_from(&id, binary, "fault-source");
  for (int profile = 0; profile < 2; profile++) {
    for (int thread = 0; thread < 2; thread++) {
      char *cmd =
          format("exec '%s' %s", path,
                 thread ? "--test-child-thread-fault" : "--test-child-fault");
      double started = stamp();
      discard(start_job("native-helper-fault-01", cmd, 5000,
                        profile ? "app" : "root"));
      free(cmd);
      await_job("native-helper-fault-01", "completed", 137, 2000);
      discard(call(job_req("job.forget", "native-helper-fault-01")));
      if (stamp() - started > 2000)
        fatal("helper fault exceeded two seconds");
    }
  }
  J *j = req("helper.release");
  str(j, "helper_id", id);
  discard(call(j));
  char *cmd = format("test ! -e '%s' && rm '%s/fault-source'", path, filescope);
  command(cmd, 5000, 0, 0);
  free(cmd);
  free(id);
  free(path);
  mark("root_and_app_helper_memory_faults_normal_release");
#endif
}
static int count_entries(pid_t pid, const char *name) {
  char path[80];
  snprintf(path, sizeof path, "/proc/%d/%s", pid, name);
  DIR *d = opendir(path);
  if (!d)
    fatal("soak process directory");
  int count = 0;
  struct dirent *e;
  while ((e = readdir(d)))
    if (e->d_name[0] != '.')
      count++;
  closedir(d);
  return count;
}
static int mount_count(pid_t pid) {
  char path[80], line[8192];
  snprintf(path, sizeof path, "/proc/%d/mountinfo", pid);
  FILE *f = fopen(path, "r");
  if (!f)
    fatal("soak mount inventory");
  int count = 0;
  while (fgets(line, sizeof line, f))
    count++;
  fclose(f);
  return count;
}
static long resident_kb(pid_t pid) {
  char path[80], line[256];
  snprintf(path, sizeof path, "/proc/%d/status", pid);
  FILE *f = fopen(path, "r");
  if (!f)
    fatal("soak process status");
  long rss = -1;
  while (fgets(line, sizeof line, f))
    if (sscanf(line, "VmRSS: %ld", &rss) == 1)
      break;
  fclose(f);
  if (rss < 0)
    fatal("soak RSS");
  return rss;
}
static void soak(int seconds) {
  if (!seconds)
    return;
  /* A foreground command beyond the progress grace must keep its lease alive.
   */
  command("sleep 32", 35000, 0, 0);
  int fd0 = count_entries(worker_pid, "fd"),
      tasks0 = count_entries(worker_pid, "task");
  int gfd0 = count_entries(child, "fd"), mounts0 = mount_count(worker_pid);
  long rss_min = LONG_MAX, rss_max = 0, guardian_rss_max = 0;
  int cycles = 0;
  double started = stamp();
  do {
    char *id, *path = stage_helper_from(&id, source_helper, "soak-source");
    discard(
        start_job("native-soak-root-01", "printf root-cycle", 5000, "root"));
    discard(start_job("native-soak-app-01", path, 5000, "app"));
    await_job("native-soak-root-01", "completed", 0, 7000);
    await_job("native-soak-app-01", "completed", 0, 7000);
    J *r = output("native-soak-app-01", 0, 0);
    contains(r, "stdout", "uid=5001 euid=5001 gid=100 smack=User");
    discard(r);
    discard(call(job_req("job.forget", "native-soak-root-01")));
    discard(call(job_req("job.forget", "native-soak-app-01")));
    J *j = req("helper.release");
    str(j, "helper_id", id);
    discard(call(j));
    char *cmd =
        format("test ! -e '%s' && rm '%s/soak-source'", path, filescope);
    command(cmd, 5000, 0, 0);
    free(cmd);
    free(id);
    free(path);
    discard(call(req("status")));
    if (count_entries(worker_pid, "fd") != fd0 ||
        count_entries(worker_pid, "task") != tasks0 ||
        count_entries(child, "fd") != gfd0 ||
        mount_count(worker_pid) != mounts0)
      fatal("soak descriptor/thread/mount growth");
    long rss = resident_kb(worker_pid), grss = resident_kb(child);
    if (rss < rss_min)
      rss_min = rss;
    if (rss > rss_max)
      rss_max = rss;
    if (grss > guardian_rss_max)
      guardian_rss_max = grss;
    cycles++;
    usleep(10000000);
  } while (stamp() - started < seconds * 1000.0);
  J *r = obj();
  str(r, "check", "bounded_lifetime_soak");
  boolean(r, "passed", 1);
  num(r, "elapsed_ms", (int64_t)(stamp() - started));
  num(r, "cycles", cycles);
  num(r, "worker_rss_min_kb", rss_min);
  num(r, "worker_rss_max_kb", rss_max);
  num(r, "guardian_rss_max_kb", guardian_rss_max);
  num(r, "worker_fds", fd0);
  num(r, "worker_threads", tasks0);
  num(r, "worker_mounts", mounts0);
  puts(json(r));
  fflush(stdout);
  discard(r);
}
#include "fault-events-accept.h"
#include "guardian-loss-accept.h"
#include "json-upload-accept.h"
#include "parity-accept.h"
#include "resource-accept.h"
#include "startup-resource-accept.h"
#include "launch-pressure-accept.h"
#include "storage-accept.h"
#include "handoff-accept.h"
int main(int argc, char **argv) {
  if (argc != 7) {
    fprintf(stderr,
            "accept WORKER TOKEN_SCOPE FILE_SCOPE LAUNCHER SHA HELPER\n");
    return 64;
  }
  binary = argv[1];
  scope = argv[2];
  filescope = argv[3];
  app = argv[4];
  appsha = argv[5];
  source_helper = argv[6];
  const char *resource_mode = getenv("COUCHROOT_NATIVE_PRODUCTION_RESOURCES");
  const char *pressure_mode = getenv("COUCHROOT_NATIVE_LAUNCH_PRESSURE");
  const char *production_mode = resource_mode ? resource_mode : pressure_mode;
  production_resources = production_mode != NULL;
  if (production_resources &&
      (strcmp(production_mode, "1") || (resource_mode && pressure_mode) ||
       getenv("COUCHROOT_NATIVE_HANDOFF_ONLY") ||
       getenv("COUCHROOT_NATIVE_PARITY_ONLY") ||
       getenv("COUCHROOT_NATIVE_RESOURCE_ONLY") ||
       getenv("COUCHROOT_NATIVE_SOAK_SECONDS") ||
       getenv("COUCHROOT_NATIVE_LIFETIME_SECONDS"))) {
    fputs("production resource acceptance cannot combine experiment modes\n",
          stderr);
    return 64;
  }
  signal(SIGPIPE, SIG_IGN);
  libraries();
  /* Namespace-pin refusal fixtures must never add mounts to deployed .NET. */
  if (unshare(CLONE_NEWNS) || mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL))
    fatal("controller test namespace");
  atexit(stop_child);
  int soak_seconds = 0;
  const char *soak_value = getenv("COUCHROOT_NATIVE_SOAK_SECONDS");
  if (soak_value) {
    int64_t value;
    if (!decimal(soak_value, &value) || value < 60 || value > 3600)
      fatal("soak must be 60..3600 seconds");
    soak_seconds = (int)value;
    char lifetime[16];
    snprintf(lifetime, sizeof lifetime, "%d", soak_seconds + 300);
    if (setenv("COUCHROOT_NATIVE_LIFETIME_SECONDS", lifetime, 1))
      fatal("soak lifetime");
  }
  alarm(soak_seconds + 240);
  readtext("/proc/sys/kernel/random/boot_id", boot, sizeof boot);
  ssize_t ns = readlink("/proc/self/ns/mnt", namespace_before,
                        sizeof namespace_before - 1);
  if (ns < 0)
    fatal("parent namespace");
  namespace_before[ns] = 0;
  if (resource_mode)
    startup_refusal_checks();
  launch();
  if (getenv("COUCHROOT_NATIVE_HANDOFF_ONLY")) {
    handoff_checks();
    return 0;
  }
  if (getenv("COUCHROOT_NATIVE_PARITY_ONLY")) {
    parity_checks();
    return 0;
  }
  if (production_resources || getenv("COUCHROOT_NATIVE_RESOURCE_ONLY")) {
    if (pressure_mode) {
      launch_pressure_checks();
    } else if (production_resources) {
      guardian_resource_checks(0);
      guardian_resource_checks(1);
      production_idle_limit_checks();
      storage_recovery_checks();
    }
    if (!pressure_mode) {
      resource_limit_checks();
      fault_diagnostic_checks();
      json_upload_checks();
    }
    finish(0);
    char *lock = format("%s/.jobs/lock", filescope),
         *dir = format("%s/.jobs", filescope);
    if (unlink(app) || unlink(lock) || rmdir(dir))
      fatal("focused resource cleanup");
    free(lock);
    free(dir);
    mark(pressure_mode ? "launch_pressure_shutdown_and_cleanup" :
         production_resources ? "production_resource_shutdown_and_cleanup"
                              : "focused_resource_shutdown_and_cleanup");
    return 0;
  }
  J *initial = call(req("status"));
  const char *staged =
      textval(get(get(initial, "result"), "app_launcher"), "path");
  if (!staged || !strcmp(staged, app) ||
      !strstr(staged, "/.launcher/app-launcher"))
    fatal("independent launcher path");
  char *check = format("test \"$(sha256sum '%s' | cut -d' ' -f1)\" = '%s' && "
                       "if printf x > '%s'; then exit 1; else exit 0; fi",
                       staged, appsha, staged);
  command(check, 5000, 0, 0);
  free(check);
  const char *group = textval(get(initial, "result"), "freezer_group");
  if (!group ||
      strncmp(group, "couchroot-native-", strlen("couchroot-native-")))
    fatal("private freezer group missing");
  char *membership_command =
      format("grep -F ':freezer:/%s' /proc/self/cgroup", group);
  command(membership_command, 5000, 0, 0);
  J *membership = req("app.exec");
  str(membership, "command", membership_command);
  num(membership, "timeout_ms", 5000);
  J *checked = call(membership);
  if (number(get(checked, "result"), "exit_code") ||
      !strstr(textval(get(checked, "result"), "stdout"), group))
    fatal("app freezer inheritance");
  discard(checked);
  free(membership_command);
  discard(initial);
  mark("independent_launcher_digest_and_readonly_view");
  char *helper_id, *helper_path = stage_helper(&helper_id);
  discard(start_job("native-long-job-01",
                    "printf begin; sleep 27; printf end; exit 7", 40000,
                    "root"));
  discard(start_job("native-app-job-001", helper_path, 5000, "app"));
  await_job("native-app-job-001", "completed", 0, 7000);
  J *r = output("native-app-job-001", 0, 0);
  contains(r, "stdout", "uid=5001 euid=5001 gid=100 smack=User");
  discard(r);
  mark("native_staged_helper_app_job_identity");
  J *j = req("helper.release");
  str(j, "helper_id", helper_id);
  rejected(j);
  j = job_req("job.start", "native-long-job-01");
  str(j, "command", ":");
  str(j, "profile", "root");
  num(j, "timeout_ms", 1000);
  rejected(j);
  rejected(job_req("job.forget", "native-long-job-01"));
  char *cmd = format("sleep 2; touch '%s/survivor'", filescope);
  discard(start_job("native-timeout-001", cmd, 100, "root"));
  discard(start_job("native-cancel-0001", cmd, 5000, "root"));
  free(cmd);
  discard(call(job_req("job.cancel", "native-cancel-0001")));
  command("sleep 2.2; printf foreground", 5000, 0, 0);
  await_job("native-timeout-001", "timed_out", 137, 5000);
  await_job("native-cancel-0001", "cancelled", 137, 5000);
  cmd = format("test ! -e '%s/survivor'", filescope);
  command(cmd, 5000, 0, 0);
  free(cmd);
  cmd =
      format("(sleep .5; touch '%s/foreground-survivor') & exit 0", filescope);
  command(cmd, 100, 124, 1);
  free(cmd);
  usleep(600000);
  cmd = format("test ! -e '%s/foreground-survivor'", filescope);
  command(cmd, 5000, 0, 0);
  free(cmd);
  mark("timeout_cancel_during_foreground_and_no_survivor");
  discard(start_job(
      "native-output-001",
      "head -c 1200000 /dev/zero; printf tail; printf error >&2; exit 9", 10000,
      "root"));
  await_job("native-output-001", "completed", 9, 12000);
  r = output("native-output-001", 0, 0);
  J *stream = get(get(r, "result"), "stdout");
  size_t count;
  unsigned char *bytes = decode(textval(stream, "data"), &count);
  if (!bytes || count != 65536 ||
      !json_object_get_boolean(get(stream, "truncated")) ||
      number(stream, "end_cursor") != 1200004)
    fatal("bounded ring");
  free(bytes);
  contains(r, "stderr", "error");
  discard(r);
  r = output("native-output-001", 1200000, 0);
  contains(r, "stdout", "tail");
  discard(r);
  j = job_req("job.output", "native-output-001");
  num(j, "stdout_cursor", 1200005);
  num(j, "stderr_cursor", 0);
  rejected(j);
  mark("nonzero_exit_bounded_logs_and_cursors");
  /* Leave protocol idle while the >25-second job continues. */
  usleep(26000000);
  await_job("native-long-job-01", "completed", 7, 10000);
  r = output("native-long-job-01", 0, 0);
  contains(r, "stdout", "beginend");
  discard(r);
  mark("background_job_over_25_seconds_and_idle_connection");
  j = req("helper.release");
  str(j, "helper_id", helper_id);
  discard(call(j));
  cmd = format("test ! -e '%s'", helper_path);
  command(cmd, 5000, 0, 0);
  free(cmd);
  j = req("helper.release");
  str(j, "helper_id", helper_id);
  rejected(j);
  free(helper_id);
  free(helper_path);
  mark("helper_release_and_unknown_id");
  command_fault_checks();
  soak(soak_seconds);
  /* Fill all helper slots and ensure rollback/release permits reuse. */
  char *source = format("%s/helper-source", filescope);
  int fd = open(source, O_RDONLY | O_CLOEXEC);
  char sha[65];
  if (fd < 0 || !filedigest(fd, sha))
    fatal("source digest");
  close(fd);
  char *ids[8];
  for (int i = 0; i < 8; i++) {
    j = req("helper.prepare");
    str(j, "path", source);
    str(j, "sha256", sha);
    r = call(j);
    ids[i] = strdup(textval(get(r, "result"), "helper_id"));
    discard(r);
  }
  j = req("helper.prepare");
  str(j, "path", source);
  str(j, "sha256", sha);
  rejected(j);
  for (int i = 0; i < 8; i++) {
    j = req("helper.release");
    str(j, "helper_id", ids[i]);
    discard(call(j));
    free(ids[i]);
  }
  mark("helper_retention_limit_and_release");
  /* A remaining owned view and running job must be cleaned on disconnect. */
  j = req("helper.prepare");
  str(j, "path", source);
  str(j, "sha256", sha);
  r = call(j);
  helper_path = strdup(textval(get(r, "result"), "path"));
  discard(r);
  cmd = format("sleep 2; touch '%s/disconnected-survivor'", filescope);
  discard(start_job("native-disconnect-01", cmd, 10000, "root"));
  free(cmd);
  finish(1);
  if (access(helper_path, F_OK) == 0)
    fatal("helper survived disconnect");
  free(helper_path);
  usleep(2200000);
  char *survivor = format("%s/disconnected-survivor", filescope);
  if (access(survivor, F_OK) == 0)
    fatal("job survived disconnect");
  free(survivor);
  mark("disconnect_cleans_job_and_helper");
  launch();
  r = call(job_req("job.status", "native-long-job-01"));
  J *saved = get(r, "result");
  if (strcmp(textval(saved, "state"), "completed") ||
      json_object_get_boolean(get(saved, "output_available")))
    fatal("saved job status");
  discard(r);
  r = call(job_req("job.status", "native-disconnect-01"));
  if (strcmp(textval(get(r, "result"), "state"), "interrupted"))
    fatal("saved interrupted job");
  discard(r);
  j = job_req("job.start", "native-long-job-01");
  str(j, "command", ":");
  str(j, "profile", "root");
  num(j, "timeout_ms", 1000);
  rejected(j);
  const char *jobs[] = {"native-long-job-01", "native-app-job-001",
                        "native-timeout-001", "native-cancel-0001",
                        "native-output-001",  "native-disconnect-01"};
  for (size_t i = 0; i < sizeof jobs / sizeof *jobs; i++)
    discard(call(job_req("job.forget", jobs[i])));
  mark("restart_saved_status_no_replay_and_forget");
  for (int mode = 0; mode <= 2; mode += 2) {
    j = req("helper.prepare");
    str(j, "path", source);
    str(j, "sha256", sha);
    r = call(j);
    helper_path = strdup(textval(get(r, "result"), "path"));
    discard(r);
    discard(start_job("native-stop-job-01", "sleep 30", 60000, "root"));
    finish(mode);
    if (access(helper_path, F_OK) == 0)
      fatal("helper survived worker stop");
    free(helper_path);
    launch();
    r = call(job_req("job.status", "native-stop-job-01"));
    if (strcmp(textval(get(r, "result"), "state"), "interrupted"))
      fatal("job survived worker stop");
    discard(r);
    discard(call(job_req("job.forget", "native-stop-job-01")));
    mark(mode == 0 ? "graceful_stop_cleans_active_job_and_helper"
                   : "signal_stop_cleans_active_job_and_helper");
  }
#ifdef NATIVE_WORKER_FAULT_TEST
  const int last_crash_mode = 9;
#else
  const int last_crash_mode = 5;
#endif
  for (int mode = 3; mode <= last_crash_mode; mode++) {
    j = req("helper.prepare");
    str(j, "path", source);
    str(j, "sha256", sha);
    r = call(j);
    helper_path = strdup(textval(get(r, "result"), "path"));
    discard(r);
    r = call(req("status"));
    char *old_launcher =
        strdup(textval(get(get(r, "result"), "app_launcher"), "path"));
    discard(r);
    cmd = format("setsid sh -c \"sleep 2; touch '%s/crash-survivor'\" "
                 ">/dev/null 2>&1 & printf ready; sleep 30",
                 filescope);
    discard(start_job("native-crash-job-01", cmd, 60000, "root"));
    free(cmd);
    double deadline = stamp() + 5000;
    for (;;) {
      r = output("native-crash-job-01", 0, 0);
      size_t n;
      unsigned char *data =
          decode(textval(get(get(r, "result"), "stdout"), "data"), &n);
      int ready = data && strstr((char *)data, "ready");
      free(data);
      discard(r);
      if (ready)
        break;
      if (stamp() > deadline)
        fatal("crash job readiness");
      usleep(10000);
    }
    finish(mode);
    if (access(helper_path, F_OK) == 0 || access(old_launcher, F_OK) == 0)
      fatal("crash runtime survived guardian cleanup");
    free(helper_path);
    free(old_launcher);
    usleep(2200000);
    char *marker = format("%s/crash-survivor", filescope);
    if (access(marker, F_OK) == 0)
      fatal("detached descendant survived crash");
    free(marker);
    launch();
    r = call(job_req("job.status", "native-crash-job-01"));
    J *record = get(get(r, "result"), "record");
    if (strcmp(textval(get(r, "result"), "state"), "interrupted") ||
        strcmp(textval(record, "recovery"), "guardian-reaped-descendants") ||
        get(record, "exit_code") != NULL)
      fatal("crash recovery record");
    if ((mode == 4 || mode == 6 || mode == 7) &&
        number(record, "worker_fault_signal") != SIGSEGV)
      fatal("worker fault was not intercepted");
    if (mode >= 8 &&
        strcmp(textval(record, "watchdog_reason"),
               mode == 8 ? "active-request-stalled" : "job-monitor-stalled"))
      fatal("progress watchdog reason");
    if ((mode == 5 || mode >= 8) &&
        !json_object_get_boolean(get(record, "watchdog_froze_group")))
      fatal("watchdog containment not used");
    discard(r);
    j = job_req("job.start", "native-crash-job-01");
    str(j, "command", ":");
    str(j, "profile", "root");
    num(j, "timeout_ms", 1000);
    rejected(j);
    discard(call(job_req("job.forget", "native-crash-job-01")));
    discard(
        start_job("native-after-crash-01", "printf recovered", 5000, "app"));
    await_job("native-after-crash-01", "completed", 0, 7000);
    r = output("native-after-crash-01", 0, 0);
    contains(r, "stdout", "recovered");
    discard(r);
    discard(call(job_req("job.forget", "native-after-crash-01")));
    mark(mode == 3
             ? "sigkill_recovery_reaps_detached_children_and_restages_launcher"
         : mode == 4 ? "sigsegv_recovery_no_replay_and_app_execution"
         : mode == 5
             ? "stopped_worker_watchdog_freezes_owned_group_and_recovers"
         : mode == 6 ? "main_thread_memory_fault_recovery"
         : mode == 7 ? "new_worker_thread_memory_fault_recovery"
         : mode == 8 ? "active_request_progress_watchdog_recovery"
                     : "job_monitor_progress_watchdog_recovery");
  }
  guardian_loss_checks(0);
  guardian_loss_checks(1);
#ifdef NATIVE_WORKER_FAULT_TEST
  startup_recovery_checks();
  orphan_intent_checks();
#endif
  storage_recovery_checks();
  resource_limit_checks();
  fault_diagnostic_checks();
  json_upload_checks();
  finish(0);
  if (unlink(app))
    fatal("remove launcher source");
  if (unlink(source))
    fatal("remove helper source");
  free(source);
  char *lock = format("%s/.jobs/lock", filescope),
       *dir = format("%s/.jobs", filescope);
  if (unlink(lock) || rmdir(dir))
    fatal("job storage not empty");
  free(lock);
  free(dir);
  mark("graceful_shutdown_and_owned_storage_cleanup");
  return 0;
}
