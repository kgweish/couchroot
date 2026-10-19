/* SPDX-License-Identifier: 0BSD */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sched.h>
#include <time.h>
#include <unistd.h>

#ifdef SERVICE_ACQUISITION
static char service_package[30], service_prefix[96], service_archive[128];
static char service_view[128], service_key[128], service_operation[128], service_command[256];
#define PROBE_NAME service_package
#define ARCHIVE service_archive
#define VIEW service_view
#define KEY service_key
#define OPERATION service_operation
#define IDENTITY_COMMAND service_command
#else
#ifndef PROBE_NAME
#error A model-specific PROBE_NAME is required
#endif
#define PREFIX "/home/owner/share/tmp/sdk_tools/" PROBE_NAME
#define ARCHIVE "/home/owner/share/tmp/sdk_tools/on-demand/" PROBE_NAME ".tar.gz"
#define VIEW PREFIX "/passwd-view"
#define KEY PREFIX "/public.pem"
#define OPERATION PREFIX "/operation.sh"
#define IDENTITY_COMMAND "--to-command=/usr/bin/dotnet " PREFIX "/NativeEntry.dll identity"
#endif
#define LIMIT 65536

static char *read_file(const char *path) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return NULL;
    char *data = calloc(LIMIT + 1, 1);
    size_t used = 0;
    if (!data) { close(fd); return NULL; }
    while (used < LIMIT) {
        ssize_t n = read(fd, data + used, LIMIT - used);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { free(data); close(fd); return NULL; }
        if (!n) break;
        used += (size_t)n;
    }
    close(fd);
    if (used == LIMIT || memchr(data, 0, used)) { free(data); return NULL; }
    return data;
}

/* Preserve every byte except the single owner's UID/GID fields. */
static char *passwd_view(const char *original) {
    char *out = calloc(strlen(original) + 1, 1);
    if (!out) return NULL;
    size_t used = 0; unsigned owners = 0;
    for (const char *line = original; *line;) {
        const char *end = strchr(line, '\n');
        if (!end) end = line + strlen(line);
        size_t length = (size_t)(end - line);
        if (length >= 6 && !memcmp(line, "owner:", 6)) {
            const char *fields[7]; unsigned count = 0;
            fields[count++] = line;
            for (const char *c = line; c < end; c++) if (*c == ':') {
                if (count == 7) { free(out); return NULL; }
                fields[count++] = c + 1;
            }
            if (++owners != 1 || count != 7 || fields[3] - fields[2] != 5 ||
                fields[4] - fields[3] != 4 || memcmp(fields[2], "5001:", 5) ||
                memcmp(fields[3], "100:", 4)) { free(out); return NULL; }
            size_t head = (size_t)(fields[2] - line), tail = (size_t)(end - fields[4]);
            memcpy(out + used, line, head); used += head;
            memcpy(out + used, "0:0:", 4); used += 4;
            memcpy(out + used, fields[4], tail); used += tail;
        } else { memcpy(out + used, line, length); used += length; }
        if (*end) out[used++] = '\n';
        line = *end ? end + 1 : end;
    }
    if (owners != 1) { free(out); return NULL; }
    return out;
}

static int write_view(const char *data) {
#ifdef SERVICE_ACQUISITION
    /* SDK cannot write the app-owned directory. Validate the coordinator's
       exclusive staged view byte-for-byte before any bind. */
    char *staged = read_file(VIEW);
    int result = staged && !strcmp(staged, data) ? 0 : -1;
    free(staged); return result;
#else
    int fd = open(VIEW, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    size_t left = strlen(data);
    while (left) {
        ssize_t n = write(fd, data, left);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { close(fd); return -1; }
        data += n; left -= (size_t)n;
    }
    int result = fsync(fd); if (close(fd)) result = -1;
    return result;
#endif
}

static long long milliseconds(void) {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t)) return -1;
    return (long long)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

/* A new child group, one bounded merged stream, and no automatic retry. */
static int child(char *const argv[], unsigned timeout, char **output) {
    int pipefd[2], status = 0, reaped = 0, eof = 0, failed = 0;
    *output = calloc(LIMIT + 1, 1);
    if (!*output || pipe2(pipefd, O_CLOEXEC)) return -1;
    pid_t pid = fork();
    if (pid < 0) { close(pipefd[0]); close(pipefd[1]); return -1; }
    if (!pid) {
        if (setpgid(0, 0) || dup2(pipefd[1], STDOUT_FILENO) < 0 || dup2(pipefd[1], STDERR_FILENO) < 0) _exit(126);
        close(pipefd[0]); close(pipefd[1]);
        execv(argv[0], argv); _exit(127);
    }
    close(pipefd[1]);
    /* Child also establishes the group before exec; EACCES here is that race. */
    if (setpgid(pid, pid) && errno != EACCES && errno != ESRCH) failed = 1;
    /* This flags-only call needs no newer libc fcntl/large-file wrapper. */
    if (syscall(SYS_fcntl, pipefd[0], F_SETFL, O_NONBLOCK)) failed = 1;
    long long start = milliseconds(); size_t used = 0;
    if (start < 0) failed = 1;
    while (!failed && (!reaped || !eof)) {
        ssize_t n = read(pipefd[0], *output + used, LIMIT - used);
        if (n > 0) { used += (size_t)n; if (used == LIMIT) failed = 1; }
        else if (!n) eof = 1;
        else if (errno != EAGAIN && errno != EINTR) failed = 1;
        if (!reaped) {
            pid_t r = waitpid(pid, &status, WNOHANG);
            if (r == pid) reaped = 1;
            else if (r < 0 && errno != EINTR) failed = 1;
        }
        long long now = milliseconds();
        if (now < 0 || now - start >= timeout) failed = 1;
        if (!failed && (!reaped || !eof)) {
            if (eof) {
                struct timespec t = {0, 10000000}; nanosleep(&t, NULL);
                continue;
            }
            struct pollfd p = {pipefd[0], POLLIN, 0};
            if (poll(&p, 1, 10) < 0 && errno != EINTR) failed = 1;
        }
    }
    if (failed) {
        /* A refusal to signal is an uncertain outcome, never success/replay. */
        if (kill(-pid, SIGKILL) && errno != ESRCH) fputs("Child stop unconfirmed\n", stderr);
        if (!reaped) {
            /* Do not turn the timeout into an unbounded wait. */
            for (unsigned i = 0; i < 100; i++) {
                pid_t r = waitpid(pid, &status, WNOHANG);
                if (r == pid || (r < 0 && errno == ECHILD)) { reaped = 1; break; }
                struct timespec t = {0, 10000000}; nanosleep(&t, NULL);
            }
        }
    }
    close(pipefd[0]);
    if (failed || !reaped || !WIFEXITED(status)) return -1;
    return WEXITSTATUS(status);
}

static int identity(unsigned expected_uid, unsigned expected_gid) {
    char *status = read_file("/proc/self/status");
    if (!status) return 0;
    unsigned u[4], g[4];
    const char *uid = strstr(status, "\nUid:"), *gid = strstr(status, "\nGid:");
    int ok = uid && gid && sscanf(uid, "\nUid: %u %u %u %u", u, u+1, u+2, u+3) == 4 &&
        sscanf(gid, "\nGid: %u %u %u %u", g, g+1, g+2, g+3) == 4;
    for (int i = 0; ok && i < 4; i++) ok = u[i] == expected_uid && g[i] == expected_gid;
    free(status); return ok;
}

static int run_identity(void) {
    if (identity(5001, 100)) { puts("NATIVE_IDENTITY owner"); fflush(stdout); return 0; }
    if (!identity(0, 0)) { fputs("Archive child identity refused\n", stderr); return 2; }
    puts("NATIVE_IDENTITY root"); fflush(stdout);
    char *script = read_file(OPERATION);
    if (!script) { fputs("Operation bytes unavailable\n", stderr); return 9; }
    /* Match the managed runner's inline shell command contract. The vendor
       shell refuses an unsigned staging file as its script argument. */
    char *const args[] = {"/bin/sh", "-c", script, NULL};
    char *output = NULL; int rc = child(args, 25000, &output);
    if (output) fputs(output, stdout);
    free(output); free(script);
    if (rc < 0) { fputs("Operation incomplete\n", stderr); return 9; }
    return rc;
}

static int launcher(int root) {
    char *const args[] = {"/usr/sbin/sdbd-tarlauncher", "--package_name", PROBE_NAME,
        "-xzf", ARCHIVE, IDENTITY_COMMAND, NULL};
    char *output = NULL; int rc = child(args, 30000, &output);
    const char *receipt = root ? "NATIVE_IDENTITY root\n" : "NATIVE_IDENTITY owner\n";
    /* Stock launcher can print diagnostics before the child's receipt. */
    const char *found = output ? strstr(output, receipt) : NULL;
    int valid = found && (found == output || found[-1] == '\n');
    if (output) fputs(output, stdout);
    free(output);
    if (rc || !valid) { fputs("Archive identity/completion unconfirmed\n", stderr); return -1; }
    return 0;
}

__attribute__((visibility("default"))) int native_entry(int mode) {
    if (mode == 1) return run_identity();
    if (mode != 0 || !identity(901, 901)) { fputs("Acquisition entry identity refused\n", stderr); return 2; }
    char *status = read_file("/proc/self/status"); unsigned long long caps = 0;
    const char *cap = status ? strstr(status, "\nCapEff:") : NULL;
    int capable = cap && sscanf(cap, "\nCapEff: %llx", &caps) == 1 && (caps & 0x200040) == 0x200040;
    free(status);
    if (!capable) { fputs("Required capability context absent\n", stderr); return 2; }
    char *original = read_file("/etc/passwd");
    char *view = original ? passwd_view(original) : NULL; free(original);
    if (!view) { fputs("Owner record refused\n", stderr); return 2; }
    int result = 1, key = 0, passwd = 0;
    if (write_view(view)) { perror("Create private passwd view"); goto done; }
    if (unshare(CLONE_NEWNS)) { perror("Private mount namespace"); goto done; }
    if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL)) { perror("Private propagation"); goto done; }
    char *mounts = read_file("/proc/self/mountinfo");
    if (!mounts) { fputs("Mount inventory unavailable\n", stderr); goto done; }
    int shared = strstr(mounts, " shared:") != NULL; free(mounts);
    if (shared) { fputs("Shared mount propagation remains\n", stderr); goto done; }
    if (mount(KEY, "/usr/share/sdbd/public.pem", NULL, MS_BIND, NULL)) { perror("Private key bind"); goto done; }
    key = 1;
    if (launcher(0)) goto done;
    if (mount(VIEW, "/etc/passwd", NULL, MS_BIND, NULL)) { perror("Private passwd bind"); goto done; }
    passwd = 1;
    if (launcher(1)) goto done;
    result = 0;
done:
    free(view);
    if (passwd && umount2("/etc/passwd", MNT_DETACH)) result = 1;
    if (key && umount2("/usr/share/sdbd/public.pem", MNT_DETACH)) result = 1;
    puts(result ? "NATIVE_ACQUISITION unconfirmed" : "NATIVE_ACQUISITION verified");
    fflush(stdout); fflush(stderr); return result;
}

#ifdef SERVICE_ACQUISITION
/* The loader and C entry independently restrict the unique service stage. */
__attribute__((visibility("default"))) int native_service_entry(int mode, const char *package) {
    if (!package || strlen(package) != 29 || strncmp(package, "archive-root-", 13)) return 2;
    for (unsigned i = 13; i < 29; i++)
        if (!((package[i] >= '0' && package[i] <= '9') || (package[i] >= 'a' && package[i] <= 'f'))) return 2;
    strcpy(service_package, package);
    snprintf(service_prefix, sizeof service_prefix, "/home/owner/share/tmp/sdk_tools/%s", package);
    snprintf(service_archive, sizeof service_archive, "/home/owner/share/tmp/sdk_tools/on-demand/%s.tar.gz", package);
    snprintf(service_view, sizeof service_view, "%s/passwd", service_prefix);
    snprintf(service_key, sizeof service_key, "%s/public.pem", service_prefix);
    snprintf(service_operation, sizeof service_operation, "%s/operation.sh", service_prefix);
    snprintf(service_command, sizeof service_command, "--to-command=/usr/bin/dotnet %s/NativeEntry.dll identity %s", service_prefix, package);
    return native_entry(mode);
}
#endif
