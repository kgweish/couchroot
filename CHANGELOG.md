# Changelog

## 0.1.0.dev1 — unreleased

- Combine public-release preparation and native-worker development into one
  experimental source candidate. Native root operations, journaled managed/native
  transitions, retained jobs and SDK rescue coexist with QN90A basic telemetry and
  the existing settings adapter. Retain the small .NET entry bridge, firmware
  runtime and managed fallback. Neither native-default installation nor complete
  .NET removal is claimed.
- Trim ordinary native build snapshots to worker inputs and remove the deferred
  capability-entry diagnostic from the normal package command. Keep research
  evidence and recovery artifacts. The S90D maintenance restart procedure waits
  for the original WRT host to exit before relaunching once. Previous 0.7.52
  device results do not qualify this combined candidate; current validation is
  local only. See [scope and remaining gates](docs/project/release-readiness.md).

- Reconcile the installer/basic-telemetry candidate with the public WebView and
  root-agent changes. Keep root-worker harness execution in managed CI, add native
  collector host checks to the existing Linux job, and fix TLS connection-reuse
  coverage on Node 22 using a valid localhost certificate. Preserve recovery and
  record the [release review](docs/project/release-readiness.md).

- Clarify the QN90A telemetry implementation/acceptance docs, run web CI once per
  OS, and refuse existing staging with a direct path check instead of directory
  hashing. Preserve explicit recovery and record the local validation and review
  groups in the [cleanup tracker](docs/project/qn90a-cleanup-plan.md).

- Narrow the home-use milestone to QN90A basic telemetry with the existing signed
  settings adapter and journaled recovery. Retire continuous QN90A inspector
  collection and suppress old inventory at ingestion and in the dashboard.
  Preserve basic counters/history, S90D behavior and existing recovery tools.
  Wait for queued telemetry handoffs and allow an explicit rollback to retry
  its exact failed recovery helper after confirming the process has stopped.
  Defer other helper, boot and root-worker rewrites. Local validation only;
  no TV or NAS deployment. See [accepted scope](docs/project/dotnet-deprecation-plan.md).

- Reconcile S90D boot documentation with the offline 2026-10-12 assessment:
  distinguish process events, splash acknowledgement and unmeasured physical UI
  readiness; defer the native graphical port. Add single-change boot recovery
  checkpoints for exact composite-helper or patched-cache restoration, using
  shared setup journals, locks and identity checks. Offline-tested only; no TV
  access, boot trial or hardware validation was performed.

- Add `couchroot-install` for explicit web/native selection, offline preparation,
  scoped web setup and enrolled QN90A native boot-hook installation/recovery.
  Native uses immutable per-run captures, verified staging, an atomic final hook
  switch and shared resume/rollback journals. Existing preferences and the web
  fallback are retained. Native failure falls through to the original boot chain.
  This new backend is offline-tested only; no TV deployment or hardware acceptance
  has been performed. See [native installation](docs/guides/native-installation.md).

- Autonomous root agent: remove nested base64/JSON upload payload encoding with
  authenticated binary chunks to the retained .NET worker. Agent 0.7.0 reduced
  median 8 MiB upload time by 37% on QN90A and 46% on S90D, preserving digest,
  resume, conditional replacement and no-retry behavior. Both TVs passed live
  acceptance without reboots, as requested; reboot persistence is untested for
  this version. See [benchmark and validation](research/autonomous-root/CAPABILITIES.md#binary-upload-benchmark--2026-10-13).

- Autonomous root agent: reuse bounded, certificate-pinned HTTPS connections
  within file transfers, without changing the .NET worker or replaying failed
  requests. Agent 0.6.0 passed both-TV and post-reboot acceptance. Paired 8 MiB
  trials used one TLS connection instead of ten and reduced median download time
  by 13% on QN90A and 36% on S90D; upload timings showed no consistent gain. See
  [benchmark and validation](research/autonomous-root/CAPABILITIES.md#https-reuse-benchmark--2026-10-13).

- Autonomous root agent: send bounded, authenticated binary download responses
  from the retained .NET worker, removing nested base64/JSON chunk encoding.
  Signed agent 0.5.0 passed both-TV and post-reboot acceptance; measured median
  8 MiB downloads improved by 1.61× on QN90A and 2.46× on S90D. See the
  [benchmark and validation](research/autonomous-root/CAPABILITIES.md#binary-download-benchmark--2026-10-13).

- Autonomous root agent: buffer protocol input in the retained .NET worker,
  preserving binary read-ahead and existing frame limits. Agent 0.4.0 reduced
  measured median 8 MiB upload time by 7.7× on QN90A and 8.8× on S90D; both
  passed transfer, app/helper, job and post-reboot acceptance. See
  [benchmark and validation](research/autonomous-root/CAPABILITIES.md#buffered-protocol-reads).

- Autonomous root agent: retain the .NET worker and use a signed, embedded native
  launcher for app commands and jobs. Verify its private read-only view, drop app
  credentials, clean the child environment/descriptors, and preserve quoted
  commands with structured arguments. Agent package 0.3.1 passed deployment,
  command/job supervision and reboot acceptance on QN90A and S90D; see
  [hardware results](research/autonomous-root/CAPABILITIES.md#native-launcher-acceptance--2026-10-13).

- Native WebView: fix the intermittent QN90A startup crash (glibc heap
  corruption while Chromium created its first browser context; about 24 s lost
  per affected boot). The host now loads libpthread at startup instead of
  receiving it later through EFL/Chromium's `dlopen` on glibc 2.30. Stress runs
  on the TV: 0 crashes in 853 starts with it (idle, CPU-loaded, default engine),
  51 in 290 without. The supervisor also records
  every thread's stack while the firmware holds a crashing child.

- Native WebView: return to the Hub when the TV wakes from standby on Live TV.
  A cheap once-a-second display-state check detects screen-on and runs the Home
  path (signed Hub handoff, re-arm, native Hub). Live TV opened deliberately with
  the screen on is untouched. A changed saved source is re-armed immediately so a
  quick power-off does not boot on Live TV. On QN90A, Hub was back about 5.6 s
  after wake.

- Native WebView: never present the static default tiles. Under QN90A boot load
  a frame of the pre-script markup could finish after the Hub's readiness
  message; 3 of 9 captured boots showed the default tiles for 70–180 ms. The
  native bundle keeps that markup transparent until the saved Home renders, and
  the host also waits for the page's presented first contentful paint.
- Add WebView startup instrumentation (EFL, engine load, view, page milestones
  with CPU, kernel time and page faults) and `minimal-hub-procsample` for private
  process, memory and contention profiles. Profiling showed the 4.4–5.2 s cold
  load of Samsung's Chromium 120 engine under saturated boot CPU dominates;
  tested launcher-side changes did not reduce it and were not kept.

- Keep the native WebView window hidden until page load and a subsequent rendered
  frame, leaving the signed Hub visible during normal boot. Recheck the source,
  foreground and display before showing it; do not interrupt a newly opened app.
  The journaled launcher enables `COUCHROOT_WEBVIEW_DEFER_SHOW=1`.

- Add the experimental QN90A native WebView launcher (`native/webview/`): shared
  web UI on Chromium/EWK, verified engine selection, native app discovery/launch,
  one-time native preference import, Home/source handling and bounded crash
  supervision. The signed web package and S90D install path are unchanged.
- Admit both normal and background boot modes to the native dispatch and its
  monitor, fixing a normal-mode gap that suppressed web autostart but never
  started native. On normal boot, wait for the display and hand the TV viewer
  to the signed Hub before admitting WebView; cancel for another app or source.
- Add first-boot recovery commands and fault tests. Dispatch watcher command text
  through `sh -c` because this firmware rejects unsigned shell-script filenames;
  serialize acceptance with hash-checked rollback. Deployment remains private
  and journaled, not a new public setup default. See the WebView README for
  hardware evidence and limitations.

- Add the experimental native Hub (`native-hub/`, QN90A only). It is an Ecore/Evas
  launcher started from the earliest boot hook. QN90A software time to a rendered Hub
  is 8.8–10.1 s across five reboots; the best web path was about 37–47 s.
  - Root cause found: Samsung's systemd starts late boot services at `SCHED_IDLE`.
    The native unit opts out with `CPUSchedulingPolicy=other`, the vendor
    convention, at normal priority.
  - Dispatch moved ahead of the other hook layers.
  - See the [launcher guide](docs/guides/choosing-a-launcher.md) and the
    [boot performance record](docs/devices/qn90a/boot-performance.md).
- Reduce QN90A Live TV boots after watching TV. Opening Live TV/TV Plus rewrites
  the saved boot source at once, so native re-arms `isp-service` about every 15 s
  while it runs. A power-off before the next re-arm can still start one Live TV boot.
  Home from Live TV asks the web Hub to open, then raises native once a re-arm no
  longer sees the viewer in front. Picture and audio were not measured.
  - The Home fallback is now one tracked attempt at a time, with a launcher deadline,
    a fixed overall deadline, and cancellation if another app takes the foreground,
    the worker restarts or a reply is late. Mock-tested only; not yet on hardware.
- Refresh the native Hub visuals (designed in two parallel passes, see
  `native-hub/DESIGN.md`):
  - Layout: one margin system, a quiet header clock, a balanced grid and a single
    footer control bar with quiet key hints.
  - List pages: consistent rows, previews and badges.
  - Tiles: dark brand-tinted, with a soft bottom brand glow and one Bold wordmark rule.
  - Focus: a bright ring with a dark gap, a halo, and brightened brand light.
  - The validator checks contrast against the composited tile, at rest and focused.
  - QN90A capture verified; one boot rendered at 9.26 s, within the earlier range.
- Generate native tile art from validated per-app specs (`native-hub/cards/`), with
  contrast, clean wordmark-area and in-card checks; 12 cards use 73 retained scene
  objects in the current harness, instead of 386. Add an opt-in startup profiler
  (`COUCHROOT_NATIVE_PROFILE=1`); its stop flag is now mutex-guarded.
- Root agent: archive and maintain the request journal; add the Python transport
  used by the setup engine.
- Reorganize the repository. Device scripts move to `tools/`, signing and packaging
  to `scripts/`, and the native launcher to `native-hub/`. Docs are grouped into
  `guides/`, `devices/`, `research/` and `project/` with an [index](docs/README.md).
  Fix two QN90A operation scripts that no longer parsed after the move and the card
  preview's repository root; an offline test now parses every tracked Python file and
  checks repository-root expressions.
- Defer initial app discovery and monitoring I/O until Hub has focus, keeping
  saved shortcuts available first. Avoid inspecting the native sound fallback
  when Web Audio is available. QN90A startup profiling did not establish a
  consistent total boot-time reduction; the tested three-second relay settle
  was reverted to five seconds in relay 0.2.4. See the startup profiling report.
- Avoid a false launch-failure dialog when Samsung Home opens as an overlay
  while Hub stays visible, as verified on QN90A. Missing callbacks and reported
  failures still offer recovery.
- Move shortcuts directly in the Home grid, undo the latest removal, and offer
  optional hold-OK editing (off by default). Keep launch progress visible until
  Hub leaves the screen; let Back dismiss it. Reuse unchanged Home tiles on
  return, defer catalog refresh, and improve secondary-text contrast/readability.
  Both TVs received the UI update; see the hardware validation record for the
  exercised behaviors. Hardware wake latency and HDMI handoff still need
  model-specific verification.
- Add remote-operated launch recovery with Retry and Samsung Home, remember
  Home selection across restarts with a First favorite option, and replace dimmed
  scroll-edge rows with directional cues. Existing shortcut order is preserved.
- Cache the static Home backdrop separately from interactive content and isolate
  footer painting; use solid utility-page backgrounds and batch scroll-edge
  updates. Preserve artwork, focus rings and settings, with a browser regression
  that checks actual paint reuse during remote navigation.
- Polish the Hub UI: 16:9 tiles with em-scaled artwork, one rounded focus ring,
  shared rows/preview/hint layout for Edit apps, Add apps and Settings, unified
  dialogs, an actionable empty Home, in-list loading/failure notes, dimmed
  unavailable tiles and error-toned status lines. Storage keys are unchanged.
- Fix the TV monitoring dialog on Chromium 76 (`inset` and px sizing), focus
  rings clipped after scrolling, and a late app list erasing "added to Home".
- Keep applied runs recoverable until saved choices and ownership ledgers are
  durable. Schema 2 records local rollback state and preserves subsequent edits;
  recover older journals with their original checkout.
- Reconcile interrupted inverse operations and verified staging files, preserve
  unknown staging content, and prevent new apply inspection while a run is pending.
- Bound nested reboot observations with one remaining deadline, without launching
  Hub or retrying the reboot request. Report uncertain diagnostic cleanup.
- Add crash/storage-failure tests and source-only Linux/container validation,
  plus a cross-path QN90A saver reproducibility check in CI. Physical hardware
  acceptance and owner disclosure/licensing decisions remain release blockers.

## 0.1.0.dev0 — unreleased

- Separate portable firmware profiles, private site settings, preferences and
  independently enrolled signing trust; remove personal defaults from current files.
- Replace the CLI's private dump-collector dependency with a source-built, bounded
  model-specific root runner. Hardware validation remains outstanding.
- Bind recovery journals to destination/trust, check source before reconciliation,
  reject apply after rollback starts, and continue reversible rollback when
  managed application reinstall requires manual recovery.
- Add dependency checks, deterministic native builds, offline platform CI,
  privacy scan, installation/security documentation and release acceptance gates.

The CLI version follows semantic versioning once released; `devN` marks an
unreleased development tree. Package versions on a TV remain separate and must
increase for in-place installs. Journal schema changes require explicit migration
review; never upgrade an unfinished run in place. A supported firmware change is
not implied by a CLI patch version.
