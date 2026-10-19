/* SPDX-License-Identifier: 0BSD
 * Fixed service identity. Called only by an already privileged launcher; never
 * installed setuid. No target is opened and no receipt is created before drop.
 */
#include <grp.h>
#include <linux/capability.h>

static int parse_service_groups(const char *text, gid_t groups[32]) {
    int count = 0, primary = 0;
    if (!text || !*text || strlen(text) > 351) return 0;
    while (*text) {
        if (*text < '1' || *text > '9' || count == 32) return 0;
        unsigned long value = 0;
        do {
            unsigned digit = (unsigned)(*text++ - '0');
            if (value > ((unsigned long)INT_MAX - digit) / 10) return 0;
            value = value * 10 + digit;
        } while (*text >= '0' && *text <= '9');
        if (count && value <= groups[count - 1]) return 0;
        groups[count++] = (gid_t)value;
        if (value == 100) primary = 1;
        if (!*text) break;
        if (*text++ != ',' || !*text) return 0;
    }
    return primary ? count : 0;
}

static int drop_service_profile(const gid_t *groups, int count) {
    if (getuid() != 0 || geteuid() != 0 || count < 1 || count > 32) return 0;
    /* Close inherited descriptors while still in System. Procfs access under
     * the package label is restricted; subsequent code owns every opened fd. */
    if (!capacity(1) || !close_inherited() || !capacity(1)) return 0;
    const char label[] = "User::Pkg::MiniRoot01";
    int fd = open("/proc/self/attr/current", O_WRONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 0;
    ssize_t written;
    do { written = write(fd, label, sizeof(label) - 1); } while (written < 0 && errno == EINTR);
    int closed = close(fd);
    if (written != (ssize_t)sizeof(label) - 1 || closed) return 0;
    if (prctl(PR_SET_KEEPCAPS, 0L, 0L, 0L, 0L) ||
        prctl(PR_SET_NO_NEW_PRIVS, 1L, 0L, 0L, 0L)) return 0;
    /* Removing a bounding bit does not remove current permitted credentials;
     * retain those only until setgroups/setgid/setuid complete below. */
    for (int cap = 0; cap < 64; cap++) {
        if (prctl(PR_CAPBSET_DROP, (long)cap, 0L, 0L, 0L) && errno != EINVAL) return 0;
    }
    if (setgroups((size_t)count, groups) || setgid(100) || setuid(5001)) return 0;
    struct __user_cap_header_struct header = {_LINUX_CAPABILITY_VERSION_3, 0};
    struct __user_cap_data_struct caps[2] = {{0, 0, 0}, {0, 0, 0}};
    if (syscall(SYS_capset, &header, caps) || syscall(SYS_capget, &header, caps)) return 0;
    for (int i = 0; i < 2; i++) if (caps[i].effective || caps[i].permitted || caps[i].inheritable) return 0;
    uid_t real_uid, effective_uid, saved_uid;
    gid_t real_gid, effective_gid, saved_gid, actual[32];
    if (getresuid(&real_uid, &effective_uid, &saved_uid) ||
        getresgid(&real_gid, &effective_gid, &saved_gid) ||
        real_uid != 5001 || effective_uid != 5001 || saved_uid != 5001 ||
        real_gid != 100 || effective_gid != 100 || saved_gid != 100 ||
        getgroups(32, actual) != count ||
        prctl(PR_GET_NO_NEW_PRIVS, 0L, 0L, 0L, 0L) != 1) return 0;
    for (int i = 0; i < count; i++) if (actual[i] != groups[i]) return 0;
    return 1;
}
