#!/bin/sh
# SPDX-License-Identifier: 0BSD
set -eu
if test "$#" != 1; then echo 'usage: build.sh NEW_OUTPUT_DIRECTORY' >&2; exit 64; fi
src=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Refuse any existing destination, including a dangling symlink.
test ! -e "$1" && test ! -L "$1"
mkdir -m 700 "$1"
# S90D libvconf imports shm_open without declaring librt. Keep librt in the
# global dependency set even though this executable does not call it directly.
"${CC:-arm-linux-gnueabi-gcc}" -std=c99 -O2 -Wall -Wextra -Werror \
 -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now \
 ${ARCH_FLAGS:--march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=softfp} \
 "$src/recovery.c" -ldl -Wl,--no-as-needed -l:librt.so.1 -Wl,--as-needed -o "$1/sdk-host-recovery"
