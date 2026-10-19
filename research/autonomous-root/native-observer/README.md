# Process exit observer

This small executable observes a worker and optional guardian using Linux `pidfd_open` and
`poll`. It does not acquire credentials, signal the target, or prove resource
cleanup. It is intended for S90D's service identity, which cannot read the root
worker's `/proc/<pid>/stat`. QN90A's older kernel retains the existing proc-stat
observer. An unavailable syscall or denied observation is a failure, never proof
that a process has exited.

Invocation: `process-observer BOOT_ID WORKER_PID [GUARDIAN_PID]`, with pipes for
stdin/stdout/stderr. Pair PIDs must be distinct.

An opt-in external transport is also available:
`process-observer --connect SOCKET_PATH TOKEN_FILE BOOT_ID WORKER_PID [GUARDIAN_PID]`.
The observer connects to an existing filesystem Unix socket, checks that its peer
has the same effective UID and GID, and redirects only stdin/stdout to that socket.
It reads exactly 64 lowercase hexadecimal characters from a regular, single-link,
0600 token file owned by its effective UID, refusing a final-component symlink.
It emits `AUTH TOKEN\n` before the unchanged observation protocol. Stderr remains
with the external launcher; no token is printed there or in argument values.

The internal `service/external-observer.js` listener creates a fresh random token
and private directory for each launch, authenticates the first connection before
interpreting `BOUND`, refuses additional connections, and bounds input/deadlines.
After binding it requires a fresh authenticated worker status with unchanged
identities; native pairs also require fresh guardian-parent confirmation. Only
then does it send `ARM` and expose readiness. Its launch descriptor contains paths,
boot ID and target PIDs, not token contents. A future launch adapter must bind this
listener and its termination receipt to the selection transaction.

The listener does not spawn a process. Socket EOF is not proof of the observer's
exit status: its trusted launcher must call `recordExit` with independently observed
termination. Successful exit observation requires `EXITED`, clean socket EOF and
a zero-exit/no-signal receipt. Nonzero exit or signals invalidate the result.
`cancel` closes the control channel without signalling a target. `dispose` refuses
to remove the private token/directory until termination has been established, and
unknown outcomes retain those files for reconciliation. This is not a durable
launch journal or recovery controller. The installed service's child-process
rejection guard remains enabled; neither transport is selected automatically.

External connection/authentication uses the same independent 35-second alarm.
Descriptor admission precedes token/socket allocation, and controller loss fails
observation without signalling either target. Parent stdio is not needed for the
observation protocol. Callers must preserve the selected service-equivalent
identity; this option never changes credentials or labels.

The native supervision entry point is
`process-observer --supervise SOCKET_PATH TOKEN_FILE BOOT_ID WORKER_PID [GUARDIAN_PID]`.
It requires `control` and `token` in the same caller-owned 0700 directory. Before
forking it creates and syncs an exclusive `result.next` intent. Existing intent or
result files refuse a second launch. The child runs the socket observer in the
same executable/identity; it sets a parent-death signal and verifies its parent
before proceeding. The supervisor waits for and reaps only that child, then
publishes a synced, create-only `result` receipt and removes the intent. It never
signals the target worker or guardian. Observer and supervisor alarms are 35 and
45 seconds respectively; interrupted supervision can leave only an unknown intent.

Receipt schema 1 records boot ID, both target PIDs, observer PID, nullable exit
code and nullable numeric terminating signal. Supervisor exit zero means receipt
publication succeeded, **not** that observation succeeded: the receipt can record
a failed or signalled observer. `readPublishedExit()` on the service listener waits
for intent removal, validates the bounded private single-link receipt against the
launch, and feeds its result into the existing socket-plus-termination gate. It
retains malformed, mismatched or unfinished files for reconciliation. Cleanup
removes a consumed receipt only if its inode still matches.

The TV launch adapter is still required. It must start this supervisor outside
`wrt-service`, pin the executable and invocation to the selected manifest and
transaction, use the service-equivalent credentials, and reconcile uncertain
submission rather than retrying. Neither the listener nor this entry point is
currently selected by the installed service.

`service/observer-launch.js` supplies an internal S90D-only submission boundary.
It restricts the executable to the installed package observer, pins its digest,
checks boot, package ownership/mode/parent paths and the private listener files,
and submits a uniquely named transient systemd service. The fixed native
`--service-supervise` entry point installs the exact groups and drops to the
service identity before entering ordinary supervision (see below). Group membership
comes from the caller's verified kernel identity, not an HTTP parameter. No direct
Node child-process call is used.

The adapter syncs an exclusive transaction record and a shared pending marker
before command submission. Transport loss, timeout or an unexpected command result
leaves an unknown outcome; the same transaction ID cannot be submitted twice.
Changing the request ID cannot bypass the pending marker. Acknowledgement advances
only to `submitted`, never readiness or successful observation. The future runtime
controller must connect the listener, held-worker confirmation, receipt polling,
unit termination checks and cleanup reconciliation before removing that marker.
The adapter deliberately does not guess that a pending launch expired.

Read-only checks confirmed both TVs remained ready on .NET and that S90D provides
systemd 244 with the expected service identity and no effective capabilities.
The generated launch command passed shell syntax checking; four submission tests
cover validation, durable intent before invocation, duplicate suppression, a
different-ID retry after an unknown outcome, partial journals and private directory
requirements. The combined Linux listener/supervisor/bridge/service suite passed
46 Node tests, followed by a focused submission rerun after adding the shared
pending marker. Actual systemd execution, service-credential launch and full
adapter integration have not been qualified on either TV. No device mutation or
reboot occurred for this submission revision.

The internal `observer-controller.js` now joins listener creation, exclusive
submission, fresh identity confirmation, receipt polling and cleanup. Confirmation
waits for the launch acknowledgement so it cannot overlap the submitting worker
request. Receipt polling has a monotonic deadline. Successful target observation
and cleanup are separate: cleanup also requires independently obtained supervisor
unit completion evidence. Before deleting the listener files, the controller saves
the receipt, its digest and the unit evidence in the durable transaction record.
Only verified cleanup releases the pending marker. Cancellation closes the socket
and waits for the observer receipt without signalling either target.

Transient units now use `RemainAfterExit=yes` and fully qualified `.service`
names, retaining their completion status for inspection. `observer-unit.js` checks
the boot before and after its bounded query and requires the exact unit identity.
Completion requires `active/exited`, no main PID, a successful exit status and a
nonzero start timestamp. A separate retirement step rechecks completion, stops
only the owned unit and verifies inactive/absent state. Retirement uncertainty
keeps the durable `cleanup-verified` checkpoint and receipt. The controller does
not repeat cleanup calls or automatically reconcile an interrupted transaction.
A future reconciler must handle `cleanup-verified`, `unit-retired`, terminal
records with leftover markers, and earlier uncertain submissions explicitly.

All 56 focused Linux Node tests passed, including real supervisor/listener process
tests with scripted systemd submission/inspection boundaries. They cover normal
completion, cancellation, lost submission response, incomplete unit termination,
lost retirement response, and cleanup of a listener rejected before submission.
Systemd command parsing and result validation are tested locally; actual unit
execution is not established by these fixtures. A small parser follow-up passed
the three unit tests again. No TV was accessed or changed for this controller
revision. The service's external observer path remains unwired and the deployed
child-process rejection guard stays enabled.

For a future worker handoff, unit inspection/retirement needs an authenticated
executor that remains available after the old worker exits. The controller takes
that dependency explicitly and must not query a disconnected old worker or assume
that observer EOF proves supervisor-unit retirement. A non-stopping probe can
use its held managed worker; this does not qualify full handoff recovery.

1. Check descriptor capacity and boot, close inherited descriptors, bind all
   pidfds and verify none has exited; emit `BOUND`.
2. The service obtains fresh authenticated worker identity and resource inventory
   and compares them to the journal-bound snapshot. A bare numeric PID is not
   sufficient. The worker must still answer over the original connection.
3. The service writes `ARM\n`; the observer verifies boot and liveness again and
   emits `ARMED`. Only then may the service submit `SHUTDOWN`.
4. Once every handle reports exit, verify boot again, emit `EXITED` and exit zero.
   The service requires the exact protocol, clean pipe closure and zero exit.

Preparation is bounded to ten seconds, armed observation to twenty seconds, and
the entire helper to a separate 35-second alarm. Controller EOF, malformed input,
early target exit, wrong boot, and broken output fail. The service bridge bounds
output and elapsed time and cancels only its own observer child. A pidfd exit
receipt means the process exited; unlike proc-stat absence it does not establish
reaping. Neither method establishes mount, descendant or retained-state cleanup.

`service/agent.js` accepts an internal `processObserver: {binary, sha256}`
construction option. The artifact is checked as a bounded regular file against
the supplied digest before launch. The deployment owner must provide the digest
from a verified manifest and keep the staged path immutable through execution;
this check is not a race-free executable loader. The option has no public API or
configuration route. Default behavior remains proc-stat observation; there is no
automatic fallback after a permission error.

Native pair observation requires a fresh raw authenticated status response after
both handles are bound, including `guardian-parent-identity-v1` and matching worker
and guardian identities. Missing capability or changed identity refuses arming.
Native status confirms the original parent relationship on every request.
Startup established the
guardian's start ticks and direct parent relationship; the fresh kernel parent
check binds that cached identity to the original parent without opening another
descriptor. This is point-in-time confirmation; either process can subsequently
exit. The observer retains evidence of each exit and waits for the other process
without repeatedly polling an already-exited handle.

## Qualification boundary

The bridge is integrated into the service's internal managed handoff and tested
locally with the real managed wire session, admission hold and selection journal.
The native pair path is tested through the actual wire server and ordinary native
worker/guardian, with journal/runtime cleanup verified separately after exit. The
service selection controller still supports managed handoff only; these native
wire tests do not qualify a native-to-managed service transition.
The tests also cover changed confirmation, malformed protocol, digest mismatch,
descriptor inheritance, deadlines, controller loss and no target signalling.

Local validation on 2026-10-14 passed eight native protocol tests and 29 Node
bridge/service/process tests, including real managed handoff through both proc
and pidfd observation and refusal before shutdown on an observer digest mismatch.
Two ordinary ARMv7 softfp builds matched byte-for-byte; their maximum required
GLIBC version is 2.17. These results do not establish TV executable staging or
service launch compatibility.

The subsequent paired-observer revision passed 12 native protocol tests and 32
Node bridge/service/process tests, including ordinary native worker and guardian
shutdown through the actual wire server. Final repeated ARM builds matched and
all nine candidate-package tests passed; GLIBC remains capped at 2.17. This is
local evidence only.

Schema-2 candidate manifests now include the observer and its source/build hashes.
Schema-1 candidates remain accepted without an observer. `main.js` selects the
packaged permission-staging path for an explicit internal S90D handoff, with the
prepared target manifest required. It does not stage at startup or select native.
See [deployment details](DEPLOYMENT.md).
Its launch from the actual installed TV service still needs qualification. Earlier
TV pidfd probes establish kernel feasibility, not this executable's deployment.
Do not enable production handoff based only on host tests. .NET remains deployed.

Cross-compile with `sh build.sh /absolute/output/directory`. For local Linux
tests compile `process-observer.c` with `cc -std=c99 -O2 -Wall -Wextra -Werror`,
then set `PROCESS_OBSERVER` to the executable and `COUCHROOT_PARITY_CONTAINER=1`
inside the disposable parity container. Run `process_observer_test.py`,
`pidfd-observer.test.cjs`, and `managed-handoff-integration.test.cjs`; the latter
also needs the existing `MANAGED_PARITY` harness. Never point test process-control
fixtures at device PIDs.

The external socket revision passed 22 native tests (12 existing and 10 socket
cases), plus all 31 focused Node bridge/service/managed-wire tests in the Linux
container. Socket coverage includes fragmented control, both target exits,
controller disconnect, invalid control, token contents/mode/links, wrong boot,
descriptor pressure, missing listener and mismatched peer credentials. Two ARM
builds matched at 18,016 bytes, SHA-256
`e8a3b47e66b92791c0a06d50c0a6edd72e46e1235f70601892c7249caee32085`,
with the maximum GLIBC requirement still 2.17. This is local transport evidence;
no TV was contacted, changed or rebooted for this revision.

The subsequent service listener passed eight additional tests, including the real
ordinary socket observer against a live Linux target. All 39 focused Node observer,
service and managed-wire tests passed. Tests require an independent termination
receipt after EOF, refuse bad authentication/sequence/identity, propagate a nonzero
observer exit, preserve files after cancellation or timeout, and enforce a private
parent directory. Device launch integration and supervised termination evidence
remain required; host test children supply that receipt only in the test harness.

The native supervisor revision passed eight supervisor tests in addition to the
22 existing native observer/socket tests. Coverage includes a pair, actual child
reaping, nonzero/signal receipts, controller and supervisor loss, retained unknown
intent, duplicate refusal, directory permissions and boot mismatch. All 42 focused
Node tests passed, including the real supervisor publishing a receipt consumed by
the socket listener. Two ARM builds matched at 22,740 bytes, SHA-256
`8919e5283aae233f1cdf619306a4b34a55c57d4e378bf52d9236d8766f4b7691`;
the maximum GLIBC requirement remains 2.17. No TV access or deployment occurred.

## Service integration for the non-stopping probe

The S90D service now routes an explicit `/v1/observer/probe` request through the
external supervised observer. It does not launch an observer at service startup.
The API's persisted request ID deterministically names the external transaction;
unknown submissions cannot acquire a fresh identity by retrying that request.
The service resolves `/proc/thread-self`, binds both kernel task and thread-group
IDs, and reads that calling thread's credentials through the held worker. It
requires the fixed package label and zero capabilities and preserves the exact
group list. The calling thread must remain unchanged across capture. The launched
supervisor must match that profile; the broker main-thread profile is rejected.
Observer launch records live in a private `worker-state/observer-launches` directory.

The managed admission hold supplies staging, submission, fresh identity confirmation,
unit inspection and unit retirement. Successful bind-and-cancel qualification must
complete journaled observer cleanup and verify the original worker remains alive
before releasing admission. Uncertain launch or cleanup retains the hold. This
path uses no JavaScript child-process launch. QN90A retains proc-stat observation.

This executor is intentionally limited to the non-stopping probe: it depends on
the managed worker remaining alive. The internal shutdown guard stays enabled.
A full handoff still requires an executor that can inspect and retire the observer
unit after the old worker exits, plus restart reconciliation of pending journals.
The S90D integration has been deployed, but its credential preflight has not
qualified. See DEPLOYMENT.md for the 0.7.3–0.7.5 outcomes and the required native
credential-drop integration. QN90A retains its qualified proc-stat path.

Local verification passed 59 Linux observer/service/managed-wire tests and seven
host API tests. The API tests verify that the persisted request ID reaches the
probe. The service tests cover successful cleanup, uncertain submission and
cleanup admission holds, missing request IDs before staging, fresh status
capabilities, and continued refusal of shutdown. The Linux image lacks OpenSSL,
so the TLS API suite ran on the host; no tests were skipped. Neither TV changed.

## Fixed service credential drop

`process-observer --service-supervise GROUP_CSV SOCKET TOKEN BOOT WORKER [GUARDIAN]`
requires an already privileged caller. It is never installed setuid. The group
list is canonical, sorted, unique, bounded to 32 nonzero IDs, and includes the
fixed primary GID 100. No arbitrary UID, label, executable or command is accepted.
The fixed identity is UID 5001, GID 100 and `User::Pkg::MiniRoot01`.

The helper closes inherited descriptors while still in System, writes the fixed
label, disables keep-caps, sets no-new-privileges, empties the bounding set, sets
exact supplementary groups, and drops GID then UID. It clears and reads back all
capability words, verifies real/effective/saved IDs, exact groups and
no-new-privileges. Only then does the ordinary supervisor create a receipt intent
and open target handles. Its child closes the supervisor's explicitly owned
journal descriptors; that path requires no procfs descriptor scan under the
restricted label. The service still independently reads the supervisor's actual
kernel credentials before confirming and arming.

Systemd starts this fixed mode directly as root/System. It does not supply the
final account groups or run a shell under the package label. This avoids the
observed merging of account-default groups. The service continues to pin the
installed executable's owner, mode and hash before submission.

Local tests cover 83 fault boundaries plus incorrect final identity/capability
results. A disposable Linux root process actually drops credentials and cannot
regain root; an end-to-end socket test checks all kernel UID/GID slots, groups,
no-new-privileges, all five capability sets and the owned receipt. The Smack write
is redirected to `/dev/null` only in that test binary, so these tests do not
qualify TV label transition. Test binaries are excluded from signed artifacts.
All 32 native, 61 focused Node and five packaging tests passed. Two ordinary ARM
builds matched at 23,016 bytes, SHA-256
`4677bef3f0137b792d6de2dd22fa91d32476db5b48c26213db8699b596e4e574`,
with maximum GLIBC requirement 2.17. The profile header is pinned in the candidate
source manifest. Hardware qualification remains separate.


### Independent cleanup boundary

`prepareRuntimeObserver` defaults to the deployed non-stopping probe. An internal
caller can request `purpose: 'handoff'` only with independent `inspectUnit` and
`retireUnit` callbacks. They receive a frozen unit/boot/artifact-digest binding;
the departing worker's execute callback is not forwarded. Probe and handoff
transaction IDs have separate namespaces. Missing or partial providers are
rejected before credential reads, staging or journal publication.

The service's internal shutdown path stages and binds the observer before
shutdown, rechecks the journal-bound inventory, then uses that independent
cleanup boundary after disconnect. Success still leaves selection prepared and
admission held; it does not start a native worker or commit a migration. The
installed service supplies no provider and keeps shutdown disabled. The
shutdown bridge tests use controlled provider fixtures; the adapter validation
below does not qualify installed-service handoff.


### Native retirement provider

`observer-retirement.js` adapts a separately launched native worker channel to
dedicated `inspectUnit`, `retireUnit`, and retained-state snapshot operations.
It requires a 300-second bounded instance
with scoped files, no retained resources, an independently staged pinned launcher,
root/System authentication, and worker/guardian identities distinct from the
source. Boot, connection, process identities and resources are rechecked around
each command. Each adapter binds exactly one observer unit and digest; parallel
operations, replacement peers, overdue replies and uncertain retries are refused.
Handoff readiness also compares independent and source-worker unit observations
before the source can be stopped.

This reuses the ordinary native worker protocol and guardian. It does not create
a new generic command endpoint or a managed maintenance dependency. Its caller
must still stage the candidate, publish a durable launch intent, provide the
private token, and own provider shutdown/staging reconciliation. Scoped mode
requires the launcher source inside the experiment directory, separately from
the read-only executable view. Service 0.7.13 constructs this lifecycle for its
non-stopping provider probe; stopping handoff remains gated.

Local integration stops a real managed wire peer and then executes adapter
commands through a separate native wire peer. That host build stubs Smack/mount
setup and unit operations. Independent tests on both TVs used ordinary packaged
binaries, real System authentication, actual systemd unit inspection/retirement,
and root-owned staging cleanup; their managed workers stayed running. Neither
test substitutes for the installed-service stopping handoff gate.

### Durable provider submission

`retirement-launch.js` constructs and submits a native maintenance launch on
loopback. It revalidates the ordinary candidate manifest, binds all three native
artifact digests, verifies the source boot and process start identities before
staging and again before launching, and copies the launcher into the private
experiment scope. The token is copied from a private service-owned file into the
root-owned scope; the record contains only its digest, not the secret. Both the
native lifetime and systemd runtime are bounded to 300 seconds.

An exclusive per-transaction record and a directory-wide pending marker are
flushed before the executor is called. Submission acknowledgement advances only
to `submitted`; it proves neither connection readiness nor completion. Lost,
failed or ambiguous results retain `unknown` ownership and block every new ID.
Partial local intent publication also blocks retry. No age-based cleanup or
automatic relaunch is permitted. The caller still needs to coordinate the
listener, verify the native peer, and reconcile teardown against this record.
The installed service does not yet call this submission module.

### Readiness publication

`retirement-readiness.js` consumes the exact acknowledged launch record and an
already authenticated native channel. It creates and flushes an exclusive
readiness intent, validates the scoped provider, binds its guardian to the
recorded systemd unit's running main process, then rechecks the native identity
and source worker. Only then does it publish `ready`, including provider process
identities and the unit's monotonic start timestamp. The launch pending marker
remains until teardown is independently verified.

Connection or identity changes, source replacement, journal changes, late
responses and publication failure return no provider and retain ownership for
reconciliation. An unfinished readiness intent cannot be retried or adopted.
The transition uses the live source executor only to inspect the maintenance
unit before source shutdown; later observer retirement uses the native adapter.

The host integration exercises this publication with real managed/native wire
peers, then stops the managed source and continues native retirement commands.
Smack/mount setup and systemd observations remain host-test substitutions. The
service still needs listener/token coordination and provider teardown integration;
this module alone does not enable a deployed stopping handoff.

### Retained state after source exit

The local `snapshotManagedJobs` provider operation uses `retained-state.js` to
read the fixed managed job directory only after the bound source process is absent
or its PID has been reused. It checks the boot around each bounded command, validates
private single-link records, hashes each byte sequence, and compares complete sorted
inventories before and after reading. At most 64 records below 2 KiB each are
accepted. Unknown entries, import/guardian markers, links, duplicate JSON keys and
changed content fail without rewriting source state or producing a snapshot.

The operation is one-shot per provider and shares its serialized identity checks.
It preserves retained bytes, including unknown outcomes, for the future installation
and rollback transaction; it does not replay jobs or infer their outcomes. The
returned receipt binds the source identity, record names, sizes, hashes and bytes.
This addition is host-tested and not included in the deployed 0.7.13 packages.
