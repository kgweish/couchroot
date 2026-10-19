/* Prototype-only freezer membership and independent liveness watchdog.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
static int freezer_root = -1, freezer_dir = -1;
static char freezer_name[64];
static int pulse_pipe[2] = {-1, -1}, pulse_started, pulse_stop;
static pthread_t pulse_thread;
static int guardian_watchdog, containment_failed;
static const char *guardian_watchdog_reason = "none";
static int freezer_write(const char *file, const char *value) {
#ifdef NATIVE_WORKER_TEST
  (void)file;
  (void)value;
  return 1;
#else
  int fd = openat(freezer_dir, file, O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return 0;
  int good = job_write(fd, value, strlen(value));
  close(fd);
  return good;
#endif
}
static void containment_storage(void) {
#ifndef NATIVE_WORKER_TEST
  freezer_root = open("/sys/fs/cgroup/freezer",
                      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (freezer_root < 0)
    fatal("prototype freezer controller unavailable");
#endif
}
static void containment_prepare(void) {
#ifndef NATIVE_WORKER_TEST
  snprintf(freezer_name, sizeof freezer_name, "couchroot-native-%s", worker_id);
  if (mkdirat(freezer_root, freezer_name, 0700))
    fatal("exclusive prototype freezer group");
  startup_fault("freezer-created");
  freezer_dir = openat(freezer_root, freezer_name,
                       O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (freezer_dir < 0)
    fatal("prototype freezer group");
#endif
  if (pipe2(pulse_pipe, O_CLOEXEC | O_NONBLOCK))
    fatal("guardian heartbeat pipe");
}
static int containment_cleanup(void) {
  if (freezer_dir >= 0) {
    close(freezer_dir);
    freezer_dir = -1;
  }
  int good = 1;
  if (freezer_root >= 0) {
    if (freezer_name[0] && unlinkat(freezer_root, freezer_name, AT_REMOVEDIR) &&
        errno != ENOENT)
      good = 0;
    close(freezer_root);
    freezer_root = -1;
  }
  return good;
}
static void *pulse_main(void *unused) {
  (void)unused;
  while (!__atomic_load_n(&pulse_stop, __ATOMIC_RELAXED)) {
    unsigned char pulse = progress_expired(&progress_main)   ? 2
                          : progress_expired(&progress_jobs) ? 3
                                                             : 1;
    ssize_t n = write(pulse_pipe[1], &pulse, 1);
    (void)n;
    usleep(100000);
  }
  return NULL;
}
static void containment_enter(void) {
  char pid[32];
  snprintf(pid, sizeof pid, "%d", getpid());
  if (!freezer_write("cgroup.procs", pid))
    fatal("join prototype freezer group");
  close(pulse_pipe[0]);
  pulse_pipe[0] = -1;
  start_thread(&pulse_thread, pulse_main, &pulse_started,
               "guardian heartbeat thread");
}
static void containment_worker_stop(void) {
  if (pulse_started) {
    __atomic_store_n(&pulse_stop, 1, __ATOMIC_RELAXED);
    pthread_join(pulse_thread, NULL);
    pulse_started = 0;
  }
}
static void containment_freeze(pid_t worker) {
  if (!freezer_write("freezer.state", "FROZEN")) {
    perror("prototype: freezer request");
    containment_failed = 1;
    return;
  }
  /* This is our unreaped child, so its PID cannot be recycled. */
  if (kill(worker, SIGKILL) && errno != ESRCH) {
    containment_failed = 1;
    return;
  }
#ifndef NATIVE_WORKER_TEST
  /* A dying multithreaded process can prevent the old freezer from reaching
   * FROZEN. Move only our already-killed worker back out; descendants remain
   * in the private leaf. SIGKILL prevents that worker returning to userspace.
   */
  int parent = openat(freezer_root, "cgroup.procs", O_WRONLY | O_CLOEXEC);
  char worker_text[32];
  snprintf(worker_text, sizeof worker_text, "%d", worker);
  int moved =
      parent >= 0 && job_write(parent, worker_text, strlen(worker_text));
  int move_error = errno;
  if (parent >= 0)
    close(parent);
  if (!moved && move_error != ESRCH) {
    errno = move_error;
    perror("prototype: remove dying worker from freezer");
    containment_failed = 1;
    return;
  }
  /* Older TV kernels retain killed tasks in a frozen cgroup. Wait until no
   * member can fork, queue SIGKILL to every member, then thaw so exit can run.
   * The exclusive private leaf, not persisted PIDs, establishes ownership. */
  double deadline = stamp() + 2000;
  for (;;) {
    char state[32] = {0};
    int fd = openat(freezer_dir, "freezer.state", O_RDONLY | O_CLOEXEC);
    ssize_t n = fd < 0 ? -1 : read(fd, state, sizeof state - 1);
    if (fd >= 0)
      close(fd);
    if (n > 0 && !strncmp(state, "FROZEN", 6))
      break;
    if (n < 0 || stamp() > deadline) {
      fprintf(stderr, "prototype: freezer wait failed state=%s errno=%d\n",
              state, errno);
      containment_failed = 1;
      return;
    }
    usleep(1000);
  }
  int fd = openat(freezer_dir, "cgroup.procs", O_RDONLY | O_CLOEXEC);
  FILE *members = fd < 0 ? NULL : fdopen(fd, "r");
  if (!members) {
    if (fd >= 0)
      close(fd);
    perror("prototype: freezer members");
    containment_failed = 1;
    return;
  }
  long member;
  int good = 1;
  while (fscanf(members, "%ld", &member) == 1) {
    if (member < 1 || member > INT_MAX ||
        (kill((pid_t)member, SIGKILL) && errno != ESRCH)) {
      perror("prototype: freezer kill");
      good = 0;
    }
  }
  if (ferror(members) || !feof(members)) {
    perror("prototype: freezer scan");
    good = 0;
  }
  fclose(members);
  if (!good || !freezer_write("freezer.state", "THAWED")) {
    perror("prototype: freezer thaw");
    containment_failed = 1;
  }
#endif
}
