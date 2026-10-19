# Edit apps — Minimal Hub 0.3.8

> **2026-10-12 recovery correction:** direct `tools/s90d/restore.py` commands
> below are historical Home-settings procedures with placeholder addressing, not
> current composite-helper/cache recovery. Use the original shared setup journal
> for setup rollback and [boot checkpoints](s90d-boot-recovery.md) for a future
> S90D boot trial. No current live state or physical boot timing was verified.

This update keeps the existing signed package ID, Home-button assignment and
startup settings. The launcher remains offline. Editing favorites needs only the
TV remote; there is no companion server, resident root service, telemetry, or
automatic process cleanup.

## Native launch spinner suppression — 0.3.8

The signed hub now requests Samsung’s verified no-loading launch hint through
app control. Samsung Home keeps its ordinary launch path. See the
[device evidence, limitations and exact rollback](../research/launch-spinner.md).
36 focused automated checks pass. The owner confirmed with the physical remote
that the Samsung spinner is gone. Existing preferences and the mellow tone are
unchanged.

## Quiet Home and launch feedback — 0.3.7

- **Bottom menu:** Auto-dim (default) fades only the footer controls to 18% after
  eight idle seconds. The first key restores full opacity immediately and still
  performs its normal action. Focused footer controls, an empty Home and visible
  status/error messages keep the menu bright. Always visible disables dimming.
  Stored as `minimal-hub.fade.v1` (`on`/`off`).
- **Clock:** Off (default), 12-hour or 24-hour under Settings. The small Home clock
  uses the TV's local time, updates once per minute, and refreshes after wake.
  It reserves space above the cards. Hidden apps stop the timer. Stored as
  `minimal-hub.clock.v1` (`off`/`12h`/`24h`). Reset shortcuts preserves these settings.
- **Sound:** Softer locally synthesized sine tones replace the native sound on
  this TV: navigation 320 Hz/75 ms, selection 420 Hz/100 ms, Back 260 Hz/75 ms.
  Each has a 12 ms attack and gentle decay at low gain. Web Audio creation and
  scheduling remain deferred after the visual update; no audio file, network,
  TV-volume change or added privilege. Native sounds remain a compatibility
  fallback only when Web Audio is absent. Runtime audio errors fail silently.
- **Launch:** The selected tile expands up to 12%, and adjacent tiles slide aside
  and dim over 140 ms. Transforms avoid changing the grid layout. The launch API
  is called immediately; it does not wait for the animation. Motion clears on
  failure, backgrounding, Home render or after 1.2 seconds. Reduced-motion mode
  skips it. At 0.3.7, Samsung's separate launch spinner was not overridden;
  0.3.8 adds the verified launch hint described above.

31 focused automated tests passed. On the signed 0.3.7 TV runtime, CDP key tests
verified the 18% idle opacity, immediate first-key navigation, clock/menu
preferences through reload, and restoration of defaults. The Web Audio probe
recorded a running 44.1 kHz context, a scheduled 320 Hz sine tone, and its ended
event. This verifies execution separately from listening. The owner then confirmed
the new sound through the TV: “Good—keep it.” Plex launched with the expansion/neighbor transforms already set,
and the native foreground ID confirmed Plex. The user-added Crunchyroll shortcut
was retained alongside Plex/YouTube. This release did not repeat the earlier
physical reboot/standby tests; the same local storage mechanism remains in use.

Signed package: `signing/builds/hub-9gblx6ur/MinimalHub.wgt`, 31,039 bytes,
SHA-256 `4d117ac63cad92d3f41b269ebc674f2df8fa6ead12858688ff82fec50fb2230d`.
The final normal launch reported `debug 0`; all nine installed files matched the
workspace and signed artifact, the diagnostic port was closed, and Home/autostart
settings were unchanged. Private evidence: `signing/quiet-tv-results.json`,
`signing/quiet-launch-tv-results.json`, `quiet-tv-*.png`, and SDK sessions
`20260920T034704.223215Z-run` / `20260920T034834.757229Z-run`.

The exact signed 0.3.6 artifact remains preserved. Before deployment a separate
rollback was signed from its source, changing only the version to **0.3.97**:

```sh
~/.local/share/samsung-tv-research/signing/quiet-home-rollback/rollback.sh
```

This rollback has not been installed. It preserves shortcut data and ignores the
new clock/menu keys; subsequent releases must exceed 0.3.97 after using it.
For the blue Samsung spinner investigation, see [the verified native launch findings](../research/launch-spinner.md).

## Page design update — 0.3.6

Settings and Edit apps now share an opaque charcoal/gold page treatment,
consistent spacing, immediate focus rings and bottom-anchored controls. The
editor pairs numbered rows with large branded artwork that follows selection.
The installed-app picker marks items already on Home; move mode retains its
artwork and numbered rows while reordering. Settings replaces the long help
column with sound, layout and reset previews that update with focus and value.
The underlying arrow/OK/Back controls, discovery, storage and Home routing are
unchanged. These graphics are local CSS/DOM, without animations or downloads.

27 automated tests pass, including preview updates and retaining row contents
while moving. On-TV CDP key checks covered the 29-app picker, selected artwork,
move/cancel, compact/comfortable preview changes, reset cancellation and repeated
Back. TV screenshots were inspected for the editor, picker, options, move and
settings views. The saved shortcuts/sound/layout matched before and after.
Physical remote feel of these new pages has not yet been confirmed by the owner.

Signed package: `signing/builds/hub-d_83m5yx/MinimalHub.wgt`, 28,483 bytes,
SHA-256 `52ede692fe6f04071284d0ed518b3d7cabd1b9e2816c0a19b9fd1c752bd2fa75`.
The final identical-package install is launched normally, without the debugger.
Private evidence: `signing/polish-tv-results.json` and `polish-tv-*.png`.

Before deployment, the exact working 0.3.5 signed package was retained and a
forward-version **0.3.98** rollback was signed from its nine source files (only
version changed). To undo just this page redesign, preserving saved preferences:

```sh
~/.local/share/samsung-tv-research/signing/pages-polish-rollback/rollback.sh
```

This rollback is prepared but has not been installed. Releases after using it
must exceed 0.3.98. The original pre-feature 0.3.99 rollback below remains available.

## Remote controls

- On Home, arrows move through the app grid and the footer. OK opens an app.
  Large lists scroll with focus. Edit apps, Samsung Home and the Settings gear remain in the footer.
- Edit apps → Add apps lists installed app entries. OK adds a shortcut; a check
  means it is already on Home. Back returns to Edit apps.
- Select an existing shortcut to choose Move shortcut or Remove shortcut.
  Removing changes only the saved list; it never uninstalls the app.
- While moving, Up/Left moves earlier, Down/Right later. OK saves the order;
  Back cancels the move. Add/remove changes save immediately.
- Back from Edit apps returns Home. Back on Home stays in the hub, including double presses.
  Only the explicit Samsung Home button launches Samsung Home.
  The physical Home key retains its existing system routing to Minimal Hub.

Plex and YouTube are the first-run defaults. An intentionally empty Home stays
empty and offers Edit apps and Samsung Home. Settings → Reset shortcuts asks
for confirmation before restoring Plex/YouTube; it does not reset or uninstall
any TV apps. Empty lists are never implicitly repopulated.

## Discovery and boundaries

On this QN55S90DAFXZA, firmware 2130.0 / Tizen 9, the already installed signed
0.2.2 app successfully called `tizen.application.getAppsInfo`, `getAppInfo`, and
`findAppControl` through its own web runtime. Its manifest requested only
`http://tizen.org/privilege/application.launch`. The new manifest has exactly the
same privilege. No certificate upgrade, privilege grant or registry bypass was
needed. `getAppMetaData` also returned results in the diagnostic, but production
discovery does not use it or request its documented privilege.

The probe returned 573 registry entries, 262 with `show=true`. Many of these
“visible” entries are Samsung diagnostics, setup screens and internal helpers.
`findAppControl(operation/default)` returned only Spotify, so it is unsuitable
as an installed-app picker.

The picker therefore filters the live `getAppsInfo` result to visible entries in
Samsung-style ten-character alphanumeric app packages, plus these native
consumer IDs: Netflix (`org.tizen.netflix-app`), Prime Video
(`org.tizen.primevideo`), Internet (`org.tizen.browser`) and TV Plus
(`com.samsung.tv.tvplus`, only if marked visible). It excludes the hub, Samsung
Home, hidden services, duplicate IDs and the dummy Prime Video entry. This TV
currently yields 29 choices. New store apps with this package convention are
discovered without rebuilding or reinstalling the hub.

This is a conservative, firmware-specific consumer-app filter, **not** a promise
that every launchable system component or custom sideloaded package appears.
Nonstandard package IDs can be excluded. Samsung Home remains the route to other
apps and inputs. Discovery reports installed entries; actual launch can still
fail or require an account. It does not launch every app in the background to
“validate” it. Netflix, Plex and YouTube were actually launched in validation.

If discovery is missing, denied or times out, the editor reports the failure and
offers Refresh list. Saved shortcuts can still launch, move and be removed;
Samsung Home remains accessible. There is no fabricated picker or baked-in
snapshot masquerading as live discovery. A privileged app-list exporter was
unnecessary on this TV and was not implemented.

Only local icon paths are accepted. Remote URLs are rejected and CSP prohibits
network connections. Missing/inaccessible icons leave a readable text logo and generated artwork;
Plex/YouTube retain their bundled artwork. All currently discovered apps have
local brand treatments; the large Home cards contain only logos/artwork, with no
callouts, repeated names, descriptions, or decorative launch arrows. The grid
is centered above a bottom-anchored menu and wraps to multiple scrollable rows. Successful discovery marks saved
entries absent from the picker as unavailable but never silently deletes them.
Launch errors/timeouts show recovery options without trapping focus.

## Fast feedback and sound

Focus rings change immediately: the former 180 ms transform/shadow animation is
removed. Normal navigation does not scroll unless its list actually overflows.
Move mode repositions the focused DOM node instead of recreating the list on
every arrow. OK briefly changes logo opacity to acknowledge the press. Async
app discovery updates labels in place and cannot reset toolbar focus.

A small on-TV 0.3.4 sample measured the app's key handlers at approximately 1.5–4 ms;
this excludes the IR receiver, Samsung input dispatch, panel scanout and perceived
latency. No claim is made that the app can remove IR or firmware delay.

Before the 0.3.7 softer-tone update, the signed app successfully called
`tizen.tvaudiocontrol.playSound` with its
existing launch-only manifest. One measured MOVE call returned in approximately
1.1 ms. Those native MOVE/SELECT/BACK sounds were scheduled after the visual update,
coalesced and rate-limited for held keys. No volume or mute setting is changed.
Settings (gear) → Navigation sound saves `minimal-hub.sound.v1` locally. API errors leave
navigation working silently. Actual audibility and loudness depend on the TV's sound settings/output. the owner
confirmed the earlier native sound with the physical remote: “Feels better; sound is good.”

## Settings

The footer gear opens a two-column screen with large focusable rows and a visual preview of the selected setting.
Remote controls stay at the bottom. Up/Down selects a row; OK toggles Navigation sound or Tile layout.
Comfortable uses up to three columns; Compact uses up to four. Both retain large
Plex/YouTube tiles when only two shortcuts are present. The layout preference is
stored in `minimal-hub.layout.v1` (`comfortable`/`compact`). Preferences save
immediately and failed writes preserve the previous setting.

Reset shortcuts opens a confirmation with **Keep my shortcuts** focused first.
Back cancels; Reset to defaults restores Plex and YouTube while preserving sound
and layout. Back from Settings returns to the footer gear. Repeated Back on Home
is consumed on both key press and release; there is no exit dialog. This does not
remap Samsung's system Power/Home keys or claim control over firmware-level
long-hold force-exit gestures.

## Local configuration

`localStorage['minimal-hub.shortcuts.v1']` contains:

```json
{"version":1,"apps":[{"id":"kIciSQlYEM.plex","name":"Plex"},{"id":"9Ur5IzDKqV.TizenYouTube","name":"YouTube"}]}
```

Only IDs, names and order are stored; icons are rediscovered locally. Each edit
writes one complete versioned record before replacing in-memory state. Failed
writes leave the prior list intact and show an error. Invalid/unreadable data
shows the defaults and a warning; it is not overwritten until an explicit edit.
IDs are validated, duplicates removed, names bounded, and lists limited to 256.
Visibility/wake reloads the saved configuration and refreshes discovery. A move
not confirmed with OK is discarded when the app is hidden.

App-data deletion, uninstalling the launcher, and factory reset can erase the
configuration. An in-place signed update preserves the app identity and storage.

## Build and checks

```sh
npm ci
npx playwright install chromium
npm test
python3 scripts/package.py
python3 scripts/sign.py
```

`npm test` includes Node model/bridge tests and headless Chromium interaction
tests. Browser mocks are explicitly separate from on-TV verification. The Python
packagers include `model.js` `presentation.js` and `feedback.js`; signing occurs in a private staged directory.

## Deployment and rollback

The preserved pre-edit source and exact signed 0.2.2 package are private at:

```
~/.local/share/samsung-tv-research/signing/edit-apps-rollback/original-web/
~/.local/share/samsung-tv-research/signing/edit-apps-rollback/original-0.2.2.wgt
```

The original signed artifact has SHA-256
`9c23d2cf5e2a7685b0844a29fd57be363821030d8e97708cf7c993142167778a`.
Before deploying, its six installed source files were hash-checked against the
repository, and original localStorage was recorded as empty.

A separately signed rollback contains that exact UI with only the widget version
raised to **0.3.99**, allowing a forward update. To restore it while retaining
Home/startup routing:

```sh
~/.local/share/samsung-tv-research/signing/edit-apps-rollback/rollback.sh
```

The script installs `edit-apps-rollback/MinimalHub.wgt`, then runs
`MiniHub001.Hub` through the existing Tizen CLI. It leaves the new favorites key
in app data, where the old UI ignores it. The rollback was signed and prepared
before deployment; this specific rollback package has not been installed.
After using it, a later feature release must use a version above 0.3.99.

To undo Home/startup integration itself, use the previously verified, separate
rollback from the repository root:

```sh
python3 tools/s90d/restore.py
```

Restore integration before uninstalling the launcher. Do not uninstall as a UI
rollback: it can erase local configuration. Signing credentials, signed packages,
private device evidence and generated signatures stay outside Git.

## Validation record

Previously verified version **0.3.5** is private at
`signing/builds/hub-ucchna3w/MinimalHub.wgt` (26,510 bytes), SHA-256
`d85ac0909acd32ae5a3fe7630bec77c1e575ac1375034d2f08946de48f6e5f36`.
All nine source files are verified against the signed package and installed copy. The package retains only the launch privilege.

On 2026-09-19 CDT / 2026-09-20 UTC:

| Check | Evidence/result |
| --- | --- |
| Automated local tests | 26 passed: storage/schema, empty list, ordering/cancel, navigation, scrolling, discovery/launch/storage failures, broken icons, focus traps, late discovery focus, sound persistence/coalescing/failure, settings/reset, four-column navigation and repeated Back |
| Signed-app API probe | 0.2.2 runtime; live list 573 entries, filtered picker 29; no extra privilege |
| Add and reorder on TV | Added Netflix with arrow/OK input; moved it ahead of Plex/YouTube; read back actual localStorage and rendered order |
| Real app launch | Netflix foreground confirmed by native `memory/appfw/current_fullscreen_appid`; its HTTP app endpoint returned 404, so that endpoint was not treated as launch evidence |
| Native remote-key path | Netflix → Home → hub → Plex → hub → YouTube → hub → Samsung Home → hub passed; temporary `input_keyevent`, no input daemon |
| Hard-power persistence | Boot ID changed from `00000000-0000-4000-8000-000000000001` to `00000000-0000-4000-8000-000000000002`; hub autostarted; signed update to 0.3.1 read the saved Netflix/Plex/YouTube order |
| Remove without uninstall | Native arrow/OK/Back removed Netflix shortcut; `getAppInfo` still returned the installed Netflix app |
| Native reordering and runtime reload | Saved YouTube/Plex, reloaded the app document, read back the same order; restored Plex/YouTube through the editor |
| Standby/wake | 0.3.2: API reported standby at 6/9 seconds and on from 12 seconds; boot ID unchanged; hub foreground and saved YouTube/Plex order survived |
| Final visual changes | TV screenshots inspected at 1920×1080; logo-only cards, fixed bottom menu, no hero/header/callouts/descriptions/launch arrows |
| Sound and latency | Signed runtime accepted system beeps; On/Off persisted on TV; focus transitions `0s`, no transform; small key-handler samples roughly 0.9–4.4 ms, excluding IR and display latency |
| Physical feedback | the owner confirmed: “Feels better; sound is good.” |
| Settings on TV | 0.3.5 CDP keys opened the gear, toggled sound/layout, canceled reset, reloaded, and read the persisted Off/Compact values; restored On/Comfortable and preserved the shortcut record |
| Double Back | Native `XF86Back` pairs immediately and 150 ms apart kept the same hub PID and foreground; leaving Settings with two Back presses also kept the process |
| Final normal run | Identical signed 0.3.5 reinstalled and launched with debug 0; native double Back, Samsung Home → Home key → hub passed; exact shortcut/sound/layout record preserved |
| Controlled reboot | Boot ID changed to `00000000-0000-4000-8000-000000000003`; 0.3.4 cold-started as Home; 0.3.5 subsequently read the same Plex/YouTube and sound record |


Private evidence includes `signing/edit-apps-probe.json`,
`signing/edit-apps-tv-edit.json`, `signing/edit-apps-native-edit-readback.json`,
`signing/edit-apps-runtime-reload.json`,
`signing/edit-apps-post-standby-readback.json`,
`signing/edit-apps-responsiveness.json`, `signing/settings-tv-results.json`,
`signing/settings-tv.png`, and the signed builds.
Native logs are in `dumps/20260920T024443Z/`, `dumps/20260920T025608Z/`,
`dumps/20260920T025850Z/`, `dumps/20260920T030010Z/` and
`dumps/20260920T030833Z/` and `dumps/20260920T031858Z/`.
The first settings native sequence passed double Back and Samsung Home launch,
but its fixed three-second Home-return assertion saw Samsung AI Companion and
exited 1. That complete sequence is not counted as a pass. The final non-debug sequence
with bounded foreground polling passed every step in
`dumps/20260920T032103Z/` (both operations exit 0). The app stayed in the same
process after double Back; Samsung Home and return routing both passed. Its
Local Storage archive exactly matches the pre-install shortcut/sound/layout
records. The collector removed its staged tooling and verified original system
configuration hashes and SDK identity afterward.

Physical panel/audio confirmation and native key-event checks are distinct from
headless Chromium mocks and CDP-generated key events. Playback, signed-in
entitlements and every picker app were not tested. No app was uninstalled to
simulate missing-app handling; that failure is covered by automated mocks.

### Developer connection recovery

Two exploratory debug-session transitions stalled the SDK connection. The first
included the legacy SDB debug path and an app-launcher help/stop/reopen attempt;
the second attempted to stop and reopen a running debug hub. These failures are
not evidence that ordinary app reload or the root chain broke. The owner performed
hard restarts; resetting the Mac SDB server was also needed to clear stale client
state. Subsequent bounded root checks/collectors ran and cleaned up successfully.
Runtime `location.reload()` preserved storage and did not stall the connection.

The final workflow used a normal signed in-place update followed by one debug
start, avoiding stop/reopen of an already running hub. The exact cause of the
exploratory stalls was not isolated. Do not repeat those debug-restart commands
as a routine reload strategy. After 0.3.5 testing, the identical signed package was installed in place and
started with the normal CLI (`debug 0`). The diagnostic port was absent; the
inspector is not a launcher dependency. No extra physical reboot was required.

## References

- [Samsung TVAudioControl API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvaudiocontrol-api.html): built-in UI beeps.
- [Samsung Application API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html): installed-app information, `show`, app-control queries and launch APIs.
