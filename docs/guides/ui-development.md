# UI development

Minimal Hub has one UI source: `web/`. The browser workbench serves those files
with simulated Tizen APIs. The unsigned TV package includes only the explicit
file list in `scripts/package.py`; it contains no preview tooling.

## Start

Requires Node 20+; packaging also requires Python 3.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Open <http://127.0.0.1:8766>. The server binds only to loopback. Use
`PORT=8767 npm run dev` if the default port is occupied. Stop with Ctrl+C.
Saving files under `web/` or `preview/` reloads the embedded app; refresh the
outer page after changing the workbench itself.

The embedded app has a 1920×1080 viewport scaled to fit the window. Choose
**Open full viewport** to inspect the app at your browser's actual viewport size.
Click inside it, then use arrows to navigate, Enter for OK, and Escape for Back.

## Scenarios

The selector covers default Home, a full catalog, the compact layout with the
clock, empty Home, an unavailable app, Edit apps, move-or-remove, moving in the
Home grid, undo removal, opening an app, hold-OK settings, the app picker,
settings, reset confirmation,
launch/discovery failures, unreadable saved shortcuts, and missing artwork.

Scenario definitions live in `preview/scenarios.js`. `preview/fixtures.js`
provides catalogs and simulated app discovery, launch and audio APIs. UI tests use the same mock installer with a numbered catalog
for stable assertions. Sound starts off in the workbench; enabling it can play
the app's normal local Web Audio tones.

**Design · Gallery apps & inputs** (`/?scenario=tvos-concept`) previews the S89C
Home design using simulated apps. Gallery shows five columns with a clock, local service
logos and labels below each tile. A greeting and date follow the browser's local
time: morning starts at 05:00, afternoon at 12:00 and evening at 17:00.
Fifteen landscape photos load directly from Unsplash and crossfade once a minute;
the sequence repeats after about fifteen minutes while Home stays visible.
Reduced motion removes the fade. Rotation pauses while the page is hidden.
Failed downloads keep the last photo, or the gradient before any photo loads.
Settings → **Background photos** turns downloads and rotation on or off. Off
shows the gradient and cancels a photo still loading; the choice survives reloads.
Settings → **Tile layout** cycles through **Gallery**, **Comfortable**, and
**Compact**. Gallery is the current five-column design with logos, captions and
the greeting/date. Comfortable and Compact use the earlier card designs with up
to three or four columns. Each choice updates the arrow and move navigation,
with a matching Settings preview. The photo toggle works across these layouts.
S89C saves this choice under `minimal-hub.design.v1`, preserving the older
`minimal-hub.layout.v1` values: the former S89C Compact choice becomes Gallery;
a saved Comfortable choice stays Comfortable. Other TV profiles retain their
existing layout choices. Photo preferences use `minimal-hub.photos.v1`.
Its Live TV, HDMI 1 and HDMI 3 entries are
sample fixtures; they do not report connected devices or switch real inputs.
The design uses `web/tvos.js`, `web/tvos.css` and the shared remote navigation.
S89C staging enables it through the body’s `data-design` attribute. Other TV
profiles retain their current layout. The existing Compact scenario remains
available for comparison. Logo sources are recorded in
[the artwork notes](../../web/logos/README.md).

On the S89C, discovery supplies installed app IDs and connected TV/HDMI sources.
Input captions say **via Home**: they open Samsung Home to select the source.
Direct input switching awaits a separate hardware test. A fresh Home includes
the discovered catalog; saved selections and explicitly empty Home stay intact.
Only the S89C package permits image downloads from `images.unsplash.com`.
The concept's Add apps list includes a curated set of 25 U.S. video services,
with Spotify as an extra music option. Extra services start off Home. Open
**Edit apps → Add apps** to browse their logos and add a sample shortcut.
Picker rows and the artwork preview use the same local logo files as Home.
The catalog is simulated; on a TV, install through Samsung's Apps store before
adding its discovered shortcut. Region and model determine store availability.
The rotation uses these photos under the [Unsplash License](https://unsplash.com/license):

| Landscape | Photographer |
| --- | --- |
| [Blanca Lake](https://unsplash.com/photos/landscape-photography-of-mountain-surrounded-by-pine-trees-and-body-of-water-4qKVQYOluDk) | Yoshi Takekawa |
| [Alpine landscape](https://unsplash.com/photos/WaceUPhYJYk) | Diggity Dog |
| [Mountain lake](https://unsplash.com/photos/G1a8v-UJ-0w) | Sergi Kabrera |
| [Rocky coast](https://unsplash.com/photos/coastal-landscape-with-ocean-and-rocky-cliffs-5XWwlkEnscA) | Kellen Riggin |
| [Forest waterfall](https://unsplash.com/photos/landscape-photography-of-waterfalls-oRIFpNILJOU) | Gabe Hobbs |
| [White Sands](https://unsplash.com/photos/soft-white-sand-dunes-under-a-pale-sky-bsWh6w4nQio) | Royce Fonseca |
| [Pine forest](https://unsplash.com/photos/landscape-photography-of-green-plants-under-tall-trees-in-forest-kC4fGR7rZVY) | Handy Wicaksono |
| [Diablo Lake](https://unsplash.com/photos/body-of-water-between-mountains-ZNkvxIPPVeE) | Sergei A |
| [Pyramid Lake](https://unsplash.com/photos/a-lake-with-mountains-in-the-background-qmg0MidYviw) | Dennis_TM |
| [Snowdonia](https://unsplash.com/photos/mountain-landscape-with-a-lake-and-clear-blue-sky-aJzQJ_oP-tY) | fabian jones |
| [Lake Minnewanka](https://unsplash.com/photos/stunning-mountain-landscape-with-lake-and-rocky-foreground-GDbwG7ziHYM) | Rafael Peier |
| [Lake Geneva](https://unsplash.com/photos/vast-lake-surrounded-by-mountains-under-a-cloudy-sky-aKUV3Hm4CqQ) | Mikheil Kuzmidi |
| [Swiss Alps](https://unsplash.com/photos/mountains-tower-over-a-serene-lake-JzlFykB6YBQ) | Pascal Debrunner |
| [California dunes](https://unsplash.com/photos/the-sun-is-shining-over-the-sand-dunes-9G8K_nycv7s) | Zetong Li |
| [Thar Desert](https://unsplash.com/photos/sand-dunes-at-desert-under-grey-cloudy-sky-mZDOfgiQeE4) | Sharad Bhat |

The active photo's credit appears below the controls. The concept requests only
these curated images from `images.unsplash.com`, with no API key or referrer.

- Edits to favorites/settings survive reloads within a scenario.
- Switching scenarios or selecting **Reset scenario** reseeds preview preferences.
- The scenarios share one preview origin; use separate browser contexts for
  independent sessions. Do not edit two scenarios concurrently in same-origin tabs.
- Simulated app launches appear in the workbench footer; no real app opens.
  Successful mocks simulate a hide/return cycle. The Opening scenario delays
  the callback for five seconds so launch progress can be inspected.

Direct links are useful for browser automation:

```text
/hub?scenario=many
/hub?scenario=settings&reset=1
/hub?scenario=tvos-concept&reset=1&static=1
```

`reset=1` reseeds once and is removed from the URL. `static=1` disables reload
polling for captures. `/web/index.html` serves the original, uninjected app for
checking its basic desktop fallback.

The injected preview permits same-origin connections for reload polling. The
tvOS scenario and S89C staged package permit images from
`https://images.unsplash.com`. The base HTML keeps `connect-src 'none'`.

## Validate and package

```sh
npm run test:ui
npm test
npm run screenshots
npm run screenshots -- --small  # 960×540 captures in test-results/screenshots-960/
npm run package
```

Screenshot capture starts its own temporary server and writes 1920×1080 PNGs
for every scenario to `test-results/screenshots/`. It uses fresh browser contexts,
a fixed clock and reduced motion, and blocks online photos to capture the
concept's gradient fallback consistently. Inspect the images; these are not golden-image
tests. The older-browser checks exercise selected fallbacks in modern Chromium,
not a Tizen emulator.

Packaging writes `dist/MinimalHub-unsigned.wgt` and `dist/manifest.json`.
For an authorized update to an already configured TV, follow
[UI deployment](ui-deployment.md). It signs current source through the setup
engine; the unsigned WGT is a local build check, not its deployment input.
Use [the setup guide](tv-setup.md) for first-time installation.

## Selection and launch recovery

Settings → Start on defaults to **Last selected**. The last highlighted Home app
is saved as `minimal-hub.selection.v1`; `minimal-hub.start.v1` stores `last` or
`first`. First favorite affects a fresh Hub start, while returning from an app
still restores the in-session selection. Missing shortcuts fall back to the first
favorite; an empty Home continues to offer Add apps. Neither preference reorders
shortcuts, and Reset shortcuts preserves the startup preference.

Selection writes wait 250 ms after navigation settles, with a flush on visibility
change or pagehide. Abrupt power loss before a write can retain the previous
selection. A failed write keeps navigation usable and reports a Home status
message when no other message is active.

Failed launches and the ten-second timeout open a remote-operated dialog with
Back to apps, Retry and Samsung Home. Back restores the failed shortcut. If
Samsung Home itself fails, its redundant fallback action is omitted. Leaving
Home for a utility page cancels pending feedback; stale callbacks cannot open a
dialog over that page. Accepted launches keep an on-tile progress badge and
duplicate-launch guard until Hub hides. If Hub stays visible for ten seconds,
the recovery dialog distinguishes an accepted request from no response. Back
dismisses feedback; it cannot revoke a request already sent to the TV. Preview
API success still does not prove a real TV app has reached the foreground.
Samsung Home is an exception to the visibility wait: on QN90A it opens as a
partial overlay while Hub remains visible. Its accepted callback clears launch
feedback; errors and a missing callback still open recovery.

Home, editor and settings scroll cues indicate content above/below their viewport.
Clipped items keep normal opacity, and trailing padding does not trigger a cue.
Local browser checks cover these behaviors; selection across real standby/restart,
launch handoff, remote feel and Chromium 76 presentation remain on-TV checks for
both models before claiming hardware verification.

## Grid editing and return work

Edit apps → choose a shortcut → Move now uses the Home grid. All four arrows
move the selected tile to the neighboring position, respecting the three- or
four-column layout and a shorter final row. Down at the bottom reaches Cancel;
Up returns to the moving tile. OK or Save position commits, while Back/Cancel
discards the draft. A failed save keeps the draft available for retry.

Remove from Home offers **Undo remove** in the editor toolbar and Home footer.
It restores the latest removed shortcut at its original index while preserving
later additions/reordering. It is session-only, has no timer, and clears on
successful undo, another successful removal, or Reset shortcuts. It never
uninstalls an app. Failed writes retain the saved list and undo entry.

Settings → Hold OK to edit is off by default (`minimal-hub.hold.v1`, `on`/`off`).
Enabled taps launch on release; a 650 ms hold opens Move/Remove from Home.
Repeated keydowns, Back/arrows, blur and visibility changes cannot accidentally
complete a pending hold. Edit apps remains available. Verify keydown, repeat and
keyup behavior with each physical remote before relying on this shortcut.

Home retains its tile nodes when order, layout, artwork and availability are
unchanged. App lookup uses an ID map, and return discovery starts after 150 ms
instead of during the first restored render. Browser tests check node reuse and
late-data/focus behavior. This does not establish native standby or screensaver
return latency; see [the performance record](../devices/qn90a/performance.md).

The [2026-09-22 hardware record](../research/hub-hardware-validation-20260922.md) tracks the
UI deployment and native-key checks on both TVs, including remaining physical
remote, playback and startup acceptance.

HDMI is not exposed until source handoff is verified on each model. See the
[HDMI investigation](../research/hdmi-shortcuts.md) for evidence and the remaining checks.

## Source boundaries

```text
web/         Shipped screens, state, presentation and TV adapters
preview/     Local workbench, scenarios, shared mocks and screenshot tooling
tests/       Unit and browser behavior checks
native-hub/  Experimental QN90A native launcher (C, mock Evas harness)
tools/       Guarded per-model device operation scripts
scripts/     Packaging, signing and offline checks
tvsetup/     Shared setup engine
research/    Hardware research, exploit tooling and auxiliary services
inventory/   Sanitized device evidence
docs/        UI guides, owner procedures and historical verification
```

Keep rendering and remote navigation in `web/hub.js`; put device API calls in
the existing adapters. Preserve the separate model and presentation modules.
Add modules when a responsibility needs separation, updating script order,
package contents and tests together. Build and rollback scripts reference
research paths directly; move a path and its references together, and run
`tests/repository_paths_test.py` to catch broken repository-root expressions.

## Startup work

Saved shortcuts, handlers and navigation initialize before the initial catalog
request. Discovery is scheduled after document focus; explicitly opening the
editor can request it immediately and cancels the pending startup request.
Tizen callback-based APIs can still block while loading their native extensions.
Hidden startup waits for a visible, focused return; explicit discovery recovery
remains available.

`HubBootTrace` hooks are inert in a normal package. The research recorder adds
bounded navigation/paint timing when explicitly included in a diagnostic build;
it is not a production asset. See the [QN90A measurements and limitations](../devices/qn90a/web-startup.md).

## Monitoring compatibility

The core launcher and S89C concept omit TV monitoring. Their Settings, scripts
and unsigned package contain no collector integration. The existing S90D and
QN90A builders retain their background adapters from
`research/s90d-telemetry/legacy-hub/` for previously configured collectors.
Those integrations are separate from the S89C preview.
