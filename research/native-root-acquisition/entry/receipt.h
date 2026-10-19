/* SPDX-License-Identifier: 0BSD */
#ifndef COUCHROOT_ENTRY_RECEIPT_H
#define COUCHROOT_ENTRY_RECEIPT_H
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

struct entry_status {
    uint32_t uid[4], gid[4];
    uint64_t inheritable, permitted, effective, bounding;
    int no_new_privs;
};

static int entry_hex(const char *text, size_t count) {
    size_t i;
    if (!text || strlen(text) != count) return 0;
    for (i = 0; i < count; ++i)
        if (!((text[i] >= '0' && text[i] <= '9') ||
              (text[i] >= 'a' && text[i] <= 'f'))) return 0;
    return 1;
}

static int entry_ids(const char *p, uint32_t values[4]) {
    unsigned i;
    for (i = 0; i < 4; ++i) {
        uint64_t value = 0;
        while (*p == ' ' || *p == '\t') ++p;
        if (*p < '0' || *p > '9') return 0;
        do {
            value = value * 10 + (unsigned)(*p++ - '0');
            if (value > UINT32_MAX) return 0;
        } while (*p >= '0' && *p <= '9');
        values[i] = (uint32_t)value;
    }
    while (*p == ' ' || *p == '\t') ++p;
    return *p == 0;
}

/* Only parse the fields the receipt claims; duplicates/partial fields refuse. */
static int entry_parse(char *text, struct entry_status *status) {
    char *line = text;
    unsigned seen = 0;
    memset(status, 0, sizeof(*status));
    status->no_new_privs = -1;
    while (*line) {
        char *end = strchr(line, '\n'), *value;
        unsigned bit = 0;
        uint64_t *cap = NULL;
        if (!end) return 0;
        *end = 0;
        if (!strncmp(line, "Uid:", 4)) bit = 1;
        else if (!strncmp(line, "Gid:", 4)) bit = 2;
        else if (!strncmp(line, "CapInh:", 7)) { bit = 4; cap = &status->inheritable; }
        else if (!strncmp(line, "CapPrm:", 7)) { bit = 8; cap = &status->permitted; }
        else if (!strncmp(line, "CapEff:", 7)) { bit = 16; cap = &status->effective; }
        else if (!strncmp(line, "CapBnd:", 7)) { bit = 32; cap = &status->bounding; }
        else if (!strncmp(line, "NoNewPrivs:", 11)) bit = 64;
        if (bit) {
            if (seen & bit) return 0;
            seen |= bit;
            value = strchr(line, ':') + 1;
            if (*value != ' ' && *value != '\t') return 0;
            while (*value == ' ' || *value == '\t') ++value;
            if (bit == 1 || bit == 2) {
                if (!entry_ids(value, bit == 1 ? status->uid : status->gid)) return 0;
            } else if (cap) {
                if (!entry_hex(value, 16)) return 0;
                *cap = strtoull(value, NULL, 16);
            } else {
                if (strcmp(value, "0") && strcmp(value, "1")) return 0;
                status->no_new_privs = *value - '0';
            }
        }
        line = end + 1;
    }
    return (seen & 63) == 63;
}

static int entry_capable(const struct entry_status *status) {
    unsigned i;
    const uint64_t required = (UINT64_C(1) << 6) | (UINT64_C(1) << 21);
    for (i = 0; i < 4; ++i)
        if (status->uid[i] != 901 || status->gid[i] != 901) return 0;
    return (status->inheritable & required) == required &&
           (status->permitted & required) == required &&
           (status->effective & required) == required;
}
#endif
