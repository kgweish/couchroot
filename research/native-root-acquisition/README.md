# Native acquisition with a managed capability-entry bridge

This opt-in setup pilot moves private namespace/archive orchestration and bounded
command execution into original 0BSD C code. It still requires Samsung's trusted
`dotnet` executable and matching managed runtime. `NativeEntry.cs` validates its invocation, creates a private read-only bind of
the fixed code directory, then loads the model-specific native library in that
process. It does not launch archive commands or run setup scripts. The code bind
is necessary because QN90A refuses native mappings from writable SDK staging.
Identity children inherit this mount; the loader detaches it on exit.

The SDK shell's inherited capabilities do not make an ordinary native executable
an equivalent entry point. Loading C from that private read-only bind in the trusted host preserves the
capability context without adding persistent file capabilities, changing SMACK,
or modifying a system passwd/key file. This is an intermediate bridge, not
.NET-free root acquisition. The default setup transport and service's managed
acquisition/bootstrap remain unchanged.

## Native contract

The model-specific library has one exported entry, used only by the loader:

- `probe`: require SDK UID/GID 901 in every credential slot and effective
  CAP_SYS_ADMIN/CAP_SETGID. Refuse absent capabilities before staging a view.
- Read the original passwd file with a bounded, no-follow read. Require exactly
  one owner record with UID 5001 and GID 100 and exactly seven fields. Change only
  those two fields in a new exclusive private file; refuse existing files/links.
- Unshare mounts, make propagation recursively private, and reject any remaining
  shared mount. Bind the disposable verification key in that namespace only.
- Launch the stock archive launcher and require the baseline native identity
  receipt. Bind the private passwd view, launch again, and require root identity
  and successful command completion. Detach only successfully mounted views,
  in reverse order. Unmount failure is unsuccessful acquisition.
- `identity`: report the full expected owner credentials without running the
  operation, or require all root UID/GID slots before reading `operation.sh`.
  Refuse any other identity. The script is fixed-path, hashed staging material,
  NUL-free and below 64 KiB. As in the managed runner, verified text is passed
  through `sh -c`; Samsung's shell refuses an unsigned staging script argument.

The launcher gets 30 seconds; the root command gets 25 seconds. The native
supervisor uses a monotonic clock, a separate child process group and a bounded
64 KiB merged stdout/stderr stream. Timeout, output overflow, signal death,
wrong identity, nonzero exit, or unconfirmed cleanup is failure. A timeout kills
the child group where credentials permit and bounds reaping; an unconfirmed
signal is reported and must be inspected. It never retries the operation.
Commands must not escape supervision into independent sessions; deliberate
persistent work must use the existing separately journaled service mechanisms.

This pilot intentionally differs from managed transport: output is capped and
stdout/stderr are merged, both owner credential fields and all UID/GID slots are
checked, and an existing passwd view is refused. These limits make it unsuitable
as a silent replacement for every existing setup caller.

## Build and use

`tvsetup.native_root.build(profile, new_folder, command)` snapshots source, pins
the existing native compiler image by resolved digest, builds each model twice,
checks identical artifact hashes and ELF ABI/dependencies, and builds the small
managed loader deterministically for that profile's exact runtime. ARMv7 EABI5
softfp and a GLIBC ceiling of 2.17 are required. The library has no interpreter;
it is loaded inside the trusted host. No binary or generated archive is committed.

An explicitly selected bundle is passed to the existing guarded executor:

```python
from tvsetup.root import execute
execute(profile, bounded_script, native_bundle=private_bundle_directory)
```

The journaled agent installer/updater also accepts `--native-bundle PATH`:

```sh
python3 -m tvsetup.autonomous_root_trial --device qn90a --artifact PREPARED_ARTIFACT --native-bundle SETUP_BUNDLE --yes
```

Use a setup bundle from `tvsetup.native_root.build`, not a service bundle or the
.NET-free component bundle. Add the existing `--previous` and credential/inventory
options for an update. This remains an explicit deployment command; hardware
qualification is currently paused.

`Transport(..., native_bundle=PATH)` validates and snapshots the prebuilt bundle
in the run's private evidence directory before contacting the TV. All root calls
in that transport use the snapshot through the bounded subprocess, avoiding
per-operation builds of `NamespaceRootProbe` and `RootIdentity`. The installer
journal records the selection and snapshot manifest digest. Later edits to the
original bundle cannot change the run; saved artifacts are revalidated before
staging. Omit the option to select the existing managed transport. Native errors
never select it automatically, and native-selected app cleanup is refused.
The small entry DLL still requires the TV's .NET runtime. Building the bundle
requires the host SDK once; executing a prebuilt bundle does not compile managed
code. This wiring has local tests only; it has not been deployed to either TV.

The caller owns the device lock, pending-run admission, durable intent, boot
binding, rescue timer and result reconciliation. Bundle/source/profile hashes
are validated and copied before target contact. The shared executor preserves
physical/model/firmware/runtime/launcher guards, disposable signing, baseline
system hashes, dirty-staging refusal and exact cleanup. It starts the loader with
a clean environment. Allowlisted app cleanup stays on the managed implementation.
There is no automatic native-to-managed retry after a submitted operation.

An occupied SDK `on-demand` directory is a refusal. For controlled qualification,
inspect the service-owned archive files, journal a unique directory rename while
the worker is disabled, preserve every byte, and restore the original directory
after verifying the probe's own cleanup. Never delete foreign staging to proceed.
This preservation belongs to the private trial orchestration, not this executor.

## Validation

Run the focused Python tests in the disposable Linux native-test image:

```sh
python3 -m unittest discover -s tests -p 'native_acquisition*_test.py' -v
```

The host-only C harness substitutes namespace syscalls and launcher behavior in
a separate translation unit. It tests exact passwd edits, credentials/capability
refusal, dirty staging, shared propagation, each partial-bind unwind, bad identity,
nonzero launcher exits, baseline no-operation behavior and root exit propagation.
Real child processes exercise timeout, pipe-holding descendants, signals and
output overflow. No test switches or substituted functions enter the library.
Python tests cover bundle drift/profile binding and lost-reply cleanup without
resubmission or managed fallback. Linux syscall tests skip on macOS.

Hardware qualification must separately prove acquisition from SDK with the
Couchroot worker disabled, baseline/root receipts, a single root command,
nonzero and deadline refusal, unchanged originals outside the private namespace,
and cleanup with no probe children remaining. Verify the retained managed path
separately; keep the independent 300-second .NET SDK rescue armed throughout.
Restore the original SDK staging, loopback and managed readiness, preserve
selection/enrollment/job bytes, and disarm all trial units. Both models passed
this bounded round; see [aggregate evidence](results.json) and the
[migration record](../autonomous-root/native-worker/MIGRATION.md) for the earlier
failures, S90D timer-stop reconciliation and remaining managed dependency.


## Shared service adapter

The service build compiles this same C state machine with `SERVICE_ACQUISITION`
and uses `ServiceEntry.cs` as the minimal trusted loader. It accepts only a unique
`archive-root-` stage, validates the coordinator's staged passwd view byte-for-byte
(the SDK cannot create files in the app-owned stage), and performs the same two
identity checks and bounded inline operation. The managed host may canonicalize
`/home` to `/opt/usr/home`; only these exact stage aliases are accepted. Model-bound
builds still run twice and preserve the original setup pilot and managed fallback.
See the [service startup contract](../autonomous-root/CAPABILITIES.md#native-service-acquisition-and-held-startup).
