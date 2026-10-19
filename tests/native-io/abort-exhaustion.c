/* Model the TV's fatal allocation failure in isolated Linux tests. Exit 93
 * proves an exhausted allocation reached libc instead of being admitted first.
 * This library is never packaged or used on a TV. SPDX-License-Identifier: 0BSD */
#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

static int task_identity_nomem(const char *path) {
  struct rlimit limit;
  if (getenv("COUCHROOT_TEST_GUARDIAN_NOMEM") &&
      !strncmp(path, "/proc/", 6) && strstr(path, "/status") &&
      !getrlimit(RLIMIT_NOFILE, &limit) && limit.rlim_cur < 32) {
    errno = ENOMEM;
    return 1;
  }
  return 0;
}
FILE *fopen(const char *path, const char *mode) {
  if (task_identity_nomem(path)) return NULL;
  FILE *(*original)(const char *, const char *) = dlsym(RTLD_NEXT, "fopen");
  if (!original) _exit(94);
  FILE *result = original(path, mode);
  if (!result && errno == EMFILE) _exit(93);
  return result;
}
FILE *fopen64(const char *path, const char *mode) {
  if (task_identity_nomem(path)) return NULL;
  FILE *(*original)(const char *, const char *) = dlsym(RTLD_NEXT, "fopen64");
  if (!original) _exit(94);
  FILE *result = original(path, mode);
  if (!result && errno == EMFILE) _exit(93);
  return result;
}
DIR *opendir(const char *path) {
  DIR *(*original)(const char *) = dlsym(RTLD_NEXT, "opendir");
  if (!original) _exit(94);
  DIR *result = original(path);
  if (!result && errno == EMFILE) _exit(93);
  return result;
}
int openat(int dir, const char *path, int flags, ...) {
  int (*original)(int, const char *, int, ...) = dlsym(RTLD_NEXT, "openat");
  if (!original) _exit(94);
  mode_t mode = 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  int result = original(dir, path, flags, mode);
  if (result < 0 && errno == EMFILE) _exit(93);
  return result;
}
int openat64(int dir, const char *path, int flags, ...) {
  int (*original)(int, const char *, int, ...) = dlsym(RTLD_NEXT, "openat64");
  if (!original) _exit(94);
  mode_t mode = 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  int result = original(dir, path, flags, mode);
  if (result < 0 && errno == EMFILE) _exit(93);
  return result;
}
