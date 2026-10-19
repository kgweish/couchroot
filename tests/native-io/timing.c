/* Private diagnostic interposer: observe sync latency without changing results.
 * Never link or package with the production worker. SPDX-License-Identifier: 0BSD */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int (*original_fsync)(int);

__attribute__((constructor)) static void initialize(void) {
  void *symbol = dlsym(RTLD_NEXT, "fsync");
  if (!symbol)
    _exit(125);
  memcpy(&original_fsync, &symbol, sizeof symbol);
}

int fsync(int fd) {
  struct timespec before, after;
  int timed = !clock_gettime(CLOCK_MONOTONIC, &before);
  int result = original_fsync(fd), saved = errno;
  timed = timed && !clock_gettime(CLOCK_MONOTONIC, &after);
  char link[64], target[PATH_MAX], report[PATH_MAX + 160];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t length = readlink(link, target, sizeof target - 1);
  if (timed && length > 0 && length < (ssize_t)sizeof target - 1) {
    target[length] = 0;
    /* The controller owns a random private .jobs scope; other syncs are not
     * emitted. Paths and process IDs stay in the private evidence bundle. */
    char *jobs = strstr(target, "/.jobs");
    if (jobs && (!jobs[6] || jobs[6] == '/')) {
      double elapsed = (after.tv_sec - before.tv_sec) * 1000.0 +
                       (after.tv_nsec - before.tv_nsec) / 1e6;
      int n = snprintf(report, sizeof report,
                       "IO_TIMING pid=%ld result=%d errno=%d ms=%.3f path=%s\n",
                       (long)getpid(), result, saved, elapsed, target);
      if (n > 0 && n < (int)sizeof report) {
        ssize_t written = write(STDERR_FILENO, report, (size_t)n);
        (void)written;
      }
    }
  }
  errno = saved;
  return result;
}
