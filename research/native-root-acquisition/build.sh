#!/bin/sh
# SPDX-License-Identifier: 0BSD
set -eu
if test "$#" != 2; then echo 'usage: build.sh NEW_OUTPUT_DIRECTORY qn90a|s90d' >&2; exit 64; fi
case "$2" in qn90a|s90d|service) ;; *) exit 64 ;; esac
define=-DPROBE_NAME=\"couchroot-native-root-$2\"
if test "$2" = service; then define=-DSERVICE_ACQUISITION; fi
src=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test ! -e "$1" && test ! -L "$1"
mkdir -m 700 "$1"
"${CC:-arm-linux-gnueabi-gcc}" -std=c99 -O2 -Wall -Wextra -Werror \
 -fPIC -shared -fvisibility=hidden -fstack-protector-strong -D_FORTIFY_SOURCE=2 \
 -Wl,-z,relro,-z,now -Wl,--no-undefined \
 ${ARCH_FLAGS:--march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=softfp} \
 "$define" "$src/acquire.c" -lrt -o "$1/libacquire.so"
