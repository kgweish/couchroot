/* Allocation admission while startup and the single-threaded guardian own state.
 * Samsung's file-open checker can abort instead of returning EMFILE. These
 * checks allocate nothing; an external limit change between check and syscall
 * is not atomic. Protocol operations retain their mutex/reserve admission.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
#include <dirent.h>
#include <sys/eventfd.h>

static int descriptor_guard = 1;
/* Count holes below the soft limit, including sparse inherited tables. */
static int descriptor_capacity(int needed) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_NOFILE, &limit))
    return 0;
  rlim_t bound = limit.rlim_cur < 4096 ? limit.rlim_cur : 4096;
  int available = 0;
  for (int fd = 0; (rlim_t)fd < bound; fd++) {
    if (fcntl(fd, F_GETFD) < 0) {
      if (errno != EBADF)
        return 0;
      if (++available == needed)
        return 1;
    }
  }
  return 0;
}
static int descriptor_allocate(int needed) {
  if (!__atomic_load_n(&descriptor_guard, __ATOMIC_RELAXED) ||
      descriptor_capacity(needed))
    return 1;
  errno = EMFILE;
  return 0;
}
static int descriptor_mode(int flags) {
  return (flags & O_CREAT)
#ifdef O_TMPFILE
         || (flags & O_TMPFILE) == O_TMPFILE
#endif
      ;
}
static int budget_open(const char *path, int flags, ...) {
  mode_t mode = 0;
  if (descriptor_mode(flags)) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  return descriptor_allocate(1) ? open(path, flags, mode) : -1;
}
static int budget_openat(int parent, const char *path, int flags, ...) {
  mode_t mode = 0;
  if (descriptor_mode(flags)) {
    va_list args;
    va_start(args, flags);
    mode = (mode_t)va_arg(args, int);
    va_end(args);
  }
  return descriptor_allocate(1) ? openat(parent, path, flags, mode) : -1;
}
static FILE *budget_fopen(const char *path, const char *mode) {
  return descriptor_allocate(1) ? fopen(path, mode) : NULL;
}
static DIR *budget_opendir(const char *path) {
  return descriptor_allocate(1) ? opendir(path) : NULL;
}
static int budget_pipe2(int pipes[2], int flags) {
  return descriptor_allocate(2) ? pipe2(pipes, flags) : -1;
}
static int budget_socket(int domain, int type, int protocol) {
  return descriptor_allocate(1) ? socket(domain, type, protocol) : -1;
}
static int budget_eventfd(unsigned initial, int flags) {
  return descriptor_allocate(1) ? eventfd(initial, flags) : -1;
}
/* Only worker.c opts into these wrappers. Define them after their bodies so
 * libc calls above remain direct; includes below also cover common utilities.
 * fdopendir/fdopen take ownership of existing descriptors, allocating no fd.
 */
#define open budget_open
#define openat budget_openat
#define fopen budget_fopen
#define opendir budget_opendir
#define pipe2 budget_pipe2
#define socket budget_socket
#define eventfd budget_eventfd
