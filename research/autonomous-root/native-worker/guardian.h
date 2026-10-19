/* Native crash guardian: owns descendants, lock, journal and runtime namespace.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
#include <sys/ptrace.h>
static pid_t guardian_pid;
static int guardian_fault_signal;
static volatile sig_atomic_t guardian_stop;
static int guardian_journal_owned, guardian_reconciled;
static const char *guardian_temporary_owned;
static const char *guardian_recovery_kind = "guardian-reaped-descendants";
static void guardian_signal(int sig) {
  (void)sig;
  guardian_stop = 1;
}
/* Interrupts ppoll() only; waitpid() reports the actual event. */
static void guardian_child_event(int sig) { (void)sig; }
static void guardian_journal(const char *phase) {
  int prepared = !strcmp(phase, "ready");
  char identity[32];
  if (!job_identity(getpid(), identity))
    fatal("guardian identity");
  J *j = obj();
  num(j, "schema", 4);
  str(j, "phase", phase);
  boolean(j, "prepared", prepared);
  struct stat scope_stat, ns_stat, runtime_stat, freezer_stat;
  if (fstat(directory, &scope_stat) || stat("/proc/self/ns/mnt", &ns_stat))
    fatal("guardian journal scope");
  num(j, "scope_dev", scope_stat.st_dev);
  num(j, "scope_ino", scope_stat.st_ino);
  num(j, "namespace_dev", ns_stat.st_dev);
  num(j, "namespace_ino", ns_stat.st_ino);
  if (helper_parent >= 0) {
    if (fstat(helper_parent, &runtime_stat))
      fatal("guardian runtime parent binding");
    num(j, "runtime_parent_dev", runtime_stat.st_dev);
    num(j, "runtime_parent_ino", runtime_stat.st_ino);
    boolean(j, "parent_created", helper_parent_created);
  }
  if (helper_owner >= 0) {
    if (fstat(helper_owner, &runtime_stat))
      fatal("guardian runtime binding");
    num(j, "runtime_dev", runtime_stat.st_dev);
    num(j, "runtime_ino", runtime_stat.st_ino);
    boolean(j, "parent_created", helper_parent_created);
  }
#ifndef NATIVE_WORKER_TEST
  if (freezer_root >= 0) {
    if (fstat(freezer_root, &freezer_stat))
      fatal("guardian freezer parent binding");
    num(j, "freezer_parent_dev", freezer_stat.st_dev);
    num(j, "freezer_parent_ino", freezer_stat.st_ino);
  }
  if (freezer_dir >= 0) {
    if (fstat(freezer_dir, &freezer_stat))
      fatal("guardian freezer binding");
    num(j, "freezer_dev", freezer_stat.st_dev);
    num(j, "freezer_ino", freezer_stat.st_ino);
  }
#else
  (void)freezer_stat;
#endif
  str(j, "worker_id", worker_id);
  str(j, "startup_token_sha256", startup_token_sha256);
  str(j, "boot_id", current_boot);
  num(j, "pid", getpid());
  str(j, "process_start", identity);
  int replacing = guardian_journal_owned;
  const char *temporary = replacing ? "guardian.next" : "guardian.initial";
  int fd = openat(jobs_dir, temporary,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("unresolved guardian journal; inspect before recovery");
  guardian_temporary_owned = temporary;
  const char *s = json(j);
  if (!replacing) {
    startup_fault("initial-created");
#ifdef NATIVE_WORKER_FAULT_TEST
    const char *fault = getenv("COUCHROOT_NATIVE_STARTUP_FAULT");
    if (fault && !strcmp(fault, "initial-partial")) {
      if (!job_write(fd, s, strlen(s) / 2) || fsync(fd))
        fatal("partial initial journal fixture");
      startup_fault("initial-partial");
    }
#endif
  }
#ifdef NATIVE_WORKER_FAULT_TEST
  if (replacing) {
    char partial[80];
    snprintf(partial, sizeof partial, "partial-%s", phase);
    const char *fault = getenv("COUCHROOT_NATIVE_STARTUP_FAULT");
    if (fault && !strcmp(fault, partial)) {
      if (!job_write(fd, s, strlen(s) / 2) || fsync(fd))
        fatal("partial successor journal fixture");
      startup_fault(partial);
    }
  }
#endif
#ifdef NATIVE_WORKER_FAULT_TEST
  char fail_at[80];
  snprintf(fail_at, sizeof fail_at, "fail-%s", phase);
  const char *failure = getenv("COUCHROOT_NATIVE_STARTUP_FAULT");
  if (failure && !strcmp(failure, fail_at)) {
    int wrote = job_write(fd, s, strlen(s) / 2);
    (void)wrote;
    close(fd);
    json_object_put(j);
    errno = ENOSPC;
    fatal("injected journal persistence failure");
  }
#endif
  int good = job_write(fd, s, strlen(s)) && !fsync(fd);
  close(fd);
  json_object_put(j);
  if (!good)
    fatal("guardian journal persistence");
  if (replacing) {
    char checkpoint[64];
    snprintf(checkpoint, sizeof checkpoint, "journal-%s", phase);
    startup_fault(checkpoint);
  } else
    startup_fault("initial-synced");
  if (renameat(jobs_dir, temporary, jobs_dir, "guardian"))
    fatal("guardian journal rename");
  guardian_temporary_owned = NULL;
  guardian_journal_owned = 1;
  if (fsync(jobs_dir))
    fatal("guardian journal persistence");
}
/* Initial intent names carry the owner's generated identity, even when their
 * contents were never written. A missing final record proves the execution
 * gate was not released. Preserve the ID as interrupted instead of replaying.
 */
static int guardian_private_file(const char *name, struct stat *st) {
  int fd = openat(jobs_dir, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return 0;
  int good = !fstat(fd, st) && S_ISREG(st->st_mode) && !st->st_uid &&
             !(st->st_mode & 077) && st->st_size >= 0 && st->st_size < 2048;
  close(fd);
  if (!good)
    errno = EINVAL;
  return good;
}
static int guardian_remove_temporary(const char *name,
                                     const struct stat *final) {
  struct stat st;
  if (!guardian_private_file(name, &st))
    return errno == ENOENT;
  if (st.st_nlink != 1 &&
      !(st.st_nlink == 2 && final && st.st_dev == final->st_dev &&
        st.st_ino == final->st_ino))
    return 0;
  return !unlinkat(jobs_dir, name, 0);
}
static int guardian_recover_intents(void) {
  DIR *d = scan_directory(jobs_dir);
  if (!d)
    return 0;
  char prefix[48];
  snprintf(prefix, sizeof prefix, ".intent-%s-", worker_id);
  size_t length = strlen(prefix);
  struct dirent *entry;
  int good = 1;
  while ((entry = readdir(d))) {
    if (strncmp(entry->d_name, prefix, length))
      continue;
    const char *id = entry->d_name + length;
    struct stat intent, final;
    if (!job_valid_id(id) || !guardian_private_file(entry->d_name, &intent)) {
      good = 0;
      continue;
    }
    char name[80], repair[128];
    snprintf(name, sizeof name, "%s.json", id);
    snprintf(repair, sizeof repair, ".repair-%s-%s", worker_id, id);
    int exists = !fstatat(jobs_dir, name, &final, AT_SYMLINK_NOFOLLOW);
    if ((!exists && errno != ENOENT) ||
        (exists && !guardian_private_file(name, &final)) ||
        (intent.st_nlink != 1 &&
         !(exists && intent.st_nlink == 2 && intent.st_dev == final.st_dev &&
           intent.st_ino == final.st_ino))) {
      good = 0;
      continue;
    }
    if (!guardian_remove_temporary(repair, exists ? &final : NULL)) {
      good = 0;
      continue;
    }
    if (!exists) {
      J *r = obj();
      str(r, "worker_id", worker_id);
      str(r, "id", id);
      str(r, "boot_id", current_boot);
      str(r, "state", "interrupted");
      str(r, "recovery", "initial-intent-not-published");
      boolean(r, "launch_started", 0);
      boolean(r, "output_available", 0);
      boolean(r, "timed_out", 0);
      json_object_object_add(r, "exit_code", NULL);
      int fd =
          openat(jobs_dir, repair,
                 O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
      const char *bytes = json(r);
      int saved = fd >= 0 && job_write(fd, bytes, strlen(bytes)) && !fsync(fd);
      if (fd >= 0 && close(fd))
        saved = 0;
      json_object_put(r);
      if (!saved || linkat(jobs_dir, repair, jobs_dir, name, 0) ||
          unlinkat(jobs_dir, repair, 0) || fsync(jobs_dir)) {
        good = 0;
        continue;
      }
    }
    if (unlinkat(jobs_dir, entry->d_name, 0) || fsync(jobs_dir))
      good = 0;
  }
  closedir(d);
  return good;
}
static int guardian_recover_records(void) {
  if (!guardian_recover_intents())
    return 0;
  DIR *d = scan_directory(jobs_dir);
  if (!d)
    return 0;
  struct dirent *entry;
  int good = 1;
  while ((entry = readdir(d))) {
    size_t len = strlen(entry->d_name);
    if (len < 5 || strcmp(entry->d_name + len - 5, ".json") || len > 69)
      continue;
    char id[65];
    memcpy(id, entry->d_name, len - 5);
    id[len - 5] = 0;
    if (!job_valid_id(id))
      continue;
    char bytes[2048];
    if (job_record_read(entry->d_name, bytes) != RECORD_READ) {
      good = 0;
      continue;
    }
    J *r = job_record_parse(bytes);
    const char *owner = r ? textval(r, "worker_id") : NULL;
    if (!owner || strcmp(owner, worker_id)) {
      if (r)
        json_object_put(r);
      continue;
    }
    const char *state = textval(r, "state");
    if (!state) {
      json_object_put(r);
      good = 0;
      continue;
    }
    char next[80];
    snprintf(next, sizeof next, "%s.json.next", id);
    /* The exclusive scope lock and owner field make this an owned interrupted
     * atomic-save temporary, never a reason to replay the command. */
    if (unlinkat(jobs_dir, next, 0) && errno != ENOENT) {
      json_object_put(r);
      good = 0;
      continue;
    }
    if (job_terminal(state)) {
      json_object_put(r);
      continue;
    }
    str(r, "state", "interrupted");
    str(r, "recovery", guardian_recovery_kind);
    num(r, "worker_fault_signal", guardian_fault_signal);
    boolean(r, "watchdog_triggered", guardian_watchdog);
    str(r, "watchdog_reason", guardian_watchdog_reason);
    boolean(r, "watchdog_froze_group",
            guardian_watchdog && freezer_dir >= 0 && !containment_failed);
    boolean(r, "output_available", 0);
    json_object_object_add(r, "exit_code", NULL);
    boolean(r, "timed_out", 0);
    int fd = openat(jobs_dir, next,
                    O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) {
      json_object_put(r);
      good = 0;
      continue;
    }
    const char *s = json(r);
    int saved = job_write(fd, s, strlen(s)) && !fsync(fd);
    close(fd);
    json_object_put(r);
    if (!saved || renameat(jobs_dir, next, jobs_dir, entry->d_name))
      good = 0;
  }
  closedir(d);
  if (fsync(jobs_dir))
    good = 0;
  return good;
}
static int guardian_children(int terminate) {
  /* waitid(P_PID, WNOWAIT) proves direct-child ownership atomically, including
   * a live child for which WNOHANG returns no exit event. This single-threaded
   * parent does not reap while iterating, so confirmed PIDs cannot be reused.
   * Avoid reading every TV process's status: cold /proc reads delay recovery.
   */
  DIR *proc = opendir("/proc");
  if (!proc)
    return -1;
  struct dirent *entry;
  int count = 0;
  while ((entry = readdir(proc))) {
    char *end;
    long pid = strtol(entry->d_name, &end, 10);
    if (*end || pid < 1 || pid > INT_MAX)
      continue;
    siginfo_t info;
    memset(&info, 0, sizeof info);
    if (waitid(P_PID, (id_t)pid, &info, WEXITED | WNOHANG | WNOWAIT)) {
      if (errno == ECHILD || errno == ESRCH || errno == EINTR)
        continue;
      closedir(proc);
      return -1;
    }
    count++;
    if (terminate && kill((pid_t)pid, SIGKILL) && errno != ESRCH) {
      closedir(proc);
      return -1;
    }
  }
  closedir(proc);
  return count;
}
static int guardian_drain(void) {
  double deadline = stamp() + 5000;
  for (;;) {
    if (guardian_children(1) < 0)
      return 0;
    int status;
    pid_t pid;
    while ((pid = waitpid(-1, &status, WNOHANG | __WALL)) > 0) {
    }
    if (pid < 0 && errno == ECHILD)
      return 1;
    if (pid < 0 && errno != EINTR)
      return 0;
    if (stamp() > deadline)
      return 0;
    usleep(10000);
  }
}
/* Some TV kernels silently ignore fatal-signal sigaction registrations and
 * run a slow crash collector. Seize only our own gated child before it creates
 * threads, then follow its threads and all fork/exec descendants.
 * A signal-delivery stop is handled before the kernel's default crash path.
 */
static pid_t guardian_tgid(pid_t thread) {
  /* Only called for a kernel-reported ptrace stop: the stopped task remains
   * owned and cannot recycle its identity while we inspect it. */
  char path[64], line[256];
  snprintf(path, sizeof path, "/proc/%d/status", thread);
  FILE *f = fopen(path, "r");
  if (!f)
    fatal("supervised task identity");
  int tgid = 0;
  while (fgets(line, sizeof line, f))
    if (sscanf(line, "Tgid: %d", &tgid) == 1)
      break;
  fclose(f);
  if (tgid <= 0)
    fatal("supervised task thread group");
  return (pid_t)tgid;
}
static void guardian_trace_stop(pid_t thread, int status, pid_t worker) {
  int sig = WSTOPSIG(status), event = (unsigned)status >> 16;
  enum __ptrace_request action = PTRACE_CONT;
  int deliver = 0;
  if (event == PTRACE_EVENT_STOP) {
    if (sig != SIGTRAP)
      action =
          PTRACE_LISTEN; /* Preserve deliberate group stops for watchdog. */
  } else if (event == PTRACE_EVENT_CLONE || event == PTRACE_EVENT_FORK ||
             event == PTRACE_EVENT_VFORK || event == PTRACE_EVENT_EXEC) {
    /* The auto-attached thread has its own initial PTRACE_EVENT_STOP. */
  } else if (event) {
    fatal("unexpected worker trace event");
  } else if (sig == SIGSEGV || sig == SIGBUS || sig == SIGILL ||
             sig == SIGFPE || sig == SIGABRT) {
    pid_t target = guardian_tgid(thread);
    if (target != worker) {
      siginfo_t info;
      if (ptrace(PTRACE_GETSIGINFO, thread, NULL, &info))
        fatal("command fault signal information");
      fault_event_save(target, thread, sig, info.si_code);
    }
    if (target == worker && !guardian_fault_signal)
      guardian_fault_signal = sig;
    if (getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
      fprintf(stderr, "prototype: guardian intercepted %s fault %d\n",
              target == worker ? "worker" : "command", sig);
    /* Command parents receive the actual SIGKILL wait status (137). Never
     * fabricate a SIGSEGV exit or mark the healthy worker as interrupted. */
    if (kill(target, SIGKILL) && errno != ESRCH)
      fatal("terminate faulted task");
    deliver = SIGKILL;
  } else {
    deliver = sig; /* Do not swallow normal signals, especially SIGCHLD. */
  }
  if (ptrace(action, thread, NULL, (void *)(intptr_t)deliver) && errno != ESRCH)
    fatal("resume supervised worker thread");
}
static void guardian_start(void) {
  if (prctl(PR_SET_CHILD_SUBREAPER, 1))
    fatal("native subreaper");
  guardian_pid = getpid();
  sigset_t blocked, previous;
  lifecycle_signals(&blocked);
  if (sigprocmask(SIG_BLOCK, &blocked, &previous))
    fatal("guardian signal mask");
  signal(SIGTERM, guardian_signal);
  signal(SIGINT, guardian_signal);
  signal(SIGALRM, guardian_signal);
  int gate[2];
  if (pipe2(gate, O_CLOEXEC))
    fatal("worker supervision gate");
  pid_t pid = fork();
  if (pid < 0)
    fatal("fork native worker");
  if (!pid) {
    fault_events_readonly();
    /* The guardian alone owns the scope lock. A frozen, EXITKILL-doomed worker
     * must not prevent the next owner from thawing the bound stale cgroup. */
    close(jobs_lock);
    jobs_lock = -1;
    runtime_owned = 0;
    guardian_journal_owned = 0;
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != guardian_pid)
      _exit(125);
    signal(SIGTERM, stop_signal);
    signal(SIGINT, stop_signal);
    signal(SIGALRM, stop_signal);
    if (sigprocmask(SIG_SETMASK, &previous, NULL))
      _exit(125);
    close(gate[1]);
    char ready;
    ssize_t got;
    do {
      got = read(gate[0], &ready, 1);
    } while (got < 0 && errno == EINTR);
    close(gate[0]);
    if (got != 1 || ready != 'R')
      _exit(125);
    containment_enter();
    alarm(lifetime_seconds);
    return;
  }
  close(gate[0]);
  if (ptrace(PTRACE_SEIZE, pid, NULL,
             (void *)(uintptr_t)(PTRACE_O_TRACECLONE | PTRACE_O_TRACEFORK |
                                 PTRACE_O_TRACEVFORK | PTRACE_O_TRACEEXEC |
                                 PTRACE_O_EXITKILL))) {
    int saved = errno;
    kill(pid, SIGKILL);
    while (waitpid(pid, NULL, 0) < 0 && errno == EINTR) {
    }
    close(gate[1]);
    errno = saved;
    fatal("native fault supervision unavailable");
  }
  /* From this point EXITKILL owns task termination. A fatal error must retain
   * the journal and views until a fresh owner proves those tasks gone; generic
   * atexit cleanup cannot establish that proof. Normal completion below drains
   * descendants and explicitly sweeps resources before retiring the journal.
   */
  runtime_owned = 0;
  if (!job_write(gate[1], "R", 1))
    fatal("release supervised worker");
  close(gate[1]);
  signal(SIGTERM, guardian_signal);
  signal(SIGINT, guardian_signal);
  signal(SIGALRM, guardian_signal);
  /* Trace stops pause supervised tasks until handled, so wait for events
   * instead of sleeping. Lifecycle signals and SIGCHLD stay blocked except
   * inside ppoll(), which closes the check-then-wait race. */
  struct sigaction child_event = {.sa_handler = guardian_child_event};
  sigset_t waiting = previous;
  sigdelset(&waiting, SIGCHLD);
  sigaddset(&blocked, SIGCHLD);
  if (sigemptyset(&child_event.sa_mask) ||
      sigaction(SIGCHLD, &child_event, NULL) ||
      sigprocmask(SIG_BLOCK, &blocked, NULL))
    _exit(125);
  alarm(lifetime_seconds ? lifetime_seconds + 10 : 0);
  int status = 0, worker_status = 0, worker_done = 0;
  close(pulse_pipe[1]);
  pulse_pipe[1] = -1;
  double stopping_at = 0, watchdog_started = 0, last_pulse = stamp();
  int pulse_seen = 0, pulse_open = 1, stalled = 0;
  while (!worker_done) {
    unsigned char pulses[128];
    ssize_t n;
    while ((n = read(pulse_pipe[0], pulses, sizeof pulses)) > 0) {
      last_pulse = stamp();
      pulse_seen = 1;
      for (ssize_t i = 0; i < n; i++)
        if (pulses[i] == 2 || pulses[i] == 3)
          stalled = pulses[i];
    }
    if (!n)
      pulse_open = 0; /* Every writer closed; stop polling its EOF. */
    if (n < 0 && errno != EAGAIN && errno != EINTR)
      _exit(125);
    pid_t got;
    while ((got = waitpid(-1, &status, WNOHANG | __WALL)) > 0) {
      if (WIFSTOPPED(status))
        guardian_trace_stop(got, status, pid);
      else if (got == pid) {
        worker_done = 1;
        worker_status = status;
      }
    }
    if (got < 0 && ((!worker_done && errno == ECHILD) ||
                    (errno != ECHILD && errno != EINTR)))
      _exit(125);
    if (worker_done)
      break;
    if (!guardian_watchdog &&
        (stalled || stamp() - last_pulse > (pulse_seen ? 1000 : 5000))) {
      guardian_watchdog = 1;
      guardian_watchdog_reason = stalled == 2   ? "active-request-stalled"
                                 : stalled == 3 ? "job-monitor-stalled"
                                                : "heartbeat-lost";
      watchdog_started = stamp();
      if (getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
        fprintf(stderr, "prototype: watchdog heartbeat age %.0f ms\n",
                watchdog_started - last_pulse);
      containment_freeze(pid);
      if (getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
        fprintf(stderr, "prototype: watchdog freeze %.0f ms\n",
                stamp() - watchdog_started);
      kill(pid, SIGKILL);
      fputs("prototype: guardian watchdog froze experiment and killed "
            "unresponsive worker\n",
            stderr);
    }
    if (guardian_stop) {
      if (!stopping_at) {
        kill(pid, SIGTERM);
        stopping_at = stamp();
      } else if (stamp() - stopping_at > 3000) {
        containment_freeze(pid);
        kill(pid, SIGKILL);
      }
    }
    /* Pulses, trace stops, exits and stop requests end the wait early. Timed
     * wakes cover the heartbeat and stop deadlines; containment keeps the
     * former 10 ms pass. */
    int wait = 10;
    if (!guardian_watchdog && !(stopping_at && stamp() - stopping_at > 3000)) {
      double until = last_pulse + (pulse_seen ? 1000 : 5000) + 1;
      if (stopping_at && stopping_at + 3001 < until)
        until = stopping_at + 3001;
      wait = wait_ms(until, 1000);
    }
    struct pollfd pulse = {pulse_open ? pulse_pipe[0] : -1, POLLIN, 0};
    struct timespec limit = {wait / 1000, wait % 1000 * 1000000L};
    if (ppoll(&pulse, 1, &limit, &waiting) < 0 && errno != EINTR)
      usleep(10000); /* Degrade to the former fixed pass, never spin. */
  }
  signal(SIGCHLD, SIG_DFL);
  if (sigprocmask(SIG_SETMASK, &previous, NULL))
    _exit(125);
  close(pulse_pipe[0]);
  pulse_pipe[0] = -1;
  alarm(0);
  /* Do not release ownership or publish interruption while any descendant can
   * still run. Unexpected retention leaves the durable journal fail-closed. */
  double recovery_started = stamp();
  if (watchdog_started && getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
    fprintf(stderr, "prototype: watchdog worker exit %.0f ms\n",
            recovery_started - watchdog_started);
  int drained = guardian_drain();
  if (getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
    fprintf(stderr, "prototype: guardian drain %.0f ms\n",
            stamp() - recovery_started);
  /* Once descendants are proven gone, a metadata write failure must not keep
   * executable views or an empty cgroup alive. Retain the journal for metadata
   * reconciliation, but attempt each independent resource cleanup. */
  int records_good = 0, runtime_good = 0, containment_good = 0;
  if (drained) {
    records_good = guardian_recover_records();
    runtime_good = runtime_sweep();
    containment_good = containment_cleanup();
  }
  if (getenv("COUCHROOT_NATIVE_RECOVERY_TIMING"))
    fprintf(stderr, "prototype: guardian recovery resources %.0f ms\n",
            stamp() - recovery_started);
  if (!drained || !records_good || !runtime_good || !containment_good ||
      containment_failed) {
    fputs("prototype: guardian recovery incomplete; journal retained\n",
          stderr);
    _exit(125);
  }
  if (unlinkat(jobs_dir, "guardian", 0) || fsync(jobs_dir))
    _exit(125);
  guardian_journal_owned = 0;
  jobs_cleanup();
  if (directory >= 0)
    close(directory);
  if (guardian_fault_signal)
    _exit(128 + guardian_fault_signal);
  _exit(wait_code(worker_status));
}
