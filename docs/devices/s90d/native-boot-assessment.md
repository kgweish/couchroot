# S90D native Hub feasibility — 2026-10-12

**Recommendation: defer the native graphical Hub port, retain web startup, and
measure the physical experience before a boot-path trial.** This assessment and
the subsequent documentation/recovery work used retained local evidence only.
No current TV state was inspected and no boot improvement is claimed.

## What the records establish

Samsung prelaunches `MiniHub001.Hub`. Its first logged event was at 2.639 seconds
in one software restart, an upper bound on process creation rather than a measured
start time. The 2.26-second `/proc` start sample is from a different standby-wake
session; these are not interchangeable boot measurements.

In two instrumented software restarts before the splash fix, the dashboard DOM
rendered at 7.75 and 9.18 seconds. These are software milestones, not panel frames.
The S90D `app_resume` binary waits up to 40 seconds for the native splash's
visibility acknowledgement. The custom Home-ID resource is missing from the
read-only system location, so Samsung's early splash does not acknowledge.
The AT-HUB helper supplies Samsung's existing resource explicitly.

In the retained helper boots, splash spawn was around 19.47–19.80 seconds and
acknowledgement/resume was around 22.16–22.47 seconds. One kernel log places resume
about 1.8 ms after acknowledgement. These are evidence for the splash handoff as
a boot-path bottleneck, not proof of the exact panel-visible or input-ready time.
Roughly 83% of the 22.47-second interval preceded managed-helper entry, and about
88% preceded splash spawn; the assessment's prose rounds the former as time
before splash launch. Do not treat those two endpoints as identical.

The existing chain uses a **patched** `oneservice` cache to start AT-HUB's helper.
The historical splash-only build `4a6fdb3d…` was superseded by telemetry composites.
A later retained boot has composite `879e602d…` and resident AT-HUB; the profile's
`93dec0d4…` is an expected build, not confirmation of today's installed helper.

## Corrections and limits

- S90D systemd has boot-idle demotion, but static analysis identifies an exemption
  for units WantedBy sysinit/basic/starter.target. AT-HUB is pulled in by
  starter.target, so its policy is expected to be SCHED_OTHER. Runtime policy for
  the helper and splash was not sampled; a scheduler change is not justified yet.
- ISP boot-mode keys exist on S90D. The retained session used `vc-service`, so the
  QN90A native guard would deny startup. The observed compositor socket also
  differs from that guard's required per-user path. Other graphics/input
  assumptions remain unverified; Samsung would still resume the web Home app.
- The assessment's statement that no native headless project process has run on
  S90D conflicts with the later [native collector validation](../../research/native-service-research.md).
  Preserve that headless execution evidence. It does **not** validate a native
  graphical Hub, its input ownership or its boot timing.
- No synchronized mains-power-to-Hub, panel-visible, first-key-response or
  standby-wake timing baseline exists. Acknowledgement means the **splash** became
  visible, not that the Hub is visible or usable. No native speedup is established.

## Next measurement and recovery gates

Future authorized work must first read back the actual helper, cache/table,
markers and firmware. Then record separate software-restart, mains-boot and
standby-wake cohorts, with panel video and first remote response alongside
software acknowledgement/resume/foreground timestamps. Do not pool boot types.

Only if the splash handoff tracks visible and usable Hub time should an earlier
splash launch or Samsung's splash scheduling policy be tested, one change at a
time. Neither trial is implemented or authorized here. Use a fresh
[recovery checkpoint](../../guides/s90d-boot-recovery.md) for each trial. It restores
the exact prior composite or patched cache; the old splash-only rollback is not
compatible with that goal. A checkpoint restores next-boot configuration, not an
already-running helper or overlay.

## Evidence references

Private sources remain outside Git under the research toolkit:
`s90d-native-hub-assessment-20261012/{REPORT.md,EVIDENCE-LEDGER.md,HARDWARE-VALIDATION-PLAN.md}`.
The summary above incorporates these sources with the stated headless/timing
corrections; it does not copy raw firmware or worker transcripts.

| Evidence | Location / identifier | Supports |
| --- | --- | --- |
| S1/S1a/S1b | S90D systemd SHA256 `d7dc5807…`; `exec_child.constprop.0`; REA `ev_aeba4c2c…`; starter.target.wants listing | Static scheduling exemption |
| S2/S4 | `app_resume` SHA256 `31fab93b…`, main `0x10d64`, resume `0x112a4`; REA `ev_14b0738c…`, `ev_75e65fea…` | Splash wait, AUL resume; no direct app_ready wait |
| S3 | `boot_splashscreen` SHA256 `da40cc20…`, `VisibilityChangedCb` `0x1b2f8`; REA `ev_29d30434…` | Acknowledgement on splash visibility |
| Recorded handoff | `dumps/20260920T174130Z/{boot-kernel.log.gz,splash-postboot.txt}` | 22.467-second acknowledgement and 22.468-second resume |
| Composite helper | `dumps/20260920T183449Z/result.txt` | Composite hash, resident helper, second handoff |
| Earlier render samples | `analysis/boot-inventory/{trial1,trial2}.json` | DOM timing, distinct from physical visibility |

Full hashes, evidence IDs and uncertainty labels are retained in the private
ledger. The [splash investigation](splash-acknowledgement.md) remains the historical
deployment record, not a current live-state assertion.
