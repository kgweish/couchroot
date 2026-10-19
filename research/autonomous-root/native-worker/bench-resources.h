/* Read-only benchmark observations; never linked into the worker. SPDX-License-Identifier: 0BSD */
#include <dirent.h>

static long bench_entries(const char *path) {
  DIR *dir = opendir(path);
  if (!dir)
    fatal("benchmark directory observation");
  long count = 0;
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(dir)))
    if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, ".."))
      count++;
  int error = errno;
  closedir(dir);
  if (error) {
    errno = error;
    fatal("benchmark directory read");
  }
  return count;
}

/* Missing optional kernel fields are unknown, never a zero observation. */
static void bench_counter(J *out, const char *name, long value) {
  json_object_object_add(out, name, value < 0 ? NULL : json_object_new_int64(value));
}

static J *bench_resources(const char *proc, pid_t pid) {
  char path[PATH_MAX], line[1024];
  J *out = obj();
  snprintf(path, sizeof path, "%s/%d/fd", proc, pid);
  num(out, "descriptors", bench_entries(path));
  snprintf(path, sizeof path, "%s/%d/task", proc, pid);
  num(out, "threads", bench_entries(path));
  snprintf(path, sizeof path, "%s/%d/mountinfo", proc, pid);
  FILE *f = fopen(path, "r");
  if (!f)
    fatal("benchmark mount observation");
  long mounts = 0;
  int ch, previous = '\n';
  while ((ch = fgetc(f)) != EOF) {
    if (ch == '\n')
      mounts++;
    previous = ch;
  }
  if (ferror(f) || previous != '\n')
    fatal("benchmark mount read");
  fclose(f);
  num(out, "mounts", mounts);
  snprintf(path, sizeof path, "%s/%d/status", proc, pid);
  f = fopen(path, "r");
  if (!f)
    fatal("benchmark process status");
  long peak = -1;
  while (fgets(line, sizeof line, f)) {
    long value;
    if (sscanf(line, "VmHWM: %ld kB", &value) == 1 && value >= 0)
      peak = value;
  }
  if (ferror(f))
    fatal("benchmark process status read");
  fclose(f);
  bench_counter(out, "peak_rss_kib", peak);

  /* Keep per-thread identities: totals can decrease when threads retire.
   * These are scheduling counters, not hardware/interrupt wakeup counts. */
  J *tasks = obj();
  snprintf(path, sizeof path, "%s/%d/task", proc, pid);
  DIR *dir = opendir(path);
  if (!dir)
    fatal("benchmark task observation");
  struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(dir);
    if (!entry) {
      if (errno)
        fatal("benchmark task read");
      break;
    }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, ".."))
      continue;
    J *task = obj();
    long voluntary = -1, involuntary = -1;
    snprintf(path, sizeof path, "%s/%d/task/%s/status", proc, pid, entry->d_name);
    f = fopen(path, "r");
    if (f) {
      while (fgets(line, sizeof line, f)) {
        long value;
        if (sscanf(line, "voluntary_ctxt_switches: %ld", &value) == 1 && value >= 0)
          voluntary = value;
        if (sscanf(line, "nonvoluntary_ctxt_switches: %ld", &value) == 1 && value >= 0)
          involuntary = value;
      }
      if (ferror(f))
        voluntary = involuntary = -1;
      fclose(f);
    }
    bench_counter(task, "voluntary_context_switches", voluntary);
    bench_counter(task, "involuntary_context_switches", involuntary);
    json_object_object_add(tasks, entry->d_name, task);
  }
  closedir(dir);
  json_object_object_add(out, "tasks", tasks);
  json_object_object_add(out, "idle_wakeups", NULL);
  return out;
}

static J *bench_tree_resources(void) {
  J *out = obj();
  json_object_object_add(out, "worker", bench_resources("/proc", worker_pid));
  if (worker_pid != child)
    json_object_object_add(out, "guardian", bench_resources("/proc", child));
  return out;
}
