# Shared Samsung TV monitoring

Dashboard: **http://192.0.2.20:20491/**. Netdata remains the existing NAS node at
**http://192.0.2.20:20489/**. The TrueNAS custom app keeps its historical
`s90d-telemetry` name; renaming it would add migration risk without changing its
function. Source remains in `research/s90d-telemetry/` so existing references work.

## Current QN90A scope — 2026-10-17

The local candidate now targets **basic QN90A telemetry with the existing settings
adapter and journaled recovery**. Continuous app/process inspector snapshots are
retired for QN90A in both the native candidate and current managed collector
source. The receiver accepts older senders' basic metrics but drops their inventory;
the dashboard also hides previously stored inventory and says “Retired on QN90A.”
Basic counters, history, pairing and settings remain. S90D behavior and manual
recovery tools are retained; the other rewrites are deferred.

These changes have local tests only. No TV or NAS deployment was performed.
The deployment records below describe earlier versions. See the
[accepted scope](../project/dotnet-deprecation-plan.md) and
[QN90A installation/recovery candidate](native-telemetry.md).

## Device profiles and runtime verification

`tvsetup/profiles/` contains the firmware/runtime profiles; private `site.json` supplies live identities and addresses. IDs identify
physical televisions and must not be reused for another TV. Friendly names may
change. Secrets are generated separately and never appear in this inventory.

| ID | Name | Verified firmware | Architecture | Managed runtime | Startup adapter |
| --- | --- | --- | --- | --- | --- |
| s90d | S90D | T-PTMDAKUC-0090-2130.0 | ARMv7 | .NET 6.0.9 | Signed application service launched by Hub |
| qn90a | QN90A | T-NKM2AKUC-2301.1 | ARMv7 | .NET Core 3.1.3 | Signed application service launched by Hub |

Both signed Samsung `/usr/bin/dotnet` hosts execute the **same collector source**,
built for their respective target frameworks. The QN90A cannot run the S90D's
.NET 6 assembly. Provisioning verifies network model/platform identity, firmware,
architecture, installed runtime and the signed host's recorded SHA-256. The
collector independently checks firmware, pointer width and running runtime before
sending. All four counter sources were readable on these firmwares: `/proc/stat`,
`meminfo`, `net/dev`, and `diskstats`. eMMC accounting excludes partitions.
Unreadable counters are JSON null; missing physical disk/interface sets produce
no rate instead of zero. No thermal/GPU/video counters are inferred.

For the investigated alternative to the managed service, see
[native collector supervision](../research/native-service-research.md). It records
successful C collector ingestion trials on both TVs at roughly 3–4 MiB RSS, preserved
pairing and tested rollback. The managed service remains deployed. QN90A native
startup and recovery integration are implemented locally; hardware acceptance is
still outstanding. See the [current integration guide](native-telemetry.md).

## Startup, controls and pairing

Both TVs use the same chain: **Hub → `MiniTelemetry.Start` →
`MiniTelemetry.Service` → shared collector**. Hub delivers public preferences after
initialization and whenever it returns to the foreground. The service continues
independently when Hub closes. Reopening Hub does not create a second collector;
a later launch can restart a collector that exited. Each device retains its own
signing identity and runtime (.NET 6 for S90D, .NET Core 3.1 for QN90A).

The no-window relay is required because Samsung disallows direct cross-package
service launches. Source lives in the historical
`research/qn90a-telemetry-startup/{service,bootstrap}` directories and is shared by
both builds. The service does not launch at boot by itself: it starts when Hub
first opens. Existing model-specific Hub startup remains independent.

S90D keeps AT-HUB, splash and native saver unchanged. Migration backs up and removes
`/opt/minimal-telemetry/enabled`, waits for the old collector's lock to release,
and then installs/pairs the shared service. The old helper and collector files
remain available for rollback. QN90A keeps its welcome-process relay, Home/AirPlay
routes and Hub-owned saver. Collection begins no earlier than uptime 60 seconds.

Settings → TV monitoring exposes only enabled and receiver URL. Changes apply
without rebooting. New URLs use `https://192.0.2.20:20490/v1/devices/DEVICE_ID`.
The original `https://192.0.2.20:20490/v1/s90d` alias remains supported. Each launcher
accepts only its own device path, HTTPS, and no embedded credentials/query/fragment.
Both Hubs forward public preferences using normal app control. Pairing and the
service's preference copy live in `MiniTelemetry/data`, owned and labeled for that
package. Status is `/tmp/minimal-telemetry-DEVICE/status.json`; the old S90D status
under `/run/minimal-telemetry` is historical after migration.

One certificate is pinned by SHA-256, with a different random bearer credential
for each device. A URL change cannot bypass certificate pairing. Replacing the
receiver certificate requires administrative re-pairing. TLS redirects and proxy
use are disabled. No secret is shipped inside the signed launcher or browser UI.

Sampling is ten seconds, nice +10, with bounded counter/config reads, a RAM-backed
file lock, a three-second request deadline, connection reuse and exponential
failure backoff capped at five minutes. There is no offline sample queue. Settings
remain responsive during backoff. Runtime status is RAM-only; no periodic metrics
or logs are written to TV flash. Preference writes occur only for explicit changes.

## Ingestion, history and freshness

Each device has an independent lock, source IP, token, latest file, throttle,
boot/session/sequence state and rate baseline. Two devices can send simultaneously.
Request bodies are limited to 512 KiB (including bounded inspector snapshots) and server connections are bounded. Replays
within a collector session and non-increasing TV uptime are rejected. A bounded
retired-boot/session list rejects recent superseded identities. Legacy S90D samples
without a session remain supported, including sequence reset on collector restart.

S90D keeps `custom-plugins.d/s90d-data/latest.json` and **all nine `s90d.*` chart
IDs and contexts**. QN90A uses `qn90a.json` and `qn90a.*`. The original plugin
filename remains `s90d.plugin`; it now loops over the public device registry.
Netdata's daemon, retention settings and database volumes are not replaced.

Rates require the same boot, device and collector session, increasing sequence,
and an uptime delta no greater than 45 seconds. Counter decreases or network/disk
membership changes invalidate affected rates. A first sample provides only gauges.
The plugin emits no fresh CPU/I/O values for duplicate or stale snapshots; after
35 seconds without receipt, availability is zero. A plugin/receiver restart does
not fabricate a baseline. Receipt timestamps are server time; TV uptime supplies
rate intervals.

The dashboard selector supports each device's history and current metrics; its
overview compares both TVs. Current rates are stored with the **exact snapshot**,
not taken from an earlier Netdata aggregation bucket. Stale telemetry clears current
readings while keeping history. A failed dashboard request shows “Dashboard
disconnected”; missing TV samples show “No recent telemetry”; unavailable Netdata
history has a separate notice. The dashboard mounts no credentials and polls only
the NAS, never the TVs.

## Operations and recovery

Use the shared setup engine for both TVs. Configure private site/signing trust as
shown in [TV setup](tv-setup.md), then substitute `s90d` or `qn90a`:

```sh
./tv-setup plan --device s90d --components hub,telemetry --privileged-inspection
./tv-setup apply --device s90d --components hub,telemetry --yes --activate
./tv-setup verify --device s90d --components hub,telemetry --privileged-inspection
./tv-setup rollback --device s90d --run RUN_ID --yes
```

Apply builds/signs for the selected TV and journals backups before mutations.
Use `TV_SETUP_RECOVERY_DIR` to enroll matching signed prior packages for rollback;
installed-file archives cannot be reinstalled. A new service package is retained
on rollback to preserve user data, but its enable marker and pairing are removed.
S90D rollback drains the new collector before restoring the old enable marker and
restarting AT-HUB. Never re-enable the old marker while the shared service is enabled.

The historical `manage-tv.py` and QN service `manage.py` commands are retired.
For a UI-only release use `./deploy-ui`; for shared NAS code changes use the
explicit `dashboard` component and `--shared-nas`. A TV service migration does not
change the NAS receiver, per-device tokens, chart IDs or history.

Validate one collector, current-boot ingestion, repeated Hub entry, Hub exit,
reboot and standby/wake separately. App launch alone is not playback verification.

The firewall permits exactly `192.0.2.12` and `192.0.2.11` to TCP
`192.0.2.20:20490`, in addition to existing trusted administration access. The new
rule is `qn90a-telemetry-20260920 receiver`, placed before the existing NAS guardrail
drop. It was staged disabled, enabled/tested and committed in RouterOS safe mode.
Binary router backup: `pre-shared-tv-telemetry-20260920`; private exports are
`telemetry/router-before-shared.rsc` and `router-after-shared.rsc`. Rollback removes
only that uniquely commented QN rule. No NAS UI/SSH/Netdata access was granted to TVs.

## Adding another supported TV

1. Inspect model/platform, firmware, ARM architecture, signed host hash, runtime and
   readable counters. Reuse a verified startup adapter only for matching supported
   firmware; stop on a mismatch rather than forcing a different model's boot hook.
2. Add one inventory entry with a stable ID, friendly name, unique chart prefix and
   snapshot filename. Keep the legacy `s90d` prefix/file reserved. Select the matching
   target framework and startup adapter. Do not copy collector source.
3. Add the television to a Samsung distributor signing profile; keep its certificate
   and signing material private. Provision its own generated credential and the
   existing receiver certificate pin, outside the launcher package.
4. Run NAS provisioning with the expanded inventory and add a single source-host /
   destination-port firewall exception. Install the matching signed service/helper
   and launcher, configured with the new device ID.
5. Verify first and second samples, auth isolation, enable/disable, restart and actual
   startup. Record any unverified firmware/startup behavior before calling it supported.

## Service unification validation — 2026-09-21

Both TVs were migrated using `tv-setup --components hub,telemetry`. Installed
content and runtime configuration passed readback, and re-planning reported no
changes. S90D uses Hub 0.4.5 / service 0.4.0; QN90A uses Hub 0.4.3 / service 0.4.4.
The package versions differ because each TV retains its own update history.

Three Hub relaunches on each TV retained one service PID. After Hub was closed,
receiver sequences continued advancing. Short post-update RSS observations were
18.21 MiB on S90D and 26.30 MiB on QN90A; these are snapshots, not peak bounds.
Both receivers were fresh and both sets of nine history charts remained available.
Saved monitoring preferences, Home assignments and QN routing/boot/saver files
matched their pre-migration snapshots. No NAS code or receiver identity was changed.

An initial package-format failure was recovered through the journal, restoring the
previous Hub and S90D collector before retrying. The shared builder now preserves
Samsung's default XML namespaces, recovery archives use filenames without spaces,
and failed installer output is retained. Local validation passed 145 Python tests,
59 Node/browser tests, both target builds, the production service lifecycle harness,
and operations-skill validation.

S90D's first reboot exposed a cold-start timing failure: Hub resumed but no relay
started. The Hub adapter now retries initial preference reads, API availability,
hidden startup and failed launch requests within a bounded 90-second backoff
window, then waits for a new foreground entry. The next full native reboot passed
with zero manual Hub launches and fresh current-boot ingestion. The helper and
renderer hashes remained unchanged, the legacy marker stayed absent, and exactly
one signed service process matched the collector status.

QN90A also passed a full native reboot with zero manual Hub launches, an
independent boot-relay foreground acknowledgement and fresh current-boot ingestion.
All counter groups remained available. These are software observations; physical
splash/saver appearance and playback are separate acceptance checks.

Private evidence and rollback packages are under `setup/runs/` and
`telemetry/unification/` in the private research directory. Service deployment
journals use source commit `ad3a3e9`; subsequent Hub-only startup fixes use
`fc78af6`. Roll back the Hub-only run before an earlier service migration, using
the matching source checkout and private journal for each step.

Actual streaming playback and standby/wake remain unverified; Hub exit and a
native reboot do not establish those behaviors.

## Historical validation before service unification

Automated: `python3 -m unittest discover -s research/s90d-telemetry/tests -v`,
`npm test`, `python3 research/s90d-telemetry/build.py`, and
`node research/s90d-telemetry/dashboard/verify.cjs`.

Deployed and verified on 2026-09-20:

- 14 Python tests and 51 Node tests passed. Both collector targets and the additive
  S90D helper compiled without warnings. Browser checks passed against both live
  devices, including selector/overview, all history ranges, keyboard inspection,
  mobile width, stale telemetry and a simulated dashboard HTTP 503.
- Live settings disable/enable and receiver URL changes took effect on both TVs
  without a reboot. QN Hub attempts to read the service pairing directory failed
  with SecurityError. Per-device credentials, wrong-device claims, simultaneous
  ingestion and legacy S90D ingestion were exercised by backend tests.
- A 45-second receiver outage left the dashboard accessible and visibly stale.
  The first actual recovered S90D sample followed a 70.07-second gap and contained
  gauges only; subsequent samples resumed rates. Collector retry/backoff recovered
  without a queue. QN URL outage also exercised timeout/backoff and restoration.
- Live TrueNAS app configuration compares equal to the pre-migration definition.
  All nine S90D chart identities retained their original first-entry timestamps
  (CPU: Unix 1789928900); all nine QN90A charts are separate. Netdata was not replaced.
- S90D passed multiple actual native reboots. The final boot ID was
  `00000000-0000-4000-8000-000000000020`; the first observed accepted sample was
  sequence 2 at uptime 82.88 seconds, following one transient send failure.
  Subsequent samples were ten seconds apart. AT-HUB remained active, running the
  final collector hash, with original account/key hashes and staging cleanup intact.
- QN90A passed signed service update → rollback → update and an actual reboot.
  New boot ID `00000000-0000-4000-8000-000000000021` collected after an ordinary Hub
  launch, with exactly one service process, 13 sends and no failures at uptime
  338.61 seconds. Home and both AirPlay-return routes, database integrity and the
  original Asteroids idle script were checked after reboot. Both TVs' SDB recovery
  required restarting the stale Mac SDB daemon; no TV developer settings changed.

Startup and steady-state overhead are different measurements. In the final S90D
boot, its hosting helper had consumed 2.788 CPU-seconds and used 30.18 MiB RSS by
its first observed accepted sample (82.88 seconds uptime). This includes existing
splash/screensaver helper work, so it is not an isolated incremental collector
startup cost. On QN90A, an earlier first service sample measured 0.384 CPU-seconds
and 25.33 MiB RSS; the final postboot relay separately took 33 ms in managed startup,
0.356 process CPU-seconds, and 23.8 MiB RSS before exiting.

Final-build steady-state observations after startup (CPU as percent of one core):

| Device | Observation | Hosting-process CPU | Observed RSS |
| --- | --- | --- | --- |
| s90d | 150.01 s / 16 samples | 0.723% | 13.31–18.66 MiB |
| qn90a | 150.03 s / 16 samples | 0.144% | 23.96–35.29 MiB |

These are short sampled windows, not long-term peak bounds. S90D measures the
shared helper process; QN measures the separate service. Startup relay memory is
transient and is not included in QN steady-state RSS.

Artifacts: S90D collector SHA-256
`8925e093cec4379aa4f1915ebc882ca8d02fa65557ec10ebd20c877ef016db14`,
S90D composite helper
`93dec0d4ce234dbdae288f0747134447771a6680f36e11483b62c90f4820579f`,
and QN shared collector
`c665d6028ae66777ab66d46df1508f94f7da0be6b13d65edace31f6a01afd8fe`.
Both launchers are version 0.4.1; QN service is version 0.4.3. Exact signed packages,
private manifests, reboot traces, outage proof, screenshots and overhead samples
are retained under `~/.local/share/samsung-tv-research/`, especially
`telemetry/shared/` and `telemetry/devices/`. Never publish pairing files.

Extended standby, wake-from-standby and actual streaming playback remain
unverified. These short foreground/startup observations do not establish their
power, lifecycle or performance behavior.

### Native Netdata feasibility — 2026-09-21

A bounded S90D trial ran upstream Netdata v2.11.1 without a resident CLR and
streamed 121 charts over verified TLS to an isolated test parent. The trial was
removed; both TVs retain normal managed collection. Automatic native startup
remains unresolved on the shared path. See the [measurements and remaining work](../research/netdata-native.md).

The later [QN90A host-bootstrap pilot](../research/native-autostart.md#host-bootstrap-pilot-and-sdk-recovery)
passed isolated native reconciliation and crash restart, but failed postboot SDK
acceptance. Managed telemetry returned after reboot. The owner's subsequent
reboot restored SDK access; all pilot resources were removed and both managed
production streams verified fresh. No native production cutover was made.

The [QN90A web startup pass](../devices/qn90a/web-startup.md) moved Hub's initial
monitoring preference read after foreground focus plus 1.5 seconds. Loading the
filesystem extension had synchronously blocked JavaScript despite the API's
callback interface. Public preferences, private pairing and bounded retry policy
are preserved. This shared adapter change was deployed and reboot-tested on
QN90A only; the S90D installed package was not changed in this pass.


## Read-only app/process/startup inspector — 2026-10-11

This section records the original shared feature and remains applicable to S90D.
The current QN90A source retires it as described above; the original deployment
and recovery evidence is retained.

The NAS dashboard includes Apps, Processes and Startup views for the selected TV,
with search, paging, process memory/CPU sorting, and explicit age/partial/unavailable
states. No app-control, mutation, shell or root endpoint is exposed. Inventory
is sampled once per minute by the existing signed collector on both runtime targets,
using the existing pinned HTTPS pairing. Ten-second metric sampling and chart IDs
are unchanged. Inventory is latest-only, not a new historical Netdata series.

Apps use fixed SQLite SELECTs against `.pkgmgr_parser.db`, opened strictly read-only,
with a 100 ms busy timeout, 250 ms progress deadline and 1,024-row cap. Global package
and app disabled flags are shown separately. Per-user overrides are not inferred.
Startup shows registered app on-boot and auto-restart flags; these do not enumerate
systemd units, boot helpers or dependency-driven launches. Labels use en_US where
available, then the unlocalized label, then another registered locale.

The process scan reads bounded `/proc/PID/stat` records, capped at 512 rows and 250 ms,
without command lines, environment variables or app data. Exited/inaccessible rows
are counted as skipped. CPU is percent of one core across inventory intervals;
PID start time prevents reuse errors, and first samples/gaps over 150 seconds have
unknown CPU. Process names are not heuristically joined to app registrations.

When the signed sandbox exposes only the collector in `/proc`, the inspector
uses Tizen’s application-manager contexts and read-only runtime memory API. The
service declares the public `systemmonitor` privilege. This fallback is explicitly
labeled as managed app contexts, not a complete system process list. Rows use
app IDs and report unknown CPU/state; memory stays unknown if the broker cannot
supply it. Per-process CPU is calculated only with `/proc` lifetime evidence.

The receiver allowlists every inventory field and bounds requests to 512 KiB.
The collector truncates app rows if needed to keep inventory below 400,000 serialized
bytes. Intermediate metric samples retain inventory only within the same device,
boot and collector session. The dashboard returns only the selected TV’s inventory,
labels snapshots over 150 seconds old stale, and clears rows on device selection.
A disconnected dashboard labels retained rows as the last snapshot. Unknown flags
are never displayed as off. No periodic inventory writes occur on TV flash.

Local validation: both target frameworks compile, collector harness exercises the
actual read-only SQLite query and process parser, receiver tests check inventory
isolation and restart clearing, and browser tests cover search/paging/sort, both
TV selections, unknown flags, hostile labels, mobile layout, pause and outages.
Live rollout evidence is separate from these fixture checks.

Live rollout completed on both TVs on 2026-10-11. Final signed-collector runs:
S90D `20261011T175820Z-7afb80d8`, QN90A `20261011T180006Z-cc9bd191`.
The S90D release preserved its installed Hub telemetry adapter; QN90A preserved
its newer installed adapter. No Hub UI or startup routing changes were deployed.
Both read-only verifications reported no drift, fresh current-boot collector
sends and receiver ingestion. Live inventories contained 564 S90D and 444 QN90A
app registrations, plus approximately 66 and 58 managed app processes respectively
(the process counts naturally change). Both devices use the partial managed-app
fallback, with RSS available and CPU/state explicitly unknown.

The initial shared update exposed an existing site-specific Netdata origin that
was absent from the public source default. Private `nas.netdata_url` now renders
that setting during deployment. Shared dashboard recovery run
`20261011T180245Z-29dfd7e1` restored history; all nine chart APIs returned data on
both TVs. The live browser smoke test passed device switching, six rendered
charts, all ranges, pause, keyboard inspection, mobile width, stale/outage states
and API restrictions. Separate live inspector checks passed app search, process
memory sorting and startup views for both TVs; desktop/mobile captures were
visually reviewed. No reboot or physical playback acceptance was performed.

Recovery artifacts and immutable release sources are private under
`~/.local/share/samsung-tv-research/inspector-release-20261011/` and the existing
setup run directory. Runs before the Netdata configuration update require the
private pre-change site file `site.pre-inspector-netdata-20261011.json` because
NAS settings participate in recovery binding. The final dashboard configuration
run uses the current site file. Pairing, compose and historical data were retained.
