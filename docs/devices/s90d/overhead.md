# Samsung S90D memory trimming

> **2026-10-12 recovery correction:** direct `tools/s90d/restore.py` commands
> below are historical Home-settings procedures with placeholder addressing, not
> current composite-helper/cache recovery. Use the original shared setup journal
> for setup rollback and [boot checkpoints](../../guides/s90d-boot-recovery.md) for a future
> S90D boot trial. No current live state or physical boot timing was verified.

## Background startup investigation — 2026-09-20 UTC

The existing startup integration already chooses Minimal Hub instead of Samsung
Home. Read-only inspection of this TV's boot manager confirmed that its Home job
uses `db/appfw/home_appid` (currently `MiniHub001.Hub`). Its separate overlay-home
setting, `db/appfw/overlay_home_appid`, is an existing empty string. The firmware
treats that as no overlay Home; only a missing value falls back to
`db/first_screen/type`. None of these settings was changed for this investigation.

After an authorized reboot and the owner's completed screen-optimization pass,
the boot ID changed and Minimal Hub was foreground. At 255 and 343 seconds of
uptime, main Samsung Home and HomeMedia were absent; HomeSidebar alone was running.
This establishes that main Home was not resident in those post-boot samples. It
does not prove that it never briefly launched during startup: usable startup logs
were unavailable, and the screen-optimization cycle is a confounding factor.

HomeSidebar's manifest already has `on-boot=false`, `auto-restart=false` and
`preload=false`. No independent, verified startup-disable switch was found.
Those manifest flags do not prevent another Samsung component from requesting it.
We left packages and boot policy intact to retain Samsung Home, Quick Settings
and source selection. Opening any of those can bring Home back into memory.
There is no permanent block on those legitimate launches and no automatic killer.

The selected one-time trim then removed the remaining sidebar helper, with all
three Home components verified absent. Available RAM rose from 479,484 to 502,972
KiB (22.9 MiB) in that run; the main Home savings were already present at baseline.
The prior full-family savings below must not be added again to that baseline.

A subsequent native-key standby/wake check passed with all three components
absent before and after. The TV's HTTP status independently reported `on`, then
`standby`, then `on`; its boot ID stayed unchanged and Minimal Hub returned to the
foreground. Available RAM after wake was 527,140 KiB (514.8 MiB), a snapshot rather
than a guaranteed steady-state amount. This was automated verification, not a
new physical-remote confirmation. Evidence: `dumps/20260920T044559Z`, operation
exit 0 and verified collector cleanup; private power samples are in
`signing/home-trim-standby-states.jsonl`. A settled check about 83 seconds after
wake again found all three absent, Minimal Hub foreground, and unchanged Home
manifest hashes/startup settings. Available RAM was then 596,148 KiB (582.2 MiB),
illustrating the variability of these samples. Evidence:
`sessions/20260920T044741.775782Z-run`, exit 0.

Private evidence: `dumps/20260920T042824Z` (pre-reboot state and reboot request),
`sessions/20260920T044321.790652Z-run` and
`sessions/20260920T044449.483207Z-run` (post-boot state),
`sessions/20260920T044501.682321Z-run` (manifest/config inspection), and
`sessions/20260920T044529.588027Z-run` (remaining-helper trim).
A root log collection at `dumps/20260920T044410Z` lost its transport and is not
counted as verified evidence. The subsequent guarded cleanup completed, confirmed
no active collector, and verified the original passwd/public-key hashes unchanged
in `sessions/20260920T044437.429960Z-run`.


## Deeper trim — 2026-09-20 UTC

The owner chose to unload the main Samsung Home process as well as its media and
sidebar helpers, accepting the measured cold-start delay. This is an explicit,
one-time operation from the Mac, not a resident or scheduled process killer:

```sh
python3 tools/s90d/trim-home.py --include-home
```

The default `python3 tools/s90d/trim-home.py` still retains main Home. Both modes require
Minimal Hub in the foreground; the deeper mode also verifies that the native
Home-button assignment points to Minimal Hub. They use normal app termination,
verify the selected apps are absent, and never escalate to forced signals.
If Samsung needs a component again it can restart it normally.

Restore the entire Home family and return to Minimal Hub:

```sh
python3 tools/s90d/trim-home.py --restore
```

Cold restoration waits for Home's asynchronously created helpers before launching
any missing helper. The first exploratory restore raced that startup and failed
one helper request; this was fixed, then the complete deep-trim/cold-restore cycle
passed through the reusable script. A foreground guard also correctly refused a
restore attempt while Samsung Home was foreground. Restore now returns to Minimal
Hub on an intermediate failure as well as on success.

### Focused TV checks

With all three Home components absent, native remote-key injection verified:

- Plex, YouTube (native Cobalt player), and Crunchyroll launch, then Home returns
  to Minimal Hub. Samsung Home stayed absent throughout these streaming-app tests.
- The hub's Samsung Home button cold-started it, and it recreated both helpers.
  Foreground detection took **9.40 seconds** from the injected OK event.
- Double Back retained Minimal Hub after returning.
- Cold Quick Settings (`XF86KeyQuickSetting`) and source selection (`XF86Display`)
  recreated Home and showed the correct overlays in captured TV screenshots.
  These panels were inspected without changing any TV setting or input.

These are automated native-key and screenshot checks. The owner accepted the
nine-second cold-start tradeoff; playback, HDMI switching, casting, voice control,
and every remote shortcut have not been exhaustively tested. No package,
firmware asset, global security policy, or launch privilege changed.

### Measurements

Sequential measurements include GC, paging and unrelated system activity; they
are not sustained performance guarantees. `MemAvailable` is measured in KiB.

| Operation | Before | After | Immediate available-RAM gain |
| --- | ---: | ---: | ---: |
| Close Pandora and Tubi left from our app-launch tests | 291,576 | 357,796 | 64.7 MiB |
| Stop media/sidebar helpers | 355,596 | 402,404 | 45.7 MiB |
| Stop main Home after helpers, five seconds | 421,728 | 497,516 | 74.0 MiB |
| Main Home still absent, fifteen seconds | 421,728 | 503,728 | 80.1 MiB |
| Reusable full-family trim | 367,620 | 494,512 | 123.9 MiB |
| Repeat after freshly restoring Home | 330,540 | 500,056 | 165.5 MiB |

Spotify's main app was already absent when checked; no broad sweep of user apps
was added. Plex, YouTube, Crunchyroll, Netflix and shared TV services were retained.
The initial PSS ranking attributed about 42.0 MiB resident / 34.5 MiB logical
SwapPss to main Home, and 44.7 MiB resident / 54.6 MiB logical SwapPss to its helpers.
SwapPss is not physical zram cost. Initial memory-pressure averages were zero;
these savings alone do not establish smoother playback or faster rendering.

Raw evidence remains private:
- `dumps/20260920T041432Z`: initial full PSS ranking.
- `sessions/20260920T041526.688761Z-run`: test-app cleanup.
- `sessions/20260920T041543.468254Z-run`: helper trim.
- `sessions/20260920T041612.954967Z-run`: main-Home-only trim and settled sample.
- `dumps/20260920T041647Z`: successful streaming navigation and cold Home recovery.
- `dumps/20260920T041757Z`: cold Quick Settings/source screenshots.
- `sessions/20260920T041952.267396Z-run`: reusable deeper trim.
- `sessions/20260920T042743.367239Z-run`: repeated full-family trim.
- `sessions/20260920T042749.783458Z-run`: corrected cold restoration, successful.

## Earlier helper-only investigation

On 2026-09-19, the owner authorized a measured, reversible reduction of background
Home overhead. The selected result is **on-demand termination of HomeMedia and
HomeSidebar**, leaving Samsung's main Home app (`com.samsung.tv.csfs`) running.
It recovered roughly 73–91 MiB of available RAM immediately across SDK-only runs.
Plex and YouTube launches passed with the helpers absent, and opening Samsung
Home automatically recreated them. No startup configuration, app package,
security policy, or boot service was changed.

## Commands

With Minimal Hub in the foreground, run from this repository:

```sh
python3 tools/s90d/trim-home.py
```

Rollback (relaunch the helpers and return to the hub):

```sh
python3 tools/s90d/trim-home.py --restore
```

Both commands were exercised through the existing SDK access route without
root. They use `app_launcher -t` / `-s`, not forced signals. A foreground guard
refuses to interrupt another app; the main Home app must still be running at
completion. The Mac's existing `samsung-tv` wrapper verifies the target model
and developer host, records a private session, and cleans its temporary script.
The Python wrapper removes its private local staging directory afterward.

This is not automatic boot optimization. Savings last until Samsung needs the
helpers again; Samsung Home was directly observed relaunching them. There is no
resident monitor, periodic killer, new network listener, or additional TV app
privilege. No reboot is needed for either operation. The original Home/startup
rollback remains `tools/s90d/restore.py`, which is a different operation.

## Inspection and measurements

Live process inspection placed all three Samsung Home processes in the app
resource group under `init.scope`, rather than dedicated systemd service units.
They have separate `User::Pkg::<package>` SMACK labels. The main Home app was in
the background CPU group; its media/sidebar helpers were in the default group.
Their package manifests mark both helpers as `on-boot=false`, `preload=false`,
and `auto-restart=false`. The main Home package is marked preloaded and handles
input selection, quick settings, and app-list keys. It remains installed and
running. Manifest hashes were recorded and matched after restoration.

Temporary root was used only to read proportional memory accounting and drive
bounded remote-key tests. Per-process PSS is more useful here than adding RSS:
shared runtime pages would otherwise be counted repeatedly. zram statistics are
compressed-RAM accounting; logical swapped bytes are not physical RAM usage.

| Stage | MemAvailable | Observation |
| --- | ---: | --- |
| Initial settled baseline | 228.2 MiB | All three Home components present |
| Media helper stopped, 20 seconds | 283.2 MiB | Media stayed absent; hub foreground |
| Sidebar also stopped, 5 seconds | 298.2 MiB | Main Home still running |
| All three stopped, 20 seconds | 375.6 MiB | Memory benefit, but recovery/navigation not validated for routine use |
| Separate helpers-only baseline | 225.8 MiB | Components freshly restored |
| Both helpers stopped, 5 seconds | 305.5 MiB | Main Home retained |
| After Plex/YouTube navigation | 317.1 MiB | Both helpers still absent |

These are short sequential measurements, not a controlled long-term benchmark.
Other processes, paging, GC, and the measurement tools affect MemAvailable.
No claim is made about FPS, playback performance, or sustained CPU improvement.
The earlier idle sample reached 96–98% CPU idle, so CPU saturation was not shown.

## Recovery and navigation

The all-three-stopped navigation script failed its first Plex assertion. A later
read reported YouTube foreground, so the cause was ambiguous: focus, timing, or
external remote use were not isolated. This configuration was promptly restored
and was **not** included in the original reusable cleanup command. The newer
explicit `--include-home` mode above has separate successful recovery evidence.

The narrower test explicitly restored hub focus and polled foreground changes.
It passed hub → Plex → hub → YouTube → hub → Samsung Home → hub. Both helpers
remained absent through the streaming-app launches; Samsung Home then recreated
both with new PIDs. The hub's focused, visible compositor window was confirmed
before navigation. Full manual restoration also passed.

The first SDK-only cleanup recovered 75,096 KiB (73.3 MiB), from 290,124 to
365,220 KiB available. The final cleanup recovered 92,752 KiB (90.6 MiB),
from 271,868 to 364,620 KiB. Its `--restore` command recreated both helpers, kept the
main Home process, and returned to the hub. The cleanup was then applied again
for the final state. Roughly 87 seconds later, both helpers were still absent and
MemAvailable was 299,480 KiB (292.5 MiB). This variation is why the immediate
gain is not presented as a sustained system-wide increase. Actual video playback was not tested during this experiment.

## Evidence and originals

Raw results remain private under `~/.local/share/samsung-tv-research/`:

- `sessions/20260920T001423.762112Z-run/`: process groups, SMACK labels, app registry.
- `dumps/20260920T001520Z/`: baseline and media-only termination, exit 0.
- `dumps/20260920T001618Z/`: sidebar/main termination and memory accounting, exit 0.
- `dumps/20260920T001706Z/`: failed aggressive navigation check, exit 1.
- `sessions/20260920T001816.992731Z-run/`: complete restoration, exit 0.
- `sessions/20260920T001903.543050Z-run/`: restored processes, unchanged manifest
  hashes and Home/autostart settings, exit 0.
- `dumps/20260920T001940Z/`: helpers-only navigation and recovery, exit 0.
- `sessions/20260920T002118.676664Z-run/`: SDK-only cleanup, exit 0.
- `sessions/20260920T002132.202979Z-run/`: reusable rollback, exit 0.
- `sessions/20260920T002147.357187Z-run/`: final cleanup, exit 0.
- `sessions/20260920T002314.694395Z-run/`: helpers still absent, main Home and hub
  running, unchanged Home/autostart values and all checked hashes, root staging
  absent, exit 0.

The package/configuration originals remain in the existing private startup and
package dumps. This experiment did not edit them. Root collector staging and
its temporary transport keys were cleaned; original passwd/public-key hashes
remained unchanged. The final selected command requires no root collector.

Sanitized results: [home-overhead-verification.json](../../../inventory/samsung/2026-09-19/hub/home-overhead-verification.json).


## Later RAM ranking — 20:25 CDT (01:25 UTC)

A fresh read-only snapshot used `/proc/<pid>/smaps` PSS, which apportions shared
pages. The first per-process shell loop timed out and is not used as the full
ranking. A single awk scanner completed successfully in
`dumps/20260920T012514Z/ram-ranking.txt`, exit 0. Raw command lines remain private.
YouTube was foreground in this sample; it is not an idle-hub baseline.

| Component | Resident PSS |
| --- | ---: |
| YouTube/Cobalt runtime | 75.8 MiB |
| Main Samsung Home (`csfs`) | 49.3 MiB |
| Samsung `slive-provider-daemon` | 42.2 MiB |
| Plex | 38.1 MiB |
| Minimal Hub | 33.8 MiB |
| Samsung TV Plus app | 22.6 MiB |
| Prime Video | 16.3 MiB |
| Display compositor | 13.5 MiB |
| Samsung QuickLaunch | 10.0 MiB |
| MultiScreen | 9.3 MiB |

Neither HomeMedia nor HomeSidebar was present. PSS across scanned processes was
about 496.8 MiB after excluding 17.7 MiB attributable to temporary diagnostics.
The diagnostic staging was cleaned afterward. This is a sequential sample, not
an atomic snapshot. PSS is not a guarantee of reclaimable savings.

The device reported 334.0 MiB available of 1,774.3 MiB Linux-visible RAM.
zram used 348.6 MiB physical RAM to hold 1,016.1 MiB of logical swapped pages.
Kernel slab was 108.0 MiB, page tables 53.1 MiB, and kernel stacks 22.2 MiB.
File cache was 323.0 MiB and partly reclaimable. These categories should not be
added indiscriminately: file mappings/PSS/cache and driver accounting can overlap.
The large device-specific CMA allocations were recorded but not assigned to
individual media/display drivers without further evidence.

AirPlay's main process had only 2.2 MiB resident PSS but 33.3 MiB logical SwapPss;
Netflix had 1.5 MiB resident PSS and 22.2 MiB logical SwapPss. ACR and targeted-ad
processes together had about 1.4 MiB resident PSS in this sample. Their presence
is not evidence of active CPU usage. Disabling them cannot be justified as a
large resident-memory saving from these numbers alone. sLive's exact feature
dependencies remain unverified; it was not stopped or labeled disposable.

Sanitized ranking: [ram-ranking.json](../../../inventory/samsung/2026-09-19/hub/ram-ranking.json).
