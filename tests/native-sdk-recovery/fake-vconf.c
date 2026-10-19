/* SPDX-License-Identifier: 0BSD -- host tests only, never deployed */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
/* Match S90D vconf's undeclared POSIX shared-memory import. */
int (*required_shm_open)(const char *, int, mode_t) = shm_open;
static int reads;
static void event(const char *name, const char *key) {
    FILE *f = fopen(getenv("FAKE_LOG"), "a");
    if (!f) abort();
    fprintf(f, "%s %s\n", name, key); fclose(f);
}
char *vconf_get_str(const char *key) {
    event("get", key); reads++;
    const char *fail = getenv("FAKE_GET_FAIL");
    if (fail && reads == atoi(fail)) return NULL;
    FILE *f = fopen(getenv("FAKE_STATE"), "r");
    if (!f) return NULL;
    char state[128]; char *value = fgets(state, sizeof state, f);
    fclose(f); return value ? strdup(state) : NULL;
}
#ifndef MISSING_SET
int vconf_set_str(const char *key, const char *value) {
    event("set", key);
    if (getenv("FAKE_SET_FAIL")) return -1;
    if (getenv("FAKE_NO_CHANGE")) return 0;
    FILE *f = fopen(getenv("FAKE_STATE"), "w");
    if (!f) return -1;
    int ok = fputs(value, f) >= 0; return fclose(f) == 0 && ok ? 0 : -1;
}
#endif
