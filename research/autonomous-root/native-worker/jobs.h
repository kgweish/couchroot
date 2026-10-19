/* Prototype job supervision. Original Couchroot code. SPDX-License-Identifier:
 * 0BSD */
#include <sys/eventfd.h>
#include <sys/file.h>
#include <sys/prctl.h>

typedef struct {
  unsigned char *bytes;
  int64_t end;
} JobLog;
typedef struct {
  char id[65], boot[80], started[40], identity[32], state[20];
  pid_t pid;
  int pipes[2], finished, reaped, code, timed, save_failed;
  double deadline, drain_deadline, save_retry;
  JobLog logs[2];
} Job;
static Job jobs[16];
static int jobs_dir = -1, jobs_lock = -1, jobs_wake = -1, jobs_started,
           jobs_stop;
static pthread_t jobs_thread;
static pthread_mutex_t jobs_mutex = PTHREAD_MUTEX_INITIALIZER;
static char current_boot[80];
/* Wake the monitor for a new, cancelled or stopping job. A saturated eventfd
 * counter already has a wake pending. */
static void jobs_notify(void) {
  uint64_t one = 1;
  ssize_t n = write(jobs_wake, &one, sizeof one);
  (void)n;
}
static int job_terminal(const char *state) {
  return !strcmp(state, "completed") || !strcmp(state, "cancelled") ||
         !strcmp(state, "timed_out") || !strcmp(state, "interrupted");
}
static void job_clear(Job *j) {
  for (int s = 0; s < 2; s++)
    free(j->logs[s].bytes);
  memset(j, 0, sizeof *j);
}
/* Bounded, private saved record. Callers parse the NUL-terminated bytes. */
enum { RECORD_READ, RECORD_MISSING, RECORD_INVALID, RECORD_SHORT };
static int job_record_read(const char *name, char bytes[2048]) {
  int fd = openat(jobs_dir, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return RECORD_MISSING;
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid ||
      (st.st_mode & 077) || st.st_nlink != 1 || st.st_size < 1 ||
      st.st_size >= 2048) {
    close(fd);
    return RECORD_INVALID;
  }
  ssize_t n = read(fd, bytes, 2047);
  close(fd);
  if (n != st.st_size)
    return RECORD_SHORT;
  bytes[n] = 0;
  return RECORD_READ;
}
/* Managed retained JSON may begin with a UTF-8 BOM. Match the importer without
 * rewriting the record or changing the protocol's JSON acceptance rules. */
static J *job_record_parse(const char *bytes) {
  if (strlen(bytes) >= 3 && !memcmp(bytes, "\xef\xbb\xbf", 3))
    bytes += 3;
  return parse(bytes);
}
static int job_identity(pid_t pid, char result[32]) {
  char path[64], buf[4096];
  snprintf(path, sizeof path, "/proc/%d/stat", pid);
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0)
    return 0;
  ssize_t n = read(fd, buf, sizeof buf - 1);
  close(fd);
  if (n <= 0)
    return 0;
  buf[n] = 0;
  char *p = strrchr(buf, ')'), *save;
  if (!p)
    return 0;
  int index = 0;
  for (char *s = strtok_r(p + 2, " ", &save); s;
       s = strtok_r(NULL, " ", &save), index++)
    if (index == 19 && strlen(s) < 32) {
      strcpy(result, s);
      return 1;
    }
  return 0;
}
/* Match managed IsNullOrWhiteSpace for a UTF-8 command. JSON has already
 * rejected embedded NUL. Any non-whitespace byte sequence is a command. */
static int job_command_nonblank(const char *command) {
  if (!command)
    return 0;
  const unsigned char *p = (const unsigned char *)command;
  while (*p) {
    if (*p == ' ' || (*p >= 9 && *p <= 13)) {
      p++;
      continue;
    }
    if (p[0] == 0xc2 && (p[1] == 0x85 || p[1] == 0xa0)) {
      p += 2;
      continue;
    }
    if (p[0] == 0xe1 && p[1] == 0x9a && p[2] == 0x80) {
      p += 3;
      continue;
    }
    if (p[0] == 0xe2 && p[1] == 0x80 &&
        ((p[2] >= 0x80 && p[2] <= 0x8a) || p[2] == 0xa8 || p[2] == 0xa9 ||
         p[2] == 0xaf)) {
      p += 3;
      continue;
    }
    if (p[0] == 0xe2 && p[1] == 0x81 && p[2] == 0x9f) {
      p += 3;
      continue;
    }
    if (p[0] == 0xe3 && p[1] == 0x80 && p[2] == 0x80) {
      p += 3;
      continue;
    }
    return 1;
  }
  return 0;
}
static int job_valid_id(const char *id) {
  if (!id || strlen(id) < 16 || strlen(id) > 64)
    return 0;
  for (const unsigned char *p = (const unsigned char *)id; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
          (*p >= '0' && *p <= '9') || *p == '-'))
      return 0;
  return 1;
}
static int job_write(int fd, const void *buf, size_t n) {
  const unsigned char *p = buf;
  while (n) {
    ssize_t got = write(fd, p, n);
    if (got < 0 && errno == EINTR)
      continue;
    if (got <= 0)
      return 0;
    p += got;
    n -= got;
  }
  return 1;
}
/* No library JSON objects cross the supervisor lock. Records contain only
 * validated identifiers, kernel integers and generated timestamps, never
 * command text. */
static int job_save_tracked(Job *j, int exclusive, int *published) {
  if (published)
    *published = 0;
  char name[80], temp[128], bytes[768], code[24];
  snprintf(name, sizeof name, "%s.json", j->id);
  if (exclusive)
    snprintf(temp, sizeof temp, ".intent-%s-%s", worker_id, j->id);
  else
    snprintf(temp, sizeof temp, "%s.next", name);
  if (j->finished)
    snprintf(code, sizeof code, "%d", j->code);
  else
    strcpy(code, "null");
  int n = snprintf(
      bytes, sizeof bytes,
      "{\"worker_id\":\"%s\",\"id\":\"%s\",\"boot_id\":\"%s\",\"state\":\"%s\","
      "\"started_at\":\"%s\",\"pid\":%d,\"process_start\":\"%s\","
      "\"exit_code\":%s,\"timed_out\":%s}",
      worker_id, j->id, j->boot, j->state, j->started, j->pid, j->identity,
      code, j->timed ? "true" : "false");
  if (n < 0 || n >= (int)sizeof bytes)
    return 0;
  int fd = openat(jobs_dir, temp,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0)
    return 0;
#ifdef NATIVE_WORKER_FAULT_TEST
  const char *intent_fault = getenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT");
  if (exclusive && intent_fault) {
    if (!strcmp(intent_fault, "created"))
      _exit(86);
    if (!strcmp(intent_fault, "partial")) {
      int wrote = job_write(fd, bytes, n / 2);
      (void)wrote;
      _exit(86);
    }
  }
#endif
  int good = job_write(fd, bytes, n) && !fsync(fd);
  if (close(fd))
    good = 0;
  /* Publish the first intent without replacing an existing ID. A partial
   * write must never become the durable job record, and no child is released
   * before both the complete record and directory entry have been synced. */
  if (good && exclusive) {
#ifdef NATIVE_WORKER_FAULT_TEST
    if (intent_fault && !strcmp(intent_fault, "synced"))
      _exit(86);
#endif
    if (linkat(jobs_dir, temp, jobs_dir, name, 0))
      good = 0;
    else if (published)
      *published = 1;
#ifdef NATIVE_WORKER_FAULT_TEST
    if (good && intent_fault && !strcmp(intent_fault, "linked"))
      _exit(86);
#endif
    if (unlinkat(jobs_dir, temp, 0))
      good = 0;
  } else if (good && renameat(jobs_dir, temp, jobs_dir, name))
    good = 0;
  if (!good)
    unlinkat(jobs_dir, temp, 0);
  if (good && fsync(jobs_dir))
    good = 0;
#ifdef NATIVE_WORKER_FAULT_TEST
  if (good && exclusive && intent_fault && !strcmp(intent_fault, "published"))
    _exit(86);
#endif
  return good;
}
static int job_save(Job *j, int exclusive) {
  return job_save_tracked(j, exclusive, NULL);
}
static J *job_snapshot(Job *j) {
  J *r = obj();
  str(r, "id", j->id);
  str(r, "boot_id", j->boot);
  str(r, "state", j->state);
  str(r, "started_at", j->started);
  num(r, "pid", j->pid);
  str(r, "process_start", j->identity);
  json_object_object_add(r, "exit_code",
                         j->finished ? json_object_new_int64(j->code) : NULL);
  boolean(r, "timed_out", j->timed);
  boolean(r, "output_available", 1);
  boolean(r, "persistence_failed", j->save_failed);
  return r;
}
static void job_kill(Job *j) {
  if (j->pid > 0 && !j->reaped)
    kill_group(j->pid);
}
static void log_add(JobLog *log, const unsigned char *p, size_t n) {
  size_t at = (size_t)(log->end % CHUNK),
         first = n < CHUNK - at ? n : CHUNK - at;
  memcpy(log->bytes + at, p, first);
  memcpy(log->bytes, p + first, n - first);
  log->end += n;
}
static J *log_read(JobLog *log, int64_t cursor) {
  int64_t start = log->end > CHUNK ? log->end - CHUNK : 0,
          at = cursor < start ? start : cursor;
  size_t n = (size_t)(log->end - at);
  if (n > 65536)
    n = 65536;
  unsigned char bytes[65536];
  size_t offset = at % CHUNK, first = n < CHUNK - offset ? n : CHUNK - offset;
  memcpy(bytes, log->bytes + offset, first);
  memcpy(bytes + first, log->bytes, n - first);
  char *encoded = base64(bytes, n);
  J *r = obj();
  str(r, "data", encoded);
  free(encoded);
  num(r, "next_cursor", at + n);
  num(r, "end_cursor", log->end);
  boolean(r, "truncated", cursor < start);
  return r;
}
static void *job_monitor(void *unused) {
  (void)unused;
  struct pollfd ready[1 + 2 * 16];
  int exit_wait = 1;
  for (;;) {
#ifdef NATIVE_WORKER_FAULT_TEST
    if (__atomic_load_n(&progress_test_jobs_stall, __ATOMIC_RELAXED))
      progress_test_stall(&progress_jobs);
#endif
    progress_touch(&progress_jobs);
    pthread_mutex_lock(&jobs_mutex);
    int stop = jobs_stop, active = 0, exiting = 0, output = 0, watched = 1;
    /* Periodic wake detects mutex/reacquisition stalls without treating an
     * idle job queue as a deadlock. Active jobs are rechecked at least every
     * 100 ms because a leader can exit while descendants hold its pipes. */
    double wake = stamp() + 1000;
    for (int i = 0; i < 16; i++) {
      Job *j = &jobs[i];
      if (!j->id[0])
        continue;
      double now = stamp();
      if (j->finished) {
        /* Keep the known terminal result in memory and retry its atomic save
         * at a bounded rate after a transient storage failure. Never rerun it.
         */
        if (j->save_failed && (stop || now >= j->save_retry)) {
          j->save_failed = !job_save(j, 0);
          /* Back off after the I/O completes. A slow failed save must not
           * leave an expired retry deadline and repeatedly take jobs_mutex.
           */
          j->save_retry = stamp() + 1000;
        }
        if (j->save_failed && j->save_retry < wake)
          wake = j->save_retry;
        continue;
      }
      if (stop || (now >= j->deadline && !strcmp(j->state, "running"))) {
        j->timed = !stop;
        strcpy(j->state, stop ? "interrupted" : "timed_out");
        job_kill(j);
        if (!j->drain_deadline)
          j->drain_deadline = now + 2000;
      }
      for (int stream = 0; stream < 2; stream++)
        if (j->pipes[stream] >= 0) {
          unsigned char bytes[8192];
          /* Bound each pass so a noisy job cannot starve cancellation or
           * siblings. */
          for (int batch = 0; batch < 32; batch++) {
            ssize_t n = read(j->pipes[stream], bytes, sizeof bytes);
            if (n > 0) {
              log_add(&j->logs[stream], bytes, n);
              output = 1;
            } else {
              if (!n || (errno != EAGAIN && errno != EINTR)) {
                close(j->pipes[stream]);
                j->pipes[stream] = -1;
              }
              break;
            }
          }
        }
      siginfo_t info;
      memset(&info, 0, sizeof info);
      if (waitid(P_PID, j->pid, &info, WEXITED | WNOHANG | WNOWAIT) < 0) {
        /* Never signal an identity after losing ownership of its wait status.
         */
        if (errno != EINTR) {
          j->reaped = 1;
          strcpy(j->state, "unknown");
          j->code = 125;
          j->finished = 1;
        }
      } else if (info.si_pid) {
        if (!j->drain_deadline)
          j->drain_deadline = now + 2000;
        if ((j->pipes[0] < 0 && j->pipes[1] < 0) || now >= j->drain_deadline ||
            stop) {
          job_kill(j);
          int status = 0;
          pid_t got;
          do {
            got = waitpid(j->pid, &status, 0);
          } while (got < 0 && errno == EINTR);
          j->reaped = 1;
          j->finished = 1;
          j->code = got < 0 ? 125 : wait_code(status);
          if (!strcmp(j->state, "running"))
            strcpy(j->state, "completed");
          if (!strcmp(j->state, "cancelling"))
            strcpy(j->state, "cancelled");
        }
      }
      if (j->finished) {
        for (int s = 0; s < 2; s++)
          if (j->pipes[s] >= 0) {
            close(j->pipes[s]);
            j->pipes[s] = -1;
          }
        j->save_failed = !job_save(j, 0);
        j->save_retry = stamp() + 1000;
        if (j->save_failed && j->save_retry < wake)
          wake = j->save_retry;
        continue;
      }
      active = 1;
      if (now + 100 < wake)
        wake = now + 100;
      if (!strcmp(j->state, "running") && j->deadline < wake)
        wake = j->deadline;
      /* A passed drain deadline waits for the leader's exit; never spin. */
      if (j->drain_deadline > now && j->drain_deadline < wake)
        wake = j->drain_deadline;
      if (j->pipes[0] < 0 && j->pipes[1] < 0)
        exiting = 1;
      for (int s = 0; s < 2; s++)
        if (j->pipes[s] >= 0)
          ready[watched++] = (struct pollfd){j->pipes[s], POLLIN, 0};
    }
    pthread_mutex_unlock(&jobs_mutex);
    if (stop && !active)
      break;
    /* Only this thread closes job pipes, so the watched descriptors remain
     * valid without the mutex. Output, EOF and jobs_notify() wake the poll.
     * Once both pipes close, poll briefly for the leader's exit status. */
    int timeout = wait_ms(wake, 1000);
    if (exiting) {
      if (timeout > exit_wait)
        timeout = exit_wait;
      exit_wait = exit_wait < 8 ? exit_wait * 2 : 10;
    } else
      exit_wait = 1;
    if (stop && timeout > 10)
      timeout = 10;
    /* Batch a continuously writing job's output as the former fixed pass did,
     * instead of taking the mutex for every small write. */
    if (output)
      usleep(10000);
    ready[0] = (struct pollfd){jobs_wake, POLLIN, 0};
    int events = poll(ready, watched, timeout);
    if (events < 0 && errno != EINTR)
      usleep(10000); /* Degrade to the former fixed pass, never spin. */
    if (events > 0 && (ready[0].revents & POLLIN)) {
      uint64_t pending;
      ssize_t n = read(jobs_wake, &pending, sizeof pending);
      (void)n;
    }
  }
  progress_idle(&progress_jobs);
  return NULL;
}
static void jobs_storage(void) {
  if (mkdirat(directory, ".jobs", 0700) && errno != EEXIST)
    fatal("job directory");
  jobs_dir = openat(directory, ".jobs",
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (jobs_dir < 0 || fstat(jobs_dir, &st) || st.st_uid || (st.st_mode & 077))
    fatal("private jobs directory");
  jobs_lock = openat(jobs_dir, "lock",
                     O_RDONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (jobs_lock < 0 || fstat(jobs_lock, &st) || !S_ISREG(st.st_mode) ||
      st.st_uid || (st.st_mode & 077) || flock(jobs_lock, LOCK_EX | LOCK_NB))
    fatal("exclusive job ownership");
  if (fstatat(jobs_dir, ".import-pending", &st, AT_SYMLINK_NOFOLLOW) == 0 ||
      errno != ENOENT)
    fatal("unfinished job import; resume offline migration first");
  readtext("/proc/sys/kernel/random/boot_id", current_boot,
           sizeof current_boot);
}
static void jobs_init(void) {
  jobs_wake = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
  if (jobs_wake < 0)
    fatal("job monitor wake");
  /* Deliver lifecycle signals on the protocol thread only. Its foreground PID
   * cannot be reaped concurrently with a signal handler targeting that PID. */
  start_thread(&jobs_thread, job_monitor, &jobs_started, "job supervisor");
}
static void jobs_cleanup(void) {
  if (jobs_started) {
    pthread_mutex_lock(&jobs_mutex);
    jobs_stop = 1;
    pthread_mutex_unlock(&jobs_mutex);
    jobs_notify();
    pthread_join(jobs_thread, NULL);
    jobs_started = 0;
  }
  for (int i = 0; i < 16; i++)
    job_clear(&jobs[i]);
  if (jobs_wake >= 0) {
    close(jobs_wake);
    jobs_wake = -1;
  }
  if (jobs_lock >= 0) {
    close(jobs_lock);
    jobs_lock = -1;
  }
  if (jobs_dir >= 0) {
    close(jobs_dir);
    jobs_dir = -1;
  }
}
static J *saved_job(J *request, const char *op, const char *id) {
  if (!descriptor_capacity(1))
    return failure("Insufficient descriptors; saved job not read");
  char name[80], bytes[2048];
  snprintf(name, sizeof name, "%s.json", id);
  switch (job_record_read(name, bytes)) {
  case RECORD_MISSING:
    return failure("Unknown job");
  case RECORD_INVALID:
    return failure("Invalid job record");
  case RECORD_SHORT:
    return failure("Job record read failed");
  }
  J *record = job_record_parse(bytes);
  const char *state = record ? textval(record, "state") : NULL,
             *boot = record ? textval(record, "boot_id") : NULL;
  const char *record_id = record ? textval(record, "id") : NULL;
  if (!state || !boot || !record_id || strcmp(record_id, id) ||
      (!job_terminal(state) && strcmp(state, "unknown") &&
       strcmp(state, "starting") && strcmp(state, "running") &&
       strcmp(state, "cancelling"))) {
    if (record)
      json_object_put(record);
    return failure("Invalid job record");
  }
  int terminal = job_terminal(state);
  int rebooted = strcmp(boot, current_boot) != 0;
  J *r;
  if (!strcmp(op, "job.status")) {
    r = obj();
    str(r, "id", id);
    str(r, "boot_id", boot);
    str(r, "state", terminal ? state : rebooted ? "interrupted" : "unknown");
    boolean(r, "output_available", 0);
    json_object_object_add(r, "record", record);
    return success(r);
  }
  if (!strcmp(op, "job.forget") && (terminal || rebooted)) {
    int ok = !unlinkat(jobs_dir, name, 0) && !fsync(jobs_dir);
    json_object_put(record);
    if (!ok)
      return failure("Cannot forget saved job");
    r = obj();
    boolean(r, "forgotten", 1);
    return success(r);
  }
  /* A disconnected worker cannot prove ownership of a process group atomically
   * on these old kernels. Refuse stale cancellation instead of risking PID
   * reuse. */
  (void)request;
  json_object_put(record);
  return failure("Operation unavailable for saved job; inspect status");
}
/* Job checks run under the job mutex, which excludes the monitor's record
 * opens; its poll and the heartbeat allocate none. Six slots cover both output
 * pipes and the launch gate. Closing their child ends leaves room for
 * identity reads and running-record persistence. */
static J *job_operation_locked(J *request, const char *op) {
  const char *id = textval(request, "id");
  if (!job_valid_id(id))
    return failure("Invalid job ID");
  Job *j = NULL, *empty = NULL;
  for (int i = 0; i < 16; i++) {
    if (!jobs[i].id[0])
      empty = &jobs[i];
    else if (!strcmp(jobs[i].id, id))
      j = &jobs[i];
  }
  if (!strcmp(op, "job.start")) {
    int64_t timeout;
    const char *command = textval(request, "command"),
               *profile = textval(request, "profile");
    if (!integer(request, "timeout_ms", &timeout) || timeout < 100 ||
        timeout > 86400000 || !job_command_nonblank(command) ||
        strlen(command) > 16384 || !profile ||
        (strcmp(profile, "root") && strcmp(profile, "app")))
      return failure("Invalid job request");
    int app = !strcmp(profile, "app");
    if (!descriptor_capacity(1))
      return failure("Insufficient descriptors; job not launched");
    if (app && !verified_launcher())
      return failure("Verified app launcher unavailable");
    if (j || !empty)
      return failure("Job already exists or retention limit reached");
    /* Check all publication names before allocating a child. The directory's
     * lifetime lock excludes another worker; linkat below remains the final
     * no-replacement guard against an external conflicting writer. */
    const char *patterns[] = {"%s.json", "%s.json.next"};
    char existing[128];
    struct stat prior;
    for (unsigned i = 0; i < sizeof patterns / sizeof *patterns; i++) {
      snprintf(existing, sizeof existing, patterns[i], id);
      if (!fstatat(jobs_dir, existing, &prior, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
        return failure("Job intent already exists or cannot be inspected; not launched");
    }
    snprintf(existing, sizeof existing, ".intent-%s-%s", worker_id, id);
    if (!fstatat(jobs_dir, existing, &prior, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
      return failure("Job intent already exists or cannot be inspected; not launched");
    int count = 0;
    DIR *d = scan_directory(jobs_dir);
    if (!d)
      return failure("Cannot inspect job retention");
    struct dirent *e;
    while ((e = readdir(d)))
      if (strstr(e->d_name, ".json"))
        count++;
    closedir(d);
    if (count >= 64)
      return failure("Saved job retention limit reached");
    j = empty;
    memset(j, 0, sizeof *j);
    j->pipes[0] = j->pipes[1] = -1;
    strcpy(j->id, id);
    strcpy(j->boot, current_boot);
    strcpy(j->state, "unknown");
    time_t now = time(NULL);
    struct tm utc;
    gmtime_r(&now, &utc);
    strftime(j->started, sizeof j->started, "%Y-%m-%dT%H:%M:%SZ", &utc);
    /* Create only a contained, gated child. The first durable publication will
     * contain its complete running identity, rather than syncing a PID-zero
     * record and immediately replacing it. No command can run before both
     * that publication's file and directory barriers have completed. */
    int pipes[2][2] = {{-1, -1}, {-1, -1}}, gate[2] = {-1, -1};
    const char *why =
        "Insufficient descriptors; job intent retained, not launched";
    if (!descriptor_capacity(6))
      goto launch_failed;
    why = "Insufficient memory; job intent retained, not launched";
    for (int s = 0; s < 2; s++)
      j->logs[s].bytes = calloc(1, CHUNK);
    if (!j->logs[0].bytes || !j->logs[1].bytes)
      goto launch_failed;
    why = "Job intent retained; launch failed";
    if (pipe2(pipes[0], O_CLOEXEC) || pipe2(pipes[1], O_CLOEXEC) ||
        pipe2(gate, O_CLOEXEC))
      goto launch_failed;
    for (int s = 0; s < 2; s++)
      if (ioctl(pipes[s][0], FIONBIO, &(int){1}))
        goto launch_failed;
    pid_t owner = getpid(), pid = fork();
    if (pid < 0)
      goto launch_failed;
    if (!pid) {
      /* Only async-signal-safe libc calls after fork from the supervisor
       * process. */
      if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != owner ||
          setsid() < 0)
        _exit(126);
      close(gate[1]);
      char permit;
      ssize_t got;
      do {
        got = read(gate[0], &permit, 1);
      } while (got < 0 && errno == EINTR);
      if (got != 1 || permit != '1')
        _exit(126);
      close(gate[0]);
      if (dup2(pipes[0][1], 1) < 0 || dup2(pipes[1][1], 2) < 0)
        _exit(126);
      int null = open("/dev/null", O_RDONLY);
      if (null < 0 || dup2(null, 0) < 0)
        _exit(126);
      close(null);
      for (int s = 0; s < 2; s++) {
        close(pipes[s][0]);
        close(pipes[s][1]);
      }
      if (app)
        execve(launcher,
               (char *const[]){launcher, "--command", (char *)command, NULL},
               environ);
      else
        execve("/bin/sh", (char *const[]){"sh", "-c", (char *)command, NULL},
               environ);
      _exit(127);
    }
    j->pid = pid;
    close(gate[0]);
    gate[0] = -1;
    for (int s = 0; s < 2; s++) {
      close(pipes[s][1]);
      pipes[s][1] = -1;
      j->pipes[s] = pipes[s][0];
      pipes[s][0] = -1;
    }
    strcpy(j->state, "running");
#ifdef NATIVE_WORKER_FAULT_TEST
    if (getenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT") &&
        !strcmp(getenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT"), "forked")) {
      fprintf(stderr, "prototype: gated job child %ld\n", (long)pid);
      _exit(86);
    }
#endif
    int published = 0, identified = job_identity(pid, j->identity);
    int prepared = identified && job_save_tracked(j, 1, &published);
    if (!identified || (!prepared && !published)) {
      /* No final record from this attempt exists. Never let the monitor later
       * synthesize one over a conflicting ID or a failed initial publication.
       * Keep the leader unreaped through kill_group, then close only our FDs.
       * EXITKILL/PDEATHSIG also cover interruption of this cleanup. */
      job_kill(j);
      close(gate[1]);
      pid_t retired;
      do {
        retired = waitpid(pid, NULL, 0);
      } while (retired < 0 && errno == EINTR);
      if (retired != pid)
        fatal("unpublished job child retirement unverified");
      j->reaped = 1;
      for (int s = 0; s < 2; s++) {
        close(j->pipes[s]);
        j->pipes[s] = -1;
      }
      if (!identified) {
        j->pid = 0;
        j->identity[0] = 0;
        strcpy(j->state, "unknown");
        int retained = job_save(j, 1);
        job_clear(j);
        return failure(retained ? "Job intent retained; child identity unavailable"
                                : "Job intent cannot be persisted; not launched");
      }
      job_clear(j);
      return failure("Job intent already exists or cannot be persisted; not launched");
    }
    if (prepared) {
      /* The child cannot execute before this gate. Slow durable preparation
       * must not spend its execution budget or release an already-expired job.
       * jobs_mutex keeps the monitor out until launch succeeds or is cancelled;
       * the existing progress watchdog still bounds stalled preparation.
       */
      j->deadline = stamp() + timeout;
      prepared = job_write(gate[1], "1", 1);
    }
#ifdef NATIVE_WORKER_FAULT_TEST
    if (prepared && getenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT") &&
        !strcmp(getenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT"), "released"))
      _exit(86);
#endif
    if (!prepared) {
      job_kill(j);
      close(gate[1]);
      strcpy(j->state, "cancelling");
      jobs_notify();
      return failure("Launch failed after intent; inspect job status");
    }
    close(gate[1]);
    jobs_notify();
    return success(job_snapshot(j));
  launch_failed:
    for (int s = 0; s < 2; s++)
      for (int p = 0; p < 2; p++)
        if (pipes[s][p] >= 0)
          close(pipes[s][p]);
    for (int p = 0; p < 2; p++)
      if (gate[p] >= 0)
        close(gate[p]);
    /* Retain the existing failed-launch ID contract even though successful
     * launches no longer need an earlier PID-zero publication. */
    {
      int retained = job_save(j, 1);
      job_clear(j);
      return failure(retained ? why : "Job intent cannot be persisted; not launched");
    }
  }
  if (!j)
    return saved_job(request, op, id);
  if (!strcmp(op, "job.status"))
    return success(job_snapshot(j));
  if (!strcmp(op, "job.output")) {
    int64_t out, err;
    if (!integer(request, "stdout_cursor", &out) ||
        !integer(request, "stderr_cursor", &err) || out < 0 || err < 0 ||
        out > j->logs[0].end || err > j->logs[1].end)
      return failure("Invalid output cursor");
    J *r = obj();
    json_object_object_add(r, "stdout", log_read(&j->logs[0], out));
    json_object_object_add(r, "stderr", log_read(&j->logs[1], err));
    str(r, "state", j->state);
    return success(r);
  }
  if (!strcmp(op, "job.cancel")) {
    if (!j->finished && !strcmp(j->state, "running")) {
      job_kill(j);
      strcpy(j->state, "cancelling");
      j->drain_deadline = stamp() + 2000;
      j->save_failed = !job_save(j, 0);
      jobs_notify();
    }
    return success(job_snapshot(j));
  }
  if (!strcmp(op, "job.forget")) {
    if (!j->finished || !j->reaped)
      return failure("Job still active");
    char name[80];
    snprintf(name, sizeof name, "%s.json", j->id);
    if (unlinkat(jobs_dir, name, 0) || fsync(jobs_dir))
      return failure("Cannot forget job record");
    job_clear(j);
    J *r = obj();
    boolean(r, "forgotten", 1);
    return success(r);
  }
  return failure("Unsupported job operation");
}
static J *job_operation(J *request, const char *op) {
  pthread_mutex_lock(&jobs_mutex);
  J *r = job_operation_locked(request, op);
  pthread_mutex_unlock(&jobs_mutex);
  return r;
}
