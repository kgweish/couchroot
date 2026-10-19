# Samsung launch spinner — native suppression in 0.3.8

> **2026-10-12 recovery correction:** direct `tools/s90d/restore.py` commands
> below are historical Home-settings procedures with placeholder addressing, not
> current composite-helper/cache recovery. Use the original shared setup journal
> for setup rollback and [boot checkpoints](../guides/s90d-boot-recovery.md) for a future
> S90D boot trial. No current live state or physical boot timing was verified.

Minimal Hub requests a launch without Samsung's blue spinner by using
`launchAppControl` with SINGLE mode and one data entry:
`__NO_LOADING_LAUNCH` = `enable`. This is a firmware-specific internal hint,
verified on the owner's QN55S90DAFXZA, firmware 2130.0 / Tizen 9. It is not a
public Tizen compatibility guarantee. The hub still requires only the existing
`application.launch` privilege. No root helper, network connection, external
server, system-file replacement, overlay service or process killing is involved
in normal use.

## What actually draws the spinner

A live Crunchyroll launch captured the blue/green four-dot spinner, progress bar
and background dimming. The simultaneous window-manager trace identified
`Launchscreen Winsys`, created by Enlightenment's `e-mod-tizen-launchscreen`.
This establishes the component from an actual image and native window evidence,
not just a loading-related filename. Earlier investigation of Samsung Home's
`OnSelectLoadingView` / `C_Loading_01` was inconclusive and is superseded by this
trace.

Private inspection of the TV's `libamd-mod-splash-screen-tv.so` showed that
Samsung's application manager checks `__NO_LOADING_LAUNCH` for the exact string
`enable` before creating this screen. Its `__K_EX_SPLASH_SCREEN_FORCE_SHOW`
option can override that check; Minimal Hub never requests forced display.
The compositor also knows `LA_UI_NONE`, but that applies to an Edje setup path;
we use the earlier service check rather than guessing a drawing-layer override.
The installed resource set includes the loading animation and progress-bar JSON
assets. None were changed.

## Device evidence

The research used bounded, on-demand root collection of native window lists and
screenshots, and the existing signed hub's JavaScript inspector to exercise app
control. The inspection helper cleaned up its staging and private mounts; original
passwd and SDB verification-key hashes stayed unchanged. Root was used to observe
the screen, not to make the application-control call work.

| Test | Observed result |
| --- | --- |
| Ordinary Crunchyroll launch | Blue spinner captured; `Launchscreen Winsys` present; destination app foreground; Home returned to hub |
| Spotify with the hint | Signed app-control success; newly launched Spotify foreground; six captures/window samples contained no launch-screen window; Home returned to hub |
| Ordinary Pandora app-control launch, without hint | Blue spinner and progress bar captured; launch-screen window present; Pandora foreground; Home returned to hub |
| Installed 0.3.8 Tubi shortcut | Added through Edit apps, launched through final bridge with exact hint/SINGLE, six captures/window samples without launch-screen window; Tubi foreground and its own branded splash visible |
| Existing shortcuts and fallback | Plex, Crunchyroll and YouTube opened; YouTube uses native `com.samsung.tv.cobalt-yt`; Samsung Home and Home-key return passed; double Back stayed in hub |
| Failure and persistence | Real missing-app request returned NotFoundError; test shortcut removed; all saved keys exactly matched the initial state after runtime reload |
| Final deployment | Identical signed 0.3.8 installed in place and run with debug 0; all nine installed file hashes matched; diagnostic ports closed; Home assignment and auto_start=1 intact |

These are sampled native traces, not a frame-by-frame recording or a same-app
cold-boot benchmark. The code path and comparison establish a practical option
on this firmware; they do not establish behavior on other Samsung models or future
firmware. Raw Samsung binaries, decompilation, screenshots and logs remain private
under `~/.local/share/samsung-tv-research/`.

Private evidence directories (UTC):
- `dumps/20260920T035344Z`: compositor module and initial Plex trace.
- `dumps/20260920T035808Z`: launch service/resources and visible Crunchyroll spinner.
- `dumps/20260920T040022Z`: signed Spotify launch with the hint.
- `dumps/20260920T040112Z`: ordinary Pandora app-control comparison.
- `dumps/20260920T040445Z`: final installed bridge, Tubi shortcut launch/captures.
- `dumps/20260920T040756Z`: native navigation, Samsung Home and double Back.
- `dumps/20260920T040914Z`: YouTube foreground/screenshot and Home-key return.
- `sessions/20260920T041028.090743Z-run`: final installed hashes and configuration.

The first SDK-only attempt to inject Home lacked native input permission, so its
sequence was not counted as a pass. The bounded native collector supplied the
verified navigation sequence. YouTube was not foreground at the initial two-second
check; the separate check confirmed its Cobalt player and profile screen. No
profile was selected.

The owner confirmed with the physical remote: **“Samsung spinner is gone.”**
This update did not repeat a full reboot or standby/wake test; those passed for the existing
startup/storage integration before this launch-only change.

## Compatibility and failure handling

The hub uses quiet app control when both ApplicationControl and
ApplicationControlData are available. A missing interface uses the prior normal
launch path. Explicit NotSupportedError, InvalidValuesError, TypeMismatchError or
SecurityError rejection of the quiet request causes one ordinary launch attempt.
A missing app or unknown launch failure remains visible instead of triggering a
second launch. Repeated or stale callbacks cannot report success twice.

Samsung Home deliberately retains the original launch path. Startup assignment,
the Home key, saved app order, mellow tones and the short tile expansion are
unchanged. Applications can still display their own splash screens, spinners or
sign-in pages. Firmware may ignore the internal hint and show Samsung's spinner
again; there is no claim to remove all loading screens.

36 automated Node/Playwright checks passed, including the exact hint, SINGLE
mode, selected app ID, Samsung Home routing, compatibility fallback, missing-app
errors, navigation, storage, ordering, empty lists, sound and launch animation.
These automated checks are distinct from physical-remote/visual confirmation.

## Artifact and exact rollback

Version 0.3.8 signed artifact:
`~/.local/share/samsung-tv-research/signing/builds/hub-mxho5h6j/MinimalHub.wgt`
(31,486 bytes), SHA-256
`573a26cc299dad155e159be9ccb5b19957914eaa0d8f1821cb176d4353eb54d2`.

The unchanged working 0.3.7 artifact is preserved in
`signing/builds/hub-9gblx6ur/`. Before deploying 0.3.8, its source at commit
`6cf75e3` was copied and signed as forward version **0.3.96** so rollback does not
require an uninstall or a version downgrade:

```sh
~/.local/share/samsung-tv-research/signing/spinner-rollback/rollback.sh
```

Rollback artifact SHA-256:
`d150f516cc1b0e18f09ab9422258956a3357bdff07635d278862c5cd8dba3212`.
The script installs that package in place and starts the hub normally, preserving
local configuration and startup/Home assignment. Prepared and signed; not itself
installed as part of this test. Full integration rollback remains
`python3 tools/s90d/restore.py` as documented in owner operations.

## QN90A boot-only verification — 2026-10-11

The guarded QN90A early boot launcher now passes the same hint as a native launch
bundle key/value pair. The owner confirmed no spinner and no Live TV on the first
trial. Two further boots confirmed successful Hub startup in software; they are
not additional physical spinner observations. Diagnostics were removed from the
retained configuration and exact prior-hook rollback is preserved. This does not
establish all-app support or an overall boot speedup on QN90A. See the
[boot profiling results](../devices/qn90a/direct-boot.md#quiet-boot-launch-and-post-request-profiling--2026-10-11).
