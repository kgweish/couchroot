# Native Hub startup experiment

> **Status:** experimental, QN90A firmware T-NKM2AKUC-2301.1 only. This folder contains
> the launcher source, tests, card styles and records. The
> [unified installer](../docs/guides/native-installation.md) now implements enrolled
> native boot-hook installation and journaled recovery with offline validation.
> It has not been deployed or hardware-tested; existing private trials still use
> their original retained drivers for recovery.
> Use the [web Hub](../web/) for a supported installation, and see
> [choosing a launcher](../docs/guides/choosing-a-launcher.md).

The [S90D offline assessment](../docs/devices/s90d/native-boot-assessment.md)
defers a graphical port: web startup already precedes the splash/resume gate,
and panel-visible/input-ready times remain unknown. S90D native headless-service
evidence is separate from graphical Hub compatibility.

QN90A-only research prototype, not a supported replacement deployment default. It renders
a native app grid with the TV's EFL 1.25 libraries, without a web or .NET host.
The current variant uses Ecore/Evas directly, avoiding Elementary widgets.
Private hardware evidence and guarded trial drivers are stored under REA-19.

The native executable runs as owner UID 5001 in the previously verified private
read-only VDFS view. Ordinary writable-path execution is rejected even inside a
developer-signed package on this firmware. See the
[native execution findings](../docs/research/native-service-research.md).
No Samsung library, executable, signing material or compiled artifact is included.

## Native parity candidate (QN90A cold-boot tested)

The current source expands the three-tile prototype into a bounded native UI.
A versioned build is installed in the QN90A trial boot chain, with the previous
binary and hook retained for rollback. Strict boot admission, source/power/foreground
checks and casting deferral remain in place. Web Hub autolaunch stays disabled.
S90D was untouched. This experimental installation is not the public CLI default.

| Feature | Native candidate |
| --- | --- |
| Home | Rounded 16:9 cards, local vector artwork/wordmarks, compact footer, key chips and instant focus ring |
| Remote | Four-way grid/list navigation, paging, Back stays on Home |
| Shortcuts | Add from discovered apps or local catalog, move in grid with save/cancel, remove, session undo |
| Settings | Comfortable/compact, off/12/24-hour clock, first/last selected, confirmed shortcut reset |
| Persistence | Separate versioned native file, atomic replacement, bounded parsing, visible save errors |
| Launch | Nonblocking child supervision, duplicate guard, 10-second timeout, retry/Home recovery |
| Fallbacks | Explicit Samsung Home and manual Web Hub controls |
| Advanced web features | Navigation sound, hold-OK, menu fade and monitoring configuration remain in Web Hub |
| Installed-app discovery | Deferred native app-manager worker; bounded, filtered catalog; refresh after return and every 60 seconds |
| Return from another app | Native remains alive; compositor focus restores controls despite stale framework foreground data |

This is feature convergence, not full parity or a production Home replacement.
The launcher is still an unregistered EFL window. App acceptance does not prove
foreground handoff. App exit/return and physical Home routing are separate: the warm trial verified
YouTube exits. The opt-in native Home grab handles short Home presses while healthy;
the unchanged underlying Samsung route still targets web Hub as a manual fallback. Utility previews follow the selected app/setting; list rows survive focus changes.
Back restores the invoking footer control. Clock changes only on minute boundaries; focus
moves do not regenerate visible cards. Lists render only their visible rows.
There are no animated backgrounds, network fetches, or web/.NET dependencies.

### Private configuration

The journaled trial provisions an owner-writable private
directory and sets these environment variables in its versioned trial unit:

- `COUCHROOT_NATIVE_STATE`: absolute path to the native preference file.
- `COUCHROOT_NATIVE_CATALOG`: optional absolute path to a UTF-8 local catalog.

Without a state path, the UI runs in preview mode and explicitly reports that
saving is unavailable. It never modifies the web app's localStorage. Native preferences are independent.
The authorized QN90A migration automatically takes a stable, read-only snapshot
of web Hub storage and converts favorites/order, selection, layout, 12/24-hour
clock and startup choice. Deployment backs up existing native preferences and
installs the owner-readable file atomically under the shared setup journal.
This is a one-time migration: later native edits are not overwritten. No browser
database parser or web app launch is added to boot. The generic public setup CLI
does not yet orchestrate this experimental migration.

For a retained Chromium snapshot, `import-chromium-state.py` selects only the five
supported Hub keys, resolves sequence numbers and tombstones, and writes a new
mode-0600 candidate without overwriting an existing file. It uses an external
[CCL Chromium Reader](https://github.com/cclgroupltd/ccl_chromium_reader) checkout
(MIT, copyright CCL Forensics; tested commit
`ef840de30221c4d65bc96d2f4d9057e9ef2f526d`). Its code is not vendored. Pass the
checkout with `--reader-directory` and its Snappy dependency location with
`--snappy-directory`. Keep snapshots, generated preferences and journals private.
An explicit localStorage JSON export is also supported:

```sh
node native-hub/import-web-state.cjs /private/exported-storage.json /private/native-state
```

The JSON input is an object mapping the original `minimal-hub.*.v1` keys to their
localStorage string values, including the JSON string stored at
`minimal-hub.shortcuts.v1`. Other fields are ignored and never copied into native
state. Exports over 128 favorites or with invalid entries are rejected, not
truncated. Unsupported settings (sound, fade, hold-OK, monitoring) stay in the web
Hub; importing does not apply those settings to native.

The optional imported catalog contains one `app.id<TAB>Display name` per line, with a final newline.
It accepts at most 128 unique entries, IDs up to 256 bytes and names up to 120
bytes. Reserved Home/Web Hub IDs, control characters and malformed input are
rejected. Missing or rejected catalogs leave the two default apps available and
the picker identifies that limitation. File loading is deferred 1.5 seconds
into the UI event loop. Live discovery begins after the first render and at least
1.7 seconds into the loop, replacing the fallback catalog when successful.
No background refresh may reorder a user's favorites.

The state file starts with `COUCHROOT1 compact clock first selected`, followed
by catalog-format favorite lines. Values are validated before replacing memory.
Writes use a mode-0600 temporary file, flush/fsync and same-directory rename.
Selection writes wait 300 ms after navigation settles; explicit edits report
failure and preserve the saved list. Unreadable state is not overwritten merely
by moving focus. There is no promise of surviving power loss before directory
metadata reaches disk.

### Automatic discovery and return

`hub-platform.h` uses the documented Tizen app-manager API in a separate exec'd
worker. It runs as owner, without root or a network listener. The Evas thread uses
nonblocking IPC; a five-second worker alarm and six-second parent timeout bound
API stalls, with a five-second restart backoff. Failed discovery retains the last
valid catalog and saved shortcuts. Successful refreshes preserve picker focus by
app identity. The 128-app bound rejects overflow instead of silently truncating.

The consumer filter follows the web bridge's package-ID boundary and explicit
Netflix/Prime/browser exceptions, excluding hidden/service apps and TV Plus for
this no-Live-TV trial. Samsung exposes internal tools as visible applications, so
`nodisplay` alone is insufficient. This is a curated consumer boundary, not a
promise to enumerate every installed package or detect every unusable shortcut.

`hub-lifecycle.h` keeps native alive after launch. Actual compositor focus-in
acknowledges an already-completed return, clears launch state and refreshes the
catalog. It does not force a window over an active app. A separate reclaim path
requires an observed away transition followed by two fresh, safe empty foreground
snapshots using the existing source/power checks. Missing or failed observations
cannot trigger it. No firmware setting or boot admission guard is weakened.

API references: [Tizen app-manager guide](https://github.com/Samsung/tizen-docs/blob/master/docs/application/native/guides/app-management/app-manager.md)
and [app-info reference](https://docs.tizen.org/application/native/api/mobile/5.0/group__CAPI__APP__INFO__MODULE.html).
The exported symbols and behavior were verified on the QN90A firmware.

### QN90A warm verification, October 11, 2026

The candidate rendered 332 ms after warm process entry, then discovered 26 apps
about 1.9 seconds after its first frame. This is **not a cold-boot measurement**.
The live picker was inspected through a compositor capture; adding a discovered
app produced the expected separate native preference file.

YouTube launched, exited via Back to the same native PID, and launched/exited
again. Return-state handling took 24 ms and 5 ms from compositor focus-in. These
measure callback handling, not the full button-to-visible transition. Selection
survived both cycles. Samsung's foreground key remained stale, establishing why
waiting for that key to clear prevented further launches in the first trial.

Plex launched and returned to native after app-manager termination, with 7 ms
focus handling. Its profile picker ignored Back; a natural Plex Back exit is not
verified. A deliberately terminated API worker restarted without replacing the
native process or losing focus, and the next catalog refresh succeeded.

Source/ISP/background guards, web-autolaunch claims and the boot-hook hash were
unchanged. Compositor state showed TV Viewer unmapped. No new physical panel/audio
confirmation was collected. Physical Home routing still targets web Hub, and
standby/resume, arbitrary apps and this candidate's cold-boot timing remain
unverified. The trial must not be described as a permanent Home replacement.

The final rollback reboot restored the retained native binary, with first render
at **13.227 seconds**, matching boot-hook hash and healthy root recovery. The
transient candidate files were removed through the shared journal, which reached
`rolled-back`. Native remained focused, the ISP/background configuration and both
web-autolaunch suppression claims were verified, and no web Hub process was found.
The candidate source and private warm evidence are retained; this result does not
measure the candidate's cold boot. The local suite passed all 101 tests, including
stale-foreground handling, failed catalog refresh preservation and the unchanged
admission denial matrix.


### Local verification

```sh
sh native-hub/test.sh
# Optional scene SVGs from the same UI functions, using a mock Evas backend:
mkdir -p test-results/native-scenes
sh native-hub/test.sh test-results/native-scenes
node native-hub/screenshots.cjs
```

The C harness checks grid boundaries, cancel/save, undo after intervening edits,
failed writes, reset preference preservation, 128-item paging, empty Home,
strict state parsing, symlink rejection, 24-hour persistence, footer focus recovery,
asynchronous child failure and timeout. It also exercises 10,000 in-page focus moves
with twelve branded cards (73 retained scene objects) to verify the bounded scene keeps
the same card objects. Paging, moving and utility previews deliberately rebuild their
scene content. Mocked Home-fallback tests cover launcher failure and timeout, repeated
Home, worker restart, expiry and a foreground change. On Linux, a profiler test starts
and joins the real sampler thread. The unchanged native guard denial matrix runs
alongside it. `npm test` includes this harness.

Scene SVGs are layout diagnostics, **not native screenshots**: the harness uses
approximate text metrics and browser SVG rendering. They were reviewed at 1920×1080
and 960×540 alongside the web workbench. Warm Evas rendering, injected remote navigation and selected app transitions
were also checked on the TV. Physical remote feel and candidate cold-boot timing
remain separate validation work.

Before promotion: finish physical remote/Home-routing and app-exit coverage,
provision a persistent private state directory through the setup engine, and
compare repeated cold boots against the retained build. Keep the warm-trial
evidence separate from no-Live-TV/spinner panel/audio confirmation. Keep all admission guards and web-autolaunch suppression.
Do not treat ARM compilation or the binary size as proof of unchanged boot time.
Default UI mode retains its 45-second limit; the retained native-only boot mode
explicitly uses `--native-guard --stay`.

`first-render-complete` is an Ecore/Evas post-render callback timestamp. It is not
an exact physical panel presentation timestamp. Screenshot and compositor checks
are separate evidence. Warm startup timings are not cold-boot promises.

## Build

Requires the existing private `samsung-native-collector:bullseye` build image with
ARM soft-float GCC. The build rejects GLIBC requirements above 2.17. The ARM `fcntl` reference
is pinned to its legacy GLIBC 2.4 interface because the build image defaults to
GLIBC 2.28; only integer flag commands are used. The output loads
the TV's installed EFL libraries through `dlopen`.

```sh
NATIVE_HUB_OUTPUT_DIR=/absolute/private/native-build sh research/native-hub/build.sh
```

The minimal ABI declarations use documented EFL legacy interfaces. The key event
reads only its first `keyname` member; the callback enum was checked against
[EFL 1.25.1's header](https://github.com/Enlightenment/efl/blob/v1.25.1/src/lib/evas/Evas_Common.h).
The initial Elementary version used the
[EFL window guide](https://www.enlightenment.org/develop/legacy/program_guide/widgets/win)
and local key handling follows the [Evas event example](https://www.enlightenment.org/_legacy_embed/Example_Evas_Events.html).

Use the shared setup engine for identity, locking, staging journals, hash checks
and rollback. Do not run this binary through a production package install or
replace the current Hub. The private recovery instructions restore the exact
quiet-launch hook before removing the prototype binary.

## QN90A trial results

Single cold boot per variant; both ran alongside the retained quiet web Hub.
These are exploratory measurements, not a controlled benchmark or a full native
replacement. The lighter canvas source is the retained prototype.

| Milestone | Elementary | Plain Ecore/Evas |
| --- | ---: | ---: |
| Warm main entry to render callback | 0.247 s | 0.177 s |
| Cold main entry, since boot | 27.047 s | 29.039 s |
| EFL initialized, since boot | 32.155 s | 32.372 s |
| Native render callback, since boot | 36.010 s | 35.632 s |
| Cold main entry to render callback | 8.963 s | 6.593 s |
| Web Hub observed foreground, since boot | 40.38 s | 39.91 s |

The owner saw black followed by native roughly one second before web Hub in the
Elementary trial. The callback-to-foreground gap is not the physical visible lead:
these are different milestones. Dropping Elementary shortened measured native
initialization, but moved first render only 0.38 seconds earlier across these two
boots. Boot scheduling and concurrent service work still dominate. No repeatable
end-to-end speedup has been established, and the prototype does not provide the
full web Hub feature set.

Both variants passed warm Left/Right and Back-to-Hub checks. Both cold boots
reached web Hub, preserved ISP/background routing, and produced all four genuine
completion markers. The systemd hard limit begins before native initialization;
under cold load it may stop the process before its own 45-second UI timer.

The canvas service reached its intended outer runtime limit with `Result=timeout`
and process exit status 0; web Hub remained foreground. Both experimental boot
entries and staged binaries were then rolled back. The prior quiet-only Hub hook
was verified by hash, with no native prototype process left running.

## Earlier native startup: repeated cold-boot result

A follow-up started the native process before web application readiness, loaded
its libraries, then checked compositor availability and the existing source,
power, foreground and revocation conditions before creating a window.

| Milestone, seconds since boot | Trial | Unchanged repeat |
| --- | ---: | ---: |
| Native main | 12.609 | 11.930 |
| Libraries loaded | 12.631 | 12.323 |
| Compositor marker/socket observed | 12.63 | 12.37 |
| Final admission passed | 13.085 | 13.847 |
| First render callback | **14.341** | **14.751** |
| Web Hub observed foreground | 37.61 | 38.37 |

The owner confirmed the repeat was faster and went directly into native. The
first successful trial was not watched; no separate audio verification was given.
The same canvas previously rendered at 35.632 seconds when launched after app
readiness. Starting earlier produced a roughly 21-second improvement in its
render callback, with no cache, priority, firmware-library or source changes.
Library loading took only 0.022/0.393 seconds in these early trials. These results
support earlier admission as the useful change; they do not establish the exact
contribution of each competing boot service.

An initial attempt safely refused admission because the unprivileged process
could not inspect Samsung's protected background-mode marker. The corrected
version leaves that check in the privileged watcher, which revokes admission on
failure. Source, power and foreground checks remain in the native launch context;
no security labels or readiness markers are changed.

Both successful boots produced all four genuine completion markers, reached the
normal web Hub, and exited native at its own timer with status 0. All experimental
boot entries and native staging were rolled back to the prior quiet-only Hub
configuration. Source and private recovery journals are retained. This establishes
an earlier native-window path, not a permanent Home replacement or full-featured
native Hub. Physical first-frame timing and complete remote/app lifecycle behavior
still need validation before promoting it to a default launcher.

## Native-only boot: web Hub autolaunch suppressed

At the owner's request, the latest QN90A experiment retains native-only startup.
The web Hub package is installed but the custom direct boot launch and root relay
fallback are suppressed with reversible, owned boot claims. Source remains the
same ISP/background configuration. Autonomous root remains enabled. Native stays
open; Back or the Web Hub tile explicitly opens the installed web interface.
Existing Home routing is unchanged. This prototype does not include the web Hub's
saver, telemetry startup, or complete app lifecycle integration.

Native-only first render was **14.455 s**, then **13.834 s** after consolidating
setup file operations. This is a modest observation, not a demonstrated repeatable
speedup. Prior native+web trials were 14.341/14.751 s. Removing web contention did
not materially move the native first frame in this sample. Main still starts near
12 seconds; library loading took 0.37/0.48 s. Further gains require earlier safe
scheduling or less graphics initialization, not assumed cache benefits.

Both native-only boots produced all four genuine completion markers and restored
root access. Process/window checks found no web Hub. The compositor screenshot
shows the native tiles; cold logs record Left/Right input. Warm Back-to-Hub passed.
Panel/audio observations remain separate from those checks. Exact private recovery
instructions restore hook versions newest-first, then remove native staging. No
S90D changes, package removal or Samsung security-label changes were made.

## Further optimization tests: no demonstrated gain

Three follow-up changes were tested against the retained native-only setup:

| Configuration | Render callback since boot |
| --- | ---: |
| Inline preparation, EGL | 14.058 s |
| Inline preparation, software Wayland | 14.807 / 14.181 s |
| Software Wayland, native process nice −5 | 13.780 s |

Inline preparation moved main entry as early as 8.826 seconds, but later checks
and graphics work grew under boot contention. Software Wayland worked in a warm
trial (0.153 s main-to-render), produced the expected screenshot, and handled
Left/Right. Cold results did not beat the prior configuration consistently.
The priority trial's 0.054-second lead over the earlier 13.834-second sample is
within the observed variation and is not treated as a performance improvement.

All follow-up hooks and the software-renderer binary were rolled back. The
retained native-only EGL configuration keeps web Hub autolaunch suppressed.
The source now allows only `wayland_egl` or `wayland_shm` through
`ECORE_EVAS_ENGINE` (default EGL) and records window creation separately for
future experiments. Software-renderer support is experimental, not a new default.

The next investigation is reducing per-query client/process overhead while
preserving equivalent source, power and foreground checks. No admission check,
Samsung service priority, firmware security label or source setting was weakened.

The restored native-only configuration was reboot-tested again: render callback
**13.899 s**, expected hook hash restored, native active at normal nice 0, all four
completion markers present, software trial binary removed, and web Hub absent.

## In-process admission experiment

`--native-guard` retains admission after EFL library loading and before canvas
initialization. It reads the same source, ISP app and foreground keys through
`libvconf`, and calls the same system D-Bus display `GetState` method through
`libsystemd`, retaining the two-second method timeout and exact `lcdon` result.
A missing library, symbol, value or failed call denies admission; a missing
foreground value is never treated as an empty foreground.

The compositor marker and actual Wayland socket, revocation marker and boot
uptime deadline remain required, with fresh checks after settings reads. An alarm
bounds admission IPC. The privileged watcher retains the protected background-mode
check and the reversible claims suppressing web Hub autolaunch. No library cache,
service priority or source selection is changed. `--settings-check` performs only
the settings reads and exits without opening a window.

The host denial test checks each missing/unexpected setting, Live TV source,
non-on power and occupied foreground:

```sh
cc -O2 -Wall -Wextra -Wno-unused-function -Wno-misleading-indentation \
  research/native-hub/guard_test.c -o /absolute/private/guard-test
/absolute/private/guard-test
```

On the QN90A, a read-only run under the same native service identity matched the
existing command-line settings and power results. A warm boot-admission attempt
past the deadline exited with status 8 before window creation.

Two cold boots rendered at **14.562 / 14.167 seconds**. Admission itself took
**0.036 / 0.112 seconds**, versus 1.222 / 2.326 seconds in earlier shell-guard
boots. Overall startup did not beat the previous 13.899-second recovery baseline:
process entry and subsequent graphics work varied between boots. This establishes
lower query overhead, not a repeatable end-to-end speedup or a sub-14-second result.

The in-process variant is retained on the experimental QN90A, with the prior
native-only hook and binary available for exact rollback. Both cold boots restored
root access and all four genuine completion markers. Source/ISP/background routing
remained unchanged; native was visible in compositor state and web Hub was absent,
including after the watcher completed. No new physical panel/audio observation was
collected. S90D was untouched.

## Inline dispatch and optional-service follow-up

Combining direct submission from the existing early boot hook with in-process
admission moved native main to 8.223 / 9.636 seconds. Render callbacks were
**13.102 / 14.360 seconds**: one sub-14 result, not a consistent guarantee. The
native-only inline path is retained; failure cleanup revokes its admission marker
before handing control back to the original repair wrapper.

A native-only nice −5 experiment rendered at 14.751 seconds and was rolled back.
Normal-priority recovery rendered at 14.205 seconds. No priority change remains.

The subsequent optional-service trial rendered at 14.190 seconds. Preview,
audio-share and USB-media launch services were verified masked/inactive. Selected
voice boot/restart flags were disabled and launch units masked, but voice
processes still appeared, so complete voice suppression is **not** established.
Casting and its SmartThings-client dependency remain intact; no casting deferral
has been installed. All four genuine completion markers, native window, root
recovery, ISP/background routing and absent web Hub were verified. No fresh
physical panel/audio observation was collected. Exact rollback is retained.

At that earlier checkpoint, further device work was blocked by the old root agent's full command
journal; all 1,000 entries were archived off-device. The service-exclusion setup
journal then remained configuration-applied pending maintenance. The subsequent
agent upgrade and optional-service follow-up are recorded in the private operations
journals; they are not changed by this parity trial.

## Home routing and cold-boot validation (2026-10-12)

`COUCHROOT_NATIVE_HOME=1` enables an overridable exclusive `XF86Home` grab just
*after* the first rendered frame. The native process runs as the TV owner, not
root. Each short Home release requests a fresh, bounded settings check: ISP
source, expected Hub source ID, LCD on and a healthy display. Unlike strict boot
admission, this explicit user action permits an occupied app foreground. It does
not change the source. Late or failed replies cannot activate the window.

The platform worker releases the grab if it fails and re-registers it after a
fresh valid recovery snapshot. Process exit also releases the grab. A QN90A
worker termination test verified that Home then used the existing web fallback,
and native Home returned after worker recovery without restarting the UI.
Samsung routing database entries and boot guards were not changed.

Software-injected Home returned from YouTube and Plex to the same native process
in 272 ms and 285 ms respectively in the warm trial. The final build's first cold
frame was 14.359 seconds after boot, and Home registration was ready at 14.364
seconds. App discovery followed at 15.554 seconds (26 apps), outside the first
frame path. Earlier discovery-only cold frames were 14.446 and 14.051 seconds.
A second cold boot after automatic config migration rendered at 15.006 seconds,
registered Home at 15.010 seconds, and displayed all six imported shortcuts in
order with the saved selection. Software-injected Home returned from YouTube to
the same native process in 379 ms on that boot. The compositor capture confirmed
the imported grid; the web Hub process was absent.

These are software measurements, not physical panel/audio observations. Physical
remote Home, app-audio handoff, long-press support and standby/resume require
separate observation. Held Home presses are ignored by the native handler; this
does not establish that Samsung's long-press action receives them under the grab.

## Boot critical path: SCHED_IDLE and hook ordering (2026-10-12)

A fresh profile of the installed launcher found that native startup was not limited by
EGL, fonts or disk I/O. tv-viewer maps the same EFL/EGL/Mali stack at about 1.3 seconds,
so those libraries were probably already cached; that is inferred from shared mappings,
not measured, and the profile still recorded some D-state samples and major faults. From
exec to first frame the main thread
used about 0.35 s of CPU but took 2.7-5.8 s: it was runnable and waiting for a CPU while all
four cores were busy.

The cause is a boot-phase scheduling default on this firmware. From about 7.3 seconds,
services that systemd starts, including our transient native unit and its children, run as
`SCHED_IDLE` (policy 5). Any wakeup of a normal task preempts such a task. Later in boot
they return to `SCHED_OTHER`. Samsung's own boot-relevant units opt out with
`CPUSchedulingPolicy=other` (for example sensord, mbr-daemon, adagent, pisa and bluetooth).
This also explains why earlier `nice -5` trials, and an autogroup `-5` trial this session,
did not help: neither changes an idle-class policy.

Static analysis of the firmware's systemd matches the runtime observation. `exec_child`
sets `SCHED_IDLE` before `execve` while a vendor boot-idle flag is active and `starter.target`
is loaded. An explicit `CPUSchedulingPolicy` skips that branch; the decompiled code has other
exemptions too. The decompiled boot helper sleeps 50 seconds after app readiness before
restoring the demoted processes; that timing is static, not observed at runtime.
Runtime evidence came from a per-thread `/proc` sampler during boot (policy column) and the
opt-in profiler below. The vendor flag is deliberately left enabled for every other service. The policy itself is printed at every profiled milestone (`policy=0`).

The retained QN90A boot hook makes two changes, each tested separately:

1. The native unit is started with `CPUSchedulingPolicy=other`. This follows the vendor
   convention: it gives normal nice-0 scheduling and is not real-time or elevated.
2. The unchanged dispatch block (claims, background/user-session wait, binary hash check,
   `systemd-run`, revocation monitor) moves from the innermost layer to the start of the
   outermost hook layer. Casting deferral, optional-service masks, the vendor script with
   completion repair, and the voice gate still run afterwards in the same order.

| Configuration (one cold boot each unless noted) | Native main | First render | Main to render |
| --- | ---: | ---: | ---: |
| Previous installed build (handoff boots) | 9.19 / 9.22 s | 14.359 / 15.006 s | 5.2 / 5.8 s |
| Same build with opt-in profiler | 10.00 s | 12.674 s | 2.68 s |
| Autogroup nice -5 (rejected) | 10.48 s | 15.203 s | 4.73 s |
| `CPUSchedulingPolicy=other` (two boots) | 9.38 / 9.06 s | 11.001 / 10.705 s | 1.63 / 1.65 s |
| Policy and early dispatch, with profiler | 7.21 s | 8.584 s | 1.37 s |
| Policy and early dispatch (three boots, pre-card binary) | 7.74 / 9.18 / 8.98 s | 8.830 / 10.009 / 10.053 s | 1.09 / 0.83 / 1.07 s |
| **Same hook with the card-style binary (two boots)** | 7.95 / 8.46 s | **9.023 / 10.039 s** | 1.07 / 1.58 s |

The remaining variation comes before `main`. The vendor hook starts between 5.8 and 7.0 s.
A systemd ordering stall around 4.7 to 6.8 s, cause unproven, gates the whole starter
batch. The dispatch `systemd-run` call itself can take 0.2 to 1.5 s while PID 1 starts
that batch. The table is the hook/card cohort; the later re-arm and visual runs (one visual
sample rendered at 9.263 s) are recorded separately. All five boots of this hook kept ISP/background routing and suppressed web Hub
autolaunch. Native was the only visible app window, Home routing returned from YouTube
in software, and the genuine completion markers, casting gate and voice gate all ran.
These are software render callbacks, not panel measurements. Physical first-photon time
and audio silence still need observation.

### Opt-in profiler

`COUCHROOT_NATIVE_PROFILE=1` (off by default, `hub-profile.h`) adds per-milestone
`prof`/`samp`/`sys` lines covering:

- thread CPU, faults and context switches;
- a 4 ms sample of the main thread's state and syscall;
- system-wide busy/iowait, runnable count and eMMC utilisation.

It also adds sub-phase stamps (`window-configured`, `scene-built`, `keys-grabbed`,
`first-pre-render`). It reads this process's `/proc` entries plus system-wide `/proc/stat`
and `/proc/diskstats`, and stops at the first frame. Unless the variable is exactly `1`,
no thread is started and no profiler descriptor is opened. This firmware does not expose `schedstat` or `wchan`. Estimate run-queue wait as
sampled `R` time minus thread CPU.

## Card styles

Card artwork is generated from validated per-app specs in `cards/*.json` by
`cards/cards.py`. It emits `hub-cards.h`, matched by exact app ID, with a designed fallback
for unknown apps. Every card shares one anatomy: a deep brand-tinted rounded base (corner
radius proportional to width), two or three translucent glow layers rising from the bottom
edge in the brand accent, and a centred Bold wordmark on one type scale with an optional accent
tail (for example Plex's `x`) or a small play triangle. A card is at most six objects. On focus
the ring adds a soft halo and repeats the outer glow layer in the accent, so the tile's light
brightens without rebuilding the card. The validator composites the glow over the base and
enforces 4.5:1 wordmark and tail contrast (3:1 for the glyph) at rest and focused, the object
budget, and that every polygon point stays inside the rounded card at every card size. Designs
evoke each brand with colour and typography; they do not reproduce logos.

```sh
python3 native-hub/cards/cards.py validate native-hub/cards/*.json
python3 native-hub/cards/cards.py preview /private/preview-dir native-hub/cards/*.json
python3 native-hub/cards/cards.py header native-hub/hub-cards.h native-hub/cards/*.json
```

## Saved-source re-arm: no Live TV after watching TV (2026-10-12)

The quiet boot depends on a firmware setting. It works only while
`db/boot/last_service` is `isp-service`, which tells the TV to start in background mode
with the Hub in the ISP slot. Opening Live TV or TV Plus changes the value to `vc-service`
immediately. The next power-on then starts in normal mode with Live TV, as happened on the
morning of 2026-10-12. The boot watcher correctly refused native, and the web Hub only
appeared later as Samsung Home. Power-off does not rewrite the value. A systemd stop action
at shutdown never ran, because Samsung's power manager reboots without stopping units.

Native now re-arms the setting while the TV is on. The key's write privilege is
public-level (`http://tizen.org/privilege/internal/default/public`), so the platform
worker can do it with `vconf_set_str` as the owner, with a readback and no root or
security changes.

- **About every 15 s while native runs:** if Hub owns `db/was/isp_app_id` and the saved
  source differs, rewrite `isp-service` and read it back. The interval starts after each
  worker reply, so worker restarts and queued Home requests can lengthen it. It runs
  regardless of the foreground app. In the QN90A test with Live TV playing, the saved
  source changed while the foreground app, live-source values and compositor windows
  stayed the same; picture and audio were not measured. Only changes and failures are logged.
- **Home while Live TV is in front, or the source is not ISP:** native asks `app_launcher`
  to open the web Hub, Samsung's own route away from the viewer. It then waits for a re-arm
  reply that no longer names the viewer and finishes the Home press by raising native.
  Only one attempt runs at a time: further Home presses are ignored, the launcher is killed
  if it has not reported within 10 s, and the whole attempt ends 20 s after it started
  (checked on the 0.1 s UI tick, so these are nominal bounds). Native is raised only if the
  final check finds the web Hub or nothing in front; another app, the viewer, a lost worker
  or a late reply cancels the attempt. Killing a late launcher cannot retract a request it
  already handed to the platform. A foreground change does not prove playback or audio
  stopped. Before this, native denied Home whenever the source was wrong, and the grabbed
  key did nothing.
- **Boots that start in normal mode:** the outermost hook layer starts a bounded owner unit,
  `native-hub --source-rearm-wait`. It makes up to 60 attempts about 15 s apart (nominally
  15 minutes; each attempt can take longer, so the trial unit also sets a runtime cap) and
  stops after the first readable result. It does not keep watching for a later Live TV
  switch in that boot.

Diagnostics: `--source-rearm-probe` rewrites the value only when it is already correct,
proving write access. `COUCHROOT_NATIVE_SOURCE_REARM=1` enables the periodic re-arm.

QN90A verification, software evidence only:
- Live TV flip, then re-arm with the viewer still in front.
- Home from Live TV reached native through the web Hub in about 2.5–5 s in the recorded
  successful examples (4.8 s in one saved run). This is not a maximum. These runs used the
  earlier detached launcher; the tracked, cancellable fallback above is mock-tested only.
- After a normal-mode boot, Home triggers a re-arm and the next boot is quiet.
- End to end: Live TV flip, re-arm, then reboot directly from Live TV. The boot was quiet,
  with native first render at 9.164 s.

Residual risks:
- Powering off before the next successful re-arm (nominally within about 15 s of
  switching to Live TV, longer if the worker is delayed or restarting) can still start one
  boot on Live TV. The next Home press then repairs it. Re-arming lowers the chance of a
  Live TV boot; it does not guarantee a quiet one.
- A real remote power-off was assumed to follow the same deviced path as the tested reboots.
- Physical picture and audio were not observed.
- Deferred: the ISP-owner and source reads and the write are separate calls, not an atomic
  compare-and-set; `--source-rearm-probe` checks the setter result but not a readback; and
  `CPUSchedulingPolicy=other` removes the vendor's boot deprioritisation for native and its
  children, which the saved boots do not show to be harmless for every other service.
