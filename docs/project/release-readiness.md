# Combined release candidate — 2026-10-19

Status: locally validated experimental source candidate on `codex/release-candidate`. Combines
public main `83906b4`, release preparation `4a2325a`, and native worker/restart work
`85ba4ab` in merge `0ae6a29`. No push, signing, TV/NAS contact or deployment is part
of this reconciliation. Prior branch test/device results below are historical;
they do not validate this combined source state.

## Supported scope and limits

- Existing signed web Hub and experimental QN90A native launchers remain intact.
- QN90A basic native telemetry uses the existing managed settings adapter and
  setup journals. Continuous QN90A inspection is retired. S90D keeps its existing
  collector/inspector. The new QN90A telemetry/install transaction is locally
  tested; its hardware acceptance remains separate.
- Experimental native root worker includes bounded operations, saved-job
  preservation, managed return, interrupted-transition recovery and SDK rescue.
  Keep the small .NET entry bridge, firmware runtime, packaged managed fallback
  and captured rollback packages. New preparations remain disabled and managed
  by default; this merge does not promote native selection.
- Earlier native-selected 0.7.52 trials passed bounded operations/recovery on
  both models. QN90A passed maintenance restart; S90D passed the corrected wait
  for the old WRT host to exit (about 115 seconds). The combined candidate is not
  deployed. Clean boot, standby/power interruption, unattended restart reliability
  and a complete 24-hour endurance run on the current version remain open.

## Reconciliation and simplicity tracker

- [x] Merge both branches, retaining timing/authentication assertions in the one
  test conflict and both changes to transport/runtime guards.
- [x] Preserve the existing setup engine, durable receipts, identity/hash checks,
  no-replay behavior, managed return and independent rescue. No new coordinator,
  supervisor, installer or configuration framework.
- [x] Limit ordinary worker source snapshots to required inputs; benchmark,
  observation and acceptance controllers remain research/test tooling.
- [x] Remove `--native-entry-probe` from normal package preparation. Keep its
  builder, source and evidence for explicitly scoped research and keep immutable
  historical recovery packages. Native-only entry and fallback removal are deferred.
- [x] Reconcile current README, changelog and scope; mark old migration/parity
  instructions historical instead of maintaining competing active plans.
- [x] Run native worker protocol/fault tests in the existing Linux native CI job,
  reusing its compiler image. Keep the SDK-free and managed jobs separate; no new
  test framework or job matrix. The disposable native test needs ptrace for its
  guardian; it has no network or device credentials.
- [x] Run combined local setup, JavaScript, managed/native and recovery checks;
  record actual passes/skips and reproducible-build results below.
- [x] Check final diff, documentation links, workflow syntax and publishable-tree
  privacy; preserve the original branch tips and private recovery inputs.

## Local validation of the combined candidate

Validated on 2026-10-19 with Python 3.14 and Node 22.23.3 on macOS, plus
disposable network-isolated Linux containers. Logs and the non-Markdown input hash
map are ignored under `test-results/release-candidate/`. The source/configuration
digest is `4f3ffde81345a01f673de8194ba6618f5098881478fde4b308554f13ecbe4ce3`.

| Boundary | Local result |
| --- | --- |
| Setup/recovery Python suite | 668 discovered: 443 passed, 225 platform/integration skips; .NET blocked and unused, private toolkit/state absent |
| JavaScript/browser on Node 22 | 612 discovered: 434 passed, 178 Linux/integration skips; .NET blocked and unused |
| Linux worker, parity, files, retained records, pidfd and restart script | 89 passed; worker built with ASAN/UBSAN and fault controls |
| Linux acquisition, SDK rescue and cross-boot/startup recovery | 35 passed |
| Real-process restart and managed/native/managed rehearsal | 37 restart cases and six rehearsal cases passed; zero skips |
| New CI native-worker command | 49 passed, one mount-dependent storage case skipped; that case passed in the separate mount-capable worker run |
| Receiver / collector | 22 receiver tests and 16 native collector tests passed |
| WebView | 61 Python tests passed, two Linux-only skips; shim and diagnostic JavaScript checks passed |
| Managed compatibility | Settings adapter, inspector scope, 18 boot-relay scenarios and root-worker harness passed |
| Reproducibility | All 42 declared managed assemblies and unsigned web package matched across source paths; ARM launcher embedding matched for both models |
| Native and bridge builds | Six ordinary native components per model built twice and matched; setup/service entry bundles also matched twice for both models (6 KiB setup / 7 KiB service bridge) |
| Review checks | Workflow syntax, restart ShellCheck, changed-document relative links and whitespace checks passed |

The initial Python run overlapped a source edit and hit the recovery source guard;
the unchanged-source rerun and all 19 focused S90D recovery tests passed. The first
native CI trial lacked ptrace permission; the corrected disposable-container
command passed without changing runtime guards. Existing SQLite ResourceWarnings
remain; neither was hidden by relaxing a recovery check.

The tracked-tree privacy audit found no matches in 789 inspected text files.
Gitleaks on the source-only snapshot reported ten generic-key matches: manual
review found only 64-character SHA-256 file hashes (including the two existing
passwd-file hashes and eight source/API-file hashes). No credential was identified.
These are limited scanner/review results. Ignored binaries, logs and generated
keys are outside the proposed source commit. Historical research and immutable
private recovery inputs were not removed or rewritten.

Local validation does not establish TV-library compatibility or hardware lifecycle
acceptance. The exact combined candidate has not run in hosted CI or on either TV.

## Before merging or publishing

Review the final combined diff and obtain hosted CI on the exact proposed commit.
Keep experimental labeling and outstanding hardware limits in the release notes.
Hardware acceptance requires a separately authorized session using the existing
[telemetry guide](../guides/native-telemetry.md),
[agent recovery procedure](../../research/autonomous-root/README.md) and
[hardware checklist](../guides/hardware-acceptance.md). Do not rebuild or delete
artifacts referenced by existing recovery journals. Full .NET removal, new boot
architectures and S90D native telemetry/graphical ports are outside this release.

---

# Earlier release-prep review — 2026-10-19

Scope: an **experimental source merge**, not stable hardware acceptance. The
release branch preserves the locally tested installer/telemetry/recovery work in
checkpoint `28c0054` and incorporates public main `83906b4`, including its WebView
launcher and root-agent transfer/native-launcher work. Nothing is pushed or
installed as part of this review. Keep the original checkout for existing recovery
runs: their source guards deliberately reject a different revision.

## Findings tracker

- [x] Reconcile current public main without dropping its third launcher, managed
  root projects, binary transport or worker-readiness checks.
- [x] Run the root-worker managed harness explicitly in the managed CI job;
  SDK-free discovery no longer invokes it. Keep the existing Linux worker job.
- [x] Add the collector's host build/tests to the existing Linux native job;
  no new CI framework, vendor libraries or deployment steps.
- [x] Fix Node 22 TLS test reuse: generate a localhost certificate and use normal
  hostname verification. A per-request verification override isolated sockets on
  Node 22. Preserve authentication, replay and connection-limit assertions.
- [x] Clarify QN90A basic telemetry versus S90D inspection, pure-C installer versus
  WebView tools, and preference retention. Historical release decisions below
  remain dated evidence, not current merge blockers.
- [x] Validate committed candidate `e16616d` in a clean checkout and scan the
  publishable tree/history. The follow-up commit records documentation only.

## Local validation evidence

Executable source/CI candidate: `e16616d`; the follow-up record changes Markdown
only. Logs are private, ignored files under `test-results/public-release/`.

- Python 3.14: 325 setup tests passed with a failing `dotnet` stub first on PATH.
  The stub was never invoked. The receiver passed 22 tests.
- Node 22.23.3: all 118 tests passed, including the corrected mutual-TLS/replay
  test. Both separate WebView JavaScript checks passed.
- WebView Python tests: 63 discovered, 61 passed, two Linux-only cases skipped on
  macOS. The separate Linux root-worker harness passed its process-group
  cancellation, timeout, reboot-interruption, transfer and protocol checks.
- Managed checks: settings adapter, QN90A inspector exclusion/S90D cadence,
  18 relay scenarios and explicit root-worker harness passed. Source-built ARM
  launcher embedding reproduced for QN90A and S90D.
- Native collector: host build and all 16 tests passed in network-isolated Linux
  containers. This exercises the host collector, not TV library compatibility.
- All 42 declared managed assemblies and unsigned web packaging reproduced across
  source paths. `actionlint`, changed-document links and `git diff --check` passed.
- A source-only clone of the committed branch passed fresh `npm ci`, Node 22,
  receiver, WebView and web reproducibility checks with private toolkit/state
  absent. The explicit managed worker harness also passed there. Python 3.12
  setup validation passed all 325 tests in a new virtual environment with pinned
  requirements and .NET blocked. Its first attempt without those requirements
  failed on missing `lxml`; the correctly provisioned rerun passed.

The tracked-tree privacy heuristic found no matches in 491 source files. The
source archive excludes ignored/private files. Gitleaks 8.30.1 found the same two
existing passwd-related SHA-256 file hashes in both source and reachable history;
manual review confirmed hashes, not credentials. The scoped history heuristic
found two room-label fixture strings already reachable from public main and only
public GitHub/noreply author addresses. No history was rewritten. These are
limited scanner/manual-review results, not a guarantee that every disclosure risk
has been detected. No new sensitive artifact or identity was found.

## Device validation boundary

Read-only checks on both enrolled TVs matched physical identity, exact firmware,
architecture, managed runtime/host hashes and the protected root launcher hash.
Both pinned agents were connected and ready; signed Hub and telemetry package
paths were present. Both had the managed `enabled` marker, no `native-enabled`
marker, and no loaded native telemetry unit. No setup journals were pending.
Raw identities, credentials and command evidence remain in private storage.

These observations validate the existing baseline and transport compatibility.
They do **not** validate this candidate's native installation, opt-in/out, reboot
startup or rollback on hardware. No TV/NAS deployment, restart, power transition
or telemetry handoff was performed. S90D retains its managed collection and
inspector path; a native S90D telemetry rewrite is outside this candidate.

Before merging, review this branch's final diff and obtain a passing hosted CI
run on the exact proposed commit. Hosted CI is still pending; this local review
performs no push. Keep the experimental label and hardware limits in the release
notes. Before calling the native integration hardware-accepted, complete the
existing [native telemetry checks](../guides/native-telemetry.md) and
[hardware acceptance procedure](../guides/hardware-acceptance.md) with separately
authorized install/recovery/reboot trials. The later combined candidate includes the separately developed native root
worker. Settings, boot and S90D telemetry rewrites remain deferred.

# Historical publication scope — 2026-10-11

Couchroot is published as experimental source with 0BSD licensing for original
work and retained upstream notices. The owner authorized a fresh source snapshot,
not the old development history. See [publication review](publication-review.md),
[licensing](../../LICENSE-STATUS.md) and [Security](../../SECURITY.md). Historical licensing
and publication decisions below are superseded; incomplete hardware acceptance
and portability work remain limitations, not completed tests.

# Public release readiness — 2026-09-20

Historical status (2026-09-20): **not ready for a stable release**. Work starts from main `7af6886`. No TV/NAS
mutation, live reboot, push, release publication or history rewriting was used
for this preparation. Historical hardware observations remain separate from the
new orchestration's automated tests.

**2026-09-21 update:** the [shared telemetry rollout](../guides/telemetry.md#service-unification-validation--2026-09-21)
subsequently validated Hub/service deployment and automatic startup after full
reboots on both TVs, plus recovery from an initial failed S90D install. The
remaining full-setup/recovery acceptance matrix is still open. The preparation
record below describes the earlier 2026-09-20 state.

## Implemented

- Removed personal addresses, local user paths, room names and historical boot
  UUIDs from current source, examples, fixtures and evidence. Historical scripts
  now contain documentation addresses and are outside the public setup path.
- Split exact model/firmware safety profiles from site addresses, physical TV
  UUIDs, SSH configuration, NAS endpoints and per-user signing trust. There is
  no default personal destination, embedded signer identity or implicit first-run
  telemetry opt-in. Model and protected-package guards remain mandatory.
- Replaced the CLI's untracked S90D dump-collector dependency and private Python
  imports with checked-in wrappers and a source-built bounded namespace runner.
  Both models retain separate namespace selection and resource guards. Temporary
  keys are generated locally; private keys are never pushed to the TV.
- Fixed the toolkit requirements path, pinned lxml and the build SDK, added offline
  dependency checks, deterministic native/path-independent builds and a build
  manifest. Removed implicit searches through historical private artifact trees.
- Bound journals to physical destination/site/trust, moved source checks before
  reconciliation side effects, blocked applying a run after rollback starts,
  preserved later edits and retained newly installed apps for manual review.
  Missing managed-app reinstall packages no longer prevent other configuration
  from being restored. Added per-file NAS checks and temporary-file protections.
- Hardened archive verification against symlink/noncanonical entries and DTDs;
  redacted preference extensions and unexpected tool exceptions from console/JSON.
- Added offline CI, failure-injection/identity fixtures, installation/support
  matrix, recovery/security guidance, development version and changelog.
- Added schema 2 recovery for saved choices and the ownership ledger: mutations
  stay pending until both local records are durable; resume can finish locally
  without contacting the TV. Rollback restores earlier local records and refuses
  later edits. Old journals require their original checkout.
- Added interrupted inverse reloads and digest-checked run-specific staging
  recovery. Unknown/partial staging bytes and symlinks remain for inspection.
- Supervised reboot observations share one remaining host deadline, including
  nested SDK/root/NAS tools. Timeout stops observation processes and records
  unverified startup/uncertain diagnostic cleanup; no launch or reboot retry is
  introduced. Snapshot/request transport budgets precede the observation budget.

## Privacy audit (redacted findings)

The audit inspected tracked working-tree files, all 37 reachable commits available
at task start, 385 unique reachable file blobs, and author/committer metadata.
The tree included source, documentation, fixtures, inventory and two PNG icons.
The history heuristic found 99 file versions containing personal addresses, three
containing personal filesystem paths, and 49 containing UUIDs (historical boot
identifiers and fixtures). Author/committer metadata contains one personal name
and email identity. Signing-profile names and public certificate fingerprints in
the old profiles also identify the original installation; they are not private
keys. The private remote URL is local Git configuration, not source content.

No private-key blocks, obvious long credential literals, tracked signing
containers, database archives, MAC literals or DUID/serial literals were detected
by these checks. This is a **limited negative result**, not secret-scanner or
manual-disclosure certification. Boot timelines, exact firmware hashes, app
inventory, screenshots/artwork and exploit details still need owner disclosure
review. No credential rotation is prescribed without evidence of exposure.

Current examples/evidence use synthetic identities; they must not be mistaken for
raw hardware captures. The latest-tree heuristic scan is clean. Old values remain
in Git history and author metadata. **Owner decision required:** authorize a
separately reviewed history sanitization or a clean public source export, and
choose public author metadata. Neither action was performed. Audit tooling prints
only paths/categories/counts, never matched values:

```sh
python3 scripts/privacy-audit.py --check
python3 scripts/privacy-audit.py --history
```

Reachable refs are the audit boundary; unknown remote refs, server backups,
reflogs/dangling objects and earlier copies are not certified. Historical findings
make `--history --check` fail by design. Do not upload raw audit inputs or journals.

## Validation and reproducibility

Local macOS validation uses Python 3.14, the SDK pinned by global.json, OpenSSL and
Chromium. The Python suite, telemetry suite, Node suite and native relay harness
run without device access: **128 Python tests, 14 telemetry tests, 51 Node tests,
and 12 native relay scenarios passed**. All **36 manifested native assemblies**
built successfully. A separate source snapshot in a new directory and
fresh virtual environment passed with toolkit/state paths pointing to empty
locations. Its native manifest matched across source paths after removing Git
informational-version leakage and normalizing temporary compilation paths.

A disposable source-only Linux amd64 container (Ubuntu 24.04, Python 3.12,
`mcr.microsoft.com/dotnet/sdk:10.0.301-noble`) also passed all 128 Python tests,
14 telemetry tests, 12 relay scenarios, all 36 native assembly builds and unsigned
Hub packaging. No private toolkit or historical deployment files were mounted.
All 36 Linux/macOS native hashes and the unsigned Hub package matched exactly.
The Node/Chromium suite was rerun on macOS; Linux browser validation remains in
the unexecuted hosted matrix.

Emscripten 3.1.64 in its upstream container produced identical QN90A saver output
across two source paths. `shaders.js` matches its reviewed digest; **`core.js` does
not**. Reproducibility is established for this compiler output, not equivalence to
the historical binary or hardware acceptance. No profile pins were changed.
`scripts/check-web-reproducible.py` writes hashes and these separate comparisons
to `dist/saver-reproducibility.json`; CI now runs this check. The current core
output must be reviewed and tested before becoming a verified release artifact.

The repeatable check is `python3 scripts/check-reproducible.py`; it compares all
manifested DLLs (including generated model-specific runners and ten QN90A cleanup
variants) and the unsigned Hub package from two paths. It does not certify signed
package reproducibility or S90D vendor-linked renderer bytes.

The checks can also run independently. Web packaging and the Python/Node test
suites do not require .NET. The four managed harness scripts must be run
explicitly; importing them during Python discovery does not execute their tests.

```sh
python3 scripts/check-dependencies.py --component offline
python3 scripts/check-dependencies.py --component web
python3 -m unittest discover -s tests -p '*_test.py'
python3 -m unittest discover -s research/s90d-telemetry/tests
npm ci
npx playwright install chromium
npm test
python3 scripts/check-reproducible.py --component web

python3 scripts/check-dependencies.py --component managed
python3 tests/telemetry_service_test.py
python3 tests/inspector_collector_test.py
python3 tests/qn90a_boot_relay_test.py
python3 tests/root_agent_worker_test.py
python3 scripts/check-reproducible.py --component managed
```

`check-dependencies.py` still defaults to `--component setup`, which requires the
pinned SDK for full setup. `--component prepare` checks Python/platform only;
native source compilation and preference conversion additionally need Docker
and Node respectively. These checks do not validate device enrollment.

CI runs four jobs on Ubuntu 24.04, with Python 3.12 and Node 22 where needed,
plus one focused macOS host check:

- `web-and-offline`: dependency/privacy checks, Python setup and recovery tests,
  telemetry receiver and WebView tests, Node/Chromium tests, and unsigned web
  packaging reproducibility. It blocks `dotnet` calls so these paths stay SDK-free.
- `managed`: the four C# harnesses and managed cross-path builds using the pinned
  .NET SDK. This covers the settings adapter, small bridges and retained recovery
  fallback; native operation does not make those checks obsolete.
- `root-native-launcher`: ARM launcher builds, native collector tests, native
  worker protocol/fault/recovery tests, and the Linux managed launcher harness.
- `qn90a-web-saver`: the pinned Emscripten reproducibility check.
- `macos-setup`: macOS 14 ARM64/Python 3.12 setup, installer and UI-deploy tests.

The native job discovers `native_*_test.py` with the host worker, fault hooks,
acceptance controller and I/O-delay interposer enabled in an isolated Linux
container. Mount-dependent storage cases and extended lifetime cases remain
separate local checks; CI is not endurance or hardware acceptance.

Pull requests and pushes to `main` run the suite. Feature-branch pushes do not
repeat the PR run; use the manual workflow trigger for a branch without a PR.
New commits cancel outdated runs for the same PR or branch. There is no broad OS
or Python-version matrix: broader macOS and newer-Python compatibility remain
local release checks. The focused macOS job covers the supervisor regression
where a zombie-group `EPERM` masked the observation deadline.

Build manifests include only declared outputs, excluding stale DLLs from other
research builds. Reports are `dist/reproducibility-web.json` and
`dist/reproducibility-managed.json`; the default combined command retains
`dist/reproducibility.json`. No secrets or vendor libraries are supplied, and no
workflow signs, deploys or publishes. The S90D GLES-linked renderer is excluded
from public CI pending a reviewed vendor-library arrangement and reproducible
compiler/sysroot recipe.

## Prioritized blockers and owner acceptance

1. **P0 — Disclosure and licensing decisions.** Choose project license and confirm
   provenance/rights for original code, icons, shaders, mesh data and any third-party
   material. Approve the public scope of the privilege-chain details. Decide how
   historical identifiers and commit author identity will be handled; changing the
   current files alone is insufficient. Establish/test a private security-reporting
   contact and maintenance policy. See LICENSE-STATUS.md and SECURITY.md.
2. **P0 — Physical apply/recovery proof on both exact TVs.** The new CLI and rebuilt
   root runner need owner-authorized tests from known recoverable states: baseline
   root invocation is read-only, privileged invocation runs once, resource hashes
   and labels remain intact, cleanup succeeds, ordinary apply is correct, second
   apply is a no-op, and interruption before/during/after each mutation reconciles
   without duplication. Exercise unreachable TV, timeout, host process death,
   corrupt/missing backup, full state disk, concurrent changes and rollback restart.
   Test recovery after a complete mutation but before saved choices/ledger writes.
   Local locks only coordinate one management host; independent-host mutation is
   unsupported. Do not conduct destructive interruption tests without recovery media.
3. **P0 — Signed installation and application recovery.** Prove independently
   enrolled author/distributor pins, device authorization, first install, forward
   updates, certificate renewal and signed forward recovery on each TV. Verify
   that in-place updates preserve newly edited app data. Confirm retained new apps
   and removed optional apps are accurately reported for manual recovery. App
   Store reinstall is an owner acceptance step, not a file-copy rollback guarantee.
4. **P1 — Fresh NAS provisioning and shared recovery.** The adapter still requires
   an existing TrueNAS app and two-device registry. Supply a reviewed provisioning
   path and isolated credentials/certificate enrollment for a genuinely new NAS.
   Physically test receiver/dashboard restart and partial-batch restore while the
   other TV continues ingesting; confirm chart history, volume ownership, registry,
   credentials and custom endpoints remain intact. Do not replay historical compose.
5. **P1 — Native artifact/toolchain portability.** Run the hosted CI matrix.
   Review why the reproducible Emscripten 3.1.64 core differs from the previously
   reviewed digest and verify generated saver bytes on QN90A. Establish a clean S90D
   ARM compiler/sysroot recipe that reproduces the reviewed renderer digest with
   user-provided GLES libraries. Review supported hosts, old TV runtime maintenance,
   dependency licenses/notices and exact dependency provenance before bundling.
6. **P1 — End-to-end hardware experience.** After explicit owner-authorized full
   reboot, observe a new boot ID and autonomous startup without launching Hub.
   Test Home and both QN90A AirPlay returns, five-minute Hub saver, S90D splash/
   screensaver, streaming, standby/wake and Samsung Home fallback. Verify reboot
   observation deadlines under slow/disconnected transport and confirm TV-side
   diagnostic cleanup after forced host cancellation. Host nested-process deadline
   coverage now passes; it does not prove remote cleanup. Record configuration and runtime
   acceptance separately, with redacted evidence.

## Release checklist

Use the [staged hardware acceptance procedure](../guides/hardware-acceptance.md) to prepare
specific owner-authorized tests. None of its mutation steps were executed here.

Resolve every P0 before a public candidate; either resolve P1 items or explicitly
reduce and label supported scope. Re-run audits against the exact publication
commit/export, run hosted CI, review the diff, record model/firmware hardware
acceptance, freeze dependency/build manifests, review third-party notices, and
inspect the proposed archive. It must exclude site/trust, logs, journals, tokens,
certificates/keys, signed packages, raw evidence, extracted resources and vendor
binaries. Confirm version/changelog, security-report route and recovery guide.
Only then request explicit owner authorization to push or publish. Nothing here
constitutes that authorization.
