# QN90A basic telemetry: local integration candidate

This implements local preparation and journaled installation/recovery for
[the accepted home-use scope](../project/dotnet-deprecation-plan.md). It reuses the existing C collector,
shared telemetry lease, package-private pairing and preferences, systemd unit
properties, and QN90A native boot-hook renderer. **No TV deployment or new hardware
validation has occurred. Managed telemetry remains the default.**

## Prepare offline

Supply reviewed ARM ELF inputs and a new output directory outside the checkout:

```sh
./couchroot-install prepare --device qn90a --launcher native \
  --native-binary /private/build/native-hub \
  --native-telemetry-binary /private/build/collector-arm \
  --output /private/couchroot-native-telemetry-review
```

This reads local files only. It adds the collector, a unit reference, boot
submission script and marker-handoff script to the usual unsigned launcher
bundle. Every payload has a hash; the version directory derives from the binary
and relevant source hashes. An owner-supplied binary is checked structurally, not
claimed to match the checkout or to have passed the firmware ABI checks.

The manifest reports journaled installation support, inspector retirement and
the retained managed adapter. Preparing a bundle does not sign the updated adapter,
copy credentials, enroll a boot hook or create a device journal. Ordinary
launcher-only preparation and installation behavior is unchanged.

## Journaled installation and recovery

The existing native installer accepts these bundles using the same device lock,
identity/trust binding, captured inputs, setup Engine and journal. It requires a
current signed MiniTelemetry adapter already installed by the existing web setup
flow: the local ledger must match its source revision and every installed assembly
hash must match that ledger. An absent/stale ledger is refused before connection;
remote adapter or registration drift is refused before staging. Native installation
does not build .NET, sign packages, install a second service package or touch the NAS.

The transaction has two actions, in this order:

1. Stage immutable versioned collector code, unit reference and scripts, checking
   hashes, ownership, permissions and package labels. Journal the marker handoff,
   wait for the shared lease to drain, and submit the captured collector once.
2. Back up and replace the enrolled launcher boot hook, including the optional
   telemetry bootstrap, using the existing atomic hook transaction.

Telemetry handoff is immediate; the launcher still changes on the next boot.
Neither operation reboots the TV or launches the Hub. Existing signed-adapter
upgrades remain a separate web setup operation. Disabled monitoring preferences
remain disabled, and pairing/preferences are never read into the run or rewritten.

A lost reply is reconciled through marker, payload and unit readback. An unchanged
uncertain action requires the Engine's explicit `--retry-unchanged`. A marker
handoff that completed without a provably running collector requires rollback;
resume does not guess whether to submit another sampler. Captured inputs allow
recovery after the original bundle is deleted. Source/trust changes still require
the original checkout/enrollment, as with launcher recovery.

Rollback reverses the actions: restore the original hook first, revoke the
version's boot admission under the same lock used for boot submission, stop only
the unit with the captured executable/arguments/identity, stop any outstanding
forward handoff, then restore managed selection under the shared lease. This
prevents a delayed boot callback from re-admitting the collector after recovery.
The per-boot claim is retained; failed or rolled-back installs cannot silently
resubmit in the same boot. A new installation requires a later boot and fresh
reviewed staging. Staged files and private preferences are retained.

The standard native `inspect`, `apply`, `resume`, `rollback`, `verify` and offline
`status` commands are documented in [native installation](native-installation.md).
The commands that contact devices require separate deployment authorization;
**none were run against a TV for this implementation**. `verify` establishes
configuration/unit readback, not receiver freshness or hardware acceptance.

## Handoff contract

The existing empty `MiniTelemetry/data/enabled` marker selects the managed sampler.
The candidate renames it to `native-enabled` in the same directory. It does not
rewrite pairing or preferences. A disabled/uninstalled, symlinked, nonempty or
ambiguous marker state is refused.

After that rename, the managed collector's existing loop exits. The handoff waits
up to 18 seconds for the existing `/tmp/minimal-telemetry-qn90a/lock` lease before
returning success. The C collector's new, QN90A-only `--native-handoff` mode requires
an empty regular `native-enabled` marker and an absent managed marker. It uses the
same lease, receiver credentials and preference file. The old trial mode is unchanged.

Hub settings still use `MiniTelemetry.Start` and its caller-validated managed
service. The adapter skips loading `Telemetry.dll` when native is selected. It
does not gain permission to start system units or issue root commands. Monitoring
off stops transmission through the existing preference mechanism; the small C
process remains available to notice re-enablement. Removing native selection or
stopping the unit ends the worker. **The managed adapter can remain resident in
this slice; no total-memory saving or CLR-free runtime is claimed.**

The bootstrap submits one fixed systemd unit with the existing package label,
owner UID, read-only code view, nice level and bounded restart policy. It does not
run the sampler synchronously in the boot hook. Sampling still waits until at
least 60 seconds uptime. A per-boot claim prevents resubmission after a lost reply
or transient-unit garbage collection; an existing unit is never restarted by the
bootstrap. Failure leaves the prior launcher/diagnostic boot chain available.
Hardware tests must establish that the chosen hook can submit this unit reliably.

Rollback must first restore the prior boot hook and stop the native unit. Only
after the lease is free can the handoff rename `native-enabled` back to `enabled`.
The normal Hub control path can then restart the managed sampler. Restoring the
marker alone is not proof that managed collection resumed. A failed or uncertain
handoff must be reconciled from marker/lease/unit state. A later explicit rollback
may retry the exact failed recovery helper after confirming it has no running
process; the helper must still acquire the lease before restoring the marker.
Forward handoffs are never replayed automatically, and recovery never launches
a fallback sampler automatically.

## Local checks

Python tests exercise deterministic preparation, adapter prerequisites, two-action
journaling, every staging interruption, lost handoff/start/rollback replies,
generated shell on temporary files, queued handoff jobs, failed recovery retries,
rollback ordering, one boot submission,
revoked admission, foreign-unit refusal, and preservation of the prior hook. Device identity, ownership and
systemd commands are stubbed in those shell tests; they are not SMACK/UEP tests.

```sh
python3 -m unittest discover -s tests -p native_telemetry_test.py
python3 -m unittest discover -s tests -p native_telemetry_install_test.py
python3 -m unittest discover -s tests -p native_install_test.py
python3 tests/telemetry_service_test.py
```

The existing local build image supports host-only C tests without private firmware
libraries. These containers have no external network; TLS tests use loopback inside
the container. The output directory must exist first.

```sh
mkdir -p test-results/native-telemetry
docker run --rm --pull never --network none --platform linux/amd64 \
  -v "$PWD:/src:ro" -v "$PWD/test-results/native-telemetry:/out" -e OUTPUT_DIR=/out \
  samsung-native-collector:bullseye sh research/native-telemetry/collector/build.sh --host-only
docker run --rm --pull never --network none --platform linux/amd64 \
  -v "$PWD:/src:ro" -v "$PWD/test-results/native-telemetry:/out:ro" \
  samsung-native-collector:bullseye python3 research/native-telemetry/collector/test_collector.py
```

`collector-host` bypasses device checks and must never be deployed. The normal ARM
build still verifies the private firmware libraries; this change does not relax it.

## Remaining acceptance

The transaction is locally tested only. Actual firmware admission, SMACK access,
systemd property/readback behavior, signed adapter upgrade and resumed managed
transmission require separately authorized hardware validation. No second
installer or supervisor was added. Launcher-only bundles do not select telemetry.

Continuous inspector snapshots are intentionally retired on QN90A. The current
managed fallback also sends basic counters only. The receiver drops inventory
from older QN90A senders and the dashboard hides stored snapshots, showing
“Retired on QN90A.” Basic metrics, chart history, pairing and settings remain.
S90D inspector support and manual diagnostic/recovery tools are retained.

Remaining acceptance is limited to QN90A: boot/wake, settings, exactly one sampler,
restart limits, receiver freshness/history, loss of the management connection,
exact rollback and verified resumed managed transmission. Observe normal use for
several days and compare combined managed/native resource use. Other helper,
boot and root-worker rewrites and S90D migration are deferred, not prerequisites.

Keep the currently deployed configuration until a separately authorized hardware
session accepts this candidate. No TV or NAS deployment was performed here.
