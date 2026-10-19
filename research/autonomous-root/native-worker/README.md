# Native worker experiment

This directory began as a C measurement sidecar and now supplies the signed native
agent candidate. The service can explicitly select it and recover it on the same
boot; managed remains the deployed fallback. See [MIGRATION.md](MIGRATION.md) for
current integration and device qualification. Historical experiments below retain
their original limits. Standalone comparisons keep the installed managed worker
active and use separate owned scopes.

Local source also supports a previous-boot schema-4 guardian journal with its
launch-token binding. Recovery keeps persistent scope/runtime inode checks but
does not compare old PIDs to current processes. A current freezer with the old
name is refused without thawing. All visible current mount namespaces must lack
owned runtime views; namespace descriptor and bind pins remain conservative
blockers. Legacy journals remain limited to same-boot recovery. Seven focused
Linux fixtures cover these rules, including production kernel-resource checks
with redirected filesystem inputs. The service integrates boot-aware startup,
retained-state verification and managed return while keeping the original
activation immutable. A schema-2 runtime receipt binds replacement processes to
the new boot. Both TVs now have 0.7.52, but clean-boot qualification of that
version remains open; see the current migration snapshot.

Local source also reconciles pending native-to-managed returns across boots.
The original request, transaction and restore inputs remain authoritative; fresh
executor/boot checks replace observations of historical PIDs. A unit with an old
name must be absent on the new boot. Completed records remain byte-identical.
Unclean native state is reconciled before restoration through the root-only mode:

```text
worker --reconcile-state PRIVATE_SCOPE CURRENT_BOOT_ID OLD_WORKER_ID JOURNAL_SHA256
```

It opens an existing private scope and job lock, pins the journal digest/owner,
and reuses guardian reconciliation without a new worker, launcher, token or
network channel. It has a 20-second outer deadline and retains the recovery
child's 15-second limit. Inspection failures have no generic exit cleanup.
`absent` may replace the digest only after independently observing no journal;
it verifies absence without repairing records. The coordinator still verifies
the exact resulting record inventory, permitted interrupted outcomes and owned
cleanup before admission. It executes the pinned binary in a private read-only
code view. This maintenance mode is not a public protocol operation. These changes
are included in 0.7.52 and locally tested; installation alone does not qualify
interrupted-return recovery across boots.

The prototype uses the existing HMAC protocol with strict sequence ordering,
bounded binary chunks and structured failure responses. It implements status,
root commands, bounded output and process-group timeouts, app commands through an
independently staged, digest-verified native launcher, and file begin/write/status/read/commit/close with
per-chunk/full-file hashes and conditional replacement. Default experiment file
access is restricted to direct children of a private, root-owned directory;
production mode uses the broader policy described in [PARITY.md](PARITY.md).
It loads the TV's libcrypto and json-c APIs, rather than implementing cryptography
or a complete JSON parser itself. This is still experimental C with a substantially
smaller test history than the managed worker.

The lifecycle extension adds `job.start/status/output/cancel/forget` with a
supervisor thread, root/app profiles, exclusive durable launch intents, bounded
1 MiB rings per stream and 64 KiB cursor windows. Sixteen jobs can be retained in
memory and 64 records on disk. Records live under the experiment's private `.jobs`
directory, locked to one native worker. Initial intents are written and synced to
an exclusive temporary file, then published with a non-replacing hard link and
directory fsync before a child can execute. Failed writes cannot publish partial
initial records. Initial temporary names include the generated worker identity.
After same-boot ownership reconciliation, an unpublished intent becomes an
interrupted record with unknown exit status and `launch_started=false`; its ID
stays reserved until explicitly forgotten. Recovery resumes interrupted repair
writes and preserves existing final records and foreign-owner intents. Invalid
owned metadata fails closed. Legacy orphan `.json.next` files without a final
record lack this ownership proof and remain preserved for inspection.
The job execution deadline starts after the running record and directory entry
are synced, just before releasing the command gate. Slow launch persistence does
not consume that execution budget; failed preparation keeps the gate closed. The
existing progress watchdog continues to bound stalled preparation.
Terminal-result save failures remain visible as
`persistence_failed`; the supervisor retries the known result at most once per
second per retained job, measured from completion of the previous attempt so a
slow failed save cannot leave the next retry already overdue. Commands are never
rerun. Restarted workers report saved outcomes
and refuse to replay starts. Logs are in-memory only. Cancellation of a saved,
previous-worker job is deliberately refused on these older kernels: process-group
ownership cannot be established atomically from a saved PID. Unknown records
require inspection, rather than being treated as safe to forget.

`helper.prepare/release` copies a digest-checked source from the experiment file
scope into an exclusively owned `/opt/couchroot-agent/native-helpers` directory,
sets Smack `User`, and creates a read-only, nosuid/nodev bind view. The native worker
unshares its mount namespace before starting threads. It owns at most eight views;
release is refused while any of its jobs are active. A separate native guardian kills/reaps remaining descendants before unmounting
helpers and its independently staged launcher. Failed unmounts retain their backing files.
After descendants are drained, metadata-save failures no longer skip execution-view
and cgroup cleanup: each cleanup is attempted, and the journal remains for a later
metadata reconciliation.
Worker SIGKILL/crashes are recovered by that guardian. Guardian loss terminates
its traced descendants; the next launch can reconcile a same-boot ownership journal
with durable resource bindings before starting a new worker. Ambiguous state remains blocked. There is no durable log recovery. The
controller and deployed .NET worker retain their original namespace.

Native-only capability entry remains unqualified: acquisition and recovery still
retain a small .NET entry bridge. The broader production file policy and offline
managed-record migration are opt-in, as described in [PARITY.md](PARITY.md). Legacy READFILE/WRITEFILE frames remain omitted: neither the
current HTTPS API, enrolled client nor loopback service exposes them. JSON
`file.write` is supported on the worker protocol for older service compatibility,
using canonical base64 and the same 1 MiB chunk, digest, offset and commit checks
as binary uploads. JSON and binary chunks can share a transfer. The current
HTTPS API continues to require binary upload bodies. Unsupported
operations fail explicitly; there is no automatic fallback or replay. The build also produces the existing native `app-launcher` source as a separate
binary. The worker accepts its source path inside the canonical file scope and an
expected SHA-256; it validates ARM ELF32, stages a private root-only copy, applies
Smack and a read-only bind mount, and verifies the staged digest before use. It no
longer accepts a borrowed .NET execution view. Standalone comparisons borrow their
initial root context and transport from the deployed agent; they do not establish
native-only service startup. The worker defaults to a five-minute experiment lifetime. An explicit
`COUCHROOT_NATIVE_LIFETIME_SECONDS` value from 300 to 86400 permits longer bounded
experiments; jobs cannot outlive that worker. The explicit `--production` option
enables production file policy and removes both worker and guardian lifetime
alarms. It rejects `COUCHROOT_NATIVE_LIFETIME_SECONDS` rather than silently
ignoring it. Status reports `lifetime_mode=production` and `lifetime_seconds=0`
(no expiry). The signed candidate and explicit native service selection use this mode.
The `--production-files` option alone keeps the bounded experiment lifetime. Disconnect,
SIGTERM and graceful shutdown clean up owned active jobs and helper views.

Startup requires 32 free descriptor slots before optional-library loading, token
consumption or scope changes. The scan counts holes below the soft limit without
opening files. Startup and the single-threaded guardian guard their explicit
descriptor allocations; the ready worker uses its existing operation admission
and monitor reserve. The admission check cannot protect the ELF loader before
`main`, or make allocation atomic against an external concurrent limit change.

The worker executable starts a small guardian before the protocol worker and its
threads. The guardian is a Linux child subreaper and holds the scope lock, runtime
mount namespace and durable ownership journal. After a worker dies, it kills and
reaps its actual children, including adopted detached descendants, before changing
its own nonterminal job records to `interrupted` and deleting owned execution views.
It never signals a PID from a saved job file. Completed records remain unchanged;
crash records have an unknown exit code and unavailable in-memory output. A new
worker invocation reads those records and refuses duplicate starts. It does not
automatically restart or replay commands. The protocol worker is non-dumpable.
Once tracing is active, fatal guardian errors bypass generic runtime exit cleanup:
`EXITKILL` stops owned tasks and the journal remains for verified takeover. Only
the normal guardian path drains descendants and explicitly retires resources.
This also preserves the ownership proof when task-identity inspection fails with
descriptors still available, such as an allocation failure.
Before allowing that child to create threads, the guardian attaches with
`PTRACE_SEIZE` and follows clone, fork, vfork and exec events with
`PTRACE_O_EXITKILL`. This covers the owned worker, command descendants and their
threads. SIGSEGV, SIGBUS, SIGILL, SIGFPE and SIGABRT delivery stops terminate the
faulting thread group before the TV's default crash collector. A command fault
does not kill the healthy worker: its parent receives the actual SIGKILL exit
status, 137. Native status exposes `command_fault_policy` and a bounded
`command_faults` history of the latest 64 events: sequence, process/thread IDs,
original signal and signal code, actual termination signal, action and monotonic
time. The guardian writes a small shared-memory ring; the worker and its children
have read-only mappings. Overwrites, concurrent snapshot omissions and counter
saturation are explicit. These are session diagnostics, not durable per-job
metadata, and reset when a new worker starts. PIDs in these historical events
must never be used as authority to signal a process. Supervision intentionally
prevents handlers for these signals from running in commands; software that uses them for its own recovery
needs a separate compatibility decision before production adoption. The original signal is saved separately as
`worker_fault_signal`; interrupted jobs still have an unknown exit code. Normal
signals are forwarded, group stops remain stopped for the heartbeat watchdog,
and unavailable tracing fails startup closed. No process is selected from a
saved PID, and no system-wide crash setting is changed. See the Linux
[ptrace interface](https://man7.org/linux/man-pages/man2/ptrace.2.html) for the
signal-delivery and clone-stop semantics used here.

The guardian also uses a heartbeat watchdog and an isolated freezer cgroup for
an unresponsive worker. The controller waits for recovery and does not force-kill
a guardian merely because its wait expires. The pulse thread also checks separate
30-second progress leases for an active protocol request and the job monitor.
Foreground command polling refreshes the request lease; waiting for a new protocol
frame is idle. Bounded experiments retain their socket/lifetime limits. Production
mode waits indefinitely for the first byte of a request, then applies the active
progress lease; individual socket reads/writes and the initial handshake have a
30-second timeout. Buffered frames are processed without another socket wait.
If an external zero descriptor limit makes `poll(nfds=1)` return `EINVAL`, idle
waiting peeks the existing socket with its receive timeout temporarily disabled.
It restores the active-frame timeout before parsing, consumes no byte and opens
no descriptor. Restoring the limit concurrently does not invalidate that wait.
Completed storage reads, writes, digest blocks and flushes refresh the request
lease. Hashing, transfer I/O and helper/launcher copies can therefore exceed the
grace while making progress. EOF, failures and interrupted calls do not refresh
it; a blocked syscall remains subject to the grace. Hashing is bounded by the
initial regular-file size and refuses a size change, so a growing file cannot
extend it indefinitely. Same-size concurrent writes still require external
writers to be quiesced. Wire parsing does not use storage progress notifications. The job monitor wakes
periodically even with an empty queue. A stalled lease triggers the same isolated
cleanup, recording `active-request-stalled` or `job-monitor-stalled`; a missing
pulse records `heartbeat-lost`. This does not supervise a stalled guardian.

Each native run exclusively creates `/sys/fs/cgroup/freezer/couchroot-native-ID`.
Only the protocol worker joins it before spawning threads or commands; its root
and app descendants inherit membership. The guardian and deployed .NET processes
stay outside. A dedicated worker thread sends a heartbeat every 100 ms. After a
one-second heartbeat gap, the guardian freezes only that group, waits until its
members cannot fork, and queues SIGKILL to every member. Before waiting for full
freezing, it kills its own unreaped protocol child and moves that dying process
back to the parent freezer group; this avoids a multithreaded exit deadlock on
older kernels. Descendants stay in the private leaf. It then thaws the group
so older kernels can finish process exit. Once the worker exits, the guardian proves child
ownership with `waitid(..., WNOWAIT)` before killing/reaping adopted descendants.
It removes the empty cgroup along with owned runtime views. It never changes the
state of an existing system cgroup. Host tests bypass unavailable freezer support;
actual membership, freezing and removal are exercised by the TV acceptance suite.

Failure to finish recovery retains the ownership journal. The next launch retries
only when its ownership checks permit it. Storage corruption, unbound partial resource creation,
legacy or different-boot journals and uninterruptible processes remain
fail-closed/manual-inspection cases. This prototype does not
replace the deployed service's root acquisition, enrollment or restart machinery.

`accept.c` exercises the native job/helper lifecycle on the TV via a private
loopback controller. It checks an over-25-second job, simultaneous foreground and
background execution, app-user helper execution, read-only mounts, output limits,
cancellation, retention, disconnect cleanup and saved status after a native restart.
These checks do not restart the production worker or TV. Set
`COUCHROOT_NATIVE_SOAK_SECONDS` to 60..3600 for an additional bounded run. It
repeatedly uploads/stages/releases a helper, runs root and app jobs, verifies app
identity, forgets records and checks stable worker/guardian descriptor counts,
worker thread counts and mount counts. It reports RSS ranges as observations,
not a full PSS/swap or CPU comparison. The controller grants the worker an explicit
soak-duration-plus-300-second lifetime and keeps its own deadline bounded.

`bench.c` runs on the TV as an authenticated root job. It alternates freshly
executed copies of the installed .NET DLL and the C worker on independent loopback
connections, with two warmup pairs. It measures fork-to-authenticated-status
readiness, worker CPU from `/proc/PID/stat`, memory from `smaps`, and peak RSS from
`wait4`. Transfer timings exclude begin/open but include chunk I/O and upload
commit. Every transfer is verified byte-for-byte and by SHA-256. It also exercises
root failures/timeouts, app identity/environment/quoting, ranges/EOF, offset rejection
and conditional replacement. Neither HTTP nor the deployed service's request
queue is in this benchmark path. The existing fallback and controller remain alive,
so PSS depends on their shared mappings. Idle CPU uses one-second windows and the
kernel clock-tick resolution. Warm-cache worker startup is not boot readiness. The updated harness includes
guardian CPU and reports its memory separately; old measurements below predate
the guardian and must not be attributed to the current implementation.

The current benchmark requires native `--production` lifetime and verifies the
owned guardian through authenticated status. It times root/app job admission and
observed completion, verifies the nonzero exit and output, then forgets each job.
Completion includes status polling with a ten-millisecond interval; this is not
an exact kernel exit timestamp. A failed outcome or persistence check retains the
job for inspection and emits no successful sample.

Ready, loaded and settled snapshots include each worker/guardian's descriptor,
thread and mount counts, process RSS high-water mark and per-thread scheduling
counters. Missing optional kernel fields or retired threads are unknown. Context
switches are not wakeup counts, and phase snapshots are not continuous descriptor
peaks. `wait4_peak_rss_kib` is labeled separately: it is the kernel high-water
statistic for the waited child/reaped descendants, not an additive tree total.
Use the separate worker/guardian `smaps` observations for contemporaneous totals.
Full acquisition, HTTPS latency, exact idle wakeups, continuous lifecycle capture
and endurance still require their own integrated measurements.

`tests/native-io/timing.c` is a private diagnostic interposer for attributing job
sync costs. It calls the original `fsync` once, preserves its result/errno, and
emits elapsed time only for the disposable `.jobs` scope. It is not part of the
worker build or signed package. Use only a separately staged, verified read-only
library in the owned diagnostic process tree; do not inject it into the installed
service. Raw paths/PIDs and logs stay private. Its own overhead means the results
are attribution evidence, not replacement ordinary-build performance numbers.
Both-TV observations are recorded in [sync timing results](job-sync-timing-results.json).

Build outside the source checkout with the project's cached ARMv7 soft-float
Bullseye toolchain:

```sh
sh research/autonomous-root/native-worker/build.sh /private/native-worker-build
```

On Linux, compile `worker.c` with `-DNATIVE_WORKER_TEST` only for the host tests,
which substitute the unavailable host Smack label and explicitly disable helper
staging when the real Smack/mount guards cannot run. Link with `-pthread -ldl`. Use address/undefined-behavior
sanitizers and set `NATIVE_WORKER` to that executable when running
`tests/native_worker_test.py`. The normal ARM build never enables this test mode. Guardian tracing tests require
native Linux execution and ptrace permission (for example, `--cap-add SYS_PTRACE`
in a dedicated container); an emulated x86 userspace is not a substitute.
`worker-fault-test` and `accept-fault-test` are separately named builds with
`NATIVE_WORKER_FAULT_TEST`. Only that worker build contains the authenticated
`test.fault` operation, which writes a PROT_NONE page on the main thread or a new
worker thread. That binary also supports isolated helper memory faults and a
`test.stall` operation: it deliberately stops a selected progress path and ages
its lease beyond the grace while leaving the pulse thread alive. Thus the test
checks stale-progress detection and cleanup without waiting 30 seconds each time.
The acceptance soak separately checks a healthy 32-second foreground command.
Do not use this fault-injection build as a production worker.
Tests cover authentication, replay, corrupted/truncated transfers, bounds, path
and symlink rejection, conditional replacement, bounded output and timeouts.
Job tests also cover duplicate intents, cursor truncation, retention, signal and
disconnect cleanup, and saved-record handling.

Device execution must use the enrolled .NET client's existing verified upload,
helper and job APIs with firmware guards, per-device locks, durable private
intent/results, unique staging names and a bounded run. Prepare the controller and worker as private read-only helpers. Upload the freshly
built launcher as a regular file inside the native file scope; do not supply the
deployed launcher path. Use a token/status directory below the SDK staging root so the existing managed
worker can run unchanged. Set `COUCHROOT_BENCH_FILES` to a separate canonical,
private directory below `/opt/couchroot-agent/files` for both workers’ transfers.
The SDK staging path may have symlinked ancestors on the TV; it is not suitable
for the native prototype’s strict canonical file scope. Pass the actual
installed DLL for that device and the new launcher source/digest, never another
model's runtime paths.
Inspect results before releasing helper views and deleting only owned experiment
files. Preserve credentials, raw measurements and signed artifacts outside Git.

## Guardian loss and stale journals

The guardian alone holds the scope lock. Before releasing its traced worker it
persists a schema-4 journal with namespace, runtime-reserved, runtime,
freezer-reserved, contained and ready phases.
Each checkpoint binds the boot, scope and mount namespace, plus runtime and
freezer inodes as those resources are created. Before each resource is created,
a reservation binds its parent and generated worker-specific name. An unbound
runtime reservation must be empty; an unbound freezer reservation must have no
processes or tasks and is never thawed. Populated, busy or mismatched reservations
remain blocked. Runtime ownership is persisted before launcher content is copied.
Empty managed helper parents are removed only after their named inode matches the
opened directory; nonempty shared parents are left alone.

The initial journal is written to `guardian.initial`, synced, renamed and directory
synced before any runtime resources can be created. An abandoned initial temporary
can be removed under the scope lock only when neither a published nor successor
journal exists and its ownership, type, links, mode and size are valid. Conflicting
or unsafe initial files remain blocked. Updates also use atomic rename and directory fsync.
A complete `guardian.next` can recover an interrupted rename only when it advances
the same owner's phase by exactly one step and preserves all existing identity
and inode bindings. Foreign or non-advancing complete temporaries block startup. A truncated update
can be discarded only after the committed base independently proves resource
cleanup through its bindings and empty-only reservations. Schema-3 contained
checkpoints have sufficient bindings for this too; ambiguous older checkpoints
and a temporary after ready remain blocked. Fully prepared schema-2 journals and
supported schema-3 checkpoints remain readable.

An interrupted launcher copy or mount can be swept using the durable runtime
binding after its old execution views disappear. Resource-creation-before-binding
windows now have empty-only reservations. A malformed published journal still
requires inspection, and cross-boot recovery remains unqualified. Ordinary
journal-write errors clean only this startup's owned temporary after owned runtime
cleanup succeeds; abrupt exits leave recoverable checkpoints. Startup fault injection exists
only in the separate fault-test binary; the ordinary binary ignores its test
environment variable.

On a later launch, reconciliation runs under the exclusive scope lock in a
bounded child process, before staging a new launcher or accepting commands. It
refuses a still-present guardian identity, mismatched directory/device bindings,
legacy/different-boot journals, symlinks, hard-linked or permissive journals,
unexpected mounts, inaccessible namespace evidence and retained namespace pins.
Saved PIDs are inspected only: reconciliation never signals them. Namespace inode
numbers can be reused on these kernels. If a live process has the saved number,
recovery checks its mount table for the old worker's owned execution views before
treating it as a retained old namespace. Both mount roots and targets are checked,
including moved bind views. Descriptor-only matches, unclassifiable pins and
unreadable evidence remain conservative refusals. No unrelated process is signaled
or moved into another namespace.

Guardian death applies `PTRACE_O_EXITKILL` to the worker and its traced descendants.
If the guardian died while its private group was frozen, recovery thaws only the
journal-bound cgroup so pending kills can finish on older kernels. It waits for
both process and task membership to empty, then checks process namespace handles,
open namespace descriptors and namespace bind mounts before removing backing
files. It never enters or detaches a retained namespace. The scan is bounded to
256 distinct visible mount namespaces and recovery sets a 15-second alarm.
Older nsfs mount metadata can omit a namespace identity; those ambiguous pins
block reconciliation conservatively. Compare the upstream
[Linux 4.1 nsfs implementation](https://github.com/torvalds/linux/blob/v4.1/fs/nsfs.c)
with [Linux 4.9's namespace mount-path reporting](https://github.com/torvalds/linux/blob/v4.9/fs/nsfs.c).

Once absence and ownership are established, recovery marks only that worker's
nonterminal jobs `interrupted`, with unknown exit codes and
`recovery: stale-guardian-reconciled`. Completed results and foreign records stay
unchanged. Strictly recognized owned runtime files and the empty cgroup are
removed before deleting the journal. Missing resources permit an interrupted
cleanup to resume; mismatched existing resources do not. A new native worker then
stages its own launcher and reports `stale_guardian_reconciled: true`. Duplicate
job IDs still cannot replay commands. This is recovery on the next explicit
launch, not a new service restart mechanism or a replacement for .NET.

## Storage-failure and namespace-reuse validation — 2026-10-13

The worker in `f9ae182` passed 43 distinct extended checks (47 rows) on each TV.
A private 2 MiB tmpfs reached actual ENOSPC without filling TV storage. Failed
initial intents neither published partial records nor released a command. A job
that completed while full exposed `persistence_failed`, then persisted its original
exit code after space returned; an external execution counter remained exactly
one. A read-only remount of only this test filesystem rejected a new job; restored
writes permitted fresh app-user execution. A worker crash while full removed its
runtime views, retained the journal and reconciled interrupted jobs after space
returned. Final verification confirmed no prototype freezer groups remained.
The immediate freezer-absence assertion was subsequently tightened to use its
absolute cgroup path; its additional validation is part of the pending endurance run.

An earlier QN90A run observed a saved namespace inode reused by a newer Samsung
framework process. Its mount table had no owned native execution views. Corrected
reconciliation recovered the old resources while preserving that unrelated process.
The suite also simulates this case on both TVs and retains its namespace descriptor
and bind-pin refusal tests. Earlier fixture failures and their verified cleanup
are recorded in [storage-recovery-results.json](storage-recovery-results.json).

All 35 native host tests passed under AddressSanitizer and
UndefinedBehaviorSanitizer on Linux ARM64; the repository suite passed 226 tests
with 35 native tests skipped by that runner. The final TV runs exited zero, showed
no observed crash-collector waits or worker executable dumps, and passed original
.NET worker, boot, protected-file, mount and cgroup preservation checks. No TV was
rebooted. The subsequent one-hour exercise completed on both TVs, but S90D failed a
follow-on recovery-latency gate; see the endurance observation below. Production integration and the other remaining work below
remain open.

## One-hour endurance observation — 2026-10-13

The storage-qualified `f9ae182` worker completed one hour of repeated root/app
jobs and helper staging/release on both TVs. QN90A completed 341 cycles in
3,608,304 ms; S90D completed 340 cycles in 3,600,799 ms. Every cycle preserved
worker/guardian descriptor counts, worker thread count and mount count. Worker
RSS ranged from 824–916 KiB on QN90A and 868–916 KiB on S90D. These are observations
of this build, not a leak-proof claim or measurements of later revisions.

QN90A also passed the entire subsequent extended suite, including the strengthened
absolute-path assertion for immediate freezer cleanup. S90D's follow-on stopped
worker recovered in **2,188 ms**, exceeding the unchanged **2,000 ms** acceptance
limit. It exited and drained descendants, but the controller stopped at that
failed gate, so later checks did not run. The complete combined suite is therefore
**not qualified on both TVs**. Additional heartbeat/freezer/exit/resource timing
is being collected before deciding whether code or the latency contract needs to
change; the limit has not been relaxed.

Both fixtures are fully cleaned. S90D's interrupted record was retained privately;
only its known, hash-verified files were removed after confirming absent native
runtime/freezer resources and acquiring the scope lock. Final checks preserved
both original .NET worker identities, boot IDs, protected file hashes, launcher
hashes, execution mounts and cgroup memberships. Neither observed kernel window
contained crash-collector waits or worker executable dumps. No TV was rebooted.
[Sanitized evidence](endurance-results.json) records both the successful exercise
and the failed S90D gate. Later startup/orphan-intent checks and focused
diagnostic/JSON checks passed separately on both TVs; they do not extend this
one-hour result to the newer revision.

## Startup-checkpoint validation — 2026-10-13

Revision `1f5d770` passed 38 distinct extended acceptance checks (42 rows) on
both QN90A and S90D. Eleven new scenarios exit abruptly before opening a command
channel: namespace and runtime checkpoints; empty, first-write and fully copied
launcher files; staged launcher; contained and ready checkpoints; and each of the
three complete journal updates before rename. The next launch recovered each
case, removed the old runtime/freezer resources and successfully ran an app-user
job. The ordinary build excludes the startup fault-control environment variable.

All 34 native host tests passed under AddressSanitizer and
UndefinedBehaviorSanitizer on Linux ARM64, including schema-2 compatibility and
rejection of mismatched successor identities and bindings. The repository suite
passed 226 tests with 34 native tests skipped by that runner. The native source
manifest matches the on-TV builds. Both observed kernel windows had zero
crash-collector wait or worker executable dump lines. Final cleanup verified the
original .NET workers, boot identities, protected files, mounts and cgroup
memberships unchanged, with all owned test resources removed. Neither TV was
rebooted. Sanitized evidence is in
[startup-recovery-results.json](startup-recovery-results.json).

This covers durable checkpoints and complete interrupted journal updates.
Creation-before-binding windows and truncated journals still require inspection;
production integration, storage-failure qualification, longer endurance runs,
compatibility decisions and updated whole-process performance measurements remain
open. Cross-boot testing remains deferred under the no-reboot constraint.

## Guardian-loss validation — 2026-10-13

The worker and acceptance harness from `5a4f69c` passed on QN90A and S90D.
Each TV completed the normal suite with 22 distinct checks (25 result rows) and
the extended memory-fault/progress-watchdog suite with 27 distinct checks
(31 result rows), all passing with exit code zero. Repeated rows exercise both
running and frozen guardian-loss scenarios. Sanitized build hashes, check names
and cleanup evidence are in [guardian-loss-results.json](guardian-loss-results.json).

The controller killed its own guardian child while root and app jobs were active,
including a detached delayed writer. EXITKILL prevented that writer from running;
the next launch reconciled interrupted records without replay and preserved the
completed exit-7 record. The frozen case verified that thawing the bound private
freezer lets pending kills finish. Fresh app-user execution then succeeded.

Recovery refused retained namespace descriptors and namespace bind mounts,
wrong schema, unprepared state, different boot, mismatched scope/runtime/freezer
bindings and a still-live owner identity. A simulated reused PID referenced the
live controller with a different process start time: reconciliation succeeded
without signaling it. Host tests additionally cover unsafe journal permissions,
hard links, symlinks, a leftover temporary journal, completed/foreign record
preservation and retry after interrupted resource cleanup.

All 31 native host tests passed under AddressSanitizer and
UndefinedBehaviorSanitizer on Linux ARM64. The repository suite passed 226 tests
with those 31 native tests skipped by its ordinary runner. Neither device's
observed kernel window contained a crash-collector wait or worker executable dump.
Both final cleanup checks verified unchanged deployed .NET worker/PID, boot,
launcher/protected-file hashes, original execution mounts and cgroup membership;
owned test files, helpers and prototype freezer groups were removed. No TV was
rebooted, and no installed package, enrollment, SDK or boot configuration changed.

These tests qualify fully prepared, same-boot schema-2 reconciliation only.
Recovery requires a subsequent explicit launch; production restart integration,
partial-preparation and cross-boot recovery remain open. This is not a new CPU,
memory or startup comparison, and .NET remains the deployed implementation.

## Descendant faults, progress watchdogs and soak — 2026-10-13

Revision `76a9649` passed **17 normal acceptance checks and 23 distinct extended
checks on each TV**, including a ten-minute soak. All controller exits were zero.
[progress-results.json](progress-results.json) records the build hashes, individual
recovery observations, soak measurements and final invariants. Local validation
passed 226 repository tests plus 27 native tests under address/undefined-behavior
sanitizers on native ARM64 Linux.

Root and app shell faults returned actual exit 137 while the worker remained
responsive. Independently staged helpers deliberately faulted both their main
thread and a newly created thread under root and UID 5001 / Smack `User` profiles.
Every helper fault completed within the two-second acceptance bound; their native
views released normally. Original signal details remain diagnostic output rather
than per-job metadata.

The extended suite stopped active-request and job-monitor progress independently
while the heartbeat thread remained alive. It checked the saved watchdog reason,
interrupted records with unknown exit codes, descendant containment, normal mount
cleanup, duplicate-start rejection and app execution after a fresh native launch.
These tests deliberately age a lease beyond its 30-second grace: their 142–214 ms
observations measure detection/cleanup after expiry, not the production grace.
A healthy 32-second foreground command completed on both TVs without a watchdog
termination; idle protocol connections also remained usable.

| Ten-minute soak observation | QN90A | S90D |
| --- | ---: | ---: |
| Elapsed workload loop | 605.4 s | 601.1 s |
| Transfer/stage/job/release cycles | 57 | 57 |
| Worker RSS range | 860–916 KiB | 892–1,064 KiB |
| Maximum observed guardian RSS | 1,092 KiB | 1,152 KiB |
| Worker threads | 3, stable | 3, stable |

Worker and guardian descriptor counts and worker mount counts remained stable.
Each cycle verified app identity, completed root/app jobs, forgot their records
and released its helper normally. These are bounded workload observations, not
proof against all leaks or a fresh PSS/swap/CPU comparison with .NET.

Both the normal and extended suites cleaned up through the regular helper APIs;
no lazy unmount or detach/rebind repair was needed. Captured kernel windows had
no crash-collector messages. All experiment files, jobs, native runtime views and
private freezer groups were removed. The original .NET process/worker and boot
identities, launcher hashes, protected files, cgroup membership and execution
mount sets were unchanged. Neither TV was rebooted; .NET remains deployed.

## Descriptor-abort diagnosis and focused validation — 2026-10-13

Both earlier failing device logs show Samsung's kernel file-open checker reporting
exhaustion and forcing SIGABRT. A focused QN90A reproduction localized it to the
second launch-pipe allocation. Calling `SYS_pipe2` directly produced the same
kernel abort, ruling out the libc wrapper as a sufficient workaround.

Revision `4e40d47` checks descriptor capacity with a bounded `fcntl(F_GETFD)` scan
under the job mutex. It requires a free slot before retention/intent operations
and six before allocating the output pipes and launch gate. This check allocates
no descriptors. When an intent has already been published, rejection preserves
it, prevents reuse and allows restart reconciliation without command replay.
The mutex excludes the job monitor's record opens; the heartbeat opens no files.
This fixes job-start admission under the tested limits, not every worker operation
or a concurrent external limit change. No kernel setting or signal policy changed.

Set `COUCHROOT_NATIVE_RESOURCE_ONLY=1` on the acceptance controller for the
focused five-check run. QN90A and S90D both exited zero: saved-record capacity and
app-user recovery, descriptor rejection and intent reconciliation, 70 command
faults with bounded history/reset, mixed JSON/binary uploads and final cleanup.
The descriptor probe leaves three free slots below the native child's limit;
the controller, guardian and deployed .NET fallback keep their original limits.
Neither final kernel window contained a file-open-checker event, crash-collector
wait or worker executable dump. Both original .NET process/worker identities,
boot IDs, launcher/protected-file hashes, mounts and cgroups were preserved.
All temporary helpers, jobs and files were removed. Neither TV was rebooted.

All 47 native tests passed under ASAN/UBSAN, including sparse inherited descriptors,
zero/one/three/five free slots, unchanged descriptor sets after rejection, no
command execution and restart reconciliation. The repository runner passed 226
tests and skipped those 47 native tests. See
[focused validation evidence](descriptor-recovery-results.json). The earlier
[failure evidence](resource-failure-results.json) remains as a historical record.

For ordinary production-binary qualification, use the separate controller mode
`COUCHROOT_NATIVE_PRODUCTION_RESOURCES=1`. It requires `--production` status,
verifies refusal at 31 free startup slots, admits each launch with 32, and tests
guardian exhaustion during graceful shutdown and supervised fault handling.
Both cases retain the journal for ordinary takeover without command replay.
It also tests zero-descriptor idle/partial-frame deadlines and full/read-only storage
recovery, then runs descriptor admission, retained-intent reconciliation, fault
diagnostics and mixed uploads. It rejects other experiment modes before creating
state. Only the controller-owned worker's limit and private storage are changed;
the controller's 240-second alarm bounds the run. This is a controller option,
not a production worker fault interface.

`COUCHROOT_NATIVE_LAUNCH_PRESSURE=1` selects a separate bounded production
controller round. It limits only its authenticated worker's `RLIMIT_AS` to the
current virtual mapping size, verifies memory refusal without command execution,
then restores the original limit. A live job and a saved result survive; a fresh
app job succeeds and ordinary restart reconciles the refused intent without
replay. It uses the same 32-slot startup budget and 240-second controller alarm,
and refuses combined experiment modes. Both TVs passed this round on unchanged
0.7.41 worker bytes; allocation-site and fork failure injection remain local-only
tests. See [launch-pressure evidence](launch-pressure-results.json).

## Event-driven waits and lifecycle cleanup — 2026-10-13

Revision `43ec7bc` replaces fixed polling passes without changing the protocol,
job records, helper lifecycle or recovery semantics. The guardian previously
slept 10 ms between passes. Every traced fork, clone, exec and signal-delivery
stop of a command therefore waited for the next pass. It now blocks in `ppoll`
on the heartbeat pipe, with SIGCHLD and lifecycle signals unblocked only inside
that wait. Timed wakes come from the heartbeat and stop deadlines. Containment
and forced stop keep the former 10 ms pass. The job monitor polls retained job
pipes plus an eventfd signaled by start, cancel and shutdown. Active jobs are
still rechecked every 100 ms, because descendants can hold a leader's pipes.
Continuous output keeps the former 10 ms batching, and an idle queue wakes once
per second for its progress lease. Foreground commands wait for output, EOF or
their deadline.

The descriptor-capacity checks from `4e40d47` and their order are unchanged.
The eventfd is a permanent startup descriptor; the acceptance fixture counts it
from the live descriptor table. Failures after a published intent now name
descriptors, memory or launch. Every such path still closes only the descriptors
it allocated and keeps the ID unreplayable. A new host test checks unchanged
worker and guardian descriptor sets across completed, drained, timed-out and
cancelled jobs. Group kills, wait-status decoding, directory scans, saved-record
reads, job slot release and signal-masked thread starts now share one
implementation each.

Before/after probes alternated the `6aebc0a` worker bytes with this build as a
root job on each TV; host figures use five fresh workers per build.

| Median | Host | QN90A | S90D |
| --- | ---: | ---: | ---: |
| Foreground cost per spawned process | 50.9 → 0.25 ms | 40.9 → 3.4 ms | 40.8 → 3.1 ms |
| Idle guardian context switches/s | 79 → 9.6 | 99 → 10 | 100 → 10 |
| Idle worker context switches/s | 26 → 10.8 | 28 → 11 | 29 → 12 |
| Worker switches/s, quiet foreground command | 107 → 13 | 128 → 15 | 130 → 15 |
| Worker switches/s, quiet background job | 94 → 36 | 124 → 56 | 150 → 66 |
| Exit-0 job, start response to visible exit | — | 45.7 → 29.5 ms | 45.1 → 33.0 ms |

Job-start responses remained bound by durable writes, at roughly 45–54 ms median.
Both builds showed occasional storage stalls above one second on both TVs. In
60 jobs per build per TV, the stall counts were similar, so these tails are not
attributed to either build. Guardian wakeups are now bounded by the 10 Hz
heartbeat itself.

The complete extended suite passed on **both TVs**, with 74 distinct checks
(78 rows) and zero controller exit codes. It covered startup checkpoints,
guardian loss, storage failure, orphan intents, descriptor exhaustion, command
and helper faults, and both progress watchdogs. Every gated worker-fault
recovery stayed within the unchanged two-second limit. The stopped-worker
watchdog recovered in 1,131 ms on QN90A and 1,206 ms on S90D. This was not a
repeat of the one-hour exercise, so S90D's earlier 2,188 ms post-endurance
result is not closed. The retained kernel logs contained no collector waits,
worker dumps or file-open-checker events. Samsung's verbose kernel logging wraps
the ring buffer within minutes, so they covered only the last 324 s on QN90A
and 229 s on S90D, not the whole run. Final checks preserved both original .NET
process/worker identities, boot IDs, launcher and protected-file hashes, mounts
and cgroups. All temporary helpers, jobs and files were removed. Neither TV was
rebooted. Local validation passed 48 native tests under ASAN/UBSAN in three
runs. The repository runner passed 274 tests, skipping the 48 native tests.
See [cleanup-results.json](cleanup-results.json).

## Descriptor admission for every protocol allocation — 2026-10-14

Revision `f9e6d0c` extends the `4e40d47` capacity check beyond job start. Before
allocating, each protocol-thread operation checks its peak descriptor use. It
also keeps one slot in reserve for the job monitor, which opens at most one
record at a time. The check runs under the job mutex, which excludes those
record writes.

| Operation | Peak descriptors |
| --- | ---: |
| Legacy `EXEC`, `app.exec` | 5 (two pipes and the child's `/dev/null`) |
| `helper.prepare` | 3 (source, directory, target) |
| `file.begin`, `file.open`, `file.commit`, `helper.release`, saved job read | 1 |
| `status` | 0 |

Rejected operations return a structured failure and allocate nothing. A legacy
`EXEC` frame has no failure result. The worker therefore ends the session
without running the command, as the managed worker does when it cannot start a
process. `status` reads `CLOCK_BOOTTIME`, the clock behind `/proc/uptime`, to
centisecond precision, so it works with no descriptor free. External limit
changes during an operation, system-wide `ENFILE` and the guardian's own
descriptors remain outside this admission.

Host tests and the TV resource fixture run each operation one slot short of
admission and again at the threshold. On these kernels, an undercounted
allocation at the threshold would abort the worker. The focused resource suite
passed on both TVs, including `operation_descriptor_admission_without_abort`.
Each worker logged exactly one session-ending legacy `EXEC` rejection. Locally,
49 native tests passed under ASAN/UBSAN. The repository runner passed 274 tests
and skipped those 49.

The repeated one-hour endurance run passed on **QN90A**. It ran 347
root/app/helper cycles in 3,606 s with stable descriptors, threads and mounts.
Worker RSS was 764–952 KiB; guardian RSS peaked at 1,124 KiB. The extended
suite that followed passed 76 distinct checks. Stopped-worker recovery took
1,069 ms, and every gated fault recovered in at most 204 ms. QN90A's retained
kernel log had no collector waits, worker dumps or file-open-checker events.
The ring buffer had wrapped, so it covered only the final 334 s, which was the
extended suite. Final
checks preserved its .NET worker, PID, boot, mounts, cgroups and protected
files, and all test resources were removed.

**S90D's first attempt was interrupted by a TV power-off.** About 16 minutes
into the soak, S90D logged a power-off request. It stayed in standby, then
entered deep suspend about 36 minutes in. After it resumed, the root-agent
service re-acquired a new .NET worker, which ended the managed job and its
in-memory output. All 213 rows recorded before the suspend had passed. The
native guardian completed recovery: no native processes, runtime views, freezer
group or guardian journal remained. The stale helper views and experiment files
were removed after hash and mount checks. At the owner's request, the stale
same-boot .NET job record was removed after confirming its process was gone.

**The S90D rerun passed** while the TV stayed on. It ran 344 cycles in 3,610 s
with stable descriptors, threads and mounts. Worker RSS was 776–948 KiB;
guardian RSS peaked at 1,124 KiB. The extended suite passed 76 distinct checks.
Stopped-worker recovery took 1,031 ms; the earlier 2,188 ms post-endurance
result was not reproduced. The slowest gated recovery was a main-thread memory
fault at 909 ms. Of that, 343 ms was post-exit record, runtime and cgroup
cleanup, matching the storage stalls seen in both builds. The retained kernel
log covered the final 353 s and had no collector waits, worker dumps,
file-open-checker events or suspend. Kernel log time does not advance during
suspend, so the window start was corrected for the earlier suspend. Final checks
preserved S90D's current .NET worker, PID, boot, launcher, mounts, cgroups and
protected files. Neither TV was rebooted. See [admission-results.json](admission-results.json).

## Remaining production work

The first migration implementation adds an opt-in production file policy,
offline managed-job import/rollback snapshots, and differential tests. See
[phase-one behavior and validation](PARITY.md). The installed service still
selects .NET; the default experiment mode retains its narrow file scope.

The [native agent parity and .NET retirement plan](MIGRATION.md) maps the
remaining contracts, managed dependencies, implementation order, rollback and
release gates. It distinguishes a native worker default from a fully native
agent installation and recovery path.

- Capture kernel logs continuously during device runs. The ring buffer keeps
  only a few minutes, so endurance windows observed just the final extended
  suite. Both TVs passed the one-hour endurance run at `f9e6d0c`. Stopped-worker
  recovery took 1,069 ms on QN90A and 1,031 ms on S90D; S90D's earlier 2,188 ms
  was not reproduced and remains unexplained. Cross-boot, reboot and power-loss
  recovery remain unqualified.
- Integrate acquisition, enrollment, service selection and rollback through the
  existing production machinery; the experiment still borrows those services.
- Extend resource-exhaustion qualification beyond protocol descriptor
  admission, storage failures and longer runs: external limit changes,
  system-wide `ENFILE` and guardian descriptors. Preserve bounded in-memory output as the public
  contract, matching .NET; durable output is not required for parity. Job outcomes
  remain durable metadata and must recover after transient failures.
- Decide command signal-handler compatibility. The strict policy is explicit in
  status. Original command-fault diagnostics are separate from actual termination
  status and now pass the focused device checks on both TVs.
- Integrate the opt-in production file policy and verified retained-record
  snapshots with service selection and rollback, then repeat whole-process
  CPU/memory/startup comparisons. Legacy READFILE/WRITEFILE frames
  are outside the current public replacement contract. Worker-protocol JSON
  uploads now pass host and focused device checks. Guardian, job-monitor and
  foreground wait wakeups are now measured; include them in that comparison.

## Historical crash delay and test-mount cleanup fix — 2026-10-13

Revision `6b41b6d` passed the normal **16-group suite and extended 18-group suite
on each TV**. The extended suite deliberately writes an inaccessible memory page
on both the protocol thread and a newly created worker thread. All fault recoveries
finished within the suite's two-second limit, removed detached descendants and
owned execution views, preserved interrupted records without replay, and allowed
app-user execution after restart. Local validation passed 226 repository tests
and 24 native tests under address/undefined-behavior sanitizers on native ARM64 Linux.
[crash-delay-results.json](crash-delay-results.json) retains the build identities,
individual observations and cleanup checks.

| Recovery observation | QN90A | S90D |
| --- | ---: | ---: |
| Previous SIGSEGV path | 20,573 ms | 20,890 ms |
| SIGSEGV, normal build | 192 ms | 101 ms |
| SIGSEGV, extended test build | 172 ms | 874 ms |
| Actual main-thread memory fault | 194 ms | 92 ms |
| Actual new-thread memory fault | 215 ms | 103 ms |

These are individual fault-to-guardian-exit observations, not a latency distribution
or a new CPU/memory benchmark. The higher S90D injected-signal sample is retained;
all real-memory-fault samples were 92–215 ms.

The earlier delay was in Samsung's kernel crash collector: kernel logs repeatedly
reported `Extended-Mincore` waiting for `get_coredump_config` for about 20 seconds.
On **both TVs**, isolated probes showed that installing handlers for SIGSEGV,
SIGABRT, SIGBUS and SIGILL returned success but read back as the default disposition.
SIGUSR1 and SIGFPE handlers installed normally. The same result occurred through
libc and direct `rt_sigaction`, with dumpability both disabled and enabled. Removing
SA_RESETHAND and using SA_SIGINFO did not solve it. The guardian now intercepts
worker faults at the kernel signal-delivery stop; it no longer depends on a fatal
handler running in the damaged worker. It does not change global crash settings.

The original non-traced signal probe also reproduced the busy executable mount.
With supervision, **all helper releases succeeded through the normal .NET API on
both TVs in both suites**, including after real memory faults: no lazy unmount,
detach/rebind or manual mount repair was needed. Captured kernel windows contained
no crash-collector wait messages. Avoiding the vendor crash path eliminated both
symptoms in these controlled runs; the exact retained kernel mount reference was
not identified.

All test files, jobs, helper/launcher views and private freezer groups were removed.
Original .NET worker/process and boot identities, launcher hashes, protected files,
cgroup memberships and execution mount sets were verified unchanged. Neither TV
was rebooted; .NET remained deployed. That revision did not trace forked
command/helper processes or qualify their own fatal-fault behavior. Production
root acquisition and service recovery remain outside the prototype.

## Historical independent launcher and crash recovery validation — 2026-10-13

Revision `d6fe00e` passed **16 acceptance groups on each TV**, with zero controller
exit codes. [recovery-results.json](recovery-results.json) records the sanitized
build hashes, checks, timings and cleanup verification. Local validation passed
226 repository tests and 22 native tests under address/undefined-behavior sanitizers.

Both TVs independently staged the uploaded launcher, enforced its digest and
read-only view, and ran helpers as UID 5001 with Smack `User`. The suite retained
the job/helper lifecycle checks and added SIGKILL, SIGSEGV and stopped-worker
recovery. Detached descendants could not create their delayed marker. Restarted
native workers restaged their own launcher, ran app commands, reported interrupted
jobs without invented exit codes, and rejected duplicate starts without replay.
Root and app commands inherited the private freezer group.

| Worker fault | QN90A recovery | S90D recovery |
| --- | ---: | ---: |
| SIGKILL | 162 ms | 81 ms |
| SIGSEGV | 20,573 ms | 20,890 ms |
| SIGSTOP / heartbeat watchdog | 1,078 ms | 1,024 ms |

These are single acceptance observations, from fault injection through guardian
exit, not performance distributions. Fatal-signal teardown still takes roughly
21 seconds; the watchdog contains descendants during that delay. Earlier attempts
exposed delayed teardown and freezer completion/exit interactions. Those failed
runs were inspected and cleaned before retrying. The final sequence excludes only
the already-killed protocol child from freezer completion, terminates the frozen
descendants, and thaws them so old kernels can finish exit.

Native launcher/helper views and private cgroups were removed by the guardian.
On both TVs the outer test worker's **.NET-managed executable view** remained busy
after the crash tests despite no matching process maps or open descriptors. It
required an inspected, experiment-only detach/rebind before registered release.
That harness cleanup limitation remains unresolved; it is not evidence of fully
automatic production recovery. No deployed launcher view was detached or replaced.

Both original .NET workers stayed active with unchanged process/worker and boot
identities, launcher hashes, cgroup memberships, protected files and execution
mount sets. Owned experiment files, jobs, views and freezer groups were removed.
Neither TV was rebooted. Production integration, guardian loss and power/storage
failure recovery remain outside this validation; keep .NET deployed.

## Historical lifecycle validation before independent staging — 2026-10-13

The extended worker at `ffe97f3` passed **12 acceptance groups on QN90A and S90D**.
Each controller exited zero. [lifecycle-results.json](lifecycle-results.json)
contains the source revision, worker digest and sanitized per-device results.

- A 27-second background job completed while other requests ran and the connection
  sat idle. Duplicate starts and forgetting active jobs were rejected.
- Root and app jobs returned actual exit codes and cursor-based stdout/stderr.
  A 1,200,004-byte output verified ring truncation, the 64 KiB response window,
  retained tail bytes and invalid-cursor rejection.
- Timeout and cancellation killed owned process groups while a foreground command
  was busy. A shell that exited before its descendants retained a waitable PID
  until group cleanup, preventing cancellation from targeting a reused PID.
- Native-prepared unsigned helpers ran with UID/EUID 5001, GID 100 and Smack `User`.
  Wrong digests were rejected, writes to the mounted executable failed even as
  root, and native mounts were absent from the controller's original namespace.
- Helper release, duplicate release rejection and the eight-view retention limit
  passed. Active jobs prevented helper release.
- Disconnect, graceful shutdown and SIGTERM cleaned up active jobs and helper
  views. Fresh native processes read saved terminal/interrupted records, refused
  duplicate starts, and forgot completed records without replaying them.

Local validation passed 226 repository tests plus 16 native tests under address
and undefined-behavior sanitizers. The latter were run explicitly in the Linux
container; normal repository discovery skips them without a native executable.
The real helper lifecycle was validated on the TVs, not simulated by host tests.
Intentional disconnect/signal tests produce the expected transport-closure
message from the prototype; controller success requires the subsequent cleanup
and saved-state checks to pass.

Both original .NET workers stayed ready with unchanged worker IDs, PIDs and boot
IDs. Their launcher hashes, execution mounts and protected-file hashes matched
baseline. All experiment jobs, helper views, sources and owned storage were removed.
Neither TV was rebooted. The initial lifecycle build also passed ten groups on
each TV before the foreground-process hardening and expanded final acceptance run.

This closes the basic job API and native helper-view gaps. It does **not** qualify
full production parity: the five-minute experimental lifetime, in-memory logs,
conservative refusal of previous-worker cancellation, abrupt-crash recovery,
independent launcher staging and autonomous acquisition remain differences.
The .NET worker remains the deployed implementation and fallback. These lifecycle
runs do not update the earlier CPU, memory or startup measurements below.

## Historical comparison before the lifecycle extension — 2026-10-13

The native worker built from `8d8e195` completed eight measured pairs per TV after
two warmup pairs. The follow-up harness `fb5bcc4` used the **identical native worker
bytes**, two measured pairs per TV, a 20-second idle window and three subsequent
transfers per process. The production .NET 0.7.0 worker remained running; temporary
managed workers used that TV's installed DLL. All samples finished successfully.
Aggregate metrics, ranges and sample counts are in [results.json](results.json).
The native worker executable was 37,788 bytes, unstripped, excluding shared libraries.

| Median metric | QN90A .NET | QN90A C | S90D .NET | S90D C |
| --- | ---: | ---: | ---: | ---: |
| Worker readiness | 457.6 ms | 11.1 ms | 748.4 ms | 12.3 ms |
| Worker CPU through readiness | 366 ms | 8 ms | 704 ms | 8 ms |
| Freshly ready RSS | 21.15 MiB | 1.26 MiB | 22.14 MiB | 1.27 MiB |
| Freshly ready PSS | 8.36 MiB | 0.32 MiB | 8.18 MiB | 0.33 MiB |
| Freshly ready private resident memory | 6.19 MiB | 0.31 MiB | 6.94 MiB | 0.32 MiB |
| PSS immediately after initial workload | 9.76 MiB | 0.24 MiB | 11.47 MiB | 0.37 MiB |

PSS apportions shared resident pages; private memory excludes shared mappings.
These freshly ready samples had no swap. They are warm-cache launches and include
app-launcher preparation for .NET, while C verifies and borrows an existing launcher.
**They do not establish a 41–61× improvement in complete service/root acquisition.**
The prototype does less lifecycle work and has fewer capabilities.

The follow-up used 8 MiB + 17-byte files and reports six warmed-up transfers per
implementation per TV after a 20-second pause. These are TV-local protocol costs,
not HTTPS upload/download timings; disk flushing remains enabled.

| Warm transfer median | QN90A .NET | QN90A C | S90D .NET | S90D C |
| --- | ---: | ---: | ---: | ---: |
| Upload worker CPU | 160 ms | 134 ms | 342 ms | 134 ms |
| Upload elapsed | 394 ms | 384 ms | 461 ms | 360 ms |
| Download worker CPU | 58 ms | 56 ms | 70 ms | 50 ms |
| Download elapsed | 84 ms | 87 ms | 89 ms | 83 ms |

Upload CPU fell by about 16% on QN90A and 61% on S90D in this small follow-up;
elapsed upload time fell only about 3% and 22%. Initial transfer medians were even
closer: C uploads were slightly slower on both TVs. CPU measurements include the
worker's hashing, protocol handling, runtime/GC work and kernel time, but exclude
controller and shell-child CPU. They do not isolate cryptographic throughput.

S90D's managed process consumed 420–492 ms of CPU during the first second of the
long idle follow-up, then only 4–8 ms over the remaining 19 seconds. QN90A's .NET
workers used 8–12 ms over those 19 seconds; native workers registered zero clock
ticks. This shows transient activity after the workload, consistent with runtime
warmup/JIT, rather than sustained idle CPU use. CPU accounting resolution was 4 ms.

Both TVs aggressively reclaim/swap idle pages. After 20 seconds, native PSS could
fall to 11–12 KiB while roughly 332–336 KiB was in swap; managed PSS fell to roughly
2.6–3.6 MiB while another 7.0–7.5 MiB was swapped. Reporting resident memory alone
at that point would hide memory commitment. `results.json` retains RSS, PSS,
private resident memory, swap and proportional swap for each measurement stage.

### Capability comparison at the original measured revision

| Capability | Native result on both TVs | Remaining difference |
| --- | --- | --- |
| Authentication/readiness | HMAC handshake and status passed | Existing root acquisition is borrowed; no autonomous acquisition/recovery |
| Root command results | Exit 7, stdout/stderr and process-group timeout passed | Long-lived production supervision remains unqualified |
| App execution | UID 5001, Smack `User`, runtime environment and quoted Unicode passed | Uses the deployed worker's verified native launcher view |
| Binary transfer | 1 MiB chunks, byte/digest verification, ranges, EOF, wrong/replayed offset and conditional replacement passed | Files restricted to one canonical private directory; legacy transfer frames omitted |
| Unsigned helper execution | Existing staged helper ran correctly as the app user | `helper.prepare`/`helper.release` explicitly unsupported; .NET owns those views |
| Background jobs | Explicitly unsupported | No start/status/output/cancel/forget or durable job recovery |
| Packaging/lifecycle | Deliberately absent | No signed production integration, boot readiness or rollback replacement |

The host tests additionally reject bad MACs, replayed sequences, malformed JSON,
symlink/out-of-scope paths, oversized frames and truncated/corrupt uploads; they
check bounded output, offsets and conditional replacement under address and
undefined-behavior sanitizers. They do not establish production-grade C memory
safety or complete .NET error-semantic parity. Arbitrary binary app-command output,
long-duration soak/failure recovery and the wider filesystem policy remain unqualified.

The first two smoke attempts stopped before samples: QN90A exposes
`json_object_is_type` but lacks the usual public `json_object_get_type`, and the SDK
staging directory has symlinked ancestors. The implementation now uses the common
JSON API and separates SDK token staging from canonical transfer storage. Failed
attempts were inspected and cleaned before retrying under fresh experiment IDs.

**Recommendation:** the footprint and startup improvements justify continuing a
native implementation if those costs matter, but this prototype is not a drop-in
replacement. Keep .NET deployed until complete launcher lifecycle, acquisition, recovery,
long-running behavior and failure-path parity are implemented and tested. The
original measurements above predate the new job supervisor and helper management;
they must not be presented as measurements of the extended worker.
The measured steady transfer gains alone do not require switching workers.

No TV was rebooted or had its installed package, SDK host setting, enrollment or
boot configuration changed. Original worker IDs and boot IDs were unchanged at
completion. Helpers, benchmark jobs and owned test files were removed; original
execution mounts and protected-file hashes were verified. Reboot behavior was not
tested. Raw logs, credentials and copied system libraries remain private.

## Ordinary candidate packaging — 2026-10-14

`python3 -m tvsetup.autonomous_root --device DEVICE --native-candidate` adds the
ordinary native worker, independent launcher and `native-manifest.json` to the
existing managed package preparation. Use the existing `--unsigned` option when
only preparing an unsigned package tree. This flag does not install anything or
select the native worker. The package still contains the managed worker and
acquisition payload, and the service continues to launch managed by default.

`tvsetup.native_worker.build` snapshots native C/header/build inputs and builds
worker plus launcher twice in an image pinned by its local immutable image ID,
with networking disabled. The build script's `--worker-only` option excludes
controllers and fault-test executables. It checks matching artifact digests,
ELF32 ARM EABI5, interpreter, dynamic dependencies and GLIBC requirements, and
rejects known test-control markers. The worker ceiling is GLIBC 2.28 and the
launcher ceiling 2.17; actual requirements are recorded in the manifest. Runtime
json-c and crypto alternatives are listed separately from ELF dependencies.

The manifest binds source bytes, toolchain identity and final artifact bytes;
the package's existing digest manifest also covers all three candidate files.
It labels both TV profiles as candidates, sets `device_qualified=false`, and
records managed selection. Preparing a candidate does not establish that device
libraries, source staging, live migration or rollback work. Those remain the
service-selection and device-qualification gates in `MIGRATION.md`.

## Focused handoff observation qualification

`COUCHROOT_NATIVE_HANDOFF_ONLY=1` selects a short ordinary-worker acceptance run
in explicit production lifetime mode. Supply `COUCHROOT_TEST_OBSERVER_PID` for the
installed agent service; the controller verifies its executable path, stable
process identity, UID/GID, groups, label and expected effective capabilities before
forking a matching observer. It never changes the installed service. The probe
closes its inherited authenticated socket and clears the key before dropping
credentials. Only the test controller contains this identity-matching code.

The default probe reads boot and process start ticks with `O_NOFOLLOW`. On S90D,
this correctly fails with EACCES. `COUCHROOT_TEST_OBSERVER_MODE=pidfd` instead
binds kernel process handles while both processes are alive, obtains a fresh
worker reply and checks that the controller still owns the live guardian child,
then waits for both handles to report exit. No unreadable stat file is treated as
process absence. This is a test of a production-backend prerequisite, not an
already integrated service pidfd bridge. The probe is bounded and never signals
the observed processes.

The run covers initial/upload/helper/running/drained inventories, app helper
identity and release, exact BYE plus disconnect, worker/guardian exit, retained
outcomes, and owned runtime/journal/freezer cleanup. The deployed .NET worker stays
active. Use the existing enrolled APIs, per-device locks, firmware guards, private
intent/results, unique scopes and explicit cleanup described above. Do not run a
controller directly against an installed worker or its live state directory.

Both TVs passed six focused checks and five inventory phases using the ordinary
worker from `cced593`. QN90A used proc-stat observations; S90D used pidfds after two
known-failed, fully cleaned diagnostic trials. One final shutdown sample per TV
was 112 ms and 32 ms respectively, not a timing distribution or an endurance gate.
See [handoff results](handoff-results.json) for scope and evidence limitations.

## Single durable job publication

Successful job admission creates a contained child behind the existing pipe
gate, then exclusively publishes its complete running record, including PID and
start ticks. The record file and containing directory must both sync before the
gate opens. This replaces the earlier PID-zero publication plus running-record
replacement with one publication; terminal persistence is unchanged.

Existing final, update-temporary and same-worker intent names are refused before
fork. Exclusive linking still prevents replacement if a conflicting final record
appears later. A failure before publication kills and reaps the gated child before
clearing its slot; no monitor can later invent a record over foreign bytes.
Allocation, pipe, fork and identity failures retain a rejected ID when persistence
is available. A linked record whose directory sync fails remains reserved and
enters the existing cancellation/recovery path. Uncertain outcomes are never
automatically replayed.

The local tests cover real gated children at each publication interruption,
pre-fork metadata refusal, failed allocation/pipe/fork/identity acquisition,
slow and failed syncs, watchdog expiry, terminal records and managed return.
Worker loss before any publication cannot execute the command; the guardian
retires its child. An explicit later request may use that unrecorded ID after
reconciliation. See [qualification results](single-publication-results.json) and
the dated migration entry for device evidence and performance limits.

## Continuous kernel observation and complete job timings

The standalone benchmark accepts `COUCHROOT_BENCH_KERNEL_CAPTURE=1` to observe
`/dev/kmsg` continuously from before its first warmup launch through the final
worker exit. It opens a read-only, independent cursor at the current end, with
no kernel writes or logging-configuration changes. The implementation follows
the [Linux dev-kmsg ABI](https://www.kernel.org/doc/Documentation/ABI/testing/dev-kmsg).
This code is included only in the diagnostic benchmark, never in a worker or
installed payload.

The reader prefaults a bounded 2 MiB buffer before measurements and preserves
whole raw records, including extensions and context lines. It writes and syncs
`kernel.raw` and `kernel.json` only after observation ends. Both files require
exclusive creation in the root-owned private trial directory. Existing files or
symlinks are refused. Transfer readback must resolve the SDK directory's symlinked
ancestors to a canonical path and verify the original and resolved files are the
same inode; do not weaken the public file API's symlink checks.

Metadata reports sequence gaps, overruns, malformed/reordered records, read errors,
capacity exhaustion, and a boottime-versus-monotonic suspend check. Any of those
conditions makes coverage incomplete and fails the benchmark after preserving
available evidence. First/last sequence numbers retain all 64 bits as decimal
strings. A gap count is an observed forward discontinuity, not a reliable total
loss count after malformed/reordered input or an overrun before the first record.
An empty healthy observation window is distinct from a read failure. Stop/drain
is bounded; the suspend check's 100 ms threshold is a diagnostic guard, not
standby/resume qualification.

Each sample now records monotonic launch, readiness, shutdown and retirement
boundaries. Each job records admission/completion and output/forget timings;
`through_forget_ms` includes cleanup while the existing completion metric keeps
its original meaning. Raw job identifiers and kernel logs belong in private
evidence, not committed results. The capture thread's CPU and memory are outside
worker/guardian accounting, but observation can still perturb scheduling and
memory pressure. This is bounded benchmark coverage, not continuous lifetime
resource monitoring, acquisition/HTTPS measurement or endurance qualification.

Synthetic record-socket tests cover preserved records, future fields, empty
windows, sequence loss/reordering, malformed and overflowing numbers, full-width
sequence values, bounded storage, overruns/EOF, simulated suspension and exclusive
output creation. Protocol tests verify that delayed output and forget calls are
measured separately and never duplicate job submission or forgetting.

## Independent acquisition and public-path observer

The diagnostic build also produces `observe`:

```text
observe PRIVATE_DIRECTORY SECONDS INTERVAL_MS COORDINATOR_PID START_TICKS WORKER_SHA256
```

It observes for 2–240 seconds at a requested 250–2000 ms interval and accepts
SIGTERM/SIGINT for an earlier orderly finish. Use a fresh root-owned 0700 output
directory. It exclusively creates `observer.ready`, `resources.ndjson`,
`observer.json`, `kernel.raw` and `kernel.json`; existing outputs are refused.
The ready receipt supplies observer identity and clock/boot bindings. Resource
snapshots reserve an 8 MiB buffer and populate pages progressively, alongside the
kernel collector's 2 MiB prefaulted buffer. Unused resource pages are not dirtied
up front. Empty readiness and output directory entries are synced before the
capture clock starts. The readiness payload then supplies live identity and
timing evidence; it is synced with the completed capture when observation stops.
Successful retained unit exit is required before accepting any capture, even
when its report says the sampling interval completed. A persistence failure
prevents successful exit. Delays after the declared start still count toward
skipped intervals and coverage limits. The bounded deadline has an outer alarm.

For a handoff trial, launch this helper in a separate owned transient unit with
an unshared mount namespace, private propagation and a read-only bind of its
owned code directory. A helper registered to the source worker would interfere
with handoff inventory/retirement; this observer must remain independent. Keep
the independent 300-second .NET SDK rescue and existing identity, firmware,
signing, request-journal and owned-cleanup guards. The observer is not an
installed payload, worker API or fallback replacement.

Snapshots identify the coordinator by PID/start ticks, report the observer's own
cost separately, discover managed worker/entry/acquisition candidates by their
managed argument names, and hash native mapped executables against the supplied
signed-worker digest. Private code binds can appear as `/worker` in proc;
accepting that discovery hint does not bypass the digest check. Bind candidate
samples to independently read public worker identities and activation receipts
before attributing resource usage. Discovery alone is not provenance.

Every reported process is bracketed by start-time and executable/argument checks,
including executable device/inode identity even when its pathname stays the same.
PID reuse, exec changes, unreadable fields and partial samples remain explicit.
CPU counters and process start times retain full-width decimal strings. The
sampler keeps CPU, resident pages, lifetime peak RSS, descriptors, threads and
mount counts at every tick. Expensive mapping RSS/PSS/private/swap sums are read
on first observation of each PID/start/executable identity and every fifth sample.
`memory_detail_sampled` distinguishes those rows; other rows leave the mapping
fields null, never stale or fabricated zeroes. At a one-second interval, mapping
details are therefore approximately five seconds apart; use the actual sample
timestamps. Missing optional kernel fields also stay null. Discovery applies its
existing executable filter before stat/cmdline reads of unrelated processes.
Metadata schema 2 records the detail cadence and reserved capacity, plus actual
sample windows, maximum gaps/durations and skipped intervals; a failed scan,
missing coordinator, capacity/cache limit, skipped interval or kernel gap fails
interval coverage while preserving available evidence.

Progressive buffer population can fault pages during sampling; this remains part
of the separately measured observer cost. The reduced mapping cadence can miss
short peaks between detail samples. This is periodic coverage, not exact
process-tree peaks or complete observation of short-lived acquisition/command descendants. CPU excludes already exited
children; idle wakeups remain unknown. Per-field failures and candidate identities
still require review even when interval coverage passes. Do not infer leak-free
endurance from a short trace. Raw paths, PID/start identities and kernel records
remain private; commit only sanitized, source-bound results.

### Offline continuity verification

`python3 verify-observer-series.py PRIVATE_SERIES_JSON` verifies an ordered series
of overlapping bounded captures without contacting a TV. It requires successful
observer exits, hashes for all five artifacts, consistent boot/coordinator/source
bindings, advancing and overlapping resource/kernel clock intervals, no reported
capture failures, and matching bytes for duplicate kernel sequence numbers.
Sequence holes across windows, changed boottime/monotonic offsets, partial process
rows and excessive gaps between actual resource samples reject the series. Empty
kernel windows do not erase the preceding sequence history. Duration is the
requested covered interval, never the sum of overlapping windows.

New qualification manifests use `schema: 2`, `boot_id`, a `coordinator` object with integer
`pid` and decimal-string `start_ticks`, `observer_sha256`, `native_worker_sha256`,
`required_start_ms`, `required_end_ms`, `maximum_sample_gap_ms`, and ordered
`windows`. Each window supplies a contained relative `directory`, `exit_code: 0`,
the same coordinator and executable bindings, and `sha256` mapping the five
artifact names to their digests. Declare the intended coverage before collecting;
do not shrink it after discovering missing data. The manifest and capture files
remain private. The CLI emits a summary and exits zero only on acceptance.

Schema 2 also requires each window's `unit_exit` receipt, recorded before stopping
the owned collector unit. Launch it with `Type=simple` and `RemainAfterExit=yes`.
The receipt must show `LoadState=loaded`, `RemainAfterExit=yes`,
`ActiveState=active`, `SubState=exited`, `Result=success`, `ExecMainCode=1` and
`ExecMainStatus=0`. `ExecMainPID` must match `observer.ready`; its positive
`ExecMainStartTimestampMonotonic` must not follow observer readiness. Unit IDs
must be distinct owned collector names. This establishes the receipt's internal
bindings; the caller still authenticates the unit inspection and launch.

Legacy schema 1 remains readable for historical file analysis. Its output labels
successful exit evidence `caller-asserted-only`; it cannot supply retained exit
proof for new endurance acceptance. The QN90A short probe demonstrated that a
discarded transient service can return `LoadState=not-found` with default zero
exit status. The earlier unretained status polls did not distinguish that case.
Their saved capture measurements remain descriptive, but those polls alone do
not establish successful collector exit. Schema 2 reports
`successful_exit_evidence: retained-unit-receipts` after the additional checks.

At most 1,024 windows are accepted. Each resource artifact is bounded to 8 MiB,
each kernel artifact to 2 MiB, and each window to 1,000 samples. Symlinked capture
files/directories are refused; inputs must remain unchanged during verification.
This is an offline integrity check of caller-supplied evidence. It cannot
independently authenticate the manifest, binary execution, firmware or process
provenance. The live controller must verify those separately and retain durable
launch/exit receipts, recovery and owned-cleanup checks. It also does not establish
native-worker coverage merely because a worker digest is supplied: activation
receipts must bind actual observed native process identities.

A sustained controller still needs bounded rolling downloads/cleanup, safe renewal
of the independent SDK rescue, and explicit selected-worker checks throughout.
The short two-window hardware qualification establishes capture continuity only;
it is not a sustained native run, a leak-free result or the 24-hour endurance gate.

### Offline resource analysis

`python3 analyze-observer-resources.py PRIVATE_SERIES_JSON PRIVATE_PRODUCTION_JSON`
first runs the continuity verifier, then binds both native identities to the
ready production receipt's boot and worker digest. Every row must contain exactly
those worker/guardian identities, plus the bound coordinator and collector.
Duplicate identities, CPU regressions (including discarded overlap samples),
changed units, invalid counters and changed artifact hashes refuse analysis.
Clock ticks and page size come from the verified observer metadata. The caller
still authenticates live receipts, executable provenance and device identity.

Each collector owns samples until the next collector's first sample. This removes
overlap weighting; the report gives the resulting sample gaps and actual CPU
sample span. Full-width tick counters are subtracted before conversion to a
percentage of one core. `--bin-ms` defaults to 600000; bins report sampled extrema,
medians and known/unknown counts, including partial edge bins. Missing mapping
detail remains null. First/last bin medians and endpoint differences are
descriptive, with no automatic growth threshold or leak-free conclusion.

Worker and guardian totals use readings from the same scan, which is not an
atomic process-tree snapshot. Shared RSS can be counted twice. Mount counts are
per namespace and are not summed. PSS plus Swap is an accounting proxy; lifetime
VmHWM is excluded from interval peaks. Coordinator measurements may include other
services in its shared host. Collector measurements remain separate per window:
they do not claim total overhead when two collectors overlap. Short-lived
descendants and between-sample peaks remain outside the measurement boundary.

Use immutable completed files. A progress analysis must use a separate, explicitly
labelled completed-prefix manifest retaining the original intended endpoint and
source-manifest digest. Never overwrite or shorten the endurance coverage intent,
or present acceptance of the shorter interval as acceptance of the planned run.
The CLI's success means the descriptive analysis completed, not that performance,
resource stability or endurance qualification passed. Reports remain private;
commit only sanitized summaries. See [resource evidence](observer-resource-analysis-results.json).

### Rolling controller

`observer-series-controller.py` supplies a synchronous `run(adapter, Plan(...))`
scheduler for an explicitly authorized host-side trial. The default windows last
220 seconds and start 160 seconds apart. It accepts at most 25 hours of requested
coverage (including startup/drain margin around a 24-hour job), keeps at most two collectors owned at once, and waits for completion
before download and cleanup. Its adapter must bind the device, installed artifact,
selection, coordinator and native process identities; journal unique intents;
confirm readiness and successful exit; verify downloaded hashes; and clean only
owned artifacts. The scheduler does not provide those device-specific operations.

The independent rescue always uses a 300-second delay. Renewal normally occurs
every 120 seconds, after a health check. The replacement must be confirmed active
before retiring the previous timer. Each retirement must check that rescue never
fired before stopping the timer and must then confirm inactivity. A conservative
host deadline reserves 30 seconds; elapsed-time overruns, unhealthy selection,
uncertain calls, excess owned collectors or a lost overlap stop scheduling.
No failed operation is retried, and exceptions leave recovery and durable receipts
for inspection. Completed runs return the last rescue still armed so managed
return and preservation checks remain protected. All adapter calls need bounded
timeouts; host timing checks cannot interrupt an adapter that hangs indefinitely.

The caller must run the offline series verifier against the predeclared TV-clock
interval and separately verify native activation identities in the samples.
Scheduling success alone is not proof of capture continuity. Host sleep, network
loss or a TV suspend may invalidate a run; never fill a gap with a later capture
or count unavailable time as active qualification. A multi-hour controller still
needs private disk-space monitoring, process supervision, and a long-job/workload
plan appropriate to the endurance gate. The three-minute trial is a controller
qualification, not the 24-hour gate.

`require_storage` checks a caller-provided free-space snapshot. Initial admission
allows maximum-sized captures, 1 GiB of private receipts per concurrent run, and
a shared 2 GiB floor; ongoing checks preserve that floor. This is a conservative
allowance, not a filesystem reservation. Concurrent writers or I/O errors can
still invalidate the run. A 24-hour-plus-one-minute plan uses 540 windows at the
default cadence. The full-day fake-clock test exercises all of them and verifies
that only the final rescue remains armed. Host sleep suppression and bounded
adapter calls belong to the supervising harness; they do not change TV power
settings or authorize reboot/standby.

The sampling duration is not a process-exit deadline: kernel reader drain and
durable file publication follow sampling. Before downloading, the adapter calls
`wait_for_collector_exit` with an identity-bound, read-only unit inspection. It
waits at most 20 seconds by default and refuses missing/discarded units, failed
results, invalid execution timestamps and expiry. Active/running with zero
status is not completion. Each inspection and the enclosing callback remain
bounded by the adapter. After loaded/active/exited success, persist the unit
receipt, verify the files and matching observer PID, stop only that owned retained
unit, confirm inactivity, and clean its verified scope. An exception preserves
evidence and recovery; it does not launch, signal, replay or clean anything.

Device-space probes must execute synchronously inside the adapter's bounded
`health()` callback. A separate `/v1/exec` monitor can hold the administrative
mutex while `job.status` runs and invalidate the trial. `require_device_storage`
validates `LC_ALL=C df -Pk` output for the two adapter-guarded storage paths and
requires at least 256 MiB available on each. Missing/malformed counters or a
low-space result stop scheduling and leave recovery armed. This checks a snapshot;
it neither reserves space nor authorizes retries of failed administrative calls.

Hourly checksum work uses `observer-transfer.py`. Each transfer index has its
own download, durable exclusive intent and completion receipt. The helper refuses
existing evidence before upload, verifies both the download receipt and the saved
bytes, then calls the adapter's hash-guarded cleanup. Earlier downloads remain
available for inspection. An uncertain upload, download or cleanup stops the run;
reusing that index is refused even when the remote mutation may have completed.
The adapter still owns authentication, bounded calls, request journaling and
serialization with health, collector and rescue operations.
