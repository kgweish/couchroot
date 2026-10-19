# Persistent worker capabilities

These changes require rebuilding the service and worker together. Existing installed
0.1.x workers do not expose the new operations. Source validation is separate from
TV installation and firmware-specific acceptance; no deployment is implicit.

Current installed version: signed **0.7.52**, with native workers selected on
QN90A and S90D. Both retain the small .NET entry bridge and managed fallback.
Installation readback, native public operations, selected-native disable/enable
and normal managed return passed on both TVs. QN90A passed service restart;
S90D subsequently passed a corrected SDK maintenance restart that waits for the
old WRT host to exit before launch. Its original failed trial remains recorded.
No unattended restart, new reboot or endurance gate was completed. See the
[current migration snapshot](native-worker/MIGRATION.md#current-qualification-snapshot)
and [restart evidence](native-worker/s90d-service-restart-fix-results.json).
Historical versioned observations below retain their original limits.

Signed 0.7.38 adds bounded ordinary-production resource qualification on both TVs.
A zero descriptor limit no longer closes an otherwise usable idle session; the
active-frame deadline remains enforced. Full/read-only private storage, retained
intents, descriptor admission and mixed transfers recover without replay. These
were separate production worker instances with managed still selected, not native
default or endurance qualification. See
[resource evidence](native-worker/production-resource-results.json).

Signed 0.7.40 adds startup descriptor admission and guardian-exhaustion
reconciliation on both TVs. Startup refuses one slot below its 32-free-slot
budget before consuming the token or creating state. Exhausted guardians retain
ownership evidence for same-boot reconciliation; fatal exits after ptrace attach
cannot discard that evidence through generic cleanup. Both final instrumented
trials passed all fourteen resource checks. The first QN90A trial hit an existing
two-second command-fault timeout; its cause remains unresolved despite the later
pass at unchanged limits. The .NET entry bridge, worker fallback and independent
rescue remain deployed. See [startup/guardian evidence](native-worker/startup-resource-results.json).

Signed 0.7.41 starts native job execution budgets after durable launch preparation
and backs off slow failed result saves from I/O completion. Four focused local
fixtures cover these boundaries; both TVs passed the fourteen resource groups on
the updated ordinary binary. Forced slow-storage behavior remains locally tested
only. See [job timing evidence](native-worker/job-start-timing-results.json).

Both TVs also passed a bounded address-space pressure round on the same 0.7.41
worker bytes. Refused launches retained their intent without execution; existing
live and saved jobs survived, and restored capacity admitted fresh app work.
Allocation-site and fork failures are covered by local fixtures only. These
results do not establish whole-TV OOM or sustained pressure behavior. See
[launch-pressure evidence](native-worker/launch-pressure-results.json).

Signed 0.7.42 admits a complete stale guardian journal for selected-native restart
only when it binds to the last accepted runtime. Native performs its existing
ownership reconciliation; startup verifies that report before admission.
Managed-return snapshots still reject guardian journals. Both TVs passed a
committed guardian SIGKILL with a live job, automatic native reacquisition through
the same coordinator, preserved receipts/results and normal managed return.
The interrupted job retained an unknown exit code and was not replayed. The
unchanged managed API cannot forget a same-boot interrupted saved job; the owned
test record required hash-bound maintenance cleanup after process-exit checks.
Partial journals and other unresolved metadata remain held. See
[committed guardian evidence](native-worker/active-guardian-results.json).

Signed 0.7.43 closes the saved interrupted-job retirement difference: both workers
permit `job.forget` for a reconciled terminal interrupted record on the same boot.
Worker-owned live jobs and saved same-boot uncertain states remain refused. Both
TVs passed guardian-loss recovery, return and public managed forgetting without
raw job-record maintenance. The changed managed DLL also required an explicitly
verified managed package transition: independent signed-worker readiness and SDK
retirement checks preceded selection commit, with the original history archived.
Automatic digest replacement remains prohibited by the existing startup guard.
See [interrupted-job evidence](native-worker/interrupted-forget-results.json) and
[managed-upgrade maintenance](maintenance/README.md).

All examples use the existing enrolled, certificate-pinned client:

```sh
python3 research/autonomous-root/client.py --config /private/client.json status
```


## Held native rehearsal (migration candidate)

`POST /v1/native/rehearse` accepts exactly `{id, manifest_sha256,
runtime_sha256}`. It requires a ready managed worker and a fallback runtime digest
matching the enrolled `/usr/bin/dotnet` pin. Firmware preflight and a read-only hash check through the existing managed worker
run before the migration controller starts. The response must come from the same
worker generation. A mismatch, timeout or unconfirmed check refuses the rehearsal
without stopping the source; managed launch independently rechecks runtime bytes.
The request is durably journaled before dispatch and returns HTTP 202 with
`state: submitted` and `status_url: /v1/native/status`. This acknowledgement does
not mean migration succeeded. The controller performs a held managed → native →
managed rehearsal. Administrative writes are refused while it runs; status and
request-journal reads remain available.

Use `native-rehearse --request-id UNIQUE_REQUEST_ID --manifest-sha256
CANDIDATE_MANIFEST_SHA256 --runtime-sha256 ENROLLED_RUNTIME_SHA256` with the client.
Use `native-status` to inspect the operation and migration phase. IDs must be
persisted before submission; neither the client nor service retries a submission.

`POST /v1/native/resume-managed` accepts exactly `{id, rehearsal_id}`. The new ID
must differ from the original rehearsal ID and bind to the live coordinator's
unknown rehearsal. The controller permits final managed-activation recovery or
read-only recovery of an interrupted native-exit observation, followed by the
remaining managed-return steps. Exit recovery retains the original transaction,
provider and process identities and never resubmits shutdown. Provider identity
failures, closed transports and other interrupted mutation phases remain blocked;
this is not general rollback or restart recovery. The client
command is `native-resume-managed --request-id NEW_REQUEST_ID --rehearsal-id
ORIGINAL_REQUEST_ID`. Recovery has a separate journal entry, and a successful
recovery does not rewrite an unknown original request as completed.

Only one rehearsal is admitted per live coordinator. A service restart retains
request replay protection but does not reconstruct in-memory recovery handles.
The rehearsal routes and interrupted-exit recovery code are deployed on both TVs
in 0.7.23. Normal round trips passed on both TVs, and a controlled hardware
interruption at the native exit-observation deadline was recovered on each TV
with one explicit request. A failed stopped-receipt publication after verified
exit is recovered by republishing the retained evidence; that case is tested
locally only. Status keeps the original failed phase and causes after a
successful recovery; the operation state and migration phase show the outcome.

### Native public admission (installed migration candidate)

`POST /v1/native/migrate` accepts exactly `{id, manifest_sha256,
runtime_sha256}` and has the same preconditions, fallback-runtime check and
journaling as a rehearsal. It runs the same held handoff and commits native.
Instead of returning to managed, the coordinator retires the bounded provider
and publishes `<id>.activation.json`. It then opens public admission on the
adopted native worker. `/v1/exec`, `/v1/op` and the file routes then reach
native. Retained managed job records stay readable through `job.status`, and
`job.forget` removes them. `GET /v1/status` reports `native_runtime`, which holds
the transaction, manifest and activation receipt digests. The durable inventory
reports boundary `native-active` with action `none`. While admission is held,
nothing may run on native: activation refuses a native worker with live
resources.

`POST /v1/native/resume-native` accepts exactly `{id, migration_id}`. It only
resumes the final activation of that live coordinator's unknown migration. If
provider teardown was interrupted, it reconciles the bound receipt through the
still-authenticated production worker before activation. It never repeats provider
launch or shutdown, and changed ownership keeps admission closed. Activation
starts once cleanup is verified; an interrupted activation resumes its own intent.
The original uncertain request remains unchanged. The client commands are `native-migrate`
(same arguments as `native-rehearse`) and `native-resume-native --request-id
NEW_REQUEST_ID --migration-id ORIGINAL_REQUEST_ID`.

`POST /v1/native/return-managed` accepts exactly `{id, runtime_sha256}`. It
needs an admitted native runtime, either after a completed `migrate` (or
`resume-native`) task or after verified selected-native startup. The managed fallback runtime is
verified through native first. The request then goes through these steps:

1. It holds admission and waits for every admitted public request to reach a
   known outcome.
2. It journals the return transition.
3. It launches a fresh bounded provider through the native worker. The provider
   is bound to the native worker as its source.
4. It runs the rehearsal's managed return: native exit observed by the provider,
   native job records copied back, the managed restore, launch, commit and
   adoption, then native retirement, provider retirement and managed activation.

A refusal before the transition begins releases the hold, and native stays
admitted. Recovery after an unknown outcome uses `resume-managed` with
`rehearsal_id` set to the original return request ID. Jobs that native created
remain available through managed `job.status`. The client command is
`native-return-managed --request-id UNIQUE_REQUEST_ID --runtime-sha256
ENROLLED_RUNTIME_SHA256`. The durable inventory reports the return provider as
`return-provider-launch`.

Selected-native startup now reconstructs the runtime on the same boot; see
[recovery](#selected-native-recovery). Signed 0.7.27 passed native admission,
disable/enable, worker transport loss, service restart and return to managed
on both supported TVs. Signed 0.7.28 additionally passed public-operation
parity checks and an interrupted active return on both TVs; see the parity
contract below.

### Restart reconciliation of an uncommitted forward trial

A rehearsal can be interrupted by a service restart before native is committed.
The new service then acquires the installed last-known-good managed worker with
public admission held. That worker is used only as an executor: it gets status
requests and read-only root commands. The service checks the following:

- The source, provider and native process identities are gone.
- The provider, source-exit observer and native transient units have no main
  process and an empty cgroup.
- The managed job directory still matches the retained snapshot.

It then records a `rolled-back` selection outcome under a durable intent.
Admission opens only after that commit. A pending launch that has no provider
record is still blocked, because the source identity is unknown. Activated native selections and pending active-native returns use the separate
startup recovery path below. Writer locks, unknown files, cross-boot records and
a changed managed package remain blocked. `GET /v1/native/status` reports the
attempt as `durable.restart_rollback`.

Staging, units and ownership markers survive the rollback. While they remain,
another handoff is refused. `POST /v1/native/cleanup-restart` accepts
`{id, transaction_id}` for a committed restart rollback. It is journaled like the
other native routes and returns HTTP 202. Cleanup runs under a held, drained
managed worker:

1. It confirms that nothing runs.
2. It stops only idle units whose cgroup is empty.
3. It removes staging only when every present entry matches its recorded type,
   mode and digest.
4. It then removes the transaction's token directories, readiness intents and
   markers.

S90D source-exit observers with a bound terminal receipt are retired through a
separate durable checkpoint before generic staging cleanup. The service verifies
the original record, same-boot process and unit absence, no live control socket,
and exact file identities and hashes. It removes only those recorded resources;
a lost acknowledgement or partial deletion resumes against the same checkpoint.
Unknown entries, live processes and missing terminal evidence leave the intent
and markers in place. Records and receipts are retained. Use the client command
`native-cleanup-restart --request-id NEW_REQUEST_ID --transaction-id
ROLLED_BACK_TRANSACTION_ID`.

If that cleanup becomes unknown in the live coordinator, explicitly continue with
`{id, transaction_id, cleanup_id}`, where `cleanup_id` is the original cleanup
request and `id` is fresh. The client exposes `--cleanup-id ORIGINAL_CLEANUP_ID`.
The coordinator requires the same transaction and original request, managed-ready
admission, and no running native task. Repeated continuations retain the original
binding; previous uncertain journal rows stay submitted. Activation recovery
cannot displace an unknown cleanup. After coordinator restart, the ordinary
cleanup route reconciles the durable intent under its existing evidence guards.

## Results and readiness

The migration candidate adds `POST /v1/observer/probe`, using the same enrolled
client and serialized administrative admission as other mutations. Its body is
exactly `{id, manifest_sha256}`: no PID, path or command is accepted. The manifest
must match the installed native candidate. The service journals the request before
staging permission on the fixed observer package member, then launches it in the
service context. S90D binds/cancels a pidfd observation after fresh worker identity
confirmation; QN90A uses proc-stat and checks executable launch separately. Neither
path submits worker shutdown or selects native.

```sh
python3 research/autonomous-root/client.py --config /private/client.json \
  observer-probe --manifest-sha256 CANDIDATE_MANIFEST_SHA256 \
  --request-id UNIQUE_REQUEST_ID
```

Success reports `verified`, `method`, manifest/observer digests, boot/worker IDs
and `worker_stopped: false`. It establishes observation setup and cancellation,
not target exit, native selection or cleanup parity. The HTTPS idle response
budget is 120 seconds and client timeout 130 seconds; underlying request and
observer deadlines remain bounded separately. Request IDs are not replayed after
success or uncertainty. Confirmed executable failures are `failed`; uncertain
staging or observer state retains the admission hold for inspection. Known probe
failure after confirmed staging/child completion can release the hold while
preserving the executable mode change. These behaviors have local tests only;
actual TV service execution is not yet qualified.

`exec` returns `exit_code`, `timed_out`, `stdout`, and `stderr`, including on a
nonzero exit. A received timeout result is a known result. HTTP failures include
`outcome`: `rejected` means admission failed, `failed` means the worker returned an
operation failure, and `unknown` means a submitted operation's result could not be
confirmed. An operation failure does not imply rollback of its intermediate work.
The client never automatically replays commands or writes. Consult the request
journal and operation status after a lost response.

Operation response budgets in the migration candidate are 120 seconds for
`file.open`, `file.commit` and `helper.prepare`, 60 seconds for `file.read` and
`file.write`, and 30 seconds for other worker operations. HTTPS allows a further
five seconds and the bundled client ten seconds for the response. These fixed
budgets cannot be extended by request fields. They do not change command/job
execution deadlines, the native progress watchdog, request-body admission, or the
five-second keep-alive idle limit. Expiry closes the worker connection, returns an
unknown outcome and leaves a submitted mutation in the journal; it never retries
it. Older deployed clients retain their earlier timeout until updated. These
budgets have local transport validation and are not yet deployed to either TV.

`AgentTransport.execute_result()` returns the complete result. Existing setup
callers retain checked execution; `_execute(..., check=False)` is available when
only stdout is needed and a nonzero exit is expected.

The migration service accepts worker readiness only after matching the current
local boot ID, a valid worker identity, the expected implementation's complete
capability set, and launcher metadata. The existing managed status format without
an `implementation` field remains supported; an explicit mismatched implementation
is rejected. Native readiness validation additionally requires a pinned launcher
digest, independent staging, a guardian identity and production lifetime mode.
That validation path does not itself enable native selection.

Commands and operations are rejected while a connection is still being checked.
Disconnect and stop clear current worker status. Late replies or errors from an
old connection cannot restore readiness or overwrite a replacement's status.
Boot-launch inspection waits for worker validation. These checks require device
qualification, including service access to the local boot ID, before deployment.

The migration candidate reports `selected_implementation` (managed by default),
`worker_selection` and `native_candidate`. Candidate state is `absent`, `invalid`, or `verified`, with a
`checked_at` timestamp and a bounded reason code on failure. Verification reports
the native manifest digest and `device_qualified: false`; it does not establish
worker readiness, verify device libraries, or select native. Checks run at service
creation and before an acquisition attempt. Legacy packages remain supported, and
invalid optional candidate files do not disable managed fallback. These fields
are local migration work and are not yet deployed to either TV.

The optional private `worker-selection.json` record is an internal migration
journal, not an exposed switching API. Its absence preserves legacy managed
startup. Pending transitions, uncertain writes and mismatched managed package
versions block acquisition and new command admission with `selection-required`.
Existing work is not silently killed by a metadata change. A native selection
requires verified runtime evidence (`native-runtime-verification-required`).
The startup coordinator reconstructs an activated same-boot selection before
admission; the journal alone cannot authorize a worker. Record mutation requires
the controller to quiesce workers and verify artifact/state/readiness evidence. Do not create or
edit this file as a shortcut to native deployment.

`/v1/status` now includes `boot_id`, `uptime_seconds`, `worker_ready`, `worker_id`,
`last_root_acquired_at`, and capability names. Readiness requires root authentication
and a completed worker operation. The HTTPS listener may be available earlier.
Acquisition timestamps describe this service lifetime. A disconnected worker's
last identity/boot observation is not readiness.

After recording the current boot ID and separately requesting an authorized reboot:

```sh
python3 research/autonomous-root/client.py --config /private/client.json \
  wait-ready --previous-boot-id OLD_BOOT_ID --wait-seconds 240
```

This requires a different boot ID, a root identity, and worker readiness. It never
requests a reboot itself.

## HTTPS connection reuse

Agent service 0.6.0 honors an explicit `Connection: keep-alive` on successful
responses. JSON and binary responses carry exact content lengths. Each socket
serves at most 128 requests and has a five-second idle timeout; errors close the
connection. Mutual TLS enrollment and browser-origin checks still run on every
request. The existing eight-connection bound and serialized administrative
operations remain in force.

The Python client's `upload` and `download` each own a sequential `Session`.
They reuse one TLS connection across transfer setup, chunks and completion,
rotating before a new request after 128 requests or four seconds idle. The session
closes when the transfer scope exits. Every new socket undergoes certificate-pin
verification before submission, and implicit HTTP-library reconnection is disabled.
One-off `request`/`operation` calls still close their connections unless given an
explicit session; sessions must not be shared concurrently or across configurations.

A transport failure, invalid response, HTTP error or digest mismatch closes and
invalidates the session. No request is automatically replayed, including a request
that encounters a stale keep-alive socket. Diagnose the outcome before explicitly
resuming an upload. A successful response that explicitly closes the socket permits
a new, re-pinned connection for the next request; this also supports older services.
HTTPS reuse does not change the .NET worker or native app-user launcher.

## File transfer

```sh
python3 research/autonomous-root/client.py --config /private/client.json \
  download --source /usr/lib/example.so --target ./example.so
python3 research/autonomous-root/client.py --config /private/client.json \
  upload --source ./helper --target /opt/couchroot-agent/files/helper
python3 research/autonomous-root/client.py --config /private/client.json \
  upload --source ./helper-new --target /opt/couchroot-agent/files/helper \
  --expected-sha256 CURRENT_TARGET_SHA256
```

Transfers use 1 MiB binary HTTPS chunks, authenticated bounded loopback frames,
per-chunk SHA-256 and a complete-file digest. Agent 0.5.0 adds
`binary-download-v1`: the .NET worker sends a small HMAC-authenticated `OPDATA`
header binding the request sequence, offset, byte length and SHA-256, followed by
at most 1 MiB of raw bytes. The service verifies the pending read, range and digest
before returning any bytes over HTTPS. It rejects malformed, oversized, truncated
or corrupted responses by closing the worker channel; it never retries the request.
The worker and service must be upgraded together. HTTPS clients are unchanged,
and the new service still accepts the earlier JSON/base64 worker responses.

Agent 0.7.0 adds `binary-upload-v1`: the service sends an HMAC-authenticated
`OPWRITE` header binding the sequence, transfer ID, offset, byte length and SHA-256,
then at most 1 MiB of raw bytes. Chunk payloads are no longer encoded in JSON or
base64 between the service and the retained .NET worker. HTTPS clients are unchanged.
The journal binds the upload metadata, actual body length and verified digest.
The worker authenticates and bounds the header, reads the entire chunk before any
write, then verifies its digest and expected offset. Malformed framing or truncated
bodies close the channel; known operation failures leave it aligned. Durable chunk
flushes, final-file verification, conditional replacement and no-retry behavior are
preserved. Upgrade service and worker together; legacy JSON operations remain
available internally for compatibility, without automatic fallback after failure.

The worker holds at most eight
transfers, each limited to 2 GiB. Downloads support arbitrary byte offsets and
lengths up to 1 MiB. The client verifies the complete download before publishing
it and refuses to overwrite a local destination. In-place source changes fail
final verification; replacing the pathname does not change an already-open file.

Uploads are permitted in the worker's staging/runtime directories, the SDK staging
root `/home/owner/share/tmp/sdk_tools/`, and `/opt/couchroot-agent/files/`.
Canonical paths are required; symlink components are refused. Downloads permit
seekable disk files outside those write roots, but refuse `/proc`, `/sys`, `/dev`
and symlinks. Parent directories must exist, except the fixed managed files root.

Uploads stage beside the destination with mode 0600. Publication is create-only
by default (`expected_sha256: "absent"`), or replaces an existing destination only
when its current digest matches the supplied digest. Replacement uses rename;
create-only publication uses an exclusive hard link. Agent operations serialize
these checks. **Independent writers must be quiesced**: this is not a filesystem-wide
compare-and-swap guarantee. Replacement publishes mode 0600; metadata preservation
and executable installation are separate operations.

An interrupted upload prints its transfer ID. Explicitly resume the same source,
target and precondition using `upload --transfer-id ID ...`; the client first
checks the server offset and metadata. An uncertain chunk is never blindly resent.
Transfers belong to one worker lifetime. Reacquisition invalidates their IDs.
Abandoned sessions can be closed through `file.close`; a clean worker shutdown
removes incomplete staging files. A crash can leave staging files for inspection.
Partial downloads remain beside the requested local target and are never published.

The API uses `POST /v1/op` with `{ "id": "unique-request-id", "operation": {...} }`
for controls. `file.open`, `file.begin`, `file.status`, `file.commit` and `file.close`
return JSON. `POST /v1/files/read` accepts that envelope with `file.read`,
`transfer_id`, `offset`, and `length`, returning bytes with `X-SHA256` and `X-Offset`.
`POST /v1/files/write` accepts bytes and the JSON envelope in `X-Operation`, with
`file.write`, `transfer_id`, `offset`, and the chunk `sha256`. Each write response
returns the next offset. Mutations retain request-ID replay protection.

## Background jobs

```sh
python3 research/autonomous-root/client.py --config /private/client.json \
  job-start --job-id stress-example-0001 --command-file ./stress.sh \
  --timeout-ms 300000 --profile app
python3 research/autonomous-root/client.py --config /private/client.json \
  job-status --job-id stress-example-0001
python3 research/autonomous-root/client.py --config /private/client.json \
  job-tail --job-id stress-example-0001 --stdout-cursor 0 --stderr-cursor 0
python3 research/autonomous-root/client.py --config /private/client.json \
  job-cancel --job-id stress-example-0001
python3 research/autonomous-root/client.py --config /private/client.json \
  job-forget --job-id stress-example-0001
```

Job start returns after launch preparation; it does not wait for command completion.
Timeouts range from 100 ms to 24 hours. At most 16 jobs are retained in the worker,
with at most 64 durable records. `job-forget` removes a finished job and its record;
keep IDs unique even after forgetting. Intent is persisted before spawning.
Duplicate retained job IDs are refused. Root and app profiles are explicit.

For native jobs, the execution timeout starts after the running record is durable,
immediately before the command gate opens. Slow preparation can delay the start
response without spending the command's execution budget. Failed preparation
keeps the gate closed and retains the intent for inspection; it never retries the
command. The existing progress watchdog still bounds stalled preparation.

Each stdout/stderr stream retains its latest 1 MiB in memory. Tail responses contain
base64 bytes, `next_cursor`, `end_cursor`, and `truncated`; each read returns up to
64 KiB per stream. Advance each cursor independently. Consumers should decode bytes
incrementally because a UTF-8 character can cross a chunk boundary.

Cancellation sends SIGKILL to the job's process group. Jobs should remain in that
group; deliberately daemonized descendants are outside this supervision contract.
A clean worker shutdown cancels jobs. Metadata survives worker/service restart and
reboot, but in-memory output does not. Old-boot running records become `interrupted`.
Same-boot records whose supervisor disappeared become `unknown`, not completed or
restarted. Cancellation of a retained process checks both boot and process start
identity before signaling. No job is automatically rerun after reconnect or reboot.

## App-user execution and unsigned helpers

```sh
python3 research/autonomous-root/client.py --config /private/client.json \
  app-exec --command-file ./app-check.sh --timeout-ms 20000
python3 research/autonomous-root/client.py --config /private/client.json \
  helper-prepare --source /opt/couchroot-agent/files/helper --sha256 HELPER_SHA256
# Put the returned helper path in the app-exec or job-start command file.
python3 research/autonomous-root/client.py --config /private/client.json \
  helper-release --helper-id RETURNED_HELPER_ID
```

The app profile uses the signed worker's embedded native launcher. The .NET worker
continues to handle authentication, commands, jobs and transfers. The launcher
drops supplementary groups, uses UID/EUID 5001 and GID/EGID 100,
requires the `User` Smack label, sets HOME/USER/LOGNAME, PATH, the owner runtime
directory, Wayland display and D-Bus addresses, then runs in `/home/owner`.
A failed identity/label transition fails the command; it does not fall back to root
or the old managed launcher. Only standard input/output/error descriptors and an
explicit app environment reach the shell; inherited SDK/loader variables are removed.

During acquisition, the worker extracts its embedded ARM ELF into an exclusively
created, root-only directory under `/opt/couchroot-agent/launchers`, verifies its
digest, and creates a private read-only view. Root readiness requires successful
preparation. Each app invocation verifies the staged digest again. Clean shutdown
attempts to release its view and delete only its own two paths. Crashes or busy
mounts can leave directories for inspection; at 64 retained directories acquisition
refuses further staging. No arbitrary external launcher path is accepted.

`native-app-launcher-v1` in the ready worker's capabilities identifies this path.
The internal worker readiness handshake also returns the embedded launcher's SHA-256.
Build the toolchain image from `research/native-telemetry/collector/Dockerfile`
before preparing signed autonomous-root packages. The shared builder compiles from
source and embeds the result in the worker DLL for each TV framework. Ordinary
standalone .NET builds without the resource are useful for host tests but refuse
worker startup on a TV. `python3 scripts/check-root-launcher.py` verifies both
embedded targets and reproducibility without signing or contacting TVs.

Helper preparation copies a digest-verified managed upload into a dedicated,
root-owned `/opt/couchroot-agent/helpers/ID/helper`, applies mode 0555 and `User`
labels, and creates a private read-only bind view. It refuses the initial mount
namespace and never changes a Samsung resource or disables signature enforcement.
This encapsulates the previously investigated execution-view technique; **the new
implementation requires verification on each TV/firmware**. The two existing
profiles passed the hardware checks below; desktop tests alone cannot certify
app-user Smack or D-Bus behavior on other firmware.

There are at most eight active helper views and 64 retained helper directories.
Release explicitly after jobs finish. Clean shutdown attempts cleanup; crashes or
busy mounts can leave directories requiring inspection. Only worker-owned helper
IDs can be released automatically; unknown directories are not recursively deleted.

## Local validation

```sh
python3 -m unittest discover -s tests -p '*_test.py'
node --test tests/autonomous-root/protocol.test.cjs
npm test
dotnet build research/autonomous-root/payload/SamsungTvRootAgent.csproj
dotnet run --project tests/root-agent-harness/Harness.csproj
```

The harness exercises the production file operations and log ring on macOS/Linux.
When run as root in a disposable Linux container, it also tests real job execution,
nonzero exits, duplicate-start refusal, group cancellation, timeouts and reboot
records. It never contacts a TV. For that check, mount only the built harness output
into the SDK container; do not mount host `/opt` or device credentials.

Validation recorded on 2026-10-13: 217 Python tests, 104 Node tests with sequential
file execution, 20 telemetry tests, three protocol scenarios, and the Linux
root job harness passed. The first parallel Node run failed an unchanged native-Hub
process-group assertion; its isolated rerun and the complete sequential suite passed.
Both worker target frameworks compile. All 42 native assemblies and the unsigned
Hub package match across source paths. Privacy and whitespace checks passed.
Hardware acceptance followed separately, as recorded below.

## Hardware acceptance — 2026-10-13

Owner-authorized signed version 0.2.0, built from source commit `389ead8`, was
installed on both existing QN90A and S90D profiles through the shared setup engine.
The prior signed packages, enrollment backups and raw evidence remain private.
Both deployment journals completed after installed-content and post-reboot checks.

Both TVs passed:

- An 8 MiB + 123 byte upload with explicit resume after the first 1 MiB chunk,
  full SHA-256-verified download, and a 12,345-byte read spanning a chunk boundary.
- Rejection of a wrong current-file hash without changing the target, followed by
  successful replacement using the matching hash. A malformed binary chunk digest
  was rejected with the upload offset still zero.
- A 32-second app-profile job returning exit code 7 and retained output, explicit
  cancellation of a running job, and bounded output after producing 1,200,000 bytes.
  The latter reported cursor truncation and returned at most 64 KiB per tail read.
- App commands reporting UID/EUID 5001, GID 100, Smack `User`, the owner runtime
  directory, Wayland display and kernel D-Bus addresses.
- Upload, preparation and execution of an unsigned ARM helper as that app user.
  Mount readback confirmed the private helper view was read-only; release succeeded.
- A no-match `grep` returning exit code 1 and stdout normally, and a command timeout
  returning exit code 124 with `timed_out: true`.
- Automatic root-worker acquisition after a full software reboot, with a different
  boot ID and `worker_ready: true`. Readiness was first observed at approximately
  51 seconds of uptime on QN90A and 84 seconds on S90D; these are observations,
  not startup guarantees. App execution and digest/timeout checks passed afterward.

All 22 installed package inventory entries, enrollment certificates, protected
file hashes and enabled service boot flags verified after reboot. Developer Mode
was restored to loopback. Temporary SDK admission initially used a saved host
address while the administrator's Mac was on another network; access recovered
after correcting the Mac's network connection. No router change was required.
Samsung's HTTP Developer Mode address remained cached during live maintenance;
admission was instead checked against the live SDK setting while retaining model,
physical-device and firmware guards. Samsung's device-service reboot API was used
after S90D rejected the generic systemd reboot target.

The large-file check used an 8 MiB payload, not the 88 MiB Chromium library.
No power-loss, firmware-upgrade or long-duration stress acceptance is claimed.

The [native app-user launcher measurements](native-launcher/README.md)
compares measured command startup, worker memory, reacquisition and transfer costs
on both TVs motivated this implementation. The public app APIs remain unchanged.

## Native launcher acceptance — 2026-10-13

Signed autonomous-agent version **0.3.1**, built from `8df7949`, passed
owner-authorized deployment and hardware acceptance on both existing TV profiles.
The .NET worker remains installed; app commands and app-profile jobs now use its
embedded native launcher. Both shared deployment journals completed only after
post-reboot verification. Prior signed packages and private enrollment remain retained.

Both TVs passed:

- Verification of the signed build's native digest against the staged executable,
  root ownership, mode 0500 and a private read-only mount. App-user attempts to
  invoke this root-only path were denied before their command could execute.
- UID/EUID/saved UID 5001, GID/EGID/saved GID 100, no supplementary groups, zero
  effective capabilities and Smack `User`. The expected runtime environment was
  present; an injected environment marker and extra descriptor did not reach the shell.
- Exact single/double quotes, apostrophes, backslashes, newlines and post-reboot
  Unicode command output. Stdout, stderr and nonzero exit codes were preserved.
- A 31-second app job with output and exit code 7, app-command timeout, app-job
  timeout, and cancellation. Delayed descendant writes did not survive either
  timeout or cancellation. Unsigned helper upload, preparation, app execution and
  release also passed through the integrated launcher.
- Graceful worker reacquisition with the old launcher directory removed and a
  new native-capable worker ready, followed by quoted app execution.
- Full software reboot and autonomous root readiness with a new boot ID, then
  repeated app, timeout, digest-rejection, quoting and native-view checks. Readiness
  was first observed around 74.5 seconds of uptime on QN90A and 111 seconds on S90D;
  these are individual observations, not startup guarantees.

All 22 installed package inventory entries, enrollment certificates, protected
file hashes, enabled boot flags and restored loopback SDK host verified afterward.
Twenty short `app.exec` calls had median client round trips of 122 ms on QN90A and
110 ms on S90D. Earlier managed-launcher measurements were 303 ms and 455 ms;
these separate runs are indicative, not a paired performance guarantee.

The first QN90A 0.3.0 trial exposed an argument-quoting bug in the old command
runner. That trial's acceptance was cancelled, its evidence and signed package
retained, and 0.3.1 installed as a guarded forward correction. S90D received only
the corrected build. Structured process arguments now preserve the nested command;
the Linux harness covers that exact process boundary.

Local validation: 220 Python tests, 104 Node tests, 20 telemetry tests, native
failure-path tests on macOS and Linux, and the Linux root job/transfer harness
passed. Both embedded TV builds and the source-only cross-path native/unsigned
package builds reproduced. Public-source privacy and secret scans passed.

## Buffered protocol reads

The .NET worker uses one 64 KiB input buffer per connection for both protocol
lines and legacy binary payloads. It scans each block for newlines and retains
read-ahead bytes for the next frame or payload. Responses still write directly
to the duplex socket. The 4 MiB line limit, authentication, transfer chunk size,
digest checks and conditional-replacement rules are unchanged.

The local harness covers single-byte fragmentation, coalesced frames, split UTF-8,
CRLF, empty lines, exact-limit and oversized lines, truncated input, and binary
payloads spanning multiple buffers between text frames. An instrumented stream
rejects unbuffered byte reads and checks the number of block reads.

### Upload benchmark — 2026-10-13

Owner-authorized measurements compare agent 0.3.1 with buffered-reader 0.4.0
(source `1a89d14`) on the existing QN90A and S90D profiles. Each version ran three
8 MiB random-file uploads per TV using the existing client and 1 MiB chunks,
followed by downloads whose SHA-256 matched the source. Timings include the full
client operation, including transfer setup and commit; the same local payload was
reused before and after each TV's update.

| TV | Median upload before | Median upload after | Observed speedup | Upload after | Median download before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| QN90A | 37.93 s | 4.92 s | 7.72× | 1.63 MiB/s | 6.36 → 6.00 s |
| S90D | 41.20 s | 4.70 s | 8.77× | 1.70 MiB/s | 5.05 → 5.64 s |

Upload trial ranges were 35.79–39.05 s before and 4.44–6.05 s after on QN90A.
S90D ranges were 39.44–41.58 s before and 4.00–6.53 s after.
These are small before/after samples over the owner's network, not
isolated CPU measurements or a throughput guarantee. Both TVs collected their
baseline trials concurrently; updated-TV trials ran separately. Downloads did
not show a consistent improvement. No client protocol, chunk-size or native-worker
rewrite was required; the .NET worker and native app-user launcher are retained.

### Buffered-reader hardware acceptance

Signed version 0.4.0 passed the shared deployment and acceptance workflow on both
TVs. All 22 installed package inventory entries, existing enrollment certificates,
protected file hashes, enabled boot flags and restored loopback SDK setting were
verified after full software reboots. Both journals were finalized only after
these checks. Prior signed packages and raw evidence remain in private storage.

Both TVs passed an 8 MiB + 123 byte transfer resumed after its first chunk,
SHA-256-verified download, unaligned byte ranges, corrupt-chunk rejection, and
conditional replacement with both wrong and matching current hashes. Root and
app commands preserved quotes, Unicode, stdout, stderr and nonzero results.
App execution and unsigned helper staging/release retained UID 5001, GID 100 and
Smack `User`. Long jobs, bounded logs, cancellation, timeouts and stopped
descendants also passed.

After reboot, a different boot ID and ready root worker were observed at about
70 seconds uptime on QN90A and 108 seconds on S90D. Post-boot checks repeated
app execution, quoting, timeout and digest rejection, verified the protected
native launcher, and completed another 1 MiB + 17 byte upload/download with a
matching SHA-256. These are software reboot observations, not physical power-loss
or firmware-upgrade acceptance.

Local validation passed: 220 Python tests, 104 Node tests, 20 telemetry tests,
the buffered-reader harness and Linux root job/transfer harness, both embedded
TV build reproducibility checks, and all 42 source-only native assemblies plus
the unsigned Hub package across build paths. Public-tree and outgoing-commit
privacy/secret scans were clean.

## Binary download benchmark — 2026-10-13

Owner-authorized trials compared agent 0.4.0 with signed 0.5.0 built from
`faaa6e2`, retaining the .NET worker and native app-user launcher. Each TV ran
three uploads/downloads of the same 8 MiB random payload per version, using the
unchanged client, 1 MiB chunks and complete SHA-256 verification. Download times
include opening/hashing the source, HTTPS requests, local file synchronization,
publication and transfer close.

| TV | Median download before | Median download after | Observed speedup | Download after | Median chunk read before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| QN90A | 5.84 s | 3.64 s | 1.61× | 2.20 MiB/s | 656 → 346 ms |
| S90D | 4.99 s | 2.03 s | 2.46× | 3.94 MiB/s | 558 → 228 ms |

QN90A download trials ranged from 5.76–5.89 s before and 3.03–3.65 s after;
S90D ranged from 4.78–5.26 s before and 2.01–2.22 s after. Per-chunk medians use
all 24 full-size reads in each set. Both TVs collected baselines concurrently;
updated-TV trials ran separately. These are small samples over the owner's
network, without isolated CPU/load controls, and are not throughput guarantees.

Upload medians in those same trials were 4.75 → 5.17 s on QN90A and
4.05 → 4.93 s on S90D. Upload framing was unchanged; these samples do not
establish an upload improvement or a cause for that variation. Fresh TLS
connections per request remain part of both versions' measured cost.

The download change removes both base64 layers and JSON serialization for chunk
responses on the local worker connection. Its receiver accumulates text frames
with bounded geometric buffer growth and copies binary bodies into a buffer
sized only after authenticating and validating their header. Other operations
retain authenticated text responses, including known failures; a partial binary
write cannot be followed by a misleading success or failure frame.

### Binary download hardware acceptance

Both signed 0.5.0 deployments completed through the shared setup engine after
full software reboot and post-boot verification. All 22 installed inventory
entries, enrollment certificates, protected file hashes, enabled boot flags and
restored loopback SDK setting verified. Previous signed recovery packages and
raw evidence remain private.

Both TVs passed resumed 8 MiB + 123 byte transfers, complete-file digests,
unaligned ranges, bad-chunk rejection, and conditional replacement with wrong
and matching current hashes. App-user commands, native launcher protections,
unsigned helper staging/execution/release, nonzero results, bounded logs, long
jobs, timeouts, cancellation and stopped descendants also passed.

After reboot, the new binary-download capability and root readiness were observed
with different boot IDs at approximately 51 seconds uptime on QN90A and 88 seconds
on S90D. A fresh 1 MiB + 17 byte upload/download matched its digest on each TV;
a direct read at EOF returned a valid zero-byte binary response. Post-boot app,
quoting, timeout, digest rejection and native-view checks passed. Both deployment
journals were then finalized. This does not claim physical power-loss testing.

Local validation passed: 220 Python tests, 116 Node tests, 20 telemetry tests,
the production .NET wire-format/transfer harness and Linux root job harness.
Protocol tests cover fragmented headers/bodies, adjacent text responses, zero
and maximum-length bodies, authentication/digest failures, wrong sequences and
ranges, oversized input, truncation, and legacy JSON/base64 compatibility. Mutual
TLS tests verify raw HTTP response bytes/headers and reject a bad worker digest.
Both embedded TV builds and all 42 source-only native assemblies plus the unsigned
Hub package reproduced across build paths. Public-tree and outgoing-commit
privacy/secret scans passed.

## HTTPS reuse benchmark — 2026-10-13

Signed agent 0.6.0 was built from `105d020`. Both TV builds contain a .NET worker
byte-for-byte identical to 0.5.0; this change is confined to the HTTPS service and
Python client. The native app-user launcher remains in place.

After collecting three 0.5.0 baseline trials per TV, the 0.6.0 comparison alternated
fresh connections and reuse on the same installed version. Each mode ran three
8 MiB uploads/downloads per TV using the same random payload and 1 MiB chunks.
Every download matched the original SHA-256. Timings include transfer controls,
chunk requests, hashing and local publication; actual TLS connects were counted.

| TV | Download median, fresh → reuse | Download time reduction | Upload median, fresh → reuse | TLS connections per transfer, fresh → reuse |
| --- | ---: | ---: | ---: | ---: |
| QN90A | 2.85 → 2.48 s | 13% | 4.57 → 5.17 s | 10 → 1 |
| S90D | 2.19 → 1.39 s | 36% | 4.96 → 4.90 s | 10 → 1 |

Download trial ranges were 2.78–2.86 s fresh versus 2.45–2.77 s reused on QN90A,
and 2.07–2.46 s fresh versus 1.28–2.54 s reused on S90D. Upload timings varied
substantially: QN90A reuse ranged from 3.62–5.62 s and S90D from 3.37–4.91 s.
These small samples demonstrate fewer TLS connections and lower median download
times; they do not establish a consistent upload speedup or a throughput guarantee.
Network, runtime and storage load were not isolated.

The earlier 0.5.0 baseline medians were 3.10 s download / 4.03 s upload on QN90A
and 3.12 s download / 3.94 s upload on S90D, also with ten connections per transfer.
Those baselines ran concurrently across TVs. The reported reuse gains above use
the stronger alternating, same-version comparison instead of attributing all
before/after variation to this change.

### HTTPS reuse hardware acceptance

Both signed 0.6.0 updates completed through the shared setup engine after software
reboot and post-boot acceptance. All 22 installed inventory entries, existing
enrollment certificates, protected file hashes, enabled boot flags and restored
loopback SDK setting verified. Prior signed packages and raw evidence remain private.

Both TVs passed resumed transfers, complete-file digests, arbitrary ranges, EOF,
corrupt-chunk rejection and conditional replacement. App-user identity, native
launcher protections, unsigned helper staging/execution/release, nonzero results,
long jobs, bounded output, cancellation, timeouts and stopped descendants passed.
Root readiness with a new boot ID was observed around 46 seconds uptime on QN90A
and 93 seconds on S90D, followed by another SHA-256-verified multi-chunk transfer.
These are software reboot observations, not physical power-loss tests.

Post-boot connection tests on each TV confirmed three status requests on one TLS
connection, rotation after 4.2 seconds idle, two connections across 129 sequential
requests, closure at scope exit, and rejection of an incorrect server pin before
an HTTP request could be sent. All deployment journals were finalized afterward.
Before S90D's update, the new client also verified safe compatibility with its
older service: two successful requests used two connections as instructed by the
service's close responses.

Local validation passed: 226 Python tests, 116 Node tests and 20 telemetry tests.
The Python and Node service were tested together over real local mutual TLS for
reused JSON and binary requests. Tests cover server request-limit closure, origin
checks on a reused socket, per-connection pinning, client rotation, stale sockets,
timeouts, truncated/invalid responses, failed-session closure and no replay.
Both embedded TV builds and all 42 native assemblies plus the unsigned Hub package
reproduced across build paths. Public-tree and outgoing-commit privacy/secret scans
passed; raw device data, credentials and signed packages were excluded.

## Binary upload benchmark — 2026-10-13

Agent 0.7.0, built from source commit `54f2182`, removes nested base64/JSON
encoding of upload chunk bodies between the HTTPS service and the .NET worker.
The worker remains .NET; the native app-user launcher is unchanged. A full 1 MiB
chunk now travels as raw bytes plus a small authenticated header, eliminating
approximately 44% of the previous loopback request bytes.

The same client uploaded an 8 MiB random file three times per TV before and after
the update, with 1 MiB chunks, durable flushes, complete-file SHA-256 verification
and one pinned TLS connection per transfer. Each upload was downloaded and verified.
Numbers include setup, chunks and commit; they are medians of complete transfers.

| TV | 0.6.0 upload | 0.7.0 upload | Less time | Throughput change |
| --- | ---: | ---: | ---: | ---: |
| QN90A | 4.22 s | 2.68 s | 37% | 1.58× |
| S90D | 5.28 s | 2.84 s | 46% | 1.86× |

These are small before/after samples on a live wireless network, not an isolated
CPU benchmark or a throughput guarantee. Individual upload times varied:
QN90A 4.14–5.30 s before and 2.39–4.04 s after; S90D 3.80–6.59 s before and
1.95–4.44 s after. Downloads were unchanged in code; their median timings were
2.64 → 2.73 s on QN90A and 1.18 → 1.24 s on S90D.

Both installed packages passed file inventory and enrollment checks, retained the
protected system-file hashes, restored SDK loopback access, and preserved existing
boot settings. Live acceptance covered maximum-sized binary chunks, unknown
transfers, wrong/replayed offsets, digest rejection without offset advancement,
resume, byte ranges, EOF, final hashes and conditional replacement. It also covered
app UID 5001 and Smack `User`, quoted commands, runtime environment, native launcher
integrity/read-only mounting, unsigned helper staging/execution/release, nonzero
results, long jobs, cancellation, timeouts and bounded logs. HTTPS reuse, idle/count
rotation and certificate-pin rejection passed on both TVs.

**Neither TV was rebooted, at the owner's request.** Both boot IDs remained
unchanged through acceptance. Reboot persistence was not tested for this version.

Local validation passed 226 Python tests, 118 Node tests, 20 telemetry tests,
the legacy protocol checks, the .NET harness on macOS and Linux (including process
supervision on Linux), reproducible ARM launcher/embedded-worker checks and
cross-path source-only builds. Upload protocol tests cover authenticated metadata,
raw byte preservation, fragmented/coalesced reads, bounds, truncation, digest and
offset failures, channel alignment and no replay after disconnect. Private device
identities, signed artifacts and raw evidence remain outside the repository.

## Native worker experiment

The [C worker prototype](native-worker/README.md) began as a sidecar experiment.
Signed 0.7.28 now packages it for explicit migration, public operation and same-boot
recovery trials on both TVs. Managed remains the selected fallback after acceptance.
Earlier sidecar performance measurements do not establish production performance
or .NET independence; acquisition still uses managed code.

## Worker handoff inventory

Workers advertising `resource-inventory-v1` add `resources` to their fresh wire
`status` result. Schema 1 has scope `worker-owned`, up to eight transfers
(`id`, `direction`), sixteen in-memory jobs (`id`, `state`, `monitor_finished`),
and eight helper IDs. Array order is unspecified. Completed in-memory jobs remain
listed until forgotten. Disk-only records and old helper directories are excluded.
No paths, command text or output are included. `monitor_finished` means that job's
monitor finished; it does not prove descendant cleanup, output draining or durable
state reconciliation. Empty arrays alone do not establish quiescence.

The service has an internal `holdAdmission()` interface for the upcoming handoff
controller, with no HTTP route or CLI switch. It immediately blocks new requests,
reports `admission_held`, `in_flight_requests`, phase `draining` and
`worker_ready: false`. Its `snapshot()` waits for already-admitted requests, then
requests and validates fresh inventory from the same connection, generation,
boot and worker identity. An uncertain drained result, missing inventory capability,
invalid inventory or changed connection refuses the snapshot and leaves the hold
in place. An explicit `release()` resumes that same worker; stop invalidates old
handles. The hold never cancels jobs, closes transfers, releases helpers, migrates
records or commits selection. It is process-local; the selection journal is required
to prevent admission after a service restart.

The controller must separately reconcile prior unknown journal outcomes, saved
records and resource ownership, then verify shutdown before state installation.
The ordinary readiness path continues to accept older managed workers without
this capability; those workers cannot provide a handoff inventory.

Workers advertising `worker-process-identity-v1` also report `processes.worker`
and `processes.guardian`: each identity contains a PID and decimal `start_ticks`
string. The managed guardian is null. Native reports its supervising guardian.
These identities are bound to boot and worker ID and checked against the
authenticated worker PID. Start ticks remain strings to avoid integer rounding.

An internal hold's `shutdown(transactionId)` supports the current managed selection.
Initialize the selection journal before creating the hold. After inspection, bind
the fresh snapshot's JSON SHA-256 to the pending prepared transaction's
`quiescence_sha256` field. This field binds the pre-shutdown inventory; it is not
itself proof of process exit or filesystem cleanup. Shutdown repeats the snapshot,
requires its hash and source version to match that transaction, refuses open
transfers/helpers and unfinished or uncertain jobs, and verifies current process
identities before sending the existing authenticated `SHUTDOWN` frame once.

The wire client requires a matching `BYE` and disconnect within ten seconds.
Because `BYE` precedes cleanup, the hold then observes `/proc` for up to ten seconds
to establish that the original process identities have gone. A different start
time means that PID was reused; it is never signalled. A matching zombie remains
present. Permission errors, malformed observations, boot changes and deadline
expiry fail the check. Both worker and guardian must be gone for native process
observations. No automatic reacquisition occurs while admission is held; a
replacement connection during submitted shutdown is refused. The hold cannot be
released after submission, including an uncertain result.

The result binds transaction ID, source manifest, inventory hash, acknowledgement
and process-exit observations. It does not advance selection, install data or prove
that every detached managed descendant, mount or retained record is reconciled.
Those are separate gates before state installation. Focused hardware probes found
that QN90A's service identity can read the required proc-stat fields, whereas
S90D's package-labelled identity receives EACCES. The direct observer remains
unavailable on S90D; permission denial must never count as absence. S90D's kernel
supports unprivileged pidfd binding and exit polling, verified across an ordinary
native sidecar's shutdown. A production pidfd bridge and actual wrt-service
integration remain required. The probes match service credentials in separate
processes; they do not update or exercise new code inside the installed service.

## Selected-native recovery

An activated native selection now survives service restart, disable/enable and
worker transport loss on the same boot. A temporary managed bootstrap acquires
root using the existing SDK and archive path, with public admission closed,
then verifies and launches native from the committed staging. The original
selection and activation receipts remain unchanged; a separate runtime receipt
binds the new worker identity. `.NET` remains required for this acquisition path. See the
[dependency inventory](native-worker/DOTNET-INVENTORY.md) for setup, rescue and
service callers, replacement options and removal order.

Transfer/helper IDs and in-memory job output belong to the worker lifetime.
Retained job metadata survives; interrupted public operations retain unknown
outcomes and are never replayed. A stale or cross-boot binding refuses admission.
A pending active-native return is reconciled under its original transaction,
including existing restore receipts and any previous managed launch. Status
reports `durable.native_startup` and `durable.restart_return`. An explicit
`resume-managed` after restart must name the original return request ID.
Previously launched managed staging is retained and reported after return
recovery; native/provider staging is removed only after exact verification.


## Native public-operation parity — 0.7.28

Both installed TVs passed commands with nonzero exits, separate stdout/stderr,
foreground and job timeouts, app-user UID/GID and home-directory checks, helper
prepare/execute/release, and file upload/download through the enrolled HTTPS client.
The file round transferred 8,388,679 bytes in 1 MiB chunks, checked the whole-file
SHA-256, read across a chunk boundary and at EOF, rejected a bad chunk digest and
wrong replacement condition, and then replaced the file under the correct digest.
Job checks covered output-ring truncation, bounded tails, explicit cancellation,
forgetting completed records and retained outcomes after return to managed.
See [aggregate evidence](native-worker/public-parity-results.json) and the
[differential contract](../../tests/worker-parity/contract.json).

A running job prevents return before a selection transaction begins. Native stays
ready with its existing identity. The caller must wait for completion or explicitly
cancel the owned job, close transfers and release helpers, then submit a fresh
return request ID. A rejected return no longer prevents that subsequent request;
the rejected ID remains protected against replay. Return does not cancel jobs
implicitly. `job.status` exposes `exit_code` at the top level for in-memory jobs;
disk-only jobs expose it in `record`. Completed and cancelled native-created records
survive the return alongside imported managed records. In-memory output does not.

Both TVs also restarted the app service during an active return, recovered the
original durable transaction, and completed `resume-managed` bound to its original
request ID. That request's unconfirmed journal entry remains `submitted`; the
separate recovery request records completion. No public failure-injection endpoint
is involved. Native/provider scopes were removed, rescue timers disarmed, and SDK
access returned to loopback on the same boot.

The intentional differences are:

| Area | Native contract |
| --- | --- |
| Saved-job cancellation | Only currently owned jobs can be signalled. Saved PIDs are never authority to cancel a process. Same-boot uncertain records remain unknown and cannot be forgotten. |
| Commands and cancellation | Native retains its reported strict fault/signal policy and owned-descendant supervision. Full arbitrary signal-handler compatibility remains a rollout gate. Neither public foreground route has a cancel endpoint; use jobs for explicit cancellation. |
| File ownership | Native `.jobs` and `.views` metadata are inaccessible through transfers. Native rejects a non-regular destination at begin and a moved/replaced parent at commit. |
| Concurrent file changes | Native hashing is bounded by the initial size and rejects size changes. Same-size external changes and publication races still require writer quiescence; no filesystem snapshot or general compare-and-swap is promised. |
| Helpers and volatile state | Helper paths are implementation-specific (`native-helpers` versus managed `helpers`). Use the returned path/ID. Transfer/helper IDs and job output expire with the worker; retained job metadata persists. |
| Diagnostics | Native status and results may include additive fields such as `output_truncated`; the shared result fields, limits and outcome classifications remain unchanged. |

The local seven-group managed/native differential suite, six process rehearsals
and eleven restart scenarios passed with freshly rebuilt fixtures. The installed
round is bounded acceptance, not a 2 GiB hardware transfer, endurance, reboot,
standby/resume or native-default qualification. .NET remains required and deployed.


## Independent native SDK rescue

The [standalone native recovery utility](recovery/native/README.md) can restore
`db/sdk/develop/ip` through system libvconf with no managed runtime or active
Couchroot worker. It supports immediate conditional `set` and delayed `watch`,
refuses drift and verifies readback. The caller still owns root acquisition,
firmware/boot/digest checks, the private read-only executable mount, SDB restart,
timer ownership and reconciliation. No new HTTP operation is added.

Both TVs passed external SDK restoration while their worker was disabled and
HTTPS coordinator suspended, then native restoration to loopback and managed
readiness. Existing .NET rescue bytes, enrollment and retained state were
preserved; the backup .NET timer never fired in the final acceptance rounds.
Earlier S90D harness-resumption failures used the preserved backup; see the
[migration record](native-worker/MIGRATION.md). The native utility is installed
separately, leaving signed agent 0.7.28 unchanged. This closes the utility's runtime
dependency, not the managed acquisition/bootstrap dependencies or all existing
private rescue callers. Reboot and standby remain outside this qualification.

## Native setup acquisition pilot

The [native acquisition pilot](../native-root-acquisition/README.md) implements
private namespace/archive orchestration and bounded commands in C. It is selected
explicitly through `root.execute(native_bundle=...)`; default setup and service
acquisition remain managed. `NativeEntry.dll` still supplies trusted capability
entry and a private read-only code bind before loading the native library.
This intermediate bridge is not .NET-free acquisition.

Both TVs passed SDK acquisition with the Couchroot worker disabled, owner/root
identity checks, one root command, nonzero-exit refusal and a 25-second command
deadline with cleanup. The managed path was exercised separately after confirmed
native cleanup. Original system resources, SDK archives, enrollment, selection
and retained jobs were preserved; both ended managed-ready on SDK loopback with
trial timers disarmed and the 300-second .NET rescue unused.

Intentional native limits include a NUL-free script below 64 KiB, a 64 KiB merged
output stream, exact owner UID 5001/GID 100 checks, full root credential checks,
and exclusive passwd-view creation. Allowlisted app cleanup remains managed.
No HTTP API, persistent capability, platform policy, package version, reboot or
standby behavior changed. See the [aggregate evidence](../native-root-acquisition/results.json).

## Native service acquisition and held startup

Packages prepared with `--native-candidate --native-acquisition` use the shared
C archive/namespace adapter through `NativeEntry.dll`. The signed-package manifest
binds the model, runtime and all adapter bytes. The loader accepts only the unique
service stage and its canonical `/opt/usr/home` alias, creates a private read-only
code bind, then enters C. C verifies SDK credentials/capabilities, the exact staged
passwd view, baseline owner credentials and full root credentials before running
the bounded launch operation. Runtime/launcher hashes remain checked in SDK context.

For a committed native selection without a retained return/rollback recovery
context, the launch starts a separate authenticated
`--held-bootstrap` worker in a root-owned systemd scope. Its lifetime is fixed at
300 seconds; it accepts only loopback, status, bounded exec, ping and shutdown.
Jobs, helpers, app execution and file transfers are refused. Public admission
stays closed while it verifies the existing selection and retained state, launches
selected native, and verifies the replacement worker and unit. The bootstrap is
then shut down; its boot/PID/start-time/unit identities and exact staging contents
are checked before retirement and public admission. It never becomes a selected
public worker.

The schema 2 private bootstrap receipt precedes an exclusive, atomic
`bootstrap-launch.pending` pointer and SDK submission. The pointer is a relative
symlink to that exact receipt in the private state directory; recovery never
follows an arbitrary target. The receipt binds the boot, selection bytes, artifact
hashes and unique root scope. A root-owned launch fence serializes launch against
recovery and retains a seal that prevents a delayed original command from starting.

After a coordinator restart, a fresh managed executor stays held while it seals
the original fence and verifies that the old unit/cgroup and any recorded process
identities are gone. It accepts only absent files or the exact expected bytes,
types, owners, modes and link counts, and refuses extra scope contents. A failed
unit is reset only after these ownership/absence checks. Cleanup can continue
after a lost reply without submitting the launch again. The retired receipt is
durable before the pending pointer is removed; selected-native startup then resumes
under the unchanged selection. `durable.bootstrap_recovery` reports this progress.

The seal and lock remain as small root-owned tombstones after scope retirement;
they are not silently removed while a delayed SDK command could still exist.
Local source also permits an authenticated new-boot executor to seal an old
schema-2 bootstrap attempt. Historical PID/start pairs are not current process
identities. The old transient unit must be absent; a reused name refuses cleanup
even when its current PID is zero. New-boot cleanup never stops or resets a unit.
Exact staging checks still apply, and the retired receipt retains its original
boot alongside `reconciled_boot_id`. This path is locally tested, not deployed or
qualified on either TV.

Changed selection, legacy schema 1 launches, unbound or malformed receipts,
unknown bytes and live current-boot processes remain blocked. Interrupted returns and forward
rollback retain the managed held executor and original transaction receipts.
There is no new public operation or production fault hook.

The original managed acquisition adapter and worker remain packaged. Omitting
`--native-acquisition` retains the prior path. Private configuration may explicitly
select `service_acquisition: "managed"` or `"native"` for a subsequent service
start; `"native"` requires the corresponding package. This is an operator choice,
not an automatic retry after an uncertain native result. The small trusted managed
entry bridge still requires .NET, even when the selected worker and held bootstrap
are native. Native-default, reboot, standby and .NET-free capability entry remain
separate qualification gates.

Signed 0.7.30 passed native disable/enable, transport loss and service restart
on both TVs, with three verified bootstrap retirements per TV and preserved jobs.
Both ended managed-ready on SDK loopback. This round qualified interrupted return
on QN90A and normal return on S90D; see
[service acquisition results](native-worker/service-acquisition-results.json).


Signed 0.7.32 additionally passed automatic same-receipt recovery after coordinator
interruption at both submitted and ready native-bootstrap phases on each TV.
Both returned to managed with retained jobs preserved, scope/process absence
verified, SDK on loopback and all owned test/rescue units inactive. The original
launch was not replayed; root-owned fence tombstones remain. See
[bootstrap recovery results](native-worker/bootstrap-recovery-results.json).


## Forward migration interruption recovery

Signed 0.7.32 now has both-TV same-boot acceptance for coordinator interruption
at provider readiness and retained-state readiness, plus provider loss followed
by coordinator restart. Startup verifies that the original processes and units
are idle, validates retained managed state, and rolls back the original selection
transaction. A separate explicit cleanup verifies remaining staging and removes
its ownership markers before another migration is admitted. Original interrupted
request rows retain their uncertainty; recovery does not replay the request.

These rounds do not establish later production readiness or cross-boot recovery.
For live-coordinator recovery and its S90D cleanup limit, see below. The managed
fallback and independent SDK rescue remain available. See
[forward recovery results](native-worker/forward-recovery-results.json).


## SDK native-entry investigation

Signed 0.7.33 can include a read-only capability receipt with
`--native-entry-probe`. It is not connected to public operations or automatic
acquisition. Both SDK vendor-loader trials produced no constructor receipt;
therefore this path is not qualified to replace the managed bridge. The fixed
bundle codec passed byte-identical round trips through both target libraries.
All owned trial resources were cleaned and managed readiness restored without
replaying either invocation. The .NET fallback and independent rescue remain
unchanged. See [probe contract](../native-root-acquisition/entry/README.md) and
[hardware evidence](../native-root-acquisition/entry/results.json).


## Live forward-failure recovery

A settled failure before native commit now gates a fresh managed acquisition in
the original coordinator. This applies only when the durable forward transaction
and its recorded provider/source evidence match the failed controller. The gate
is installed before closing its source, provider and production transports. No
public operation is admitted until the existing read-only rollback verifier
confirms old process/unit absence, a distinct managed executor on the same boot,
and unchanged retained managed state. It then rolls back the original selection
transaction. Closing a transport alone never proves that its worker has exited.

Malformed or missing evidence, a selection writer, a published commit, activation
failure and managed-return failure do not enter this path. They retain their
existing reconciliation boundaries. A transport-close failure leaves the original
hold intact. Recovery never replays provider launch, state installation or the
original migration request; it acquires only a fresh held managed executor.

Native status exposes `durable.restart_rollback.trigger: "live-forward-failure"`
and the failed controller phase. The original background operation remains unknown
and its journal row remains submitted. Its `recovery_transaction_id` permits
`cleanup-restart` only for that exact, successfully rolled-back transaction, using
a fresh request ID. Cleanup remains explicit; an unknown cleanup requires the separate original-request
binding described above. After verified cleanup, a new migration or
rehearsal can use the same coordinator. No fault-injection API is introduced.


Signed 0.7.34 qualified automatic rollback/readmission after provider loss on both
TVs without restarting the original coordinator. QN90A also passed normal explicit
cleanup. S90D's unpaused trial retained an external observer remnant, so generic
cleanup stayed unknown until separate guarded observer retirement and a later
coordinator restart allowed reconciliation of the same cleanup intent. S90D cleanup
without maintenance was not qualified by that 0.7.34 round. A preceding paused S90D trial lost its
coordinator and was recovered through the independent .NET SDK rescue; its cause
remains unresolved. Both TVs ended managed-ready, settled, and on SDK loopback,
with retained jobs, enrollment and recovery bytes preserved. See
[live recovery results](native-worker/live-recovery-results.json).


Signed 0.7.36 subsequently qualified terminal observer retirement and bound cleanup
continuation on both TVs. An inert owned file forced cleanup refusal; after that
exact test file was removed, a fresh request naming the original cleanup and
transaction completed reconciliation. S90D advanced its observer checkpoint from
prepared to complete and retired the recorded resources through service code.
Both original coordinators remained running throughout rollback, refusal and
continuation. Original migration and cleanup rows remain submitted; the continuation
alone is completed. Both TVs ended managed-ready and settled on SDK loopback,
with retained state, enrollment and .NET recovery preserved. See
[observer cleanup results](native-worker/observer-cleanup-results.json).


The unchanged signed 0.7.36 packages also passed production-readiness guardian
loss on both TVs. With a submitted production record and readiness still pending,
the bound guardian was terminated without pausing the coordinator. Automatic
rollback/readmission and explicit staging cleanup completed on the same
coordinator. Retained state and enrollment stayed unchanged, original migration
journal rows remain submitted, and both TVs returned to settled managed readiness
on SDK loopback. This qualifies that pre-commit boundary; wider interruption and
power-lifecycle cases remain open. See
[production recovery results](native-worker/production-recovery-results.json).


## Guardian-owned persistence recovery — 0.7.44

Selected-native startup can reconcile bounded initial-intent, repair and
record-save temporaries when a complete stale guardian journal matches the last
accepted native runtime. The service pins file identities and bytes, and the
native worker performs recovery under its scope lock. Public admission requires
retained-record readback, unchanged terminal bytes, the exact final inventory,
and removal of the admitted temporaries. Foreign or incomplete guardian journals
remain held; managed-return snapshots retain their stricter contract.

Both TVs passed real guardian loss followed by owned crash-state file injection,
automatic native reacquisition on the same coordinator, managed return and public
fixture retirement. Unpublished intents did not launch, the live witness remained
singular, and existing records, enrollment and protected files were preserved.
All 19 payload members are unchanged; .NET acquisition and fallback remain
available with the independent rescue. This qualifies the modeled persistence
boundaries, not power loss or pre-readiness guardian ownership. See
[persistence recovery results](native-worker/persistence-recovery-results.json).

## Launch-bound pre-readiness recovery — 0.7.45

Each new selected-native startup attempt binds its original transaction, boot,
source worker and token digest to a durable exclusive launch fence. Complete
native startup journals and authenticated readiness report that same digest.
Retiring an uncertain attempt seals its fence, excludes a delayed launch and
proves the original unit/processes absent before recovery can proceed.

A sealed submitted attempt may authorize its pre-readiness guardian checkpoints,
including bounded partial successor or unpublished initial files. Complete
identities, phases and token bindings must agree. Partial bytes never supply an
identity. The service pins exact files and absent checkpoint names; native
performs resource ownership checks and reconciliation under the scope lock.
Unexpected job metadata and records owned by an unaccepted worker are refused.
Retained-record readback, checkpoint cleanup and final authenticated readiness
gate admission. Recovery archives the original attempt and uses a fresh launch;
it does not replay commands or jobs. Unbound legacy attempts and foreign journals
cannot use this admission path. The .NET entry bridge, managed fallback and
independent rescue remain available.

Both TVs passed partial-successor and unpublished-initial checkpoint recovery
with ordinary signed 0.7.45 workers. The private harness modeled lost readiness
publication while acquisition was disabled and verified the fixtures through
independent SDK access. The same coordinator recovered native, preserved retained
bytes, and returned normally to managed; public forgetting retired only fixture
jobs. Both ended managed-ready and settled with SDK on loopback, owned units
inactive and old/replacement native scopes absent. No rescue fired, and enrollment
and boot identity stayed unchanged. Real checkpoint fault exits are tested locally;
this does not qualify power loss or natural interruption at the exact write.
See [startup binding results](native-worker/startup-binding-results.json).


## Single durable job admission — 0.7.46

Native job admission publishes a complete running record once while the
contained child is held behind its gate. Both file and directory sync precede
command execution; terminal persistence is unchanged. Existing publication names
are refused before fork, and exclusive publication never replaces a late foreign
record. Unpublished failures retire the gated child; published uncertain outcomes
retain their ID for reconciliation. Allocation, pipe, fork and identity failures
retain rejected-ID evidence when storage permits. No recovery path replays work.

Both TVs passed signed public root/app jobs and return to managed, plus bounded
per-worker address-space refusal/restart and an ordinary-worker latency comparison.
Original records, enrollment and boots were preserved; test resources were retired
and independent rescues were verified inactive without firing. Local tests cover
publication interruption and injected launch/storage failures. This does not
qualify power loss or sustained pressure. Performance and endurance gates remain
open, and the .NET entry bridge, worker fallback and independent rescue remain.
See [single-publication results](native-worker/single-publication-results.json).


## Endurance transfer recovery and reboot scope

The host endurance harness now preserves a separate checksum download for every
transfer index and refuses any replay with an existing intent. Two consecutive
native 1 MiB transfers passed on QN90A. Both TVs have fresh supervised endurance
runs using the corrected helper; neither has completed the 24-hour gate.

S90D recovered after an explicitly authorized software reboot and host-assisted
SDK loopback restoration, with original selection, jobs and enrollment preserved.
Its managed readiness is verified on the new boot. The installed selected-native
restart receipts remain bound to their original boot; this recovery does not
qualify native cross-boot startup. The .NET entry, managed worker and independent
300-second rescue remain available. See [transfer and recovery evidence](native-worker/observer-transfer-recovery-results.json).


## Local cross-boot startup integration

Local source now binds a selected-native restart to the held executor's observed
boot, preserving the original activation and migration source. A schema-2 runtime
receipt may replace only the boot, worker identity and unit start binding. Initial
production launch validation stays strict. Schema-3 startup attempts separately
record the previous runtime boot and the new launch boot; old fences can be sealed
on the current boot but cannot authorize replay. Retained-state, managed return
and activation verification use the appropriate original or current identity.

Three modeled reboot integration cases cover stale guardian recovery, interrupted
new-boot startup, and a runtime receipt published before startup completion. Each
also restarts the service again on the new boot and returns to managed while
preserving retained records. These use synthetic historical receipts and real
native/managed fixture workers; they do not prove TV reboot behavior. The code is
not installed on either TV, and both 0.7.48 endurance runs remain undisturbed.
Interrupted-bootstrap recovery across boots is implemented locally as described
above; pending-return recovery is described below. Hardware qualification of the
cross-boot paths and broader power lifecycle acceptance remain open. Neither
.NET fallback is removed.

## Local pending-return recovery across boots

Pending native-to-managed returns can now finish on a fresh authenticated boot
under their original request and transaction IDs. Historical PID/start pairs
cannot identify current processes, and a reused transient-unit name blocks
recovery. Original activation and restore receipts remain unchanged while their
execution guards use the observed boot.

A bounded root-only native offline mode reconciles an unclean guardian journal
without launching jobs or opening a worker channel. The coordinator persists
and verifies the original retained snapshot, accepts only owned interrupted
outcomes, and resumes after lost cleanup replies or partial restore cutover.
Provider journals additionally bind to their original launch token and may not
contain public jobs. Completed record bytes remain exact; no command is replayed.

Nine modeled reboot integration cases cover these boundaries with real fixture
workers. The code is not installed or qualified on either TV. Their independent
0.7.48 endurance runs and all .NET fallback/recovery paths remain unchanged.


## S90D signed 0.7.49 same-boot qualification

After its old-observer endurance run failed a startup interval and was fully
reconciled, S90D received signed 0.7.49. The bounded round passed native migration,
public commands/jobs, selected-native disable/enable reacquisition and normal
managed return. Committed production/activation receipts and completed native-job
bytes survived reacquisition unchanged. Original jobs, enrollment and protected
files were preserved; owned scopes were removed and rescues retired unfired.

QN90A still runs 0.7.48 in its independent corrected-observer endurance trial.
Neither TV has completed endurance or hardware cross-boot qualification. The .NET
entry bridge, managed fallback and independent rescue remain unchanged. See
[S90D installed qualification](native-worker/cross-boot-s90d-install-results.json)
and [failed capture reconciliation](native-worker/observer-s90d-readiness-gap-results.json).

## S90D signed 0.7.50 cross-boot repair

The authorized native-selected reboot on 0.7.49 exposed a launch refusal when
the previous transient unit was absent. The independent rescue restored SDK
access. After the owner restarted again, signed 0.7.50 recovered native startup
from the retained cross-boot receipts and reconciled the interrupted bootstrap.
All 86 installed entries were verified. Original receipts and saved job bytes
matched, and saved job records survived the subsequent managed return. Enrollment,
retained jobs and protected hashes were preserved; deployment and return rescues
retired unfired. Every payload member is unchanged from 0.7.49.

This verifies repair of actual cross-boot state after maintenance. It does not
accept the original failed reboot or qualify a clean boot with the corrected
package already installed. QN90A remains on 0.7.48 during endurance. Both TVs still
need full endurance/resource acceptance; clean reboot and pending-return reboot
qualification remain open. The .NET entry and both fallback/recovery paths remain.
See [repair evidence](native-worker/native-startup-absent-unit-results.json).

After repair, the production API correctly refused a second migration in the
same coordinator before journal mutation. A separate guarded service restart
passed preservation and cleanup, then a fresh immutable S90D endurance invocation
started with native readiness, the 24-hour quiet job and collectors. The private
admission now requires a fresh coordinator; no production guard was relaxed.
See [admission evidence](native-worker/service-coordinator-endurance-admission-results.json).

## Hardware qualification paused by owner

Both endurance runs were stopped and reconciled at the owner's request. S90D
remains on 0.7.50 and QN90A on 0.7.48; both are managed-ready. Completed captures
were preserved, owned test jobs were cancelled and verified through managed
return before forgetting, and original jobs/enrollment/protected files matched.
All owned rescue timers retired unfired and SDK remains on loopback. No package
or power state changed. Neither shortened run satisfies 24-hour endurance.
Hardware qualification awaits explicit owner direction; local work may continue,
but no native-default or .NET-retirement gate is waived by this pause. See
[pause evidence](native-worker/hardware-qualification-paused-results.json).
