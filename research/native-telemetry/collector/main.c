#include "collector.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/random.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <openssl/crypto.h>
#include <time.h>
#include <unistd.h>

volatile sig_atomic_t stopping;
static void stop(int sig) { (void)sig; stopping = 1; }

static bool uuid(char output[37]) {
    unsigned char bytes[16]; size_t offset = 0;
    while (offset < sizeof bytes) {
        ssize_t n = getrandom(bytes + offset, sizeof bytes - offset, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        offset += (size_t)n;
    }
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    snprintf(output, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
        bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],
        bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
    return true;
}

static bool enabled(int directory, bool native_handoff) {
    struct stat st;
    if (native_handoff) {
        // Never compete with an enabled managed sampler, including a symlink or
        // unreadable marker. The handoff renames its empty marker atomically.
        if (!fstatat(directory, "enabled", &st, AT_SYMLINK_NOFOLLOW) || errno != ENOENT) return false;
        return !fstatat(directory, "native-enabled", &st, AT_SYMLINK_NOFOLLOW) &&
            S_ISREG(st.st_mode) && st.st_size == 0 && st.st_nlink == 1;
    }
    return !fstatat(directory, "enabled", &st, AT_SYMLINK_NOFOLLOW) && S_ISREG(st.st_mode);
}

static bool write_atomic(int directory, const char *name, const char *text) {
    char temporary[64];
    snprintf(temporary, sizeof temporary, ".%s-%ld", name, (long)getpid());
    int fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return false;
    size_t length = strlen(text), offset = 0;
    while (offset < length) {
        ssize_t n = write(fd, text + offset, length - offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        offset += (size_t)n;
    }
    bool ok = close(fd) == 0 && offset == length;
    if (ok) ok = renameat(directory, temporary, directory, name) == 0;
    if (!ok) unlinkat(directory, temporary, 0);
    return ok;
}

static void wait_until(double deadline) {
    while (!stopping) {
        double left = deadline - uptime_seconds();
        if (left <= 0) return;
        // One wake per second bounds shutdown and the optional pilot deadline.
        if (left > 1) left = 1;
        struct timespec delay = {(time_t)left, (long)((left - (time_t)left) * 1e9)};
        nanosleep(&delay, NULL);
    }
}

static int run(const char *root, const char *runtime, int duration, bool native_handoff) {
    int result = 1, data = -1, runfd = -1, lease = -1;
    struct sender sender = {0}; struct config cfg = {0};
    char *boot = NULL, session[37];
    umask(0077);
    data = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (data < 0) goto done;
    if (!enabled(data, native_handoff)) { result = 0; goto done; }
    if (!load_config(data, &cfg)) { fputs("Collector configuration rejected\n", stderr); goto done; }
    if (native_handoff && strcmp(cfg.device, "qn90a")) goto done;
    if (mkdir(runtime, 0700) && errno != EEXIST) goto done;
    runfd = open(runtime, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat st;
    if (runfd < 0 || fstat(runfd, &st) || st.st_uid != getuid() || (st.st_mode & 077)) goto done;
    lease = openat(runfd, "lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK, 0600);
    if (lease < 0 || fstat(lease, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_uid != getuid()) goto done;
    if (flock(lease, LOCK_EX | LOCK_NB)) { result = errno == EWOULDBLOCK ? 0 : 1; goto done; }
    boot = read_bounded("/proc/sys/kernel/random/boot_id", 64);
    if (!boot || !uuid(session)) goto done;
    boot[strcspn(boot, "\r\n")] = 0;
    if (strlen(boot) != 36 || !sender_init(&sender, &cfg)) goto done;
    struct sigaction action = {0}; action.sa_handler = stop;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)) goto done;
    signal(SIGPIPE, SIG_IGN);
    errno = 0;
    int priority = getpriority(PRIO_PROCESS, 0);
    if (errno || (priority < 10 && setpriority(PRIO_PROCESS, 0, 10))) goto done;
    char pid[32]; snprintf(pid, sizeof pid, "%ld\n", (long)getpid());
    if (!write_atomic(runfd, "pid", pid)) goto done;
    double finish = duration ? uptime_seconds() + duration : 0;
    uint64_t sequence = 0, sent = 0, failures = 0;
    double next_send = 0, next_status = 0;
    int backoff = 10, last_error = 0;
    bool previous_enabled = false;
    char endpoint[513]; strcpy(endpoint, cfg.endpoint);
    while (!stopping && enabled(data, native_handoff)) {
        double now = uptime_seconds();
        if (now < 0) goto done;
        if (finish && now >= finish) break;
        if (now < 60) { wait_until(finish && finish < 60 ? finish : now + 1); continue; }
        bool monitoring = false; char next_endpoint[513]; strcpy(next_endpoint, endpoint);
        load_preferences(&cfg, &monitoring, next_endpoint);
        if (monitoring != previous_enabled || strcmp(endpoint, next_endpoint)) {
            strcpy(endpoint, next_endpoint); previous_enabled = monitoring;
            next_send = 0; backoff = 10; next_status = 0;
        }
        if (monitoring && now >= next_send - .05) {
            struct json_object *body = sample(++sequence, boot, session, cfg.device);
            bool ok = body && sender_post(&sender, endpoint,
                json_object_to_json_string_ext(body, JSON_C_TO_STRING_PLAIN), &last_error);
            if (!body) last_error = -1;
            json_object_put(body);
            if (ok) { ++sent; backoff = 10; }
            else { ++failures; backoff = backoff >= 150 ? 300 : backoff * 2; }
            next_send = now + backoff;
        }
        if (now >= next_status) {
            struct json_object *status = json_object_new_object();
            if (!status) goto done;
#define STR(key, value) json_object_object_add(status, key, json_object_new_string(value))
#define NUM(key, value) json_object_object_add(status, key, json_object_new_int64(value))
            STR("implementation", "native"); STR("boot", boot); STR("session", session); STR("device", cfg.device);
            STR("endpoint", endpoint); NUM("pid", getpid()); NUM("sequence", sequence); NUM("sent", sent);
            NUM("failures", failures); NUM("last_error", last_error); NUM("retry_seconds", backoff);
            json_object_object_add(status, "monitoring", json_object_new_boolean(monitoring));
            json_object_object_add(status, "uptime", json_object_new_double(now));
            bool written = write_atomic(runfd, "status.json", json_object_to_json_string_ext(status, JSON_C_TO_STRING_PLAIN));
            json_object_put(status);
            if (!written) goto done;
            next_status = now + 60;
#undef STR
#undef NUM
        }
        double wake = now + 10;
        if (finish && finish < wake) wake = finish;
        wait_until(wake);
    }
    result = 0;
done:
    sender_destroy(&sender); free(boot);
    if (lease >= 0) close(lease);
    if (runfd >= 0) close(runfd);
    if (data >= 0) close(data);
    OPENSSL_cleanse(&cfg, sizeof cfg);
    return result;
}

int main(int argc, char **argv) {
    const char *root = NULL, *runtime = NULL; int duration = 0; bool check = false, native_handoff = false;
    if (curl_global_init(CURL_GLOBAL_DEFAULT)) return 1;
    if (argc == 2 && !strcmp(argv[1], "--sample")) {
        char *boot = read_bounded("/proc/sys/kernel/random/boot_id", 64), session[37];
        if (!boot || !uuid(session)) { free(boot); return 1; }
        boot[strcspn(boot, "\r\n")] = 0;
        struct json_object *obj = sample(1, boot, session, "qn90a");
        free(boot); if (!obj) return 1;
        puts(json_object_to_json_string_ext(obj, JSON_C_TO_STRING_PLAIN));
        json_object_put(obj); curl_global_cleanup(); return 0;
    }
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--check-config")) check = true;
        else if (!strcmp(argv[i], "--native-handoff")) native_handoff = true;
        else if (!strcmp(argv[i], "--root") && i + 1 < argc) root = argv[++i];
        else if (!strcmp(argv[i], "--runtime") && i + 1 < argc) runtime = argv[++i];
        else if (!strcmp(argv[i], "--run-for") && i + 1 < argc) {
            char *end; long value = strtol(argv[++i], &end, 10);
            if (*end || value < 1 || value > 3600) return 2;
            duration = (int)value;
        } else return 2;
    }
    if (check && root && root[0] == '/') {
        struct config cfg = {0};
        int fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        bool ok = fd >= 0 && load_config(fd, &cfg);
        if (ok && native_handoff) ok = !strcmp(cfg.device, "qn90a");
        if (fd >= 0) close(fd);
        OPENSSL_cleanse(&cfg, sizeof cfg); curl_global_cleanup();
        return ok ? 0 : 1;
    }
    if (!root || root[0] != '/' || !runtime || runtime[0] != '/') {
        fputs("Usage: collector --root ABSOLUTE_DATA_DIR --runtime ABSOLUTE_RAM_DIR [--run-for SECONDS] [--native-handoff]\n", stderr);
        return 2;
    }
    int result = run(root, runtime, duration, native_handoff);
    curl_global_cleanup(); return result;
}
