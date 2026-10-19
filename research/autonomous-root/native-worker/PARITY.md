# Production files and retained job compatibility

This document records the original file/record parity phase. Later service
selection and recovery work is summarized in the [current release status](../../../docs/project/release-readiness.md)
and [qualification snapshot](MIGRATION.md#current-qualification-snapshot).
Statements below about future integration apply to that earlier phase.

This phase implements the file-access and retained-record portions of the
[migration plan](MIGRATION.md), with a [machine-readable contract](../../../tests/worker-parity/contract.json)
and [differential harness](../../../tests/worker-parity/README.md). It does not
select native in the installed service or remove .NET. Subsequent work adds the
explicit `--production` mode described in the README. Short ordinary-sidecar
handoff trials exercised that mode on both TVs; they do not qualify production
selection, long-running operation or the full lifecycle. See the dated evidence
below and `handoff-results.json`. Default experiments keep their original narrow
file policy and bounded lifetime.

## Opt-in production file policy

Append `--production-files` to the existing worker arguments to enable the policy.
The supplied private scope remains the worker's runtime/state root; its `.jobs`
directory must be stable across replacement workers if records are to survive.
A future deployment should select a dedicated persistent native state directory,
not reuse the managed job directory. Scope selection and migration installation
belong to the later service-selection transaction.

The policy accepts canonical absolute paths, traverses parents using directory
descriptors without following symlinks, and opens regular files without following
the final component. Downloads can read disk files beyond the experiment scope,
but refuse `/proc`, `/sys`, `/dev`, and non-regular files. Uploads permit the
worker's own runtime/state scope, its token's staging directory, the SDK staging
root and `/opt/couchroot-agent/files`. Only the fixed managed files directory may
be created; caller-selected parent directories must exist. The native scope's
`.jobs` and `.views` metadata remain inaccessible through file operations.

Uploads retain their parent descriptor until commit/close. Commit revalidates
that the pathname still resolves to that parent. If it was moved, replaced or
changed into a symlink, publication fails and cleanup removes the temporary file
through the original descriptor. This is not a filesystem-wide compare-and-swap;
independent writers must still be quiesced. A parent can change after validation,
so no stronger concurrency guarantee is claimed. Create-only and current-hash
replacement retain the existing publication semantics.

Production traversal needs two spare descriptors at its peak, plus the monitor's
reserved slot. Persistent upload parent descriptors are included in subsequent
admission scans. Host tests exercise the rejecting and admitting thresholds and
verify unchanged descriptor sets after close. Helper sources use the same parent
traversal and, in this mode, must be managed uploads. The ordinary launcher still
comes from its separately supplied, digest-bound source within the private scope.

Two response discrepancies were corrected: `file.open` initially returns offset
zero, while download `file.status` returns file length and a null expected digest,
matching managed behavior. Job admission now rejects whitespace-only commands,
including the Unicode whitespace accepted by managed `IsNullOrWhiteSpace`.

## Retained records and offline migration

`python3 -m tvsetup.native_job_migration` imports a quiesced managed snapshot into
a private native `.jobs` directory. It has no TV transport and never signals a
process or launches a recorded command. Do not point it at a live managed job
directory: the old worker does not honor the native lock. The caller must stop
mutations, establish a quiesced snapshot and arrange rollback before a real
service transition. Those production transitions are not performed in this phase.

Example using canonical, private, local snapshot directories:

```sh
python3 -m tvsetup.native_job_migration \
  --source /absolute/private/managed-snapshot \
  --target /absolute/private/native-state/.jobs --offline-snapshot
```

Both directories must exist and belong to the current effective user with private
permissions. Records must be bounded, singly linked regular files with matching
IDs, valid metadata and unique JSON fields. The tool refuses malformed records,
partial `.next` files, unresolved guardian/intent state and a combined count over
64. An existing identical record is retained; a differing ID collision stops the
transaction without overwriting either version.

The source is unchanged. A durable `.import-pending` manifest binds source hashes
and direction before records are published. Each new record is synced through a
scratch file and renamed; final manifest publication commits the transaction.
Native startup refuses a destination with `.import-pending`. Retry the same command
with the same source bytes to resume a completed pending manifest and partial
record publication. A torn/unreadable pending manifest, unexpected file or changed
source is preserved for inspection rather than guessed or deleted. Do not remove
the pending marker merely to make a worker start.

Records are copied byte-for-byte, with no invented native ownership. The guardian
therefore does not claim it reaped the old managed job. Same-boot running/unknown
records remain unknown; old-boot nonterminal records report interrupted. Completed
results remain available without logs. Imported IDs participate in duplicate-start
refusal and the 64-record limit. Native saved-job cancellation remains refused.
Unknown same-boot records cannot be forgotten through the API. This is an explicit
compatibility difference, not a reason to restore saved-PID signalling.

For rollback, export a quiesced native snapshot to a fresh private managed rollback
snapshot with `--direction rollback --offline-snapshot`. This preserves native-created
IDs/outcomes as well as imported records; the original managed archive stays
unchanged. Install that verified snapshot only within the later rollback transaction,
never by replacing a running worker's files. In-memory output cannot be migrated.
Forgotten legacy records may reappear if an older archive is restored; use the
exported current snapshot when selecting rollback data. Changed-ID collisions
require inspection, not last-writer-wins merging.

## Qualification and remaining gates

Focused recheck at source revision `36859d8` rebuilt the managed harness and the
native ASAN/UBSAN host executable. All 23 phase-one checks passed: six production
file-policy/retained-record tests, seven differential groups and ten offline
migration/rollback tests. This recheck was local in the isolated Linux container;
the device results below are previously recorded evidence, not a new deployment.

Local verification comprises 49 existing native ASAN/UBSAN tests, six new native
production-policy/record tests, six differential groups and ten offline migration
tests. The repository runner passes 236 tests and skips the 61 Linux native and
differential tests that run separately. The existing loopback protocol tests pass.

A short acceptance run on QN90A and S90D used the ordinary ARM worker, not the
fault-test build. It exercised nested uploads and managed helper sources, reads
outside the old scope, path refusals, app-user helper identity/release, synthetic
legacy unknown records across sidecar restart, duplicate/cancel/forget refusal,
mixed JSON/binary upload and owned cleanup. No deployed managed job records were
read, imported or changed. Both original .NET identities and boot IDs were preserved.
See [phase results](parity-results.json) for build hashes and evidence limitations.

This closes the implemented file policy and offline retained-record compatibility
work, not the entire migration. A live state-installation/rollback transaction,
production packaging and capability advertisement, HTTPS worker selection,
production lifetime, acquisition/recovery ports, signal-policy decision and
cross-boot qualification remain the subsequent gates in `MIGRATION.md`. Do not
claim full .NET replacement readiness from these tests.

## Subsequent local lifetime validation — 2026-10-14

The explicit `--production` mode removes the worker and guardian lifetime alarms,
retains production file policy, and separates an idle connection from an active
frame. It does not select native in the service. Default and `--production-files`
experiments remain bounded. A conflicting experiment-lifetime environment value
is rejected, and status reports the mode and zero seconds for no lifetime expiry.

All 61 existing native/file/differential tests passed with ASAN/UBSAN. Six distinct
lifetime checks passed across ordinary host and sanitizer builds: production
status and job deadlines, conflicting configuration refusal, buffered requests,
default bounded mode with 32 seconds of idle time, 315 seconds of uninterrupted
production idle time with a running job, and partial-frame expiry with owned-job
cleanup. The two extended checks ran in the ordinary host build without fault
controls. Both old lifetime thresholds (300 and 310 seconds) were crossed without
replacing the worker or guardian. ARMv7 worker/controller and fault-test builds
compiled successfully. These are local tests, not TV qualification.

A 24-hour job deadline was accepted and the job explicitly cancelled; no claim is
made that a job completed 24 hours of execution. Slow-storage progress, integrated
service selection, both-TV lifetime/endurance checks and power lifecycle remain
open. No TV was contacted, restarted or switched during this follow-up.

## Subsequent local storage-progress validation — 2026-10-14

Successful request-side storage reads, writes, digest blocks and flushes refresh
the main-thread progress lease. Transfers and helper/launcher copy paths use
these notifications; the monitor and guardian never refresh the main lease on
behalf of blocked I/O. Failed operations, EOF and repeated EINTR do not count as
progress. A single blocked syscall still expires under the existing watchdog.
Hashing stops at the initial regular-file size (at most 2 GiB) and refuses changed
sizes, rather than following a growing file indefinitely. This does not detect
all same-size external writes or provide a filesystem snapshot; writers still
must be quiesced. The contract records the size-change behavior explicitly.

The final ordinary host build passed seven isolated storage tests in 197.639
seconds: slow hashing and byte-range download, partial slow upload followed by
exact publication, blocked hash read, blocked flush without publication,
repeated EINTR, file growth/shrink during hashing, and sparse 2 GiB hashing plus
boundary range reads and oversize refusal. Slow successful operations crossed
30 seconds; stalled cases terminated the worker and its owned job within the
38-second test bound. The delay fixture is a separate host-only shared library,
not compiled into any TV artifact.

The final source also passed all 61 existing native/file/differential tests under
ASAN/UBSAN and ordinary/fault-test ARMv7 builds. Four short lifetime checks passed
during this change; the earlier 315-second lifetime qualification was not repeated.
No TV was contacted or modified, and .NET remains deployed.

This closes the worker-side file progress gap, not integrated storage qualification.
The service's 30-second OP response budget, client deadlines, job-record flush
latency under its mutex, startup before guardian activation, actual TV storage,
Smack helper staging and long-running endurance remain separate integration and
qualification work. No request is automatically replayed after a timeout.

## Subsequent local transport-deadline validation — 2026-10-14

The service and bundled client now use fixed, operation-specific response budgets:
120 seconds for open/commit/helper preparation, 60 seconds for file chunks, and
30 seconds otherwise. The API adds five seconds of transport margin and the client
ten seconds. New requests reset the HTTPS inactivity budget so reused connections
do not inherit a previous operation's allowance. Command/job execution deadlines,
body admission and keep-alive limits are unchanged. A request field cannot extend
its response budget. The operation journal keeps its existing admission envelope;
response budgets are not job execution timeouts.

Expiry explicitly reports an unknown outcome and closes the worker connection.
A submitted mutation remains in the journal, and replay of its request ID is
rejected before another worker submission. Confirmed responses clear their timer.
Both JavaScript and Python budgets are checked against the parity contract.

Four new Node tests passed, including a real 42-second request through the pinned
Python client, mutual-TLS API and authenticated loopback protocol server. That
check uses a scripted peer, not a native worker or TV, and crosses the old 30/35/40
second wire/API/client limits. Twenty existing service/protocol tests also passed,
including additional unknown-operation journal/no-replay assertions. Repository
Python discovery passed 238 tests with 74 native fixture tests skipped. The client
reuse test confirms per-operation socket budgets of 130, 70 and 40 seconds on the
same pinned connection. No TV was contacted, rebooted or switched.

These budgets are candidate defaults, not throughput guarantees. Qualification
must still run the ordinary packaged native worker through this service on both
TVs, reconcile observed operation tails, and verify deployment and rollback with
retained state. Older separately copied clients need updating to use the longer
budgets. Native packaging, implementation selection and later lifecycle gates in
`MIGRATION.md` remain open.

## Subsequent ordinary candidate packaging — 2026-10-14

The package preparer accepts `--native-candidate`. It builds the ordinary native
worker and launcher, copies them and their manifest into the existing package,
and retains both managed payloads. Managed selection and disabled provisioning
remain unchanged. No signing, package installation, selection change or device
access was performed during this follow-up.

The build snapshots source inputs, pins the compiler image by immutable local
identity, runs without networking, checks two identical builds, and verifies the
published files against the measured digests. The candidate manifest records
source/artifact hashes, compiler version/image identity, ARM ABI, interpreter,
ELF dependencies and runtime-loaded library alternatives. Fault-test/controller
outputs are excluded. Nonempty output directories, symlink artifacts, unexpected
outputs, mismatched repeated builds, incompatible ABI/dependencies and recognized
test-control markers are refused without publishing a manifest.

Actual repeated ARM builds produced:

| Artifact | Bytes | Highest required GLIBC | SHA-256 |
| --- | ---: | --- | --- |
| native-worker | 107568 | 2.28 | `ab3f37813ca3254303f0be015d12c2bec077878114c093684615846e886fd28c` |
| native-app-launcher | 13296 | 2.4 | `4ba756c8b725ba2e375ca02608c9ca7579f6d6275c4ed96348ba93bf5b8a6d55` |

The worker's requirement includes `fcntl64@GLIBC_2.28`; it is not appropriate to
apply the launcher's 2.17 ceiling to that artifact. Existing native-service
research records libc 2.30 on the TVs, but candidate qualification must still
verify the currently deployed libraries on each device. Both artifacts use
`/lib/ld-linux.so.3`; the worker additionally needs libc, libdl and libpthread,
plus the runtime json-c/crypto alternatives recorded in its manifest.

Five new build/package tests passed. Repository Python discovery passed 243 tests
with 74 native fixture tests skipped. The package-boundary fixture verifies both
managed DLLs, candidate hashes in the package manifest and unchanged managed
selection. Shell syntax and CLI-help checks passed. This evidence qualifies local
artifact preparation, not an installed package or a native-only agent build.
Service selection, state migration and rollback remain open.

## Subsequent service candidate validation — 2026-10-14

The service now validates optional native candidate package contents at creation
and before an acquisition attempt. It checks the package index's native-manifest
digest, exact candidate schema, supported profile declaration, managed selection,
unqualified status, repeated-build declaration, source/toolchain metadata, artifact
set, declared ABI/dependency limits and runtime-library alternatives. Bounded
no-follow reads verify final artifact size/digests and ELF headers, and refuse
known test-control markers. All referenced artifact names are fixed; manifest
source paths are metadata and are never opened by this validator.

`selected_implementation` remains `managed`. Candidate diagnostics distinguish
absent, invalid and verified packages and include when they were checked. An
invalid candidate has a bounded reason code and does not suppress managed launch.
Successful candidate verification does not set `worker_ready`, select native or
mark the device qualified. A later staging/selection transaction must freshly
validate its expected manifest digest and copied bytes.

Seven new Node tests passed, covering both profile declarations, legacy absence,
invalid metadata, digest failures, incomplete packages, symlinks, oversized input,
wrong ELF headers, test-control markers, refresh-before-launch, and the actual
ordinary binaries built in the preceding step. Fourteen candidate/service tests
passed in total; sixteen additional protocol/deadline tests passed, with the
previously completed 42-second test skipped in this run. Five candidate-builder
Python tests passed. No TV access or deployment occurred.

This is package consistency validation within the existing signed-package trust
boundary. It does not independently rebuild source, rerun readelf, prove compiler
provenance or probe device libraries. ABI dependency/version declarations are
bound to the package's artifact hashes; live compatibility still requires device
qualification. Journaled implementation selection, retained-state installation,
rollback, and integrated native readiness remain open.

## Subsequent worker readiness gate — 2026-10-14

Before implementation selection can be committed, the service needs to prove
that its authenticated connection supplies the expected worker contract. The
managed path now checks the local boot ID, nonnegative finite uptime, worker ID,
complete managed capabilities and native-launcher metadata. The deployed managed
status shape lacks an implementation field and remains accepted; an explicit
mismatched implementation does not. Native readiness validation requires its
prototype production capabilities, a pinned launcher SHA-256, independent staging,
positive guardian PID and unbounded production lifetime. This validator is not
native selection and does not independently attest the executing worker binary.

Connection ownership is checked again when asynchronous status resolves. Closed
or superseded connections cannot become ready, and late failures cannot overwrite
a replacement's status. Disconnect and stop clear current worker metadata. The
service rejects execution/operations until validation succeeds; boot-launch
inspection also waits, preserving its attempt while the connection is checking.

Seven readiness tests and one additional boot-launch test passed. The combined
service, candidate, protocol, deadline and boot suite passed 43 Node tests with
two previously qualified extended/artifact checks skipped. State-transition tests
use controlled channels and stop before any device access. No TV was accessed,
changed or rebooted.

Local boot-ID readability under the deployed service identity must be checked on
both TVs before shipping this gate. Managed launcher digest format is checked;
older packages do not have a separately pinned managed embedded-launcher digest.
The native path requires an explicit digest supplied by future selected-artifact
staging. Durable selection, retained-state installation and rollback remain open.

## Subsequent selection journal and service guards — 2026-10-14

The internal selection journal records selected/last-known-good artifact versions,
revision, pending transaction and the last 32 completed transition receipts. Its
phases separate preparation, state-copy evidence, trial-readiness evidence and
commit. Aborting a trial requires new quiescence, rollback-state and readiness
receipts before the old selection is committed. Completed receipts retain both
artifact versions and state hashes, including after rollback. History continuity,
transaction IDs, expected revisions and phase order are validated.

Changes use an exclusive writer marker and fsynced atomic publication. Ordinary
precondition failures leave the record unchanged. A publication failure retains
the marker and blocks subsequent launch/writes for inspection, including when the
new record became visible before the failure. The marker is never cleared using
PID or age guesses. This is an unresolved-write guard, not an implemented automatic
recovery controller. A reconciler must establish ownership and the durable result
before removing it or advancing state.

The service reads the optional journal from its existing private data directory.
Absence preserves legacy managed behavior. Pending/invalid/uncertain selection,
or a selected managed version that differs from the six verified managed package
artifacts, blocks acquisition and new request admission. Existing work is not
killed by a metadata write. A stable native selection also remains blocked because
the native launch adapter is not integrated. The journal APIs are internal and
have no HTTP endpoint or CLI switch; they never start processes or copy live state.

The final combined service/protocol suite passed 55 Node tests with two previously
qualified extended/artifact tests skipped. Tests include revision/phase errors,
restart reads, failures before/after atomic publication, rollback receipts,
invalid record shapes, symlinks/permissions, bounded history, version mismatch, pending
admission, and the real Python offline importer/exporter. The latter preserves
original managed bytes and a synthetic native-created record in rollback output,
and binds the actual import/export manifest hashes to completed selection receipts.
Readiness/quiescence receipts in these tests are fixtures, not device observations.

No journal was created on a TV and no live job directory was copied. .NET remains
deployed. The next runtime controller must actually establish quiescence, retain
rollback artifacts, verify/install state, stage the chosen executable, validate a
trial and reconcile interruption. The journal merely binds its verified evidence;
it does not prove single ownership or qualify live selection by itself.

## Subsequent live inventory and admission hold — 2026-10-14

Both managed and native workers now advertise `resource-inventory-v1` and return
bounded worker-owned transfers, in-memory jobs and helper IDs in fresh status.
Snapshots include completed jobs until forgotten. Job fields are read under their
monitor lock; transfer/helper tables remain owned by the serialized request thread.
Disk-only records are intentionally excluded. `monitor_finished` is the monitor's
existing completion flag, not a new claim about detached descendants, fully drained
output or persisted state. No command text, paths or output are exposed.

The service's internal admission hold blocks new executions and operations, waits
for already-admitted requests and obtains fresh status from the captured worker.
Generation, connection, boot and worker identity must remain unchanged. Unknown
or unclassified drained errors refuse a snapshot; known worker failures can proceed
to inventory without replay. Inventory capability, shape, bounds and unique IDs
are checked. An error leaves the hold active. Explicit release requires the same
worker; stop invalidates the handle. Public readiness is false while held, and the
status reports the hold and number of in-flight requests. Older managed workers
remain usable normally but cannot supply this handoff inventory.

The hold is process-local and has no HTTP or CLI exposure. It does not cancel or
forget resources, stop the worker, reconcile earlier uncertain journal outcomes,
install state or advance selection. The runtime controller must bind these checks
to the durable selection journal, prove ownership/shutdown and install verified
state before launching a replacement. Empty inventory alone cannot be used as a
quiescence receipt.

Local validation passed 49 native ASAN/UBSAN tests, six production file/record
tests and seven managed/native differential groups. The new differential group
observes both transfer directions, explicit close, running/cancelled job monitoring
and forget; saved-record tests verify exclusion of disk-only records. The combined
service/selection/protocol suite passed 59 Node tests with two previously qualified
optional checks skipped. It includes held admission, pending-request drain, unknown
results, stale connections/replies, malformed inventory, legacy-worker refusal and
explicit release. These service tests use controlled channels, not TV processes.

Two ordinary ARM builds matched byte-for-byte. The worker is 107512 bytes, SHA-256
`77d3c4aaf8d9e0f4c5dd1ccd26236ce48b08013924f05776c7ebbf5aec922029`, with the
unchanged GLIBC 2.28 requirement; the independent launcher hash is unchanged.
No TV was accessed, deployed to or rebooted. Live helper inventory, the service
admission hold and this candidate still require qualification on both TVs. .NET
remains deployed as the fallback.

## Subsequent journal-bound shutdown and process observations — 2026-10-14

The existing SHUTDOWN/BYE exchange now has a strict JavaScript client: it refuses
pending requests, admits no new work after submission, requires an exact matching
BYE and disconnect, and reports uncertain completion on malformed replies, missing
acknowledgement, explicit server closure or the ten-second deadline. BYE is an
acknowledgement before cleanup, not evidence of process exit.

Both workers expose boot-bound PID/start-tick identities under the additive
`worker-process-identity-v1` capability; native also identifies its guardian.
The observer preserves tick strings, checks the authenticated worker PID, parses
Linux comm fields containing spaces/parentheses/newlines, treats a matching zombie
as present and accepts absence or a different start time as exit of the original
identity. It never signals a PID. Permission/format failures or a changed boot do
not establish exit. Native captures identities after the guardian fork, without
adding a `/proc` open to each status request.

The service hold can stop the current managed worker only after its inventory and
source version are bound to a durable prepared selection transaction. It repeats
the inventory, refuses live transfers/helpers and unfinished/uncertain jobs,
verifies the processes are still present, submits shutdown once, then observes
exit. Concurrent submissions cannot send two shutdowns. The returned observation
binds the transaction, source manifest and inventory digest. Admission remains held
and the journal remains pending. Retry acquisition and replacement connections are
suppressed; a submitted shutdown cannot be released as if nothing happened.

Local tests passed all 49 native ASAN/UBSAN, six file/record and seven differential
checks. The combined service/selection/protocol run passed 77 Node tests with
three skipped: the Linux process test passed separately in its container, and two
previously qualified optional tests were not repeated. The repository Python suite
passed 243 tests and skipped 75 separately enabled Linux checks. Eight Linux checks passed:
six process-observer tests plus two real integration tests. The ordinary native
worker/guardian passed actual wire shutdown, process-exit and journal/runtime
cleanup checks. The managed production session passed through the real service
hold, retained a completed job record byte-for-byte, and drained an active command.
Its test-only entry bypasses TV launcher setup; this is not full managed Main or
TV lifecycle qualification. The final source-version/concurrent-stop checks were
rerun with the managed integration test after the combined run.

Two ordinary ARM builds matched. Worker SHA-256 is
`e17dee11cd459ce51e0f3f742b27cef624d352d4cf4c9232500f5553d7714009`
(107792 bytes); launcher hash and GLIBC ceilings are unchanged.

No TV was accessed or rebooted, and .NET remains deployed. This does not yet copy
or install live state, commit native selection, or reconcile arbitrary detached
managed descendants, mounts or ambiguous saved outcomes. Process disappearance
alone is insufficient for those gates. TV service `/proc` access and the complete
journal-bound stop path need qualification on both devices before live use.

## Ordinary candidate handoff probes on both TVs — 2026-10-14

The exact ordinary candidate worker from `cced593` (SHA-256
`e17dee11cd459ce51e0f3f742b27cef624d352d4cf4c9232500f5553d7714009`)
ran as an isolated sidecar on both TVs. The final controller passed six checks
and five inventory phases on each: initial empty resources, an open upload,
a staged helper, a running job, and completed jobs with transfers/helpers released.
The app helper reported UID/EUID 5001, GID 100 and User label. Both completed job
outcomes survived shutdown; the controller then removed only its owned fixtures.
No pre-existing managed jobs were migrated. Owned test jobs were created through
the existing managed API and explicitly forgotten after private evidence capture.

A new prerequisite was discovered rather than waived. QN90A's service uses User
with additional effective capabilities and can read native process stat files.
S90D's service uses its package label without those capabilities and gets EACCES
(errno 13). Two known-failed diagnostic trials confirmed the denial, then verified
that their native processes and resources had been cleaned. The production
JavaScript direct observer already rejects this failure before submitting shutdown;
it must remain disabled for S90D handoff until an appropriate backend is integrated.

S90D's 5.4 kernel permits pidfd_open and exit polling from a process matching its
service UID/GID, supplementary groups, label and effective capabilities. The final
probe bound both live native process handles, confirmed identity with a fresh
worker reply and the controller's owned guardian child, and observed both handles
signal exit after shutdown. QN90A's 4.1 kernel used the original stat observations.
These are separate probes matching the service's credentials, not new JavaScript
running in the installed wrt-service instance. Production pidfd packaging, launch,
identity binding and service integration remain open. In particular, the service
cannot borrow the controller's waitpid ownership of the guardian; it needs an
equivalent fresh identity check before trusting a bound handle.

The final ordinary controller waited for exact BYE plus disconnect, successful
guardian termination, and removal of the staged launcher, guardian journal and
private freezer group. The single final shutdown/cleanup samples were 112 ms on
QN90A and 32 ms on S90D. These are warm sidecar samples, not acquisition timings,
a recovery-tail distribution, 24-hour job coverage or an endurance qualification.

Final verification on both TVs confirmed unchanged deployed .NET worker/PID/boot,
launcher bytes, protected files, execution mounts and original cgroup membership.
All uploaded test artifacts, helper views, private scopes and test jobs were
cleaned. Neither TV was rebooted, and no installed package or service configuration
was changed. Raw logs and identities remain private. The sanitized evidence is
[handoff-results.json](handoff-results.json).

Full before/after kernel ring snapshots retained exact overlaps of 5668 lines on
QN90A and 6015 on S90D. Their new tails had no matching panic/BUG/Oops/segfault/
file_open_checker patterns. This avoids the earlier suspend-clock filtering error,
but remains retained-interval evidence rather than continuous collection. Long-run
qualification still needs continuous bounded capture and explicit gap reporting.

## Observer packaging and fresh guardian confirmation — 2026-10-14

Schema-2 native candidates include the ordinary process observer alongside the
worker and app launcher. All three artifacts are built twice from snapshotted
sources with the pinned compiler image. Manifest validation checks observer source
provenance, artifact hash, ABI, GLIBC ceiling 2.17 and the bridge's 128 KiB limit.
Schema-1 candidates remain accepted without an observer; an unexpected observer
in a schema-1 package is refused. Managed payloads and selection remain unchanged.

Native status now checks that its current kernel parent is the original guardian
and advertises `guardian-parent-identity-v1`. Startup establishes the direct parent
relationship and guardian start ticks; this fresh check binds those cached ticks
to the original parent without allocating a descriptor. It does not promise future
liveness. The single-handle service bridge still rejects native guardian pairs:
binding both handles and requiring this confirmation is the next integration step.

Local validation passed 50 native ASAN/UBSAN tests, seven differential groups and
six production file/record tests. The repository runner passed 243 tests and
skipped 84 environment-dependent tests. All nine candidate service tests passed
with the actual source-built schema-2 candidate, including the ordinary artifact
case; its repeated builds matched. The five builder/package boundary tests also
passed as part of the repository run. No TV was contacted or package installed.
Actual service-side observer staging/launch and both-TV validation remain open.

## Paired process exit observation — 2026-10-14

The observer now accepts a distinct worker/guardian pair and binds both pidfds
before emitting `BOUND`. The bridge requires a fresh authenticated native status
with `guardian-parent-identity-v1` and unchanged identities before arming. Exit of
only one process is insufficient. The completed receipt contains both original
identities; the observer never signals either target. Managed single-process
observation remains supported.

Descriptor admission precedes even the inherited-descriptor scan and reserves
room for both handles plus boot readback. The compiler's libc `fcntl` wrapper
raised the ARM dependency to GLIBC 2.28 and was rejected by the package check.
Using the existing `F_GETFD` syscall preserves the GLIBC 2.17 ceiling without
weakening validation. Concurrent external limit changes remain outside admission.

Final local checks passed 12 native observer tests and 32 Node bridge/service/
process tests. The ordinary native worker completed shutdown through the real
wire server with both proc-stat and pidfd observations; guardian exit status and
journal/runtime cleanup were checked separately. Pair tests cover either exit
order, premature guardian exit, duplicate PIDs, missing/changed confirmation and
low-descriptor refusal. All nine candidate tests passed with the final ordinary
source build, and both ARM builds matched. No TV was contacted. The service
selection controller still supports managed handoff only; native service
transitions and actual TV staging/launch remain unqualified.
