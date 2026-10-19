/* Reproduce restoration between a real poll EINVAL and the caller's next step.
 * Isolated Linux test interposer only. SPDX-License-Identifier: 0BSD */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <poll.h>
#include <sys/resource.h>
static int injected;
int poll(struct pollfd *fds, nfds_t count, int timeout) {
    int (*original)(struct pollfd *, nfds_t, int) = dlsym(RTLD_NEXT, "poll");
    if (!original) { errno = EIO; return -1; }
    if (!injected && count == 1 && timeout == -1) {
        struct rlimit saved, zero;
        injected = 1;
        if (getrlimit(RLIMIT_NOFILE, &saved)) return -1;
        zero = saved;
        zero.rlim_cur = 0;
        if (setrlimit(RLIMIT_NOFILE, &zero)) return -1;
        int result = original(fds, count, timeout);
        int error = errno;
        if (setrlimit(RLIMIT_NOFILE, &saved)) return -1;
        if (result != -1 || error != EINVAL) { errno = EIO; return -1; }
        errno = error;
        return result;
    }
    return original(fds, count, timeout);
}
