/* SPDX-License-Identifier: 0BSD -- LD_PRELOAD test fixture, never deployed */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
uid_t getuid(void) { return getenv("FAKE_NONROOT") ? 5001 : 0; }
uid_t geteuid(void) { return getenv("FAKE_NONROOT_EUID") ? 5001 : 0; }
int nanosleep(const struct timespec *request, struct timespec *remaining) {
    static int calls;
    FILE *f = fopen(getenv("FAKE_LOG"), "a");
    if (!f) abort();
    fprintf(f, "sleep %ld %ld\n", (long)request->tv_sec, request->tv_nsec); fclose(f);
    calls++;
    if (getenv("FAKE_SLEEP_FAIL")) { errno = EIO; return -1; }
    if (getenv("FAKE_EINTR") && calls == 1) {
        remaining->tv_sec = 7; remaining->tv_nsec = 123; errno = EINTR; return -1;
    }
    return 0;
}
