#!/bin/sh
# SPDX-License-Identifier: 0BSD
set -eu
if test "$#" -ne 1; then
    echo 'usage: build.sh OUTPUT_DIRECTORY (outside the source tree)' >&2
    exit 64
fi
src=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$1"
"${CC:-arm-linux-gnueabi-gcc}" -std=c99 -O2 -Wall -Wextra -Werror \
    -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now \
    -march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=softfp \
    "$src/process-observer.c" -o "$1/process-observer"
