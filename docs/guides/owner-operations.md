# Minimal TV Hub

For current UI updates, use [UI deployment](ui-deployment.md). Full installation
and recovery use [tv-setup](tv-setup.md). The signing and rollback records below
describe historical procedures and evidence. The direct SDB addresses below are
documentation placeholders, not current destinations. Historical `restore.py`,
`enable.py` and splash-only shell commands are not the current recovery interface.
Use the original setup journal for setup rollback; for a future S90D boot trial,
use [boot checkpoints and recovery](s90d-boot-recovery.md).

A local Tizen TV launcher for the owner’s QN55S90DAFXZA.
Remote-editable shortcuts start with Plex and YouTube. Samsung Home remains
available as a fallback. See [Edit apps](edit-apps.md) for controls, discovery
limitations, persistence evidence, and the exact pre-feature rollback. All assets are local; no server, root daemon, feed,
telemetry, external font, or network request is required by the hub.

**Status:** signed and installed on the TV. the owner confirmed the hub displays and
the remote's Plex tile opens Plex. Uninstall and reinstall of the same package
passed. Reboot startup, standby/wake, both app tiles, Home-key routing, and
Samsung Home fallback have passed automated on-TV checks. Details are tracked in
[integration findings](../devices/s90d/README.md).

## Visual design

Version 0.3.8 centers logo-only app cards horizontally and wraps larger lists into
rows, scrolling with focus. The bottom menu remains anchored at the screen edge.
The Home logo, clock, hero heading, slogans, section labels, tile callouts,
descriptions and decorative launch arrows have been removed. Plex/YouTube retain
their geometric artwork; the other discovered consumer apps have bundled brand
colors, typography and geometry. Unknown apps get a readable generated card.
No remote fonts or artwork are fetched. Edit apps uses explicit focus, a scrolling
picker and move/remove controls. Focus feedback is immediate, without animated
travel. The footer gear contains sound, comfortable/compact layout, confirmed
shortcut reset and remote help. Back always stays inside the hub; use the
Samsung Home button to leave.

The current gear also includes menu auto-dimming and an optional 12/24-hour
clock. Navigation uses soft local tones and selection briefly expands the tile.
Rollback of these 0.3.7 additions to 0.3.6 is prepared at
`~/.local/share/samsung-tv-research/signing/quiet-home-rollback/rollback.sh`.

For just the 0.3.6 page redesign, use the prepared rollback to the working 0.3.5
UI: `~/.local/share/samsung-tv-research/signing/pages-polish-rollback/rollback.sh`.
See the feature record for version and validation details.

The exact pre-feature 0.2.2 UI has a signed forward-version rollback prepared at
`~/.local/share/samsung-tv-research/signing/edit-apps-rollback/rollback.sh`.
Use that for this feature's UI rollback. The older original-UI rollback below is
historical and has version 0.2.3, below the new installed version.

The original six app files are preserved privately in
`~/.local/share/samsung-tv-research/signing/ui-before-0.2.0/`.
Restore the original UI with:

```sh
~/.local/share/samsung-tv-research/signing/rollback-ui-0.2.0.sh
```

This installs the original UI under version 0.2.3, avoiding a version downgrade,
and leaves Home/startup configuration intact. Its signed package was prepared
before the final update; this particular visual rollback has not been installed
on the TV. That historical Home-settings restore is not a composite-helper or
cache rollback.
Use the relevant current journal and the boot recovery guide linked above.

## Preview and checks

For local UI work, follow [UI development](ui-development.md). The browser
workbench uses simulated TV APIs and does not control a device.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Before preparing a release, run `npm test`, inspect `npm run screenshots`, and
build the unsigned WGT with `npm run package`. Signing and installation follow
below. This document's commands target the S90D; use the
[QN90A record](../devices/qn90a/README.md) for that TV's profile and device procedures.

The app IDs are from this TV's package registry, and each target was separately
launched through app_launcher during the previous investigation:

| Tile | Tizen application ID |
| --- | --- |
| Plex | `kIciSQlYEM.plex` |
| YouTube | `9Ur5IzDKqV.TizenYouTube` |
| Samsung Home | `com.samsung.tv.csfs` |

`bridge.js` requests the verified native no-loading hint through app control for
app shortcuts, with ordinary launch fallback if unsupported. Samsung Home uses
the original launch path. See [spinner verification and rollback](../research/launch-spinner.md).
It fails visibly when the runtime or permission is missing.
The manifest requests `application.launch` plus filesystem read/write for
monitoring preferences. The launch privilege and remote input worked for Plex. Other hardware checks are recorded in the integration notes.
The Home key is not intercepted by this app. Power and volume remain system keys.
The hub does not request a wake lock or disable the TV's screen saver.

## Signing and installation

The private toolkit now contains Tizen CLI, a `MinimalHub` signing profile,
and Samsung-issued author/distributor certificates for this TV. the owner completed
the Samsung account login himself. Keys, passwords, certificates, and signed
packages remain outside git under `~/.local/share/samsung-tv-research/`.
Signature enforcement remains enabled.

Run `python3 scripts/sign.py` to sign a private staged copy of the source. It prints the
new package path. Staging keeps generated signatures and certificate subjects
out of the source tree. The output filename is `MinimalHub.wgt`: a filename with
a space failed on this TV, while identical package bytes installed after renaming.

The current 0.3.8 artifact is in the private toolkit's `signing/builds/hub-mxho5h6j/` directory. The original 0.1.0 artifact remains in `signing/package/`:

```sh
cli="$HOME/.local/share/samsung-tv-research/tizen-sdk/cli/tools/ide/bin/tizen"
"$cli" install -s 192.0.2.12:26101 -n MinimalHub.wgt -- \
  "$HOME/.local/share/samsung-tv-research/signing/builds/hub-mxho5h6j"
"$cli" run -s 192.0.2.12:26101 -p MiniHub001.Hub
```

The verified standalone uninstall command is:

```sh
"$HOME/.local/share/samsung-tv-research/tizen-sdk/cli/tools/ide/bin/tizen" \
  uninstall -s 192.0.2.12:26101 -p MiniHub001.Hub
```

Restore any Home/startup assignment **before** uninstalling a configured hub;
see the integration notes for the current rollback command.

## Startup integration

On S90D firmware 2130.0, Samsung prelaunches the web Hub and its native splash
handoff controls the later resume request. The current design uses an AT-HUB
composite helper for splash and screensaver integration; telemetry revisions
superseded the original splash-only helper.

Do not rebuild/install the historical splash variant or use its original-helper
rollback against a composite. `tools/s90d/splash.py` now provides offline planning
and explicitly gated live checkpoints/recovery through the shared setup journal.
It preserves exact prior helper/cache bytes and marker state. See
[S90D boot recovery](s90d-boot-recovery.md) for commands, failure handling and limits.
No boot optimization or S90D native Hub port is enabled by that tooling.

The [offline assessment](../devices/s90d/native-boot-assessment.md) recommends
measurement first: the 22-second acknowledgement/resume records do not measure
when the panel shows the Hub or when the remote first works.

The native Home-operation assignment points to `MiniHub001.Hub`,
`db/appfw/home_appid` names the hub, and Smart Hub `auto_start` is integer `1`.
This configuration survived a controlled real reboot with the hub running in the
foreground. Samsung Home remains installed and `db/first_screen/type` remains
unchanged. Writing the derived startup-app string alone was insufficient.

For new setup use the [shared setup workflow](tv-setup.md); its journal records
the exact prior Home settings. Recover a setup run with that run's rollback and
original checkout. The old `enable.py`/`restore.py` commands describe historical
native-setting experiments with fixed placeholder addressing and no current
shared journal. Do not run them as today's recovery procedure. Restoring a boot
checkpoint does not change Home assignment or uninstall the Hub.
See [historical verification details](../devices/s90d/README.md).

## Verification

Current Edit apps verification is in [the feature record](edit-apps.md). The
following checks describe the original two-tile implementation:

- Six Node tests: desktop simulation, exact target IDs, independent app-control
  launch, unsupported runtime, permission error, rejection of unknown target.
- Browser: Right/Enter selected YouTube; Escape displayed return confirmation;
  Right/Enter selected Samsung Home; visible messages clearly identified previews.
- Visual layout inspected in the in-app browser at its default size and at
  1920×1080. the owner also confirmed the real TV display and Plex tile.
- Native API assignment to the hub and immediate restoration to Samsung Home
  passed; the startup-app string also passed a change/restore test.

## Optional runtime memory cleanup

With the hub open, `python3 tools/s90d/trim-home.py` temporarily stops Samsung's HomeMedia
and HomeSidebar helpers. The main Samsung Home app stays running. The measured
initial gain was about 73–91 MiB of available RAM; Plex/YouTube navigation and
Samsung Home recovery passed. Samsung Home recreates the helpers when opened.
This uses the existing SDK route, requires no root, and changes no boot settings.
For the owner-selected deeper trim, run `python3 tools/s90d/trim-home.py --include-home`.
This also unloads main Samsung Home; reopening it took about nine seconds.
App launches, Home-key routing, cold Samsung Home, Quick Settings and source
overlays passed focused TV checks. Run `python3 tools/s90d/trim-home.py --restore` to
relaunch the full Home family and return to Minimal Hub.
See [measurements and limitations](../devices/s90d/overhead.md).

The background-startup investigation found main Samsung Home already absent in
two post-reboot samples with the existing hub configuration. Its sidebar helper
was present and was trimmed explicitly. No permanent startup block was added;
Samsung Home, Quick Settings or source selection can reload these components.

## Primary references

- [Samsung Application API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html)
- [Tizen application groups and launch privilege](https://github.com/Samsung/tizen-docs/blob/master/docs/application/web/guides/app-management/app-group.md)
- [Samsung remote input](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
- [Samsung certificate creation](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
- [Samsung TV CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)
