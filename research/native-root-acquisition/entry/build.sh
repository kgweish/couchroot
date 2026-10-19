#!/bin/sh
# SPDX-License-Identifier: 0BSD
set -eu
test "$#" = 2 || exit 64
case "$2" in
 qn90a) loader=/usr/bin/launchpad-loader ;;
 s90d) loader=/usr/bin/app-defined-loader ;;
 *) exit 64 ;;
esac
src=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test ! -e "$1" && test ! -L "$1"
mkdir -m 700 "$1"
"${CC:-arm-linux-gnueabi-gcc}" -std=c99 -O2 -Wall -Wextra -Werror \
 -fPIC -shared -fvisibility=hidden -fstack-protector-strong -D_FORTIFY_SOURCE=2 \
 -Wl,-z,relro,-z,now -Wl,--no-undefined \
 ${ARCH_FLAGS:--march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=softfp} \
 "-DENTRY_LOADER=\"$loader\"" "$src/probe.c" -o "$1/libentry-receipt.so"
