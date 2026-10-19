# Native SDK-host recovery

`recovery.c` replaces the small `Recovery.dll` setting-change utility without
requiring a managed worker or runtime. It is an original 0BSD implementation.
It does not acquire root, launch SDB, manage timers or change service selection.
The managed utility and signed agent package remain the deployed fallback.

## Contract

```
sdk-host-recovery set EXPECTED_IPV4 TARGET_IPV4 0
sdk-host-recovery watch EXPECTED_IPV4 TARGET_IPV4 SECONDS
```

Both real and effective UID must be zero. Addresses must be canonical, nonzero
IPv4; seconds must be canonical unsigned decimal. `set` requires zero and `watch`
requires 30–600 seconds. Invalid input/identity returns 2 before loading vconf.
Unlike managed `int.TryParse`, native rejects whitespace, signs and leading zeroes
in the delay. It also rejects an effective UID other than zero.

The executable explicitly retains `librt.so.1`: S90D vconf imports `shm_open`
without declaring that dependency. This replaces a dependency the managed host
had supplied implicitly; no vendor library is copied or patched.

The utility loads system `libvconf.so.0` and resolves `vconf_get_str` and
`vconf_set_str`, then waits if requested. Interrupted sleeps continue for the
remaining duration. Missing library/symbols fail before waiting; no setting is
read until the delay completes. There is no production test switch or alternate
library argument. Callers should launch with a clean environment.

Only `db/sdk/develop/ip` is accessed:

| Observation | Result |
| --- | --- |
| Current value equals target | `Already restored`, exit 0, no write |
| Current value differs from expected and target | `Host drift; refusing overwrite`, exit 1, no write |
| Current value equals expected | Set target once; exit 0 only after matching readback |
| Read, setter, readback or delay fails | Exit 1; no retry or compensating write |

Successful publication prints `Host readback verified`. A failed confirmation
may follow a completed write: inspect the actual value before deciding what to
do next. The read/check/write is not an atomic compare-and-swap. Concurrent
setting writers must be excluded by the orchestration layer.

## Build and test

Build in the existing `samsung-native-collector:bullseye` toolchain, mounting this
directory read-only as `/src` and a private output parent as `/out`:

```
sh /src/build.sh /out/new-build
```

The destination must not exist. The script emits only `sdk-host-recovery`, with
ARMv7 EABI5 softfp, stack protection and RELRO/NOW. Pin the compiler image by its
resolved digest, build twice, compare bytes, inspect ELF interpreter/dependencies
and GLIBC versions, and retain a private source/build manifest before deployment.
Do not commit the binary or vendor libraries. The installed build's aggregate
properties and hardware results are recorded in `results.json`.

The tests compile the ordinary source with the host compiler. A fake vconf shared
library supplies state, logging and operational failures. A separate host-only
LD_PRELOAD fixture controls UID and sleep for deterministic boundary/error tests;
neither fixture enters the deployment build. A real 30-second test changes the
fake setting during the wait and verifies late drift refusal with no write.
Run from the repository root in the disposable Linux native-test container:

```
python3 -m unittest discover -s tests -p native_sdk_recovery_test.py -v
```

The tests skip on non-Linux hosts; the real-delay case requires container root.
Ten test groups cover successful readback, idempotence, drift, argument/root
checks, missing library/symbols, first/second read failure, setter failure, failed
readback, 30/600-second boundaries, EINTR, sleep failure, the retained librt
dependency and existing-output refusal.

## Device launch and independent-rescue qualification

Use the enrolled, pinned client, per-device lock and shared pending-run check.
Persist each request ID and intent before mutation; reconcile uncertain outcomes
instead of repeating them. Install the verified bytes into a new, root-owned
versioned directory beside the managed recovery material. Keep code and logs in
separate directories and refuse existing or symlinked destinations.

The TVs require the established native execution context: a root/System transient
unit with `PrivateMounts=yes` and `BindReadOnlyPaths=ABSOLUTE_CODE_DIRECTORY`.
Direct execution from writable staging was refused on QN90A before the utility
ran. The accepted launch uses a private read-only bind; no platform policy,
file capability, system passwd/key file or signing trust is changed. The
orchestrator verifies firmware, boot, binary digests and exact owned paths.
The utility itself does not establish those guards or require systemd.

The qualification procedure keeps an independent 300-second .NET SDK rescue armed:

1. Verify the existing managed worker, enrollment, selection/job records, SDK
   loopback value and managed recovery digest. Check native idempotence, invalid
   arguments and wrong-expected-value drift refusal before changing the setting.
2. Prearm a root/System native `watch` for 30 seconds, followed by SDB restart.
   Also prearm identity-bound coordinator resumption and a later native reverse
   switch to loopback. Keep suspension short: the final rounds suspend near the
   rescue deadline, verify SDK access while stopped, and resume promptly. Store
   all unit names and code hashes privately.
3. Disable the worker, then suspend the HTTPS coordinator only after binding its
   listener PID, start ticks and executable. Confirm HTTPS is unavailable.
4. After native rescue, connect through external SDK. Verify the same boot,
   expected host setting, coordinator still stopped, native unit completed and
   the .NET fallback timer still armed. This establishes independence from the
   unavailable worker and coordinator, not reboot/crash recovery.
5. Resume the coordinator. If its listener is unavailable, use the SDK access
   restored by native to relaunch the enrolled service once, then verify its
   listener and disabled state. Keep the external-SDK window open long enough
   for this recovery. Let the prearmed native reverse switch restore loopback
   and restart SDB, then re-enable the worker and confirm managed readiness.
   Verify both native readbacks, unchanged enrollment/selection/retained jobs and
   the original .NET bytes. Disarm every trial timer and prove the .NET rescue
   never fired.

Raw commands, addresses, identities, packages and receipts stay in private state.
No new WGT is needed for this standalone utility; the signed agent remains 0.7.28.
The installed native utility is available for subsequent journaled rescue runs;
this qualification does not globally replace existing deployment-kit callers.

## Local builder and journaled caller

`python3 -m tvsetup.native_components --model qn90a --output NEW_DIRECTORY`
builds all native agent components, including this utility, without invoking
.NET, loading private site configuration, signing or contacting a TV. Use `s90d`
for the other profile. Every component is built twice in the digest-pinned,
network-disabled toolchain; ELF ABI, dependency and GLIBC checks precede manifest
publication. This utility must retain `librt.so.1`. The bundle is explicitly
non-deployable as a complete agent because native-only capability entry remains
unresolved. Ordinary signed-package preparation and its managed payloads are
unchanged.

`tvsetup.native_rescue` supplies the new caller path for a future, separately
qualified deployment. It generates commands and journals one-shot submissions;
it does not connect to a TV, install files or obtain root. A caller must first
hold the device lock, reject pending setup work and verify the physical device
and enrolled root executor. Prepare an owned root-only versioned installation:
`/opt/couchroot-native-recovery/<32-lowercase-hex>/code/sdk-host-recovery`, mode
0500, with root-owned non-group/other-writable ancestors. Keep logs elsewhere.
The build output is not itself an installation receipt.

Construct a plan with the exact model, current boot, installed code directory,
verified binary digest and expected/target addresses. Persist its journal in a
fresh private directory. Call `submit(plan, 'arm', journal, execute)` where
`execute(request_id, script)` submits that exact ID once through the admitted
root executor and returns `exit_code`, `timed_out` and `stdout`. The journal
records the complete intent and submission clocks before dispatch. Bound the
executor to 25 seconds and account for that time in the renewal margin; do not
reuse host monotonic timestamps across host restarts. The arm uses a unique 300-second
systemd timer, root/System identity and a private read-only code bind. The
delayed command rechecks boot, firmware and code before running the utility with
a clean environment, then restarts SDB only after successful readback.

Use `submit(plan, 'retire', journal, execute)` for the same binding. Retirement
verifies the original service description, stops only its timer, then checks
that no start job is queued, the service never started and it is inactive.
`RemainAfterExit=yes` retains
the execution evidence if the timer fires during disarm. A fired rescue is not
killed or reported as unfired. An exception or incomplete result is persisted as
unknown and is never retried or automatically replaced with the managed utility.
An uncertain arm can be reconciled by the bound retirement command; it remains
unknown in the historical arm receipt. Uncertain retirement needs inspection,
not a second submission. Callers retain the independent managed rescue until
hardware adoption is accepted, and renew recovery with overlap before retiring
an older timer.

The queued-job check uses systemd's [unit Job property](https://wiki.freedesktop.org/www/Software/systemd/dbus/)
and requests `--all` so an empty value is explicit. Upstream's
[property printer](https://github.com/systemd/systemd/blob/v219/src/systemctl/systemctl.c#L3598)
otherwise permits omission of an empty Job. The exact TV property behavior is
part of the pending caller qualification, not established by the fake systemd.

Hardware qualification is paused. This new caller has only local fake-systemd
and real-shell acceptance; historical independent-rescue results above cover
the utility and previous private orchestration. Existing immutable deployment
kits are not rewritten. This timer is boot-bound and does not survive reboot.
