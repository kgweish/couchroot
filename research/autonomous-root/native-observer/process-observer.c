/* SPDX-License-Identifier: 0BSD
 * Observe one or two processes through pidfds. Never signal or acquire privileges.
 * BOUND -> caller confirms authenticated identity -> ARM -> ARMED -> EXITED.
 * This helper alone cannot establish which process a numeric PID identifies.
 */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/syscall.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/prctl.h>
#include <stddef.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <time.h>
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Older target headers predate pidfds. ARM EABI and AArch64 use number 434. */
#ifndef SYS_pidfd_open
#if defined(__arm__) || defined(__aarch64__) || defined(__x86_64__)
#define SYS_pidfd_open 434
#else
#error Missing pidfd_open syscall number for this architecture
#endif
#endif

static int fail(const char *reason) {
    fprintf(stderr, "observer: %s\n", reason);
    return 1;
}
static int valid_boot(const char *s) {
    if (strlen(s) != 36) return 0;
    for (int i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i] != '-') return 0;
        } else if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) return 0;
    }
    return 1;
}
static int boot_matches(const char *expected) {
    int fd = open("/proc/sys/kernel/random/boot_id", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 0;
    char buf[38]; size_t used = 0;
    while (used < sizeof(buf)) {
        ssize_t n = read(fd, buf + used, sizeof(buf) - used);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { close(fd); return 0; }
        if (!n) break;
        used += (size_t)n;
    }
    close(fd);
    return used == 37 && buf[36] == '\n' && !memcmp(buf, expected, 36);
}
/* Set only after the fixed root-to-service profile closed all inherited fds.
 * The supervisor child closes its two explicit journal descriptors before
 * observe(); it inherits no other non-stdio handles on that path. */
static int profile_descriptors_closed;
static int close_inherited(void) {
    if (profile_descriptors_closed) return 1;
    DIR *dir = opendir("/proc/self/fd");
    if (!dir) return 0;
    struct dirent *entry;
    errno = 0;
    while ((entry = readdir(dir))) {
        char *end; long fd = strtol(entry->d_name, &end, 10);
        if (*entry->d_name && !*end && fd > 2 && fd <= INT_MAX && fd != dirfd(dir)) close((int)fd);
        errno = 0;
    }
    int ok = errno == 0;
    closedir(dir);
    return ok;
}
/* TV kernels may abort on exhaustion instead of returning EMFILE. Do not
 * allocate even a proc directory handle until spare capacity is established.
 * External concurrent limit changes remain outside this admission check. */
static int capacity(int needed) {
    struct rlimit limit;
    if (getrlimit(RLIMIT_NOFILE, &limit)) return 0;
    rlim_t bound = limit.rlim_cur < 4096 ? limit.rlim_cur : 4096;
    for (int fd = 0; (rlim_t)fd < bound; fd++) {
        /* F_GETFD needs no newer libc fcntl wrapper or large-file structure. */
        if (syscall(SYS_fcntl, fd, F_GETFD, 0) < 0) {
            if (errno != EBADF) return 0;
            if (!--needed) return 1;
        }
    }
    return 0;
}
#include "service-profile.h"

static long long milliseconds(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now)) return -1;
    return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}
static int emit(const char *message) {
    size_t left = strlen(message);
    while (left) {
        ssize_t n = write(STDOUT_FILENO, message, left);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return 0;
        message += n; left -= (size_t)n;
    }
    return 1;
}
static pid_t parse_pid(const char *s) {
    if (!*s || *s == '0') return 0;
    for (const char *p = s; *p; p++) if (*p < '0' || *p > '9') return 0;
    errno = 0; char *end; long pid = strtol(s, &end, 10);
    return errno || *end || pid <= 1 || pid > INT_MAX || pid == getpid() ? 0 : (pid_t)pid;
}
static void close_targets(struct pollfd *fds, int count) {
    for (int i = 0; i < count; i++) if (fds[i].fd >= 0) close(fds[i].fd);
}
/* Optional external transport: the launcher supplies an existing private Unix
 * listener and a per-launch token file owned by this same execution identity.
 * Never listen on a public interface or accept target IDs from the socket. */
static int connect_controller(const char *socket_path, const char *token_path) {
    struct sockaddr_un address;
    size_t length = strlen(socket_path);
    if (!length || socket_path[0] != '/' || length >= sizeof(address.sun_path) || token_path[0] != '/') return 0;
    int token = open(token_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (token < 0) return 0;
    struct stat st;
    char secret[65]; size_t used = 0;
    int ok = !fstat(token, &st) && S_ISREG(st.st_mode) && st.st_uid == geteuid() &&
             st.st_nlink == 1 && (st.st_mode & 07777) == 0600 && st.st_size == 64;
    while (ok && used < sizeof(secret)) {
        ssize_t n = read(token, secret + used, sizeof(secret) - used);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { ok = 0; break; }
        if (!n) break;
        used += (size_t)n;
    }
    close(token);
    if (!ok || used != 64) return 0;
    for (size_t i = 0; i < used; i++) if (!((secret[i] >= '0' && secret[i] <= '9') || (secret[i] >= 'a' && secret[i] <= 'f'))) return 0;
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return 0;
    memset(&address, 0, sizeof(address)); address.sun_family = AF_UNIX;
    memcpy(address.sun_path, socket_path, length + 1);
    struct ucred peer; socklen_t size = sizeof(peer);
    ok = !connect(fd, (struct sockaddr *)&address, (socklen_t)(offsetof(struct sockaddr_un, sun_path) + length + 1)) &&
         !getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &size) && size == sizeof(peer) &&
         peer.uid == geteuid() && peer.gid == getegid() && peer.pid > 1;
    if (ok) ok = dup2(fd, STDIN_FILENO) == STDIN_FILENO && dup2(fd, STDOUT_FILENO) == STDOUT_FILENO;
    if (fd > STDERR_FILENO) close(fd);
    if (!ok) return 0;
    secret[64] = 0;
    ok = emit("AUTH ") && emit(secret) && emit("\n");
    memset(secret, 0, sizeof(secret));
    return ok;
}
static int observe(int argc, char **argv) {
    int external = argc >= 2 && !strcmp(argv[1], "--connect");
    const char *socket_path = NULL, *token_path = NULL;
    if (external) {
        if (argc != 6 && argc != 7) return fail("invalid arguments");
        socket_path = argv[2]; token_path = argv[3];
        argc -= 3; argv += 3;
    }
    if ((argc != 3 && argc != 4) || !valid_boot(argv[1])) return fail("invalid arguments");
    int count = argc - 2;
    pid_t pids[2] = {parse_pid(argv[2]), count == 2 ? parse_pid(argv[3]) : 0};
    if (!pids[0] || (count == 2 && (!pids[1] || pids[0] == pids[1]))) return fail("invalid pid");
    if (getuid() != geteuid() || getgid() != getegid()) return fail("changed credentials");
    sigset_t signals;
    sigemptyset(&signals);
    if (sigprocmask(SIG_SETMASK, &signals, NULL) || signal(SIGALRM, SIG_DFL) == SIG_ERR) return fail("signal setup failed");
    signal(SIGPIPE, SIG_IGN);
    alarm(35); /* Independent bound even if a pipe write or proc read stalls. */
    if (!capacity(1) || !close_inherited() || !capacity(count + (external ? 3 : 1)) || !boot_matches(argv[1])) return fail("initial observation unavailable");
    if (external && !connect_controller(socket_path, token_path)) return fail("controller connection unavailable");
    struct pollfd fds[3] = {{-1, POLLIN, 0}, {-1, POLLIN, 0}, {-1, POLLIN, 0}};
    for (int i = 0; i < count; i++) {
        fds[i].fd = (int)syscall(SYS_pidfd_open, pids[i], 0);
        if (fds[i].fd < 0) { close_targets(fds, count); return fail("pidfd unavailable"); }
    }
    fds[count].fd = STDIN_FILENO;
    if (poll(fds, count, 0) != 0 || !boot_matches(argv[1])) { close_targets(fds, count); return fail("process already exited or boot changed"); }
    if (!emit("BOUND\n")) { close_targets(fds, count); return fail("output unavailable"); }
    long long now = milliseconds(), deadline = now + 10000;
    size_t arm_used = 0; int armed = 0, result = 1;
    if (now < 0) { close_targets(fds, count); return fail("clock unavailable"); }
    for (;;) {
        now = milliseconds();
        if (now < 0 || now >= deadline) { fail("deadline expired"); break; }
        int ready = poll(fds, count + 1, (int)(deadline - now));
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) { fail("poll failed"); break; }
        /* Caller disappearance or malformed control always invalidates evidence. */
        if (fds[count].revents & (POLLERR | POLLHUP | POLLNVAL)) { fail("controller disconnected"); break; }
        if (fds[count].revents & POLLIN) {
            char bytes[8]; ssize_t n = read(STDIN_FILENO, bytes, sizeof(bytes));
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0 || armed || (size_t)n > 4 - arm_used || memcmp(bytes, "ARM\n" + arm_used, (size_t)n)) { fail("invalid control"); break; }
            arm_used += (size_t)n;
            if (arm_used == 4) {
                if (poll(fds, count, 0) != 0 || !boot_matches(argv[1])) { fail("process exited before arm"); break; }
                if (!emit("ARMED\n")) { fail("output unavailable"); break; }
                armed = 1; deadline = milliseconds() + 20000;
            }
        }
        int remaining = 0, invalid = 0;
        for (int i = 0; i < count; i++) {
            if (fds[i].fd < 0) continue;
            if (fds[i].revents & (POLLERR | POLLNVAL)) { invalid = 1; break; }
            if (fds[i].revents & (POLLIN | POLLHUP)) {
                if (!armed) { invalid = 1; break; }
                close(fds[i].fd); fds[i].fd = -1;
            } else remaining++;
        }
        if (invalid) { fail("unconfirmed process handle or exit"); break; }
        if (!remaining) {
            if (!boot_matches(argv[1])) { fail("boot changed at exit"); break; }
            if (!emit("EXITED\n")) { fail("output unavailable"); break; }
            result = 0; break;
        }
    }
    close_targets(fds, count);
    return result;
}

/* The supervisor owns only this forked child. Publish a termination receipt only
 * after waitpid; socket EOF is deliberately insufficient. An interrupted intent
 * is retained, and neither the intent nor a final receipt may be overwritten. */
static int supervise(int argc, char **argv) {
    if ((argc != 6 && argc != 7) || !valid_boot(argv[4]) ||
        !parse_pid(argv[5]) || (argc == 7 && (!parse_pid(argv[6]) || !strcmp(argv[5], argv[6])))) return fail("invalid supervisor arguments");
    if (getuid() != geteuid() || getgid() != getegid()) return fail("changed credentials");
    sigset_t signals; sigemptyset(&signals);
    if (sigprocmask(SIG_SETMASK, &signals, NULL) || signal(SIGCHLD, SIG_DFL) == SIG_ERR || signal(SIGALRM, SIG_DFL) == SIG_ERR || signal(SIGTERM, SIG_DFL) == SIG_ERR || signal(SIGINT, SIG_DFL) == SIG_ERR) return fail("supervisor signal setup failed");
    alarm(45);
    umask(077);
    if (!capacity(1) || !close_inherited() || !capacity(4) || !boot_matches(argv[4])) return fail("supervisor admission failed");
    char directory[sizeof(((struct sockaddr_un *)0)->sun_path)];
    size_t length = strlen(argv[3]);
    if (length < 7 || length >= sizeof(directory) || argv[3][0] != '/' || strcmp(argv[3] + length - 6, "/token")) return fail("invalid supervisor directory");
    memcpy(directory, argv[3], length - 6); directory[length - 6] = 0;
    char expected_socket[sizeof(directory) + 8];
    int printed = snprintf(expected_socket, sizeof(expected_socket), "%s/control", directory);
    if (printed < 0 || (size_t)printed >= sizeof(expected_socket) || strcmp(expected_socket, argv[2])) return fail("supervisor socket mismatch");
    int dir = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0) return fail("supervisor directory unavailable");
    struct stat st;
    if (fstat(dir, &st) || st.st_uid != geteuid() || (st.st_mode & 07777) != 0700) { close(dir); return fail("supervisor directory invalid"); }
    if (!fstatat(dir, "result", &st, AT_SYMLINK_NOFOLLOW) || errno != ENOENT) { close(dir); return fail("supervisor result exists or unavailable"); }
    int report = openat(dir, "result.next", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (report < 0) { close(dir); return fail("supervisor intent exists or unavailable"); }
    if (fsync(report) || fsync(dir)) { close(report); close(dir); return fail("supervisor intent sync failed"); }
    pid_t parent = getpid(), child = fork();
    if (child < 0) { close(report); close(dir); return fail("observer fork failed"); }
    if (!child) {
        close(report); close(dir);
        if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != parent) _exit(1);
        argv[1] = "--connect";
        _exit(observe(argc, argv));
    }
    int status; pid_t reaped;
    do { reaped = waitpid(child, &status, 0); } while (reaped < 0 && errno == EINTR);
    if (reaped != child || (!WIFEXITED(status) && !WIFSIGNALED(status)) || !boot_matches(argv[4])) { close(report); close(dir); return fail("observer termination unavailable"); }
    char result[512], code[16], sig[16], guardian[16];
    if (WIFEXITED(status)) snprintf(code, sizeof(code), "%d", WEXITSTATUS(status)); else strcpy(code, "null");
    if (WIFSIGNALED(status)) snprintf(sig, sizeof(sig), "%d", WTERMSIG(status)); else strcpy(sig, "null");
    if (argc == 7) snprintf(guardian, sizeof(guardian), "%s", argv[6]); else strcpy(guardian, "null");
    int size = snprintf(result, sizeof(result), "{\"schema\":1,\"boot_id\":\"%s\",\"worker_pid\":%s,\"guardian_pid\":%s,\"observer_pid\":%ld,\"exit_code\":%s,\"signal\":%s}\n", argv[4], argv[5], guardian, (long)child, code, sig);
    int ok = size > 0 && (size_t)size < sizeof(result);
    size_t used = 0;
    while (ok && used < (size_t)size) {
        ssize_t n = write(report, result + used, (size_t)size - used);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { ok = 0; break; }
        used += (size_t)n;
    }
    if (ok) ok = !fsync(report);
    close(report);
    if (ok) ok = !linkat(dir, "result.next", dir, "result", 0) && !fsync(dir) && !unlinkat(dir, "result.next", 0) && !fsync(dir);
    close(dir); alarm(0);
    return ok ? 0 : fail("observer receipt publication failed");
}
int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "--service-supervise")) {
        gid_t groups[32];
        if ((argc != 7 && argc != 8) || !valid_boot(argv[5]) ||
            !parse_pid(argv[6]) || (argc == 8 && (!parse_pid(argv[7]) || !strcmp(argv[6], argv[7])))) return fail("invalid service supervisor arguments");
        int count = parse_service_groups(argv[2], groups);
        if (!count || !drop_service_profile(groups, count)) return fail("service credential drop failed");
        profile_descriptors_closed = 1;
        /* Remove the group argument; all remaining supervision uses ordinary
         * unprivileged code and the same authenticated socket protocol. */
        argv[2] = "--supervise";
        return supervise(argc - 1, argv + 1);
    }
    return argc > 1 && !strcmp(argv[1], "--supervise") ? supervise(argc, argv) : observe(argc, argv);
}
