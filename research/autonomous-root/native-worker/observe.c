/* Independent bounded acquisition/public-path observer; diagnostic only (0BSD). */
#include "common.h"
#include "bench-kernel.h"
#include "observe-process.h"

#define OBSERVE_BYTES (8 * CHUNK)
#define OBSERVE_CACHE 128
static volatile sig_atomic_t observe_stop;
static void observe_signal(int signal) { (void)signal; observe_stop = 1; }
typedef struct { pid_t pid; uint64_t start; dev_t dev; ino_t inode; int native; } ObserveCache;
static ObserveCache observe_cache[OBSERVE_CACHE];
static size_t observe_cached;
static int observe_failed;
typedef struct { pid_t pid; uint64_t start; dev_t dev; ino_t inode; } ObserveSeen;
static ObserveSeen observe_seen[OBSERVE_CACHE];
static size_t observe_seen_count;

static int observe_first_seen(pid_t pid, uint64_t start, const struct stat *exe) {
  for (size_t i = 0; i < observe_seen_count; i++) {
    ObserveSeen *s = &observe_seen[i];
    if (s->pid == pid && s->start == start && s->dev == exe->st_dev && s->inode == exe->st_ino) return 0;
  }
  if (observe_seen_count == OBSERVE_CACHE) { observe_failed = 1; return 1; }
  observe_seen[observe_seen_count++] = (ObserveSeen){pid, start, exe->st_dev, exe->st_ino};
  return 1;
}

static int observe_native_path(const char *exe) {
  /* A private bind's root can appear as /worker through proc, even when its
   * launch path was /opt/couchroot-worker-ID/code/worker. This is only a discovery
   * hint: the mapped executable must still match the supplied SHA-256. */
  return !strcmp(exe, "/worker") || !strncmp(exe, "/opt/couchroot-", 15) ||
         strstr(exe, "/sdk_tools/") != NULL;
}

static int observe_native(int directory, pid_t pid, uint64_t start, const char *sha) {
  /* Following this specific proc link is intentional: hash the mapped executable,
   * not a similarly named file reachable in the observer's mount namespace. */
  int fd = openat(directory, "exe", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  struct stat st;
  if (fstat(fd, &st)) { close(fd); return 0; }
  for (size_t i = 0; i < observe_cached; i++) {
    ObserveCache *c = &observe_cache[i];
    if (c->pid == pid && c->start == start && c->dev == st.st_dev && c->inode == st.st_ino) { close(fd); return c->native; }
  }
  char hash[65];
  int match = st.st_size > 0 && st.st_size <= CHUNK && filedigest_progress(fd, hash, NULL) && !strcmp(hash, sha);
  close(fd);
  if (observe_cached == OBSERVE_CACHE) { observe_failed = 1; return 0; }
  observe_cache[observe_cached++] = (ObserveCache){pid, start, st.st_dev, st.st_ino, match};
  return match;
}

static const char *observe_managed(const char *bytes, size_t size) {
  size_t first = strnlen(bytes, size);
  if (first == size || first + 1 == size) return NULL;
  const char *argument = bytes + first + 1;
  size_t n = strnlen(argument, size - first - 1);
  if (n == size - first - 1) return NULL;
  const char *name = strrchr(argument, '/'); name = name ? name + 1 : argument;
  if (!strcmp(name, "SamsungTvRootAgent.dll")) return "managed-worker-candidate";
  if (!strcmp(name, "NativeEntry.dll")) return "managed-entry-candidate";
  if (!strcmp(name, "SamsungTvArchiveRoot.dll")) return "managed-acquisition-candidate";
  return NULL;
}

static J *observe_snapshot(const char *proc, pid_t coordinator, uint64_t coordinator_start, const char *sha, unsigned sample_index) {
  J *sample = obj(), *processes = json_object_new_array();
  json_object_object_add(sample, "started_monotonic_ms", json_object_new_double(kernel_clock(CLOCK_MONOTONIC)));
  json_object_object_add(sample, "processes", processes);
  int root = open(proc, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) fatal("observer proc root");
  DIR *dir = fdopendir(root);
  if (!dir) fatal("observer proc inventory");
  struct dirent *entry;
  unsigned vanished = 0, matched = 0; int found_coordinator = 0, scan_error = 0;
  for (;;) {
    errno = 0; entry = readdir(dir);
    if (!entry) { scan_error = errno; break; }
    uint64_t id;
    if (!observe_unsigned(entry->d_name, &id) || !id || id > INT_MAX) continue;
    pid_t pid = (pid_t)id;
    int directory = openat(root, entry->d_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (directory < 0) { vanished++; continue; }
    char exe[PATH_MAX], command[4096];
    ssize_t n = readlinkat(directory, "exe", exe, sizeof exe - 1);
    if (n < 0 || (size_t)n >= sizeof exe - 1) { close(directory); continue; }
    exe[n] = 0;
    /* Most proc entries are unrelated daemons or kernel threads. Apply the same
     * executable discovery filter before reading their stat/cmdline files. */
    if (pid != coordinator && pid != getpid() && strcmp(exe, "/usr/bin/dotnet") &&
        !observe_native_path(exe)) { close(directory); continue; }
    ObserveStat before;
    if (!observe_stat(directory, "stat", &before)) { vanished++; close(directory); continue; }
    int command_size = observe_read(directory, "cmdline", command, sizeof command);
    const char *role = NULL;
    if (pid == coordinator) {
      if (before.start == coordinator_start) { role = "coordinator"; found_coordinator = 1; }
      else observe_failed = 1;
    } else if (pid == getpid()) role = "observer";
    else if (!strcmp(exe, "/usr/bin/dotnet") && command_size > 0) role = observe_managed(command, (size_t)command_size);
    else if (observe_native_path(exe) && observe_native(directory, pid, before.start, sha)) role = "native-worker-or-guardian";
    if (role) {
      if (++matched > 32) { observe_failed = 1; close(directory); break; }
      struct stat executable_before, executable_after;
      /* Follow only this proc executable link, and bind exec changes even if
       * the process reuses the same pathname and command-line arguments. */
      int have_executable = !fstatat(directory, "exe", &executable_before, 0);
      int detail = sample_index % 5 == 0;
      if (have_executable && observe_first_seen(pid, before.start, &executable_before)) detail = 1;
      J *process = observe_process(directory, pid, before.start, detail);
      str(process, "role", role);
      str(process, "executable", exe);
      /* Exec can change code without changing PID/start ticks. Bracket that too. */
      char after[PATH_MAX], command_after[4096];
      ssize_t after_n = readlinkat(directory, "exe", after, sizeof after - 1);
      int after_size = observe_read(directory, "cmdline", command_after, sizeof command_after);
      if (!have_executable || fstatat(directory, "exe", &executable_after, 0) ||
          executable_before.st_dev != executable_after.st_dev || executable_before.st_ino != executable_after.st_ino ||
          after_n != n || after_n < 0 || memcmp(exe, after, (size_t)n) || command_size < 0 || after_size != command_size || memcmp(command, command_after, (size_t)command_size)) {
        boolean(process, "identity_valid", 0); num(get(process, "errors"), "exec_changed_or_unreadable", ESTALE);
      }
      json_object_array_add(processes, process);
    }
    close(directory);
  }
  closedir(dir);
  if (scan_error || !found_coordinator) observe_failed = 1;
  num(sample, "scan_error", scan_error);
  num(sample, "unreadable_or_disappeared_proc_entries", vanished);
  boolean(sample, "coordinator_present", found_coordinator);
  json_object_object_add(sample, "finished_monotonic_ms", json_object_new_double(kernel_clock(CLOCK_MONOTONIC)));
  return sample;
}

static int observe_output(int directory, const char *name) {
  int fd = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) fatal("exclusive observer output");
  return fd;
}

int main(int argc, char **argv) {
  uint64_t seconds, interval, pid, start;
  if (argc != 7 || !observe_unsigned(argv[2], &seconds) || seconds < 2 || seconds > 240 ||
      !observe_unsigned(argv[3], &interval) || interval < 250 || interval > 2000 ||
      !observe_unsigned(argv[4], &pid) || !pid || pid > INT_MAX ||
      !observe_unsigned(argv[5], &start) || !start || !hexvalid(argv[6], 64)) return 64;
  libraries();
  int directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (directory < 0 || fstat(directory, &st) || st.st_uid || (st.st_mode & 077)) fatal("private observer directory");
  int output = observe_output(directory, "resources.ndjson");
  int metadata = observe_output(directory, "observer.json");
  int ready = observe_output(directory, "observer.ready");
  unsigned char *buffer = allocate(OBSERVE_BYTES);
  long page = sysconf(_SC_PAGESIZE);
  if (page <= 0) fatal("observer page size");
  /* Reserve the same bounded capacity without dirtying unused pages. Resource
   * records populate it progressively; page-fault cost remains observer cost. */
  struct sigaction action;
  memset(&action, 0, sizeof action); action.sa_handler = observe_signal; sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)) fatal("observer stop handler");
  alarm((unsigned)seconds + 15);
  /* Publish the empty output entries before declaring the capture interval.
   * Slow startup persistence must not consume its first sampling slots. The
   * readiness payload is live evidence only; its final fsync and successful
   * collector exit are required before any capture can be accepted. */
  if (fsync(ready) || fsync(directory)) fatal("observer readiness admission");
  BenchKernel kernel;
#ifdef NATIVE_OBSERVER_TEST
  const char *test_fd = getenv("COUCHROOT_TEST_KERNEL_FD");
  if (!test_fd) return 64;
  kernel_begin_fd(&kernel, atoi(test_fd), argv[1], 2 * CHUNK);
#else
  kernel_begin(&kernel, argv[1]);
#endif
  double began = kernel_clock(CLOCK_MONOTONIC), deadline = began + seconds * 1000.0, next = began;
  J *receipt = obj(); num(receipt, "pid", getpid());
  int self = open("/proc/self", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  ObserveStat identity;
  if (self < 0 || !observe_stat(self, "stat", &identity)) fatal("observer identity");
  close(self); observe_u64(receipt, "start_ticks", identity.start);
  str(receipt, "boot_id", kernel.boot);
  json_object_object_add(receipt, "monotonic_start_ms", json_object_new_double(began));
  const char *receipt_bytes = json(receipt); writeall(ready, receipt_bytes, strlen(receipt_bytes));
  json_object_put(receipt);
  size_t used = 0; unsigned samples = 0, skipped = 0; double max_sample = 0, max_gap = 0, previous = 0;
  while (!observe_stop && kernel_clock(CLOCK_MONOTONIC) < deadline) {
    double at = kernel_clock(CLOCK_MONOTONIC);
    if (previous && at - previous > max_gap) max_gap = at - previous;
    previous = at;
    J *sample = observe_snapshot("/proc", (pid_t)pid, start, argv[6], samples);
    const char *bytes = json(sample); size_t length = strlen(bytes);
    if (length + 1 > OBSERVE_BYTES - used) { json_object_put(sample); observe_failed = 1; break; }
    memcpy(buffer + used, bytes, length); used += length; buffer[used++] = '\n'; samples++;
    json_object_put(sample);
    double now = kernel_clock(CLOCK_MONOTONIC);
    if (now - at > max_sample) max_sample = now - at;
    next += interval;
    while (next <= now) { next += interval; skipped++; }
    double until = next < deadline ? next : deadline;
    while (!observe_stop && (now = kernel_clock(CLOCK_MONOTONIC)) < until) {
      int delay = (int)(until - now); if (delay < 1) delay = 1;
      if (poll(NULL, 0, delay) < 0 && errno != EINTR) fatal("observer interval");
    }
  }
  double ended = kernel_clock(CLOCK_MONOTONIC);
  int kernel_complete = kernel_end(&kernel);
  J *report = obj(); num(report, "schema", 2); num(report, "samples", samples); num(report, "bytes", used);
  num(report, "memory_detail_every_samples", 5);
  num(report, "resource_capacity_bytes", OBSERVE_BYTES);
  str(report, "resource_storage", "bounded reserved buffer populated progressively; unused pages are not prefaulted");
  num(report, "interval_ms", interval); num(report, "skipped_intervals", skipped);
  num(report, "clock_ticks_per_second", sysconf(_SC_CLK_TCK)); num(report, "page_bytes", page);
  boolean(report, "sampling_failed", observe_failed); boolean(report, "kernel_complete", kernel_complete);
  boolean(report, "stopped_by_signal", observe_stop); boolean(report, "interval_complete", !observe_failed && kernel_complete && samples > 0 && !skipped);
  json_object_object_add(report, "monotonic_start_ms", json_object_new_double(began));
  json_object_object_add(report, "monotonic_end_ms", json_object_new_double(ended));
  json_object_object_add(report, "max_sample_duration_ms", json_object_new_double(max_sample));
  json_object_object_add(report, "max_sample_gap_ms", json_object_new_double(max_gap));
  str(report, "limits", "Periodic process snapshots, not exact lifetime peaks; short-lived descendants may be missed. Managed names are candidates requiring public-status identity binding. Per-field errors and invalid identity rows remain explicit. CPU excludes already exited descendants; idle wakeups are unknown. Observer overhead is sampled separately. Private raw evidence only.");
  writeall(output, buffer, used); const char *bytes = json(report); writeall(metadata, bytes, strlen(bytes));
  if (fsync(output) || fsync(metadata) || fsync(ready) || fsync(directory)) fatal("observer persistence");
  close(output); close(metadata); close(ready); close(directory); free(buffer); json_object_put(report);
  return observe_failed || !kernel_complete || !samples || skipped ? 1 : 0;
}
