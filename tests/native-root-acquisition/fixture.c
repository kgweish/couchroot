/* SPDX-License-Identifier: 0BSD -- host-only syscall substitution harness. */
#define _GNU_SOURCE
#include <assert.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
static int fake_open(const char *, int, ...);
static int fake_unshare(int);
static int fake_mount(const char *, const char *, const char *, unsigned long, const void *);
static int fake_umount(const char *, int);
static int fake_execv(const char *, char *const []);
#define open fake_open
#define unshare fake_unshare
#define mount fake_mount
#define umount2 fake_umount
#define execv fake_execv
#ifndef SERVICE_ACQUISITION
#define PROBE_NAME "couchroot-native-root-qn90a"
#endif
#include "../../research/native-root-acquisition/acquire.c"
#undef open
#undef unshare
#undef mount
#undef umount2
#undef execv
static const char *scenario;
static int root_mounted;
static void event(const char *name) {
    FILE *f = fopen("events", "a"); assert(f); fprintf(f, "%s\n", name); fclose(f);
}
static int fake_open(const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap); }
    if (!strcmp(path, "/proc/self/status")) path = "status";
    else if (!strcmp(path, "/proc/self/mountinfo")) path = "mountinfo";
    else if (!strcmp(path, "/etc/passwd")) path = "passwd";
    else if (!strcmp(path, VIEW)) path = "passwd-view";
    else if (!strcmp(path, OPERATION)) path = "operation.sh";
    return open(path, flags, mode);
}
static int fake_unshare(int flags) {
    assert(flags == CLONE_NEWNS); event("unshare");
    if (!strcmp(scenario,"unshare-fail")) { errno = EPERM; return -1; }
    return 0;
}
static int fake_mount(const char *source, const char *target, const char *fs, unsigned long flags, const void *data) {
    assert(!fs && !data);
    if (!strcmp(target,"/")) {
        assert(!source && flags == (MS_REC | MS_PRIVATE)); event("private");
        return !strcmp(scenario,"private-fail") ? -1 : 0;
    }
    assert(flags == MS_BIND);
    if (!strcmp(target,"/etc/passwd")) {
        assert(!strcmp(source,VIEW)); event("bind-passwd");
        if (!strcmp(scenario,"passwd-bind-fail")) return -1;
        root_mounted = 1;
    } else {
        assert(!strcmp(target,"/usr/share/sdbd/public.pem") && !strcmp(source,KEY)); event("bind-key");
        if (!strcmp(scenario,"key-bind-fail")) return -1;
    }
    return 0;
}
static int fake_umount(const char *path, int flags) {
    assert(flags == MNT_DETACH);
    event(!strcmp(path,"/etc/passwd") ? "unmount-passwd" : "unmount-key");
    return !strcmp(scenario,"unmount-fail") ? -1 : 0;
}
static int fake_execv(const char *path, char *const argv[]) {
    if (!strcmp(path,"/usr/sbin/sdbd-tarlauncher")) {
        assert(!strcmp(argv[1],"--package_name") && !strcmp(argv[2],PROBE_NAME) && !strcmp(argv[4],ARCHIVE));
        assert(!strcmp(argv[5],IDENTITY_COMMAND));
        event(root_mounted ? "root-launch" : "baseline-launch");
        const char *message = root_mounted ? "NATIVE_IDENTITY root\n" : "NATIVE_IDENTITY owner\n";
        if (!strcmp(scenario,"wrong-identity")) message = "NATIVE_IDENTITY root\n";
        if (!strcmp(scenario,"embedded-identity")) message = "prefix NATIVE_IDENTITY owner\n";
        if (write(1,message,strlen(message)) < 0) _exit(90);
        _exit(!strcmp(scenario,"launcher-fail") ? 7 : 0);
    }
    return execv(path,argv);
}
int main(int argc, char **argv) {
    assert(argc >= 2); scenario = argv[1];
#ifdef SERVICE_ACQUISITION
    const char *package = "archive-root-0123456789abcdef";
    if (!strcmp(scenario,"bad-package")) return native_service_entry(0, argc > 2 ? argv[2] : NULL);
    /* Set paths without executing a mode. */
    assert(native_service_entry(7, package) == 2);
#endif
    if (!strcmp(scenario,"parse")) {
        char *text = read_file("passwd"); char *view = text ? passwd_view(text) : NULL;
        free(text); if (!view) return 2; fputs(view,stdout); free(view); return 0;
    }
    if (!strcmp(scenario,"identity")) return native_entry(1);
    if (!strcmp(scenario,"bad-mode")) return native_entry(7);
    if (!strcmp(scenario,"child")) {
        assert(argc == 3);
        char *args[] = {"/bin/sh","-c",argv[2],NULL}; char *output = NULL;
        int rc = child(args,150,&output);
        if (output) fputs(output,stdout);
        free(output);
        printf("\nCHILD_RESULT %d\n",rc); return 0;
    }
    return native_entry(0);
}
