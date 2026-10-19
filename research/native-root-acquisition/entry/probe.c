/* SPDX-License-Identifier: 0BSD
 * Read-only, finite SDK capability receipt. Never enters the vendor event loop.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <sys/statvfs.h>
#include <unistd.h>
#include "receipt.h"
#ifndef ENTRY_LOADER
#error "ENTRY_LOADER must be the reviewed vendor loader"
#endif
#define ENTRY_CODE "/opt/usr/apps/MiniRoot01/res/wgt/payload/libentry-receipt.so"

static int read_bounded(const char *path, char *out, size_t size) {
    size_t used = 0;
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 0;
    for (;;) {
        ssize_t n = read(fd, out + used, size - 1 - used);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 || (n > 0 && memchr(out + used, 0, (size_t)n))) { close(fd); return 0; }
        if (!n) break;
        used += (size_t)n;
        if (used == size - 1) { close(fd); return 0; }
    }
    if (close(fd) || !used) return 0;
    out[used] = 0;
    return 1;
}

static int link_bounded(const char *path, char *out, size_t size) {
    ssize_t n = readlink(path, out, size - 1);
    if (n <= 0 || (size_t)n == size - 1) return 0;
    out[n] = 0;
    return 1;
}

static void print_hex(const char *value) {
    const unsigned char *p = (const unsigned char *)value;
    for (; *p; ++p) printf("%02x", *p);
}

__attribute__((constructor)) static void entry_receipt(void) {
    char status_text[16384], exe[512], label[256], mount_ns[128], boot[64];
    const char *nonce = getenv("COUCHROOT_ENTRY_NONCE");
    struct entry_status status;
    struct statvfs mount_info;
    int capable, readonly = -1;
    if (!entry_hex(nonce, 32)) _exit(64);
    if (!read_bounded("/proc/self/status", status_text, sizeof(status_text)) ||
        !entry_parse(status_text, &status) ||
        !link_bounded("/proc/self/exe", exe, sizeof(exe)) ||
        !link_bounded("/proc/self/ns/mnt", mount_ns, sizeof(mount_ns)) ||
        !read_bounded("/proc/self/attr/current", label, sizeof(label)) ||
        !read_bounded("/proc/sys/kernel/random/boot_id", boot, sizeof(boot))) _exit(65);
    if (!statvfs(ENTRY_CODE, &mount_info)) readonly = !!(mount_info.f_flag & ST_RDONLY);
    capable = entry_capable(&status) && !strcmp(exe, ENTRY_LOADER);
    printf("COUCHROOT_ENTRY_RECEIPT {\"schema\":1,\"nonce\":\"%s\",\"pid\":%ld,"
           "\"uid\":[%" PRIu32 ",%" PRIu32 ",%" PRIu32 ",%" PRIu32 "],"
           "\"gid\":[%" PRIu32 ",%" PRIu32 ",%" PRIu32 ",%" PRIu32 "],"
           "\"cap_inh\":\"%016" PRIx64 "\",\"cap_prm\":\"%016" PRIx64 "\","
           "\"cap_eff\":\"%016" PRIx64 "\",\"cap_bnd\":\"%016" PRIx64 "\","
           "\"no_new_privs\":%d,\"code_readonly\":%d,\"capable\":%s,\"exe_hex\":\"",
           nonce, (long)getpid(), status.uid[0], status.uid[1], status.uid[2], status.uid[3],
           status.gid[0], status.gid[1], status.gid[2], status.gid[3],
           status.inheritable, status.permitted, status.effective, status.bounding,
           status.no_new_privs, readonly, capable ? "true" : "false");
    print_hex(exe); printf("\",\"label_hex\":\""); print_hex(label);
    printf("\",\"mount_ns_hex\":\""); print_hex(mount_ns);
    printf("\",\"boot_hex\":\""); print_hex(boot); printf("\"}\n");
    if (fflush(stdout)) _exit(66);
    _exit(capable ? 0 : 2);
}
