# S90D boot-splash acknowledgement investigation

Investigated and implemented 2026-09-20, firmware T-PTMDAKUC-0090-2130.0.
**Historical record:** the splash-only helper below was superseded by telemetry
composites later that day. The current live helper has not been read back for this
assessment. See the [2026-10-12 assessment](native-boot-assessment.md) and
[current recovery procedure](../../guides/s90d-boot-recovery.md). Do not use the
old splash-only installer to replace a composite helper.

The initial read-only investigation was followed by owner-authorized deployment
and reboot validation. The path correction and final implementation below
supersede the original resource-copy proposal.

## Finding

The custom Home integration is missing the native boot splash resource expected
by Samsung's boot code. This is a strongly supported explanation for the
40-second wait identified in [the boot inventory](boot-inventory.md).
The first resource-copy trial was ineffective because its writable destination
was wrong. The corrected implementation supplies the resource through the native
splash executable's explicit path argument. No synchronized physical video was
captured.

The acknowledgement is **not something dashboard JavaScript must send**. It is
emitted by Samsung's splash-window visibility callback. The producer depends on
a native resource path derived from the configured Home **application ID**, not
its package ID. Our IDs differ:

| Item | Value |
| --- | --- |
| Configured Home application | `MiniHub001.Hub` |
| Installed widget package directory | `/opt/usr/apps/MiniHub001` |
| Expected native splash path | `/usr/apps/MiniHub001.Hub/shared/res/homeloading.edj` |
| Expected path on the TV | Absent; application-ID directory also absent |
| Same resource under package-ID directory | Also absent |
| Samsung Home resource | `/opt/usr/apps/com.samsung.tv.csfs/shared/res/homeloading.edj` exists |
| Home autorun | `db/menu/smart_hub/ontvsetting/auto_start = 1` |
| Root application's initial mode | `memory/appfw/is_root_app_init_mode_fg = 1` |

**Correction to the initial investigation:** platform keys start at **zero**.
The exact TV library's lookup table maps key 27 to `TZ_SYS_RW_APP` and key 28
(`0x1c`) to `TZ_SYS_RO_APP`. The original inference from a one-based CLI key list
was incorrect. The latter root is `/usr/apps`, which is on the read-only system
filesystem. `SetEdjPath` passes 28 to `tzplatform_mkpath3`, then the configured Home
ID and `shared/res/homeloading.edj`. There is no package-ID translation.

The failed `/opt/usr/apps/MiniHub001.Hub` resource trial reproduced the 43-second
resume delay. Its complete owned tree was removed using the hash/metadata-guarded
rollback; neither that tree nor its staging directory is part of the final fix.

## Producer and consumer

Offline disassembly/decompilation of the exact TV executables gives this sequence.
Addresses below are Ghidra virtual addresses using its `0x10000` load base.
Decompiler function signatures and return types are imperfect; use the described
branches and native call arguments, not the generated C as buildable source.

1. `BootSplashscreen::Setup` (`0x1c728`) selects the boot mode and invokes
   `SetEdjPath` (`0x1b998`). Normal startup derives the path from
   `db/appfw/home_appid`. Only Samsung Android launcher and Ballie Home IDs get
   the explicit CSFS resource fallback. `MiniHub001.Hub` takes the general path.
   Upgrade mode uses the CSFS resource; license/hospitality-logo paths can select
   a separate empty resource. Those special modes are not established here.
2. `Validate` (`0x1c438`) tests the selected file with `access(path, F_OK)`.
   A missing file throws `std::runtime_error("edj path doesn't exist")` before
   `Prepare` initializes the window. There is also an autorun-off early exit,
   but current autorun is enabled. No acknowledgement is emitted on either path.
3. Successful construction proceeds to `Run` (`0x1c620`), showing the window,
   registering callbacks and checking the root application's initial mode.
4. `VisibilityChangedCb` (`0x1b2f8`) handles either a visible or invisible window
   event and calls `LwipcEventDone("/tmp/boot_splash_resumed")`. This is the
   acknowledgement producer in this executable. It is not a “dashboard ready”
   event, and it does not require disappearance of the splash.
5. `app_resume::main` (`0x10d64`) first waits for
   `/tmp/root_app_init_mode_check_done`, then reads
   `memory/appfw/is_root_app_init_mode_fg`. A foreground root app takes the
   `LwipcWaitEvent("/tmp/boot_splash_resumed", 40000)` path. After that wait it
   checks device power state and requests the root app's resume.

The previous log's `/tmp/init_mode_background` does **not** establish that the
root dashboard should remain in the background. That event comes from a
separate boot-manager mode selection; the root-app foreground flag above is
what the resume controller actually consumes. The dashboard's cold-boot process
arguments include background launch, consistent with preparing it before resume.

## Evidence and limits

The control boot `00000000-0000-4000-8000-000000000010` shows the splash process
reading its early prerequisites around 1.357 seconds, but no splash
acknowledgement. The resume wait begins at 2.730 seconds and expires around
43.007, followed by root resume at 43.012. Two instrumented boots repeat this
pattern. The splash process is gone by post-boot inspection, and
`/tmp/boot_splash_resumed`, `/tmp/.boot_splashscreen_run`, and
`/tmp/boot_splash_finished` are absent then. Absence alone does not prove the
exception, but it agrees with the missing resource and the static failure path.

`launch_splash.sh` permits launch when `/opt/usr/apps/bstr_csfs_mode` exists;
that marker exists, and the kernel log proves the splash executable ran.
Deleting the launch marker would not supply the acknowledgement or repair the
resource contract. The remaining native CSFS resource proves app cleanup did not
remove that file. This investigation does not establish when the dashboard
integration first introduced the delay.

Private evidence under `~/.local/share/samsung-tv-research/`:

- `dumps/20260920T171748Z`: exact executable/script archive and runtime snapshot.
- `dumps/20260920T172025Z`: settings, resource existence/labels, native resources
  and platform configuration.
- `analysis/splash-ack/`: offline Ghidra outputs, PIC string resolutions, binaries.
- `sessions/20260920T172122.497272Z-run`: platform app root and utility help.
- `sessions/20260920T172149.614619Z-run`: ordered platform key list.

Both root collections have verified transport hashes, zero per-operation exit
codes, empty stderr and successful original account/key and temporary-file
cleanup checks. Broad app logging remains disabled. No live splash invocation
was attempted, since it can manipulate panel visibility and input blocking.

| Artifact | SHA256 |
| --- | --- |
| `app_resume` | `31fab93b83e796bec456da20ab7d999e4b5809384acef0edae28a120a50b52da` |
| `boot_splashscreen` | `da40cc2088fd63d06fd3170fcb0e797b45125335e154b67912108bce21b29882` |
| CSFS `homeloading.edj` | `9895cdeba1abef45c60cf13057cc662f159caf94db17436713cbc9d5649b587f` |

## Implemented compatibility handoff

Samsung launches the original splash very early from its read-only fastboot
script and `launch_splash.sh`. Writing a native resource under `/opt/usr/apps`
does not satisfy the `/usr/apps` lookup. Rather than change the read-only system
image, the compatibility helper invokes the signed native program with the
existing resource explicitly:

```text
/usr/bin/boot_splashscreen /usr/apps/com.samsung.tv.csfs/shared/res/homeloading.edj
```

`main` accepts this positional argument and `SetEdjPath` retains it. The child
sources `/etc/profile`, sets `HOME=/home/root`, then uses `exec`, matching Samsung's
normal display environment. Samsung creates the window and sends its own
visibility acknowledgement; no synthetic readiness marker or timeout patch is
used.

`research/s90d-splash/build-helper.py` creates a separate variant of the existing
AT-HUB/screensaver helper. The normal helper source remains unchanged. It calls
`Splash.Start` before existing diagnostic/renderer work and `Splash.Finish` before
exit. At this stage AT-HUB remained Type=simple and this splash addition did not
change the already-patched cached unit (the screensaver setup had replaced its
stock ExecStart). Later telemetry composites keep AT-HUB resident. Consequently,
the earliest handoff is limited by this existing helper's managed startup time;
this implementation does not promise the dashboard's 8–10-second render time as
physical boot time.

The feature is opt-in via root-owned `/opt/minimal-splash/enabled`. It checks exact
firmware, custom Home selection, native executable and resource hashes. It skips
if resume is already requested/acknowledged or another native splash is running.
The child has a ten-second wait at helper completion; failures are logged and
fall back to Samsung's existing resume behavior. This initial splash-only revision
introduced no new resident service or security-policy exception; later telemetry
composites made the helper resident. Existing diagnostic execution and screensaver
overlay behavior are retained.

The historical splash-only installer backed up the original helper and refused
unrelated versions. Its replacement allowlist is intentionally not broadened to
composites: doing so could discard telemetry and screensaver integration.
`tools/s90d/splash.py` now routes to the shared-journal recovery checkpoint tool;
see [boot recovery](../../guides/s90d-boot-recovery.md). It captures the actual
reviewed baseline before a future trial and never installs the old splash build.

## Deployment evidence

- Resource-only preflight: `dumps/20260920T172455Z`.
- The first staging check exposed inherited SMACK transmutation; the corrected
  check matched Samsung's directory metadata before publication.
- Resource-only install: `dumps/20260920T172708Z`; ineffective boot ID
  `00000000-0000-4000-8000-000000000016`, root resume at 43.009 seconds.
- Recovered compressed boot log and exact platform library:
  `dumps/20260920T172956Z`. A preceding raw-log transfer was interrupted; cleanup
  verification and this complete recollection succeeded.
- Resource-only rollback: `dumps/20260920T173318Z`.
- The SDK server briefly stalled and was restarted locally; subsequent cleanup
  verification passed. This did not change TV service configuration.
- Initial helper install and rollback exercised exact helper restoration before
  deploying the version with Samsung's display environment.

## Verified result and state at the splash-only deployment

Full restart boot ID `00000000-0000-4000-8000-000000000017`, collected in
`dumps/20260920T174130Z`:

| Milestone | Kernel seconds |
| --- | ---: |
| Resume controller starts waiting | 2.896 |
| Compatibility helper managed entry | 18.548 |
| Native splash child spawned | 19.805 |
| Native window sends `/tmp/boot_splash_resumed` | **22.467** |
| Resume controller requests root-app resume | **22.468** |
| Native splash sends `/tmp/boot_splash_finished` | 22.645 |
| Helper observes native exit code 0 | 23.570 |

The resume controller woke with roughly 20.4 seconds left on its timeout.
The previous control requested resume at 43.012 seconds: the internal handoff
advanced by **20.54 seconds**. This confirms the real acknowledgement path works
when Samsung receives a valid resource argument. It does not establish exact
power-to-visible-dashboard time: the owner did not time this restart, and no
synchronized physical video was captured.

Native executables, resource, screensaver renderer and cached unit hashes are
unchanged. The helper's existing diagnostic returned zero and its custom renderer
overlay was active. Native splash exit was normal, with no timeout termination.
The dashboard was confirmed as system foreground after boot.

Regression session `sessions/20260920T174214.723775Z-run` launched Plex and
verified it as foreground, returned to the dashboard, launched the screensaver
and observed its native renderer process, then returned to the dashboard. This
checks control flow/process startup; it is not a screenshot-based or physical
visual assessment of the screensaver.

The boot-tested helper hash was
`e10a33fc26a03eea25f2ce0fe63da6d29ed49633068e9cd470ebc59d710b39f7`.
A final change contains diagnostic write/dispose errors so a log I/O failure
cannot interrupt normal boot work; native launch logic is unchanged. The
then-installed splash-only helper hash:
`4a6fdb3d979ab13ed8d38b2bc6e1b9b94e5a04294312d0f9b50cc7f1f0a6c987`, deployment
`dumps/20260920T174317Z`. A warm invocation in PID 1's mount namespace verified
that this splash-only helper **skips** the splash after resume, leaves the dashboard
foreground and retains the active screensaver overlay. Evidence:
`dumps/20260920T174348Z`. This logging-only revision was not separately
cold-boot timed.

The same historical check verifies the exact original helper backup, unchanged
systemd cache/table, and absence of the ineffective resource/staging directories.
All completed deployment/verification operations passed transport hashes and
original account/key/temporary-root cleanup checks. One reboot interrupted its
final cleanup check; verification was rerun successfully after reconnecting.

Builds pass without warnings/errors, shell syntax and Python compilation pass,
and the on-TV rollback round trip restored the exact original helper before the
successful compatibility deployment. The optional boot recorder is disabled.
No firmware files or signed native executables were patched. The feature remains
enabled persistently through the existing boot helper and its opt-in marker.

## Subsequent state correction — 2026-10-12

The later recorded composite `879e602d…` retained splash/saver work and left
AT-HUB resident. The setup profile expects `93dec0d4…`, but the assessment has no
post-install live readback confirming that revision. Neither this page nor the
profile establishes today's installed bytes. Recovery must checkpoint a fresh,
reviewed baseline before a separately authorized trial. The private assessment
also confirms a static starter.target scheduling exemption for AT-HUB; its actual
runtime policy remains unmeasured. See the assessment summary for evidence and
measurement limits.
