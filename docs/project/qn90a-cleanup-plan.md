# QN90A cleanup tracker

Created: 2026-10-19. Status: complete; historical telemetry cleanup record.
The [combined release candidate](release-readiness.md) tracks subsequent branch
reconciliation and validation. Results below apply to the original cleanup state;
they are not current candidate or hardware acceptance.

Goal: make the existing QN90A basic-telemetry work easier to understand, test and
maintain. Follow the [accepted scope](dotnet-deprecation-plan.md). This is a local
cleanup pass, with no TV/NAS access, deployment, reboot or hardware acceptance.

Mark each item complete only after its completion check passes. Add a short dated
result and test/log or commit reference under the item; leave blocked work open
with its reason. Use this file as the only cleanup tracker.

## Work, in order

### 1. Correct the current documentation

- [x] Update the [collector README](../../research/native-telemetry/collector/README.md):
  journaled installation and bootstrap integration exist locally; hardware
  acceptance and deployment remain outstanding. Remove contradictory statements
  that installation is unavailable or that integration is still unimplemented.
- [x] Keep [native telemetry](../guides/native-telemetry.md) as the detailed
  installation/recovery guide. Other current docs should summarize and link to it.
  Keep dated trial results clearly historical and preserve recovery commands.

**Complete when:** current docs distinguish implemented, locally tested, deployed
and hardware-accepted behavior consistently, with working relative links.

Result: 2026-10-19: corrected collector/current monitoring status, retained the historical trial/recovery workflow, and linked the integration guide. Relative links validated.

### 2. Shorten the active plan

- [x] Condense the active portion of the [scope document](dotnet-deprecation-plan.md)
  to accepted scope, completed implementation, remaining QN90A hardware checks,
  and deferred work. Remove completed tasks still phrased as future instructions.
- [x] Keep useful original findings in a clearly historical section of that same
  file. Link to detailed guides rather than repeat their procedures.

**Complete when:** the remaining work is clear without reading the original
review. Full .NET removal and the other rewrites remain deferred.

Result: 2026-10-19: reduced the scope document to current implementation, remaining acceptance, deferred work and a short historical review. Relative links validated.

### 3. Reduce repeated CI work

- [x] In [validation CI](../../.github/workflows/validate.yml), run browser tests
  and web reproducibility checks once per OS, on one selected Python matrix
  version. Gate their Node/Playwright setup too; use simple step conditions.
- [x] Preserve Python-version/OS coverage for Python-dependent checks, the
  SDK-free tooling guard, and the separate managed tests/build checks.

**Complete when:** review of the expanded matrix shows each required check still
runs, with web checks once per OS. Run affected commands locally; record hosted
CI as unverified until a real run passes. Do not push merely to exercise CI.

Result: 2026-10-19: step conditions now select Python 3.12 for web work on each OS. `actionlint` passed; expanded matrix recorded in `test-results/qn90a-cleanup/ci-matrix.log`. Local web prerequisites, all 101 JavaScript tests and cross-path web reproducibility passed with .NET blocked. Managed harnesses and cross-path builds also passed. Logs are under `test-results/qn90a-cleanup/`; hosted CI remains unverified.

### 4. Clarify the existing-staging check

- [x] Replace the directory passed to file hashing in
  [telemetry preflight](../../tvsetup/native_telemetry_io.py) with an explicit
  staging-directory check. Keep refusal of existing or unsafe staging and direct
  the owner to the original run. Do not add automatic deletion or adoption.
- [x] Add focused local cases for absent staging, an existing directory and a
  symlink/invalid path. Preserve explicit resume and rollback behavior.

**Complete when:** failures are understandable and occur before mutation; the
focused cases and `python3 -m unittest discover -s tests -p '*_test.py'` pass.

Result: 2026-10-19: explicit path inspection replaces directory hashing. All 18 focused install/recovery tests passed, including absent/existing/invalid staging, symlink parents, no mutation and explicit retry. See `test-results/qn90a-cleanup/preflight.log`; all 311 setup tests passed with .NET blocked (`setup.log`). The existing journal/recovery cases remain intact.

### 5. Make the tested working state reviewable

- [x] Inventory modified and untracked files. Group related dependency/CI,
  installer/telemetry, and S90D recovery work without dropping existing changes.
  Keep interdependent changes together rather than forcing arbitrary splits.
- [x] Prepare coherent commit groups with their validation evidence. Include
  required source/tests/docs and exclude secrets, generated binaries and logs.
  Commit/publish is separate from writing this plan; no push or deployment here.

**Complete when:** every intended file is accounted for, groups have clear scope
and dependencies, and the final diff passes `git diff --check` and applicable
checks. Recorded test results identify the source state they cover.

Result: 2026-10-19: all 71 modified/untracked files are assigned exactly once in `test-results/qn90a-cleanup/commit-groups.json`. The value-redacted privacy scan covers tracked and nonignored untracked files and found no matches (`privacy.json`). All applicable local checks passed, relative links passed in all 22 changed Markdown files, and `git diff --check` passed. The prepared groups and exact tested source are recorded below. No staging, commit or push was performed.

## Keep it simple

- Make direct edits in existing files. Add no framework, capability registry,
  supervisor, installer, backend, generic test harness or new configuration layer.
- Keep journals, captured inputs, identity/hash checks, shared leases, private
  preferences, managed fallback and fault-injection tests. Preserve S90D inspector
  support and executable paths needed by existing recovery runs.
- Avoid cosmetic source moves, broad renaming, manifest/schema changes and
  unrelated refactors. Do not prune staged artifacts or recovery backups.
- Add tests for changed behavior; do not add tests that merely mirror formatting
  or implementation details. Reuse existing fixtures and run affected checks.
- If an item grows into a rewrite, record the concrete blocker and defer the
  expansion. More code or fewer files alone is not evidence of improvement.

Stop when the five completion checks are satisfied and results are recorded.
Hardware acceptance remains a separate, explicitly authorized activity.

## Prepared review/commit groups

These groups account for the entire existing working diff, including work that
predates this cleanup. Exact paths are in `test-results/qn90a-cleanup/commit-groups.json`.
Keep each group's source, tests and docs together. Evidence below validates the
combined working state; each intermediate commit needs its own applicable checks.

| Order | Group | Files | Dependency and evidence |
| --- | --- | ---: | --- |
| A | Build prerequisites, transport guards and CI | 12 | Foundation; setup suite, SDK-free web checks and managed reproducibility. |
| B | Installer, QN90A telemetry, settings and inspector retirement | 39 | Depends on A; setup/recovery, receiver, browser, managed harness and native collector checks. |
| C | S90D boot assessment and existing-engine recovery | 9 | Depends on A; S90D recovery cases in the setup suite. Keep its source and dated evidence together. |
| D | Shared entry-point docs, scope, changelog and this tracker | 11 | After A–C, so shared instructions describe the complete source state; links and diff checks. |

Group A includes `tvsetup/operations.py` with the transport guard changes. Group B
keeps the native installer and telemetry transaction together because they share
action ordering, capture and recovery. Group D holds the cross-cutting README and
owner/setup guides rather than splitting their interdependent edits into hunks.
Generated binaries, private state and raw logs stay outside these groups.

## Local validation record

Date: 2026-10-19. Logs and the exact non-Markdown source/configuration hash map are
in `test-results/qn90a-cleanup/`. The `tested-source.json` aggregate SHA-256 is
`46029d51d298429e5977d3872229c04eb45cf1a4f5a413c5eef073f693b5c9ef`.
The map includes tracked and nonignored untracked inputs; Markdown is excluded so
completion notes can be updated after tests. The final documentation is checked
separately. No device credentials or raw device evidence are included.

Validation completed on 2026-10-19:

| Check | Result | Local evidence |
| --- | --- | --- |
| Focused telemetry installation/recovery | 18 passed; includes new staging cases | `preflight.log` |
| Full setup suite, including S90D recovery | 311 passed with .NET blocked | `setup.log`, `dependencies-offline.log` |
| Receiver | 22 passed | `receiver.log` |
| Browser/JavaScript | 101 passed with .NET blocked | `npm.log`, `dependencies-web.log` |
| Web packaging across source paths | Reproducible with .NET blocked | `web-reproducible.log` |
| Managed adapter, inspector scope and boot relay | All harnesses passed | `adapter.log`, `inspector.log`, `relay.log` |
| Managed builds across source paths | Reproducible | `managed-reproducible.log`, `dependencies-managed.log` |
| Native collector host build and tests | Build passed; 16 tests passed in network-isolated Docker | `native-build.log`, `native-tests.log` |
| Workflow syntax and matrix review | `actionlint` passed; web work once per OS, Python coverage retained | `actionlint.log`, `ci-matrix.log` |
| Links, privacy and whitespace | 22 Markdown files passed relative-link checks; no privacy matches; diff clean | `links.log`, `privacy.json`, `diff-check.log` |

The source hash map was rechecked after tests: no non-Markdown input changed.
`working-tree.json` captures final hashes/modes for all 71 files in the review
inventory, including documentation. These local records and raw test logs are
ignored by Git. The setup suite still emits existing SQLite ResourceWarnings;
there were no test failures. Local validation used this macOS host; hosted
Linux/macOS CI was not run. No signing, commit, push, TV/NAS contact or deployment
was performed. Existing recovery inputs and private artifacts were not removed.
