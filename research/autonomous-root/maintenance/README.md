# Managed package upgrade evidence

Changing either managed DLL changes the digest pinned by `worker-selection.json`.
A signed package installation alone therefore does not authorize launching that
new worker. The service continues to refuse `managed-package-version-mismatch`.
Do not delete selection state, rewrite a historical digest, or reuse a readiness
receipt from the previous package.

`managed-upgrade.js` supplies host-side verification and selection-plan primitives
for explicit maintenance of a stable managed selection. It is not packaged into
the service, exposed as a public operation, or called automatically at startup.
The maintenance caller uses the shared setup engine's device lock and original
pending run, verifies both signed WGTs against the device's existing trust pins,
and binds the complete installed-member inventory to that run. The caller keeps
SDK access independently available while public acquisition is disabled. Before
returning SDK to loopback, it arms the existing independent 300-second .NET rescue.

The verification sequence is:

1. Bind the old managed digest to its signed payload and the last accepted worker
   identity. Require a different new digest, stable selection, no pending native
   work, and disappearance of the old worker on the same boot.
2. Launch an independent authenticated probe from the new signed managed worker
   bytes, copied into a private root-owned code directory mounted read-only by a
   bounded transient unit. Use a fresh secret, unit, directory and operation ID.
3. `verifyUpgrade` checks every installed package member, runtime and command-line
   hashes, process start time, private namespace, read-only code and launcher
   mounts, root identity, empty owned-resource inventory and stable unit identity.
   It reads retained records twice and checks their public managed status without
   starting, cancelling, forgetting or rewriting any job.
4. `stageSelection` records quiescence, retained-state and readiness receipts. It
   uses `SelectionJournal` to prepare a managed-to-managed `trial-ready` transition;
   selection still names the old worker. It preserves the complete original
   selection file separately, including entries that the 32-entry history ring
   will eventually rotate out.
5. The publisher holds an exclusive remote writer marker, compares the exact
   original selection bytes, and durably archives the receipts before publishing
   the held transaction. It never clears a writer merely because time elapsed.
6. Shut down the probe and independently verify process, launcher and runtime
   disappearance, successful unit exit, unchanged package bytes and retained
   records through the SDK route. Only then commit the original transaction,
   publish its exact next state, retire owned staging, and release the writer.
   Normal service acquisition must independently become ready before installation
   acceptance and rescue disarming.

Publication, SDK lifecycle and interrupted-publication recovery remain explicit
maintenance orchestration; these primitives do not implement an automatic
managed-upgrade coordinator. After any uncertain mutation, inspect the original
writer, selection digest, archived evidence, process identities and unit before
continuing that operation. A failed installation is not permission to retry it.
The .NET entry bridge, worker fallback and independent rescue remain available.

The focused tests cover planning refusal, identity/package/unit/resource failures,
connection replacement, unchanged retained snapshots, and held selection evidence.
Actual target results are recorded with the interrupted-job milestone in
[`../native-worker/MIGRATION.md`](../native-worker/MIGRATION.md).
