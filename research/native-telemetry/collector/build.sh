#!/bin/sh
# Run inside the collector build image; no TV actions or credentials.
set -eu
: "${OUTPUT_DIR:?Set an absolute output directory}"
case "$OUTPUT_DIR" in /*) ;; *) exit 2;; esac
mkdir -p "$OUTPUT_DIR"
collector_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "${1:-}" in
    '') targets='host arm' ;;
    --host-only) targets=host ;;
    *) echo 'Usage: build.sh [--host-only]' >&2; exit 2 ;;
esac
if test "$targets" != host; then
: "${TV_LIB_DIR:?Set the directory containing verified firmware libcurl/libssl/libcrypto}"
python3 - "$collector_source/tv-libraries.json" "$TV_LIB_DIR" <<'PY'
import hashlib, json, pathlib, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
for name, expected in manifest['libraries'].items():
    path = pathlib.Path(sys.argv[2]) / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected['sha256']:
        raise SystemExit('Firmware library hash mismatch: ' + name)
PY
fi
for target in $targets; do
    if test "$target" = arm; then
        compiler=arm-linux-gnueabi-gcc
        target_flags='-march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=softfp'
        target_lib=/arm/usr/lib/arm-linux-gnueabi
        target_include=/arm/usr/include/arm-linux-gnueabi
        link_flags="-L$TV_LIB_DIR -Wl,--allow-shlib-undefined"
    else
        compiler=gcc
        target_flags=-DCOLLECTOR_HOST_TEST
        target_lib=/usr/lib/x86_64-linux-gnu
        target_include=/usr/include/x86_64-linux-gnu
        link_flags="-L$target_lib"
    fi
    # json-c is linked statically because the TVs expose different SONAMEs.
    # TLS/HTTP stay on the verified firmware libraries (OpenSSL 1.1.1, libcurl 4).
    "$compiler" -std=c11 -O2 -g -Wall -Wextra -Werror -fstack-protector-strong \
        -D_FORTIFY_SOURCE=2 -fPIE $target_flags -I"$target_include" \
        "$collector_source/main.c" "$collector_source/config.c" \
        "$collector_source/sample.c" "$collector_source/send.c" \
        $link_flags "$target_lib/libjson-c.a" -lcurl -lssl -lcrypto -lm \
        -pie -Wl,-z,relro,-z,now -o "$OUTPUT_DIR/collector-$target"
done
if test "$targets" = host; then exit 0; fi
arm-linux-gnueabi-readelf -d -V "$OUTPUT_DIR/collector-arm" > "$OUTPUT_DIR/elf-dependencies.txt"
dpkg-query -W gcc-arm-linux-gnueabi libjson-c-dev libcurl4-openssl-dev libssl-dev > "$OUTPUT_DIR/build-packages.txt"
cp /arm/build-packages.sha256 "$OUTPUT_DIR/arm-packages.sha256"
cp /usr/share/doc/libjson-c-dev/copyright "$OUTPUT_DIR/json-c-COPYING"
sha256sum "$OUTPUT_DIR/collector-arm" > "$OUTPUT_DIR/collector-arm.sha256"
