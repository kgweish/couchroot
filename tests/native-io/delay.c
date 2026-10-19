/* Host-only I/O delay fixture, loaded into the test worker, never packaged.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int selected(int fd, const char *operation) {
  const char *prefix = getenv("COUCHROOT_IO_TEST_PATH");
  const char *op = getenv("COUCHROOT_IO_TEST_OP");
  if (!prefix || !*prefix || !op || strcmp(op, operation))
    return 0;
  const char *after = getenv("COUCHROOT_IO_TEST_AFTER_FILE");
  if (after && access(after, F_OK))
    return 0;
  /* Optionally delay only the protocol worker, leaving its independent
   * guardian free to persist recovery after the watchdog terminates it. */
  const char *pid_file = getenv("COUCHROOT_IO_TEST_PID_FILE");
  if (pid_file) {
    FILE *file = fopen(pid_file, "r");
    long pid = 0;
    int matched = file && fscanf(file, "%ld", &pid) == 1 && pid == getpid();
    if (file)
      fclose(file);
    if (!matched)
      return 0;
  }
  char link[64], path[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, path, sizeof path - 1);
  if (n < 0)
    return 0;
  path[n] = 0;
  return getenv("COUCHROOT_IO_TEST_EXACT") ? !strcmp(path, prefix)
                                          : !strncmp(path, prefix, strlen(prefix));
}
static int delay(void) {
  const char *mode = getenv("COUCHROOT_IO_TEST_MODE");
  int interrupted = mode && !strcmp(mode, "eintr");
  struct timespec wait = {interrupted ? 1 : mode && !strcmp(mode, "blocked") ? 40 : 2, 0};
  while (nanosleep(&wait, &wait) && errno == EINTR) {}
  if (mode && !strcmp(mode, "fail")) {
    errno = EIO;
    return -1;
  }
  if (interrupted) {
    errno = EINTR;
    return -1;
  }
  return 0;
}
ssize_t pread64(int fd, void *buf, size_t size, off64_t offset) {
  static ssize_t (*real_call)(int, void *, size_t, off64_t);
  if (!real_call) real_call = dlsym(RTLD_NEXT, "pread64");
  if (selected(fd, "pread")) {
    if (delay()) return -1;
    if (size > 65536) size = 65536;
  }
  return real_call(fd, buf, size, offset);
}
ssize_t pwrite64(int fd, const void *buf, size_t size, off64_t offset) {
  static ssize_t (*real_call)(int, const void *, size_t, off64_t);
  if (!real_call) real_call = dlsym(RTLD_NEXT, "pwrite64");
  if (selected(fd, "pwrite")) {
    if (delay()) return -1;
    if (size > 65536) size = 65536;
  }
  return real_call(fd, buf, size, offset);
}
int fsync(int fd) {
  static int (*real_call)(int);
  if (!real_call) real_call = dlsym(RTLD_NEXT, "fsync");
  if (selected(fd, "fsync") && delay()) return -1;
  return real_call(fd);
}
