/* Read-only, identity-bracketed process sampling for diagnostics (0BSD). */
#include <dirent.h>

typedef struct {
  uint64_t start, user, system, virtual_bytes;
  int64_t resident_pages;
  pid_t parent;
} ObserveStat;

static int observe_read(int directory, const char *name, char *bytes, size_t size) {
  int fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  ssize_t count;
  do { count = read(fd, bytes, size); } while (count < 0 && errno == EINTR);
  int error = errno;
  close(fd);
  if (count < 0) { errno = error; return -1; }
  if ((size_t)count >= size) { errno = EOVERFLOW; return -1; }
  bytes[count] = 0;
  return (int)count;
}

static int observe_unsigned(const char *text, uint64_t *out) {
  if (!text || !*text) return 0;
  uint64_t n = 0;
  for (const char *p = text; *p; p++) {
    if (*p < '0' || *p > '9' || n > (UINT64_MAX - (*p - '0')) / 10) return 0;
    n = n * 10 + (*p - '0');
  }
  *out = n;
  return 1;
}

static int observe_stat(int directory, const char *name, ObserveStat *out) {
  char bytes[4096];
  if (observe_read(directory, name, bytes, sizeof bytes) < 0) return 0;
  char *end = strrchr(bytes, ')');
  if (!end || end[1] != ' ') { errno = EINVAL; return 0; }
  char *cursor = end + 2, *save = NULL, *field;
  memset(out, 0, sizeof *out);
  unsigned index = 0;
  for (field = strtok_r(cursor, " \n", &save); field; field = strtok_r(NULL, " \n", &save), index++) {
    uint64_t value;
    if (index == 1 || index == 11 || index == 12 || index == 19 || index == 20 || index == 21) {
      if (!observe_unsigned(field, &value)) { errno = EINVAL; return 0; }
      if (index == 1) { if (value > INT_MAX) { errno = EOVERFLOW; return 0; } out->parent = (pid_t)value; }
      if (index == 11) out->user = value;
      if (index == 12) out->system = value;
      if (index == 19) out->start = value;
      if (index == 20) out->virtual_bytes = value;
      if (index == 21) { if (value > INT64_MAX) { errno = EOVERFLOW; return 0; } out->resident_pages = (int64_t)value; }
    }
  }
  if (index < 22 || !out->start) { errno = EINVAL; return 0; }
  return 1;
}

static void observe_u64(J *value, const char *key, uint64_t number) {
  char text[32];
  snprintf(text, sizeof text, "%" PRIu64, number);
  str(value, key, text);
}

static void observe_error(J *errors, const char *key) { num(errors, key, errno ? errno : EIO); }

static long observe_count(int directory, const char *name) {
  int fd = openat(directory, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  DIR *dir = fdopendir(fd);
  if (!dir) { int error = errno; close(fd); errno = error; return -1; }
  long count = 0;
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(dir)))
    if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..")) count++;
  int error = errno;
  closedir(dir);
  errno = error;
  return error ? -1 : count;
}

static FILE *observe_stream(int directory, const char *name) {
  int fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return NULL;
  FILE *stream = fdopen(fd, "r");
  if (!stream) { int error = errno; close(fd); errno = error; }
  return stream;
}

/* An exited, reused or unreadable identity is explicit and never a zero sample.
 * Fields can disappear while a process exits; callers retain partial observations
 * with errors, and cannot use identity_valid=false rows in resource summaries. */
static J *observe_process(int directory, pid_t pid, uint64_t expected, int memory_detail) {
  J *out = obj(), *errors = obj();
  num(out, "pid", pid);
  json_object_object_add(out, "errors", errors);
  boolean(out, "identity_valid", 0);
  boolean(out, "memory_detail_sampled", memory_detail);
  ObserveStat before, after;
  if (!observe_stat(directory, "stat", &before)) { observe_error(errors, "stat_before"); return out; }
  observe_u64(out, "start_ticks", before.start);
  if (before.start != expected) { num(errors, "identity", ESTALE); return out; }
  num(out, "parent_pid", before.parent);
  observe_u64(out, "user_ticks", before.user);
  observe_u64(out, "system_ticks", before.system);
  observe_u64(out, "virtual_bytes", before.virtual_bytes);
  num(out, "resident_pages", before.resident_pages);
  for (unsigned i = 0; i < 2; i++) {
    const char *name = i ? "task" : "fd", *key = i ? "threads" : "descriptors";
    long value = observe_count(directory, name);
    if (value < 0) { json_object_object_add(out, key, NULL); observe_error(errors, key); }
    else num(out, key, value);
  }
  FILE *stream = observe_stream(directory, "mountinfo");
  long mounts = 0;
  if (stream) {
    int ch, last = '\n';
    while ((ch = fgetc(stream)) != EOF) { if (ch == '\n') mounts++; last = ch; }
    if (ferror(stream) || last != '\n') { errno = EIO; mounts = -1; }
    fclose(stream);
  } else mounts = -1;
  if (mounts < 0) { json_object_object_add(out, "mounts", NULL); observe_error(errors, "mounts"); }
  else num(out, "mounts", mounts);

  /* Sum all mappings; do not depend on newer smaps_rollup support. */
  stream = memory_detail ? observe_stream(directory, "smaps") : NULL;
  const char *keys[] = {"Rss:", "Pss:", "Private_Clean:", "Private_Dirty:", "Swap:", "SwapPss:"};
  const char *names[] = {"rss_kib", "pss_kib", "private_clean_kib", "private_dirty_kib", "swap_kib", "swap_pss_kib"};
  int64_t sums[6] = {0}; unsigned seen = 0; int failed = memory_detail && !stream;
  if (stream) {
    char line[4096];
    while (fgets(line, sizeof line, stream)) {
      for (unsigned i = 0; i < 6; i++) if (!strncmp(line, keys[i], strlen(keys[i]))) {
        unsigned long long n; char unit[8], extra;
        if (sscanf(line + strlen(keys[i]), " %llu %7s %c", &n, unit, &extra) != 2 || strcmp(unit, "kB") || n > INT64_MAX || sums[i] > INT64_MAX - (int64_t)n) failed = 1;
        else { sums[i] += (int64_t)n; seen |= 1u << i; }
      }
    }
    if (ferror(stream)) failed = 1;
    fclose(stream);
  }
  if (failed) { errno = EIO; observe_error(errors, "smaps"); }
  for (unsigned i = 0; i < 6; i++)
    json_object_object_add(out, names[i], !failed && (seen & (1u << i)) ? json_object_new_int64(sums[i]) : NULL);

  stream = observe_stream(directory, "status");
  int64_t peak = -1;
  if (stream) {
    char line[1024];
    while (fgets(line, sizeof line, stream)) {
      long long n;
      if (sscanf(line, "VmHWM: %lld kB", &n) == 1 && n >= 0) peak = n;
    }
    if (ferror(stream)) peak = -1;
    fclose(stream);
  }
  json_object_object_add(out, "peak_rss_kib", peak >= 0 ? json_object_new_int64(peak) : NULL);
  json_object_object_add(out, "idle_wakeups", NULL);
  if (!observe_stat(directory, "stat", &after)) observe_error(errors, "stat_after");
  else if (after.start != before.start) num(errors, "identity", ESTALE);
  else boolean(out, "identity_valid", 1);
  return out;
}
