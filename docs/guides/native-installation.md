# Native boot-hook installation and recovery

The QN90A native backend is implemented in `couchroot-install` and uses the shared
setup Engine, locks and private journals. It has **offline validation only**. This
new generated hook has not been installed or exercised on a TV. The historical
native performance/behavior measurements do not certify this installer.

Supported target: **QN85QN90AAFXZA, T-NKM2AKUC-2301.1**. S90D native is unsupported.
There is no firmware override or automatic discovery/adoption of an arbitrary
private trial chain.

## Prerequisites and enrollment

Before a future authorized installation:

- Install/update web Hub and its Home/AirPlay/startup routes through the web
  installer. Native checks the current web source and the reviewed routes, retains
  the web app and Samsung Home fallback, and does not sign/install packages itself.
- The TV must already have the reviewed ISP assignment to `MiniHub001.Hub` and
  saved source `isp-service`. Native preflight refuses to repair these implicitly.
- Enroll the existing autonomous root agent with its pinned client configuration.
  The installer verifies model, platform and physical UUID via the TV API before
  constructing the independently TLS-pinned agent transport. Firmware/runtime
  hashes remain enforced by that transport.
- Prepare a native bundle, and independently review copies and hashes of the
  **non-native** baseline AWK boot hook and every file it depends on. Retain all
  existing absolute dependency paths. This is a reviewed enrollment contract, not
  a shell dependency discovery tool.

Existing private native trials must first be recovered using their retained
original driver/journal. Enrollment rejects recognized native dispatch in the
baseline or dependency copies to avoid two launchers competing. This backend does
not run incident scripts, guess a trial generation, or modify historical journals.

The private `hook-config.json` has this shape. Replace every placeholder with an
independently reviewed value; file names resolve relative to this JSON file:

```json
{
  "schema": 1,
  "device": "qn90a",
  "firmware": "T-NKM2AKUC-2301.1",
  "hook": {
    "path": "/opt/etc/parseinfo.sh",
    "file": "baseline.awk",
    "sha256": "REVIEWED_BASELINE_SHA256"
  },
  "dependencies": [
    {
      "path": "/opt/reviewed-chain/previous.awk",
      "file": "previous.awk",
      "sha256": "REVIEWED_DEPENDENCY_SHA256"
    }
  ],
  "recovery_guards": {
    "/opt/reviewed-root/enabled": "REVIEWED_ROOT_RECOVERY_GUARD_SHA256"
  }
}
```

The sample paths are placeholders, not proposed device paths. Guards must pin at
least one reviewed autonomous-root recovery resource. They cannot point at the
hook being replaced or the new native installation. Local copies are bounded
regular files; unknown hashes, traversal, duplicate paths and conflicting guards
are refused. No enrolled baseline program is executed on the host.

## Commands

The following only print a recipe/workflow and **do not connect**:

```sh
./couchroot-install plan --device qn90a --launcher native
./couchroot-install apply --device qn90a --launcher native --dry-run
```

Preparation is also offline:

```sh
./couchroot-install prepare --device qn90a --launcher native \
  --build-native --output /private/native-bundle
```

These examples are for a **separately authorized future device operation**. They
contact the TV; do not run them as offline tests:

```sh
./couchroot-install inspect --device qn90a --launcher native \
  --agent /private/client.json --bundle /private/native-bundle \
  --hook-config /private/hook-config.json

./couchroot-install apply --device qn90a --launcher native \
  --agent /private/client.json --bundle /private/native-bundle \
  --hook-config /private/hook-config.json --yes

./couchroot-install verify --device qn90a --launcher native \
  --agent /private/client.json --run RUN_ID

./couchroot-install resume --device qn90a --launcher native \
  --agent /private/client.json --run RUN_ID --yes

./couchroot-install rollback --device qn90a --launcher native \
  --agent /private/client.json --run RUN_ID --yes
```

`status --device qn90a --launcher native --run RUN_ID` reads only the local journal;
no site configuration or agent connection is needed. Recovery and verify use only
the captured inputs, so supplying a new bundle/enrollment is rejected. Keep the
original checkout for recovery because the shared engine binds source revisions.
Changing the destination, signing trust, agent server pin/port or client certificate
also blocks recovery with that new configuration.

Native apply configures **the next boot only**. `--activate` is refused. There is no
implicit app launch, reboot, service restart or saved-source change. Optional
`--source-rearm` opts in to the existing native process's periodic saved-source
re-arm on a later native boot; it is off by default. It does not add an incident
shutdown helper or guarantee a quiet boot after Live TV.

## Transaction and boot behavior

Launcher-only bundles use a single hook action with scope `launcher-native`.
Opt-in [native telemetry bundles](native-telemetry.md) prepend a telemetry action,
handoff the sampler immediately, and restore it after the hook during rollback.
The launcher action itself works as follows:

1. Capture baseline/dependency bytes, native ELF, generated scripts, optional
   preference candidate and hashes into the private run before any device change.
2. Check web fallback, ISP/saved source, exact hook/dependency hashes and root
   recovery guards. Capture the current hook with metadata in a run-specific
   remote backup; never overwrite an unowned nonempty staging directory.
3. Upload exact run-specific payloads. Existing staged bytes must match; absent
   files can be filled on an explicit retry. Verify hashes, ownership, modes and
   Smack labels before activation. Run code is root-owned and read-only to owner.
4. Initialize the private native state only if absent. A marked state directory
   permits later installs to reuse owner preferences; an unowned existing directory
   is refused. Preference bytes are never reset or overwritten on retry/rollback.
5. Replace `/opt/etc/parseinfo.sh` through a same-directory temporary file and
   atomic rename, with before/after hash guards. Read back the hook and all payloads.
6. Finalize the ownership ledger while preserving full-setup choices.

The generated AWK wrapper guards and invokes the native dispatcher before invoking
the unchanged baseline hook. Missing/corrupt native dispatch or failed native
admission still falls through to the verified baseline; native failure does not
suppress the vendor/root chain. Existing absolute baseline dependencies, vendor chain,
casting policy and root recovery remain in place. The dispatcher establishes the
existing web-autolaunch claim markers before that chain runs, then submits an
owner-UID native service with a read-only binary view, normal CPU scheduling and
`--native-guard --stay`. Native's compositor/source/ISP/power/foreground checks remain
active. A bounded systemd monitor revokes admission on marker/background loss.
No casting services, vendor source settings or database rows are rewritten.

Uptime checks and service timeouts are retained; they are not a hard end-to-end
wall-clock guarantee for every firmware IPC call. Boot admission, physical Home,
playback, casting, standby/wake and first render remain hardware acceptance items.

## Interruption and rollback

A lost activation reply is reconciled by hook readback plus payload verification,
without a second activation. If the hook is unchanged after an uncertain operation,
inspect the private evidence and confirm no installer is active before adding
`--retry-unchanged` to `resume`. A retry reuses only exact staged bytes. Foreign or
partially written unknown staging files are retained and refused, not deleted.

Rollback hash-checks the current hook, original backup, dependencies and root
recovery guards before restoring the baseline. A subsequent hook edit is never
overwritten. A lost rollback reply is recognized from the restored baseline and
does not repeat the inverse. Corrupt native payloads do not prevent restoring an
intact baseline; changed baseline dependencies or backup bytes do.

Rollback intentionally retains preferences, staged code, snapshots and backups.
The currently running native process may still need them. It does **not** stop
that process, undo periodic source writes, remove claim markers in the current
boot, repair a saved-source incident or reboot. The restored baseline takes effect
on a later boot. Do not delete remote run directories until runtime/hardware
recovery has been separately accepted. A failed allocation may leave a partial
run-specific staging file for inspection; no blind cleanup is performed.

Offline tests cover successful installation, each payload-stage interruption,
lost backup/activation/rollback replies, explicit retry, modified/deleted input
bundles, corrupted backups/dependencies, hook drift, preference preservation,
unowned-state refusal, shell syntax/probes and actual file-management shell in a
temporary host filesystem with TV ownership/Smack operations simulated. They do
not establish TV kernel labels, systemd behavior, rendering or physical recovery.
