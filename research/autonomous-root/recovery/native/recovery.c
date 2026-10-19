/* SPDX-License-Identifier: 0BSD */
#define _POSIX_C_SOURCE 200809L
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static const char key[] = "db/sdk/develop/ip";

static int host(const char *text) {
    struct in_addr address;
    char canonical[INET_ADDRSTRLEN];
    return inet_pton(AF_INET, text, &address) == 1 && address.s_addr != 0 &&
        inet_ntop(AF_INET, &address, canonical, sizeof canonical) != NULL &&
        strcmp(text, canonical) == 0;
}

static int seconds(const char *text, unsigned *value) {
    unsigned n = 0;
    if (!*text || (text[0] == '0' && text[1])) return 0;
    for (; *text; text++) {
        if (*text < '0' || *text > '9') return 0;
        n = n * 10 + (unsigned)(*text - '0');
        if (n > 600) return 0;
    }
    *value = n;
    return 1;
}

int main(int argc, char **argv) {
    unsigned delay;
    if (getuid() != 0 || geteuid() != 0 || argc != 5 ||
        !host(argv[2]) || !host(argv[3]) || !seconds(argv[4], &delay) ||
        (strcmp(argv[1], "set") == 0 ? delay != 0 :
         strcmp(argv[1], "watch") != 0 || delay < 30)) return 2;

    /* Resolve the system ABI before waiting. No alternate library CLI or test
       controls are compiled into the deployed utility. */
    void *library = dlopen("libvconf.so.0", RTLD_NOW | RTLD_LOCAL);
    if (!library) { fputs("vconf unavailable\n", stderr); return 1; }
    char *(*get)(const char *) = (char *(*)(const char *))dlsym(library, "vconf_get_str");
    int (*set)(const char *, const char *) =
        (int (*)(const char *, const char *))dlsym(library, "vconf_set_str");
    int result = 1;
    char *current = NULL;
    if (!get || !set) { fputs("vconf symbols unavailable\n", stderr); goto done; }
    struct timespec remaining = {(time_t)delay, 0};
    while (nanosleep(&remaining, &remaining) != 0) {
        if (errno != EINTR) { fputs("Recovery delay failed\n", stderr); goto done; }
    }
    current = get(key);
    if (!current) { fputs("Host unavailable\n", stderr); goto done; }
    if (strcmp(current, argv[3]) == 0) {
        puts("Already restored"); result = 0; goto done;
    }
    if (strcmp(current, argv[2]) != 0) {
        fputs("Host drift; refusing overwrite\n", stderr); goto done;
    }
    free(current); current = NULL;
    if (set(key, argv[3]) != 0) {
        fputs("Host change unconfirmed\n", stderr); goto done;
    }
    current = get(key);
    if (!current || strcmp(current, argv[3]) != 0) {
        fputs("Host change unconfirmed\n", stderr); goto done;
    }
    puts("Host readback verified"); result = 0;
done:
    free(current);
    dlclose(library);
    return result;
}
