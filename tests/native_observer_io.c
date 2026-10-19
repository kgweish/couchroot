/* Disposable observer persistence fault fixture. Never included in TV builds. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static int readiness(int fd) {
  char path[64], target[4096];
  snprintf(path, sizeof path, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(path, target, sizeof target - 1);
  if (n < 0) return 0;
  target[n] = 0;
  const char *name = strrchr(target, '/');
  return name && !strcmp(name + 1, "observer.ready");
}
static int mode(const char *name) {
  const char *value = getenv("COUCHROOT_OBSERVER_IO_FAULT");
  return value && !strcmp(value, name);
}
static void delay(long milliseconds) {
  struct timespec remaining = {milliseconds / 1000, (milliseconds % 1000) * 1000000};
  while (nanosleep(&remaining, &remaining) && errno == EINTR) {}
}
int fsync(int fd) {
  int (*real_sync)(int) = dlsym(RTLD_NEXT, "fsync");
  static int delayed;
  if (readiness(fd)) {
    struct stat st;
    if (fstat(fd, &st)) return -1;
    if (mode("startup-delay") && !delayed++) delay(1200);
    if ((mode("admission-fail") && !st.st_size) ||
        (mode("final-fail") && st.st_size)) { errno = EIO; return -1; }
  }
  return real_sync(fd);
}
ssize_t write(int fd, const void *bytes, size_t length) {
  ssize_t (*real_write)(int, const void *, size_t) = dlsym(RTLD_NEXT, "write");
  if (readiness(fd) && mode("capture-delay")) delay(350);
  return real_write(fd, bytes, length);
}
