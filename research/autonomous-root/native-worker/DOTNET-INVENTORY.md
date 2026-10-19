# Agent .NET dependency inventory

Inspected 2026-10-15; includes service acquisition, interrupted-bootstrap
reconciliation and the standalone setup-control caller audit.
This is a source/caller inventory and removal plan, not a native-only qualification.
The deployed managed payloads, SDK rescue utility and runtime remain available.
See [migration status](MIGRATION.md) and [public contract](../CAPABILITIES.md).

Local follow-up, 2026-10-16: `tvsetup.native_components` builds the worker,
launcher, observer, model-specific setup acquisition library, service acquisition
library and SDK recovery utility without invoking .NET. Its manifest explicitly
states that the component bundle is not a deployable agent and still requires
the managed fallback. It neither changes `autonomous_root.prepare` nor supplies
the missing capability entry. `tvsetup.native_rescue` adds journaled native
arm/retire commands for future callers, with boot/code binding, private read-only
mapping and race-aware disarm. Hardware adoption and existing private callers
remain paused; this is not a claim that their .NET dependency is removed.

Follow-up: the [native SDK recovery utility](../recovery/native/README.md) now
implements the conditional setting contract and has independent-rescue acceptance
on both TVs. The .NET recovery bytes remain unchanged; older private deployment
kits still use them until their callers explicitly adopt the native unit launch.

The [native acquisition pilot](../../native-root-acquisition/README.md) now ports
the bounded setup probe and command runner to C behind an explicit
`root.execute(..., native_bundle=...)` selection. Its small `NativeEntry.dll`
still uses the trusted host to create a private read-only code bind and load the
library. Native acquisition is therefore not yet a .NET removal. Default setup and allowlisted cleanup keep their managed
implementations; uncertain native operations never trigger a fallback replay.

The service integration now packages an explicit native adapter opt-in. The
same trusted loader supplies capability entry; the archive and namespace logic
runs in C. Selected-native startup uses a bounded native held bootstrap. Managed
selection, interrupted returns and forward rollback retain the managed worker;
the managed acquisition adapter remains an explicit fallback. See the
[service contract](../CAPABILITIES.md#native-service-acquisition-and-held-startup).

## Dependency paths

| Entry point | Required managed path today | Why native selection does not remove it |
| --- | --- | --- |
| Fresh install, SDK maintenance, setup rollback | Default: `Transport.root` → `tvsetup.worker` → `NamespaceRootProbe.dll` → `RootIdentity.dll`; explicit `--native-bundle`: prebuilt `NativeEntry.dll` → `libacquire.so` | Setup must acquire root even when no enrolled worker is available. |
| Service start and worker loss (native acquisition opt-in) | `agent.js` SDK launch → `NativeEntry.dll` → `libacquire.so` → managed worker or bounded native held bootstrap | Trusted managed capability entry remains; selected-native startup verifies selection, process absence and retained state through native bootstrap. The original `SamsungTvArchiveRoot.dll` path remains explicitly selectable. |
| Normal return to managed | `managed-launch.js` → pinned `/usr/bin/dotnet` → `SamsungTvRootAgent.dll` | This is the deliberately retained fallback. |
| Interrupted active return | `agent.js` acquisition → managed bootstrap → `restart-return.js` | Recovery adopts the fresh managed executor under the original return transaction. |
| SDK rescue / maintenance host restoration | Private deployment and acceptance scripts → `/usr/bin/dotnet Recovery.dll set/watch …` → `libvconf` | The independent rescue must work when Couchroot admission is closed or unavailable. |
| Explicit native setup pilot | `root.execute(native_bundle=…)` → `NativeEntry.dll` → `libacquire.so` | The trusted managed host supplies capability entry and the private read-only native-code mount; namespace/archive and command execution run in C. |

The host SDK is separately required by `Builder.build_managed`, generated setup
probes, managed parity fixtures, `scripts/build-native.py` and
`scripts/check-dependencies.py`. `global.json` pins SDK 10.0.301. Device targets
remain `netcoreapp3.1` / runtime 3.1.3 on QN90A and `net6.0` / runtime 6.0.9 on S90D;
these are distinct from the host SDK. Framework, firmware, host and optional
`dotnet-launcher` hashes come from the tracked profiles and private enrollment.

## NamespaceRootProbe and the generated operation

**Callers and build.** [`tvsetup/root.py`](../../../tvsetup/root.py) builds both
`NamespaceRootProbe` and `RootIdentity` for each bounded root request.
[`Transport.root`](../../../tvsetup/transport.py) runs that module through
[`tvsetup.worker`](../../../tvsetup/worker.py) in a private subprocess and saves
its output. Setup `Driver` operations, inspection/backup, rollback, autonomous-root
package installation/readback and research trial transports inherit this path.
`namespace=True` wraps the requested operation in a PID-1 mount-namespace entry
for the specifically supported S90D cache operations. The probe itself always
uses private mounts. QN90A optional-app cleanup substitutes the build-time
allowlisted cleanup source for `RootIdentity`; it is not the generic shell path.

**Responsibilities.** The current probe source is
[`research/namespace-root-probe/Program.cs`](../../namespace-root-probe/Program.cs),
compiled with `QN90A` for that model. It requires the fixed staging path and a
32-bit process, creates a passwd view with exactly one owner UID/GID adjustment,
creates a private mount namespace, makes propagation recursively private and
rejects remaining shared mounts. It binds a disposable verification key, proves
baseline UID 5001, then binds the passwd view and proves UID 0 through the stock
archive launcher. Its child deadline is 30 seconds. Generated `RootIdentity`
prints UID and runs the encoded command only at UID 0, with a 25-second deadline.
The wrapper signs/verifies the disposable archive locally, hashes original system
files and staged artifacts, refuses dirty staging, and cleans only known files.
An uncertain operation is never retried automatically.

**Dependencies and replacement.** Host: Python, selected .NET SDK, OpenSSL and the
pinned SDK transport. Device: Samsung's trusted dotnet host, matching framework,
libc namespace/mount calls, `/proc`, stock `sdbd-tarlauncher`, tar and shell.
Crucially, the trusted runtime makes inherited mount/group capabilities effective;
an arbitrary unsigned C executable is not automatically an equivalent acquisition
entry point. The historical [chain evidence](../../../docs/research/exploit-chain.md)
explains this dependency. A native port needs both equivalent orchestration and a
separately qualified way to enter the required capability context on each firmware.
Do not solve that by relaxing SMACK, changing system passwd/key files or granting
new persistent capabilities as an incidental part of the port.

An enrolled [`AgentTransport`](../../../tvsetup/agent_transport.py) already avoids
this probe for supported operations while a ready worker exists. It cannot replace
first install or recovery when the worker is unavailable, and it refuses namespace
and allowlisted cleanup operations. A small native probe/command runner can replace
the managed logic once the capability entry is established. Preserve the two
identity checks, bounded children, exact cleanup, original hashes and no-replay
semantics; retain the existing path until both-model acceptance passes.

## Recovery.dll

**Callers and build.** [`recovery/Program.cs`](../recovery/Program.cs) and
[`Recovery.csproj`](../recovery/Recovery.csproj) provide the two-framework utility.
The current per-TV installed copies are used by private deployment/acceptance kits,
including the 300-second SDK rescue timers and explicit loopback/external-host
switches. There is no tracked service or tvsetup invocation of `Recovery.dll`,
and `autonomous_root.prepare` does not package it. Its deployment and caller
receipts remain in private state; public documentation should not invent a
tracked installer or expose their paths, addresses or digests.

**Responsibilities.** Root-only `set EXPECTED TARGET 0` or
`watch EXPECTED TARGET SECONDS` changes only `db/sdk/develop/ip` through
`libvconf.so.0`. Both addresses must be canonical nonzero IPv4. `watch` requires
30–600 seconds; `set` requires zero. Already at target is success; a third value
is drift and refuses overwrite. It checks the setter and verifies readback.
Argument/identity failures return 2, operational failures 1, success 0. It frees
the value returned by `vconf_get_str`. The library call is a read/check/write,
not an atomic compare-and-swap. The caller, not this utility, owns systemd timer
identity, boot/firmware/hash checks, SDB restart, journaling and disarm verification.

**Dependencies and replacement.** It needs the dotnet host/framework, libc and
libvconf, plus root with the appropriate device label. It needs no managed worker
or HTTPS service. A small native utility is the lowest-risk first replacement:
use the existing native cross-build conventions, link/load the device libvconf,
strictly parse arguments, preserve bounded delay and result semantics, and test
against a fake library before per-device readback/drift/timer trials. `vconftool`
with shell guards is a possible temporary adapter, but reproducing parsing,
readback and error semantics in shell adds ambiguity. Keep both utilities until
the native rescue independently restores access with the service unavailable.

## SamsungTvArchiveRoot and service bootstrap

**Callers and build.** [`tvsetup/autonomous_root.py`](../../../tvsetup/autonomous_root.py)
always builds and packages `SamsungTvArchiveRoot` and `SamsungTvRootAgent` DLLs,
deps and runtimeconfig files, including when `native_candidate=True`.
[`agent.js`](../service/agent.js) copies their manifest-verified bytes into unique
SDK staging, writes a one-use secret and passwd view, and signs an archive whose
shell payload starts the managed worker on loopback. SDK launch uses a staged
script and a create-once gate; [`policy.js`](../service/policy.js) checks the pinned
runtime/launcher hashes in SDK context before execution. This placement matters
on S90D, whose app label cannot stat all guarded binaries.

**Responsibilities.** [`SamsungTvArchiveRoot.cs`](../payload/SamsungTvArchiveRoot.cs)
accepts only the `archive-root-` package name with 16 lowercase hex digits,
requires effective CAP_SYS_ADMIN and CAP_SETGID, unshares mounts, makes propagation
private, binds the staged key and passwd view, then runs stock `sdbd-tarlauncher`
with the signed archive and `/bin/sh` command. It captures both streams, records
launcher completion, and detaches private mounts on exit. Unlike the setup probe,
it does not perform a baseline identity launch or impose its own child deadline.
Root authentication and readiness are subsequently checked by the service.

**Integrated native branch.** `prepare(..., native_acquisition=True)` additionally
builds the shared C adapter and `ServiceEntry.cs` loader twice and packages their
model-bound manifest. The service verifies these bytes, stages a unique launch,
and retains SDK-context runtime guards. The loader creates the read-only code
bind; C checks capabilities, validates the staged passwd view, proves baseline
owner/root identities and applies bounded archive/operation deadlines. The trusted
managed host remains the capability entry, so this is not .NET-free acquisition.

For a committed native selection, `held-bootstrap.js` starts the packaged worker
with `--held-bootstrap`: loopback only, fixed 300-second lifetime, status and
bounded exec only, and no public admission. Startup verifies the original
selection, retired processes and retained state before launching native. It then
shuts down and verifies the bootstrap's boot/PID/start-time/unit identities,
removes exact staging, and opens public admission. A durable bootstrap marker
blocks another native launch after uncertainty. Schema-2 receipts now permit
same-boot reconciliation through a fresh held managed executor. Recovery seals
the original launch fence, verifies absent processes and exact remaining files,
and retires that receipt without replaying its launch. Legacy, changed-boot or
changed-selection receipts still require independent inspection.

Managed selection, pending returns and forward rollback still acquire a managed
worker, preserving the existing same-transaction adoption rules. The original
archive adapter is retained; `service_acquisition: "managed"` explicitly selects
it on a subsequent service start. There is no automatic fallback after a native
submission. Both managed payloads remain signed and packaged. Removing the final
bridge needs a separately qualified native capability entry on each firmware,
without relaxing platform policy or granting persistent capabilities.

## Removal order and concrete next step

### Setup-control caller audit

`Driver.prepare_control` builds `Control.dll` only for `setting`, `home_operation`
and `routes` actions. `control_call` is reached by those actions and their inverse
operations, plus the engine's route-reload recovery. Its modes change Hub home
routing, first-screen/autostart settings, or notify the context database reload.
The QN90A resume trial adds its own first-screen caller. These are Hub integration
controls, not autonomous-agent installation requirements.

The agent's `PilotDriver.prepare` accepts only its package and four provisioning
files; every other action is refused. `install` and `update` construct only those
package/file actions. Consequently, the guarded standalone agent installation,
update and provisioning paths do not build or invoke `Control.dll`. Replacing
that utility would expand this migration into unrelated Hub behavior and would
not remove a dependency from the agent's current install path.

The installer and updater now expose `--native-bundle` to select the C acquisition
path for all privileged snapshots and file/package operations. The shared
transport validates and snapshots the prebuilt setup bundle before device access;
the journal records its selection and manifest digest. This avoids compiling
`NamespaceRootProbe` and `RootIdentity` for each call. Omission retains the managed
path, and failures never retry through it automatically. Local tests cover both
model bundles, subprocess dispatch, snapshot drift, uncertain replies and CLI
selection; hardware adoption remains paused.

The selected path still requires `NativeEntry.dll` and Samsung's trusted runtime.
SDK admission retains its runtime/host guards. Building this bundle requires the
host SDK, but running the prebuilt bundle does not. Removing the entry bridge
still needs a native capability entry on each firmware.

### Capability-entry evidence boundary

A local artifact audit has not established a direct native replacement for the
trusted bridge. QN90A's pinned development launcher performs a zone transition
and `exec`; that does not demonstrate retained effective mount capabilities in
an arbitrary native child. Its archive launcher performs the already-used
signature and owner-identity transition, which still requires the private
passwd/key views created by a capable host. S90D's capability inventory alone
does not establish equivalent launcher behavior.

The current-firmware artifact audit now identifies a concrete SDK entry candidate.
QN90A's vendor `launchpad-loader` and S90D's `app-defined-loader` decode the caller's
bundle and preload a native library before connecting to Launchpad. Direct SDK
execution is distinct from Couchroot's normal WRT package route; it does not need
a package route rewrite. QN's loader explicitly checks inheritable/effective
SETGID. Existing vendor capability metadata suggests the needed context on both
models, but metadata alone is not a runtime capability receipt.

Both captured `libbundle` implementations agree on string and string-array
records wrapped in ASCII MD5 and Base64. The original bounded host encoder and
[read-only entry probe](../../native-root-acquisition/entry/README.md) implement
only a fixed Couchroot preload. The constructor records SDK credentials and
capabilities and exits before the normal vendor event loop. Its caller must
verify code/loader hashes and an absent exact socket, and guard failed preload
with an independent process-bound watchdog. The signed package is the proposed
code mapping location; no persistent capability grant or platform-policy change
is part of this experiment. Detailed vendor-artifact evidence stays private.

This is a capability-entry investigation, not complete native acquisition.
The signed 0.7.33 trials produced no constructor receipt on either TV, although
both installed bundle libraries decoded and re-encoded the fixed bundle exactly.
The ordinary WGT code location did not establish entry; previous signed-TPK
experiments also show that package signing alone does not solve native executable
verification on writable VDFS. See [entry results](../../native-root-acquisition/entry/results.json).
Replacing the managed bridge still needs successful SDK code mapping and runtime
receipts on both TVs, then a native identity child and independent qualification
of the full namespace/archive operation. A read-only receipt alone cannot remove
the managed fallback or justify native-default installation.

### Remaining removal order

1. Completed: the native Recovery equivalent, fake-vconf/error/delay tests,
   reproducible ARM build and independent rescue on both TVs. Keep the managed
   utility available and migrate individual private rescue callers only through
   their journaled workflows and verified read-only code mounts.
2. The intermediate managed capability-entry bridge and C setup probe/runner
   are implemented in the native acquisition pilot. Preserve the independent
   managed path and explicit opt-in. A fully native capability entry remains
   open; the read-only code bind and trusted runtime cannot simply be omitted.
3. The opt-in service archive adapter and selected-native held bootstrap now use
   the shared native acquisition path and bounded native protocol mode. Keep
   managed pending-return/rollback adoption and explicit acquisition fallback.
   Same-boot submitted/ready bootstrap reconciliation is implemented; wider
   handoff/provider-failure and power-lifecycle gates remain before default changes.
4. Completed: the setup-control caller audit above establishes that `Control.dll`
   serves Hub settings/routing and is not invoked by standalone agent install or
   update. Keep those unrelated controls unchanged. The telemetry
   `native_bootstrap` pilot is not a root-acquisition replacement.
5. After native-default lifecycle, endurance, reboot and standby qualification,
   retire the managed worker payload and agent-specific build requirements.
   Preserve a verified offline managed recovery release. Do not remove Samsung's
   system runtime or unrelated applications' managed components.

The inventory itself installed no utility; the subsequent native SDK recovery
milestone completed step 1. The acquisition pilot advances step 2 through an
explicitly managed entry bridge. The service adapter, selected-native held bootstrap and same-boot interrupted
bootstrap reconciliation are integrated. The setup-control audit above is complete.
The next acquisition boundary is a verified .NET-free capability entry on both
firmwares, followed by adoption in agent-required setup and recovery callers. The
prerequisites delivered by the preceding milestones—immutable selection binding,
fresh runtime receipts, held startup, same-transaction return recovery and operation parity—remain reusable
regardless of the eventual acquisition adapter.

### Exact unresolved entry boundary and next evidence

The remaining gap is earlier than the C acquisition state machine: execute
original native code from an acceptable mapping while still holding the required
effective mount and group capabilities in the direct SDK context. The ordinary
package preload produced no receipt; writable mapping diagnostics were refused;
the successful private read-only bind was created by the managed bridge. The
later vendor app-preparation path drops capabilities, and the inspected global
Launchpad starter is not an isolated replacement. Existing metadata and modeled
Linux tests cannot establish this firmware-specific entry.

The next useful investigation needs a concrete, isolated mapping/preparation
path reachable before that capability drop. Its first experiment must produce
a nonce-bound SDK identity/capability/mapping receipt before any archive or root
operation. Only after that receipt should the native identity child and bounded
namespace/archive flow be qualified. Do not repeat failed package-preload trials
without a new mapping hypothesis or substitute an already-root/managed-created
read-only bind as independence evidence. No such replacement has been established
by the current captured-artifact analysis. Device experiments remain paused.
