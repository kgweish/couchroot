# Native app-user launcher

The measurements below motivated replacing the per-command managed launcher while
retaining .NET for the persistent worker. The shared package builder now embeds the
source-built launcher in the signed worker DLL; both `app.exec` and app-profile
jobs use it. See [capability documentation](../CAPABILITIES.md) for lifecycle and
build requirements. A later [native worker experiment](../native-worker/README.md) compares startup,
memory, CPU and partial capability parity; the deployed worker remains .NET.

`app-launcher.c` is a small root-only executable that applies the existing app
profile and then replaces itself with `/bin/sh -c COMMAND`. It clears supplementary
groups, drops GID/UID, verifies identities and Smack `User`, sets the same runtime
environment overrides, and changes to the owner's home directory. A failed
transition exits without executing the requested command. It is **not a setuid
program**, network listener, authentication layer or standalone privilege grant.
The integrated version closes descriptors above stderr and supplies an explicit
app environment to the shell. The earlier prototype measured below inherited the
other environment variables and was staged through the generic helper API.

## Measurements on both supported TVs — 2026-10-13

The installed managed worker was the previously accepted version 0.2.0. Both
prototype executables were uploaded with verified digests and staged through its
private read-only helper views. The launcher binary was 13,160 bytes, unstripped.
Raw logs, device identities and credentials remain private. Aggregated values are
in [results.json](results.json).

Thirty measured pairs per TV followed three warmup pairs. Order alternated within
each pair. `bench.c` used a monotonic clock around fork/exec/wait4, launching the
installed worker DLL's `--app-exec` path or the native executable. Both ran the
shell builtin `:`. Thus the measurement includes launcher startup, profile setup,
shell startup and exit, but excludes HTTPS and the worker's command dispatch.
These are warm-cache samples; the first launches are excluded, not claimed as a
controlled cold-start benchmark. Other TV processes remained active.

| Median per-command cost | QN90A .NET | QN90A native | S90D .NET | S90D native |
| --- | ---: | ---: | ---: | ---: |
| Elapsed time | 149.7 ms | 5.95 ms | 372.3 ms | 8.87 ms |
| CPU time | 144.0 ms | 4.0 ms | 322.6 ms | 8.13 ms |
| Peak child RSS | 15.20 MiB | 1.14 MiB | 16.39 MiB | 1.13 MiB |
| p95 elapsed time | 170.1 ms | 8.73 ms | 496.5 ms | 10.91 ms |

The native launcher was approximately 25x and 42x faster locally in these samples.
Linux `wait4` reports child CPU accounting and peak RSS; the RSS figure is not the
sum of every process's simultaneous memory. Native exec also removes the managed
supervisor process that otherwise waits for the shell.

A separate 20-pair client comparison included a new pinned mutual-TLS connection
for every request. Managed commands used `app.exec`; native commands used root
`exec` to invoke the staged launcher, which then dropped to the app identity.
Both passed through the installed worker's command runner. Median round trips were:

| TV | Managed API | Native through root exec |
| --- | ---: | ---: |
| QN90A | 303.2 ms | 135.4 ms |
| S90D | 454.8 ms | 104.5 ms |

The routes and envelopes differ, so this is a practical prototype comparison,
not a claim about an integrated native `app.exec` implementation.

## Persistent worker, recovery and transfers

The initial idle snapshots had worker RSS of 18.54 MiB (QN90A) and 19.43 MiB
(S90D). Proportional resident memory was only 6.15 and 4.68 MiB, respectively;
private resident memory was 3.45 and 3.48 MiB. Shared runtime mappings explain why
RSS alone overstates the exclusive resident cost. Both workers also had swapped
pages; resident measurements are not their total memory commitment.

After temporary helpers were released and test files removed, two explicit worker
disable/enable cycles per TV measured enable-to-new-worker readiness:

| TV | First acquisition | Second acquisition | Fresh worker PSS | Fresh worker swap |
| --- | ---: | ---: | ---: | ---: |
| QN90A | 1.38 s | 2.80 s | 4.72 MiB | 2.32 MiB |
| S90D | 1.89 s | 2.22 s | 4.42 MiB | 2.21 MiB |

Every acquisition succeeded on its first attempt, in the same boot. Status was
sampled every 250 ms plus request time. These two observations include the full
existing acquisition path; they do not isolate .NET startup or predict cold boot.
No TV reboot or SDK host-address change was performed for this experiment.

One 8 MiB random-payload round trip per TV, using the existing managed transfer
implementation and 1 MiB chunks, produced:

| TV | Upload | Download |
| --- | ---: | ---: |
| QN90A | 38.55 s / 0.208 MiB/s | 7.49 s / 1.068 MiB/s |
| S90D | 44.11 s / 0.181 MiB/s | 6.90 s / 1.160 MiB/s |

Both complete digests matched. These include client/network, hashing and control
requests. The incoming frame reader currently calls `ReadByte` on an unbuffered
`NetworkStream` for each byte. This is a candidate for a buffered-reader experiment,
not a measured attribution of the entire upload cost. There is no native transfer
implementation in this prototype.

## Validation and next decision

Both TVs verified UID/EUID 5001, GID 100, Smack `User`, runtime environment and
working directory. Native commands preserved exit codes 0, 7 and 77. Calling the
launcher from the app profile was rejected without executing its command. Helper
views and test files were removed, benchmark jobs forgotten, and both existing
workers were ready after reacquisition.

The local failure-injection harness checks that failed label writes, identity or
group transitions, label verification, descriptor cleanup and directory changes
prevent shell execution. It checks the explicit child environment, exact shell
arguments and exec failure handling. The Linux worker harness also exercises
nested single/double quotes, backslashes and newlines across the actual process
boundary. These checks complement, but cannot replace, hardware Smack checks.

The integration preserves digest-verified staging and root-only invocation.
Separately profiling incoming protocol reads remains a useful next step. The
measured worker footprint and acquisition latency do not justify a full C rewrite.

## Reproducing the prototype

Build with an ARMv7 Linux soft-float ABI toolchain compatible with the supported TVs;
the measured build used `arm-linux-gnueabi-gcc` in the existing Bullseye toolchain.
Keep output outside the source checkout:

```sh
sh research/autonomous-root/native-launcher/build.sh /private/native-launcher-build
python3 tests/native_app_launcher_test.py
```

Through the enrolled client's file-transfer and helper APIs, upload and prepare
both binaries. Invoke the returned benchmark helper path as an authenticated root
job with the installed worker DLL path, returned launcher helper path, and `30`
as its arguments. Give the job a bounded timeout (180 seconds in this experiment).
The benchmark emits JSON lines; exclude rounds -3 through -1 for the warmup.
Never substitute another TV's runtime or bypass the model/firmware guards. Release
both views after the job finishes and remove only the experiment's uploaded files.
No changes to SDK admission, signature enforcement or boot flags are needed for
this standalone experiment. Its managed comparison specifically requires the old
0.2.0 DLL, which still supported `--app-exec`; the integrated worker removes that
entry point and never falls back to it.
