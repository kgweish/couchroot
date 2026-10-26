# Samsung S89C setup and hardware checks

On 2026-10-18, Minimal Hub 0.4.1 was signed for the owner's 77-inch
`QN77S89CBFXZA`, installed and selected as Home. The owner confirmed that the
launcher displays installed apps, responds to the remote's arrows and opens
again when Home is pressed from another app. The owner chose to keep it.

The checkout starts from upstream commit
`83906b468836869933012da03a4018fb339462b3`.

## Observed device and settings

| Detail | Observed value |
| --- | --- |
| Platform | `23_PTM_QD_T09` |
| Firmware | `T-PTMCAKUC-0090-2220.4` |
| Build | `T-PTMCAKUC-0090-REL-202603190200` |
| OS | Tizen 9.0.0 |
| Kernel and architecture | Linux 5.4.77, ARMv7 (`armv7l`) |
| Managed helper runtime | .NET 6.0.9 |
| Launcher package / app | `MiniHub001` / `MiniHub001.Hub` |
| Home operation and Home setting | `MiniHub001.Hub` |
| Smart Hub autostart | Integer `1`, preserved from the original configuration |
| Reported startup app | `MiniHub001.Hub` |

The .NET host and launcher hashes match the reviewed S90D runtime. Native API
calls on this S89C also confirmed the current Home assignment, a working Home
setter and eligibility for the installed web app to start as Home. These checks
ran as UID 901 (`sdk`). Root access stayed disabled.

The original Home operation, `db/appfw/home_appid` and
`db/appfw/startup_appid` all named `com.samsung.tv.csfs`. The restore command
returned those values to Samsung Home and preserved integer autostart `1`.
Selecting Minimal Hub through the native API updates the reported startup app.
The final assignment was verified after the recovery timer had exited.

See the [sanitized inspection record](../../../inventory/samsung/2026-10-18/s89c/inspection.json).
Private identities, signed artifacts and raw output live under ignored
`.local-tools/` directories.

## Samsung signing

The local `CouchrootS89C` profile contains Samsung-issued author and distributor
certificates. The owner completed Samsung account sign-in. Certificate validity
and CA chains passed inspection, and the distributor certificate contains this
TV's SDK signing DUID. Passwords live in macOS Keychain.

Retrieve the signing DUID through the official SDB `getduid` service. The HTTP
identity API's `duid` field contains the network UUID on this set. An initial
distributor certificate using that UUID was rejected during installation.
Issuing a corrected distributor certificate with the SDK DUID resolved the
failure while preserving the author key.

Samsung's official tools run through Rosetta 2, installed with the owner's
approval. The pinned local packages include SDB 4.2.36 and Tizen Core 10.0.18.
Samsung's certificate helper comes from `Samsung/tizen-agent-skills` commit
`21af18ca1e4ab83acb8aafb277d2b93cbf531b2e`; the local copy requires HTTPS
certificate verification for its CA requests. Package archives were checked
against the official Tizen catalog's SHA-256 values.

The shared Couchroot Builder staged the launcher sources. Tizen Core's `tz pack`
produced the signed WGT, which passed the shared `verify_package` checks against
independently inspected certificate pins. Every installed file matched its
signed archive member. The older Java CLI failed on a missing XML utility;
its local shell wrapper also needed argument quoting for this workspace's spaces.

Keep `.local-tools/tizen-sdk/data-data/keystore/samsung/CouchrootS89C/` and the
matching Keychain entries when backing up this setup. Updates require the same
author identity. Signing trust and the package manifests stay private.

## Recovery on this Mac

From the Couchroot checkout, check readiness without changing Home:

```sh
.venv/bin/python .local-tools/s89c/restore-home.py --check
```

To restore the captured Samsung Home configuration:

```sh
.venv/bin/python .local-tools/s89c/restore-home.py
```

This private command verifies the physical TV identity, Developer Mode host and
runtime hashes. It checks the saved helper's digest, reuses an existing SDB
connection or connects once, and uploads the helper when performing recovery.
Native setters preserve the settings' access labels. Readback confirms Samsung
Home, the original startup value and autostart `1`. The installed Minimal Hub app
remains available.

The command and its pinned helper are local preparation files excluded from Git.
Preserve `.local-tools/s89c/` with the signing setup. The private
`home-trial.json` records the trial and original typed settings. The historical
S90D restore procedure uses its own autostart baseline of `0` and must stay
separate from this S89C procedure.

A temporary TV-side watchdog exercised automatic recovery. Its SDK-shell
cancellation marker failed to prevent that recovery. The watchdog exited before
the final Home assignment. Its trial commands were retired and temporary files
were removed. The underlying native restore passed
the roundtrip check; the local wrapper passed its `--check` readiness check.

## Local development

A Python 3.12 virtual environment, locked JavaScript dependencies and local
Playwright browser binaries are prepared. The .NET SDK 10.0.301 matches
`global.json`.

```sh
. .venv/bin/activate
export PATH="$PWD/.local-tools/dotnet:$PATH"
export DOTNET_ROOT="$PWD/.local-tools/dotnet"
export DOTNET_CLI_HOME="$PWD/.local-tools/dotnet-home"
export NUGET_PACKAGES="$PWD/.local-tools/nuget"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.local-tools/playwright"
npm run dev
```

Open <http://127.0.0.1:8766>. The browser workbench simulates TV apps. Use arrows,
Enter and Escape in the preview. `npm run package` produces an unsigned WGT;
installation requires the TV-specific signing profile.

The read-only identity command remains available:

```sh
.venv/bin/python -m tvsetup.s89c_inspect TV_IP
```

It checks the exact model and returns selected identity fields while omitting
private identifiers. Its `setup_supported: false` keeps the general installer
boundary explicit.

## Remaining hardware scope

Cold reboot and standby recovery remain untested. The S90D's native boot/splash
helper and writable-cache assumptions require separate S89C work. General
`tv-setup` / `deploy-ui` commands still refuse S89C because a complete integration
profile has yet to be implemented and accepted.

HDMI shortcuts await a native source-handoff check; the launcher includes a
Samsung Home fallback for inputs. See the [HDMI investigation](../../research/hdmi-shortcuts.md).
App cleanup and alternate screensavers remain outside this setup. A telemetry
receiver/service was not provisioned.

The earlier host suite passed 233 Python tests and 118 JavaScript/browser tests.
This session's checks covered certificate chains and signatures, installed-file
hashes, native Home/readback and recovery, plus the owner's physical remote test.
The shipped UI source stayed unchanged during signing and hardware validation.

## Local 0.4.2 design trial

The local tvOS-style build uses five compact columns, bundled service logos,
local time for its greeting/date/clock, and rotating landscape images from
Unsplash. It discovers installed apps and connected TV/HDMI sources. Input
captions say **via Home** and open Samsung Home for source selection.
Saved shortcut lists take precedence; fresh storage starts with all discovered
entries. Monitoring code and controls are absent from the S89C package.

Both signatures and all source members passed verification. Installed source
and author-signature hashes matched the signed 0.4.2 archive; the TV reported
`MiniHub001.Hub` as its foreground app. The original signed 0.4.1 package remains
available locally. The owner confirmed that the design looks good, the remote
arrows work, and Home returns to the updated launcher after opening an app.

Tizen Core 10.0.18's `tz install` silently removed the old package before
installing this build. That reset the Home assignment to Samsung Home. The
existing native helper restored Minimal Hub; typed Home/startup readback and
autostart `1` passed verification afterward. SDK access to the private app-data
folder was denied, and developer-inspector requests stalled, so saved launcher
settings could have reset. No firmware, services or other apps were changed.

Do not use `tz install` for another update. The local adapter has been retired.
A future update needs an installer path verified to preserve app data. The
standard `deploy-ui` targets remain S90D and QN90A until S89C has that adapter.

Standby/wake and full reboot checks remain pending. The owner plans to exercise
those behaviors over the next day.

## Local 0.4.4 dock and return trial

On 2026-10-19, the local `codex/tvos-hig-design` branch was signed and installed
as 0.4.4 through the guarded direct SDK update adapter. It includes the approved
Horizon Dock. Landscape rotation resumes the current photo's remaining display
time after returning from another app. Launch animations measure tile geometry
before changing styles, and artwork decoration requests a resize only after
adding captions.

Both signatures passed verification. The installed version and 39 tracked file
hashes matched the signed package. Typed Home/startup settings and autostart `1`
stayed unchanged; app-data and Local Storage directory identities also matched
the pre-update snapshot. Foreground readback confirmed `MiniHub001.Hub` after
launch. The signed 0.4.3 package remains available for recovery.

Local checks passed 468 tests with 178 platform-dependent skips. The owner
confirmed that saved shortcuts and physical Home return work on 0.4.4.
Performance measurements remain pending for this build, alongside standby and
reboot checks. The branch and performance changes remain local.

## Local 0.4.5 motion and artwork trial

On 2026-10-19, signed 0.4.5 was installed from the local
`codex/tvos-hig-design` branch through the guarded SDK update adapter. Gallery
remote navigation now uses native smooth scrolling with consistent library row
positions. Direction changes retarget the movement. Reduced motion retains
instant scrolling. Artwork recognizes the full Spotify and Tubi titles reported
by this TV, and HBO Max and Sling use official transparent wordmarks.

Both signatures passed verification, and the installed version and 39 tracked
file hashes matched the signed package. The retired HBO/Sling JPG files were
absent. Home/startup settings and autostart `1` stayed unchanged; app-data and
Local Storage directory identities matched the pre-update snapshot. Foreground
readback confirmed `MiniHub001.Hub`. The signed 0.4.4 package remains available
for recovery.

The local suite passed 475 tests with 178 platform-dependent skips. The owner
confirmed that row motion and the updated logos look good on the S89C with
0.4.5. Hardware performance measurements, standby and reboot checks remain
separate. GitHub publication is pending.

## Local Home Shelf design

On 2026-10-20, Home Shelf was added to Settings → Tile layout on
`codex/tvos-hig-design`. Gallery remains the default; Cinema is also available.
Home Shelf shows ten saved service spines per row, with shared app discovery,
editing and Samsung Home fallback. Its walnut room and case texture ship as
local PNG assets. Background photos keep the existing preference.

The browser suite and unsigned package checks covered this option before its
first TV trial. The 1990s Video Club alternative remains a design render.

## Local 0.4.6 Shelf and Cinema trial

On 2026-10-20, signed 0.4.6 was installed from the local
`codex/tvos-hig-design` branch through the guarded SDK update adapter. It includes
Cinema and the refined Home Shelf, with textured cases that recede along a shared
ledge. Both layouts remain available under Settings → Tile layout, alongside
Gallery and the existing choices. Saved layout preferences were preserved.

Both signatures passed verification. The installed version and all 41 tracked
file hashes matched the signed package. Typed Home/startup settings and autostart
`1` stayed unchanged; app-data and Local Storage directory identities matched
the pre-update snapshot. The signed 0.4.5 package remains available for recovery.

The launch API accepted the request. Its first foreground read still named
Screen Mirroring; a later read-only check confirmed `MiniHub001.Hub` in front.
The launch was issued once. The shared journal records the package update as
complete, and activation evidence records the subsequent foreground confirmation.

The deployment's local suite passed 503 tests with 178 platform-dependent skips.
Owner confirmation of the new Shelf and saved shortcuts remains pending.
Physical remote feel and rendering cost need a TV trial, alongside standby and
reboot checks for this version. GitHub publication is pending.


## UI source release — 2026-10-26

The owner fork's UI release adds Cinema and the final rigid-case Home Shelf,
with smoother Gallery row movement and transparent Disney+, HBO Max and Sling
artwork. The layouts share saved shortcuts and appearance preferences. The
latest Shelf refinement has passed local browser review; hardware rendering and
performance remain pending. The last recorded S89C installation is still 0.4.6.

Private device records and signing material remain outside this release. The
upstream S89C-support PR keeps its existing branch and revision.
