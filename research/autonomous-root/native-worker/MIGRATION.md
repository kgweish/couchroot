# Native agent parity and .NET retirement plan

Status: owner-authorized native rollout, 2026-10-19. The original review below used baseline
`f3f911e`, including runtime changes `43ec7bc` and `f9e6d0c`. Historical progress
entries retain their original qualification limits; use the current snapshot
below for installed state. The plan itself does not authorize device changes.

## Current qualification snapshot

Both TVs now run signed **0.7.52 with the native worker selected**. The 7 KiB
`NativeEntry.dll` remains the small .NET capability-entry bridge. No old managed
root-agent process remained at final acceptance. The firmware runtime, packaged
managed fallback and signed rollback packages are retained for recovery.

Both installations verified all 86 packaged entries and preserved enrollment,
protected-file hashes and original saved jobs. Bounded public native operations,
selected-native disable/enable, and return to managed passed on both models.
Temporary test jobs were forgotten and final SDK rescue timers retired unfired.
QN90A also passed the service-restart check. S90D's original quick restart remains
a failed trial. Follow-up reproduced the failure before helper cleanup: the new
worker reused the old WRT host while it was still shutting down. The corrected
SDK maintenance procedure waits for that host to exit before launching once.
Stop, wait and launch took about 115 seconds on unchanged 0.7.52; a different WRT
host and native worker passed readiness, state preservation and stability checks
after cleanup. See [restart evidence](s90d-service-restart-fix-results.json).

A real S90D teardown interruption on 0.7.51 exposed a resume-path gap. Version
0.7.52 reuses the existing receipt reconciler before native activation, without
replaying launch or shutdown. Local failure and ownership tests passed; normal
0.7.52 migration and recovery passed on both TVs. Original uncertain requests
remain recorded, not rewritten as successful.

See [rollout evidence](native-bridge-rollout-results.json). No reboot, standby,
interrupted-power or new endurance trial was performed. S90D now has one accepted
same-boot maintenance restart; unattended restart reliability and clean-boot
qualification remain open. Keep the bridge and fallback;
a native-only entry rewrite and fallback removal are deferred. This rollout changes
the root agent only; Hub, telemetry/settings and NAS services were not redeployed.

## Release candidate scope

The combined candidate is tracked in [release readiness](../../../docs/project/release-readiness.md).
Keep the small entry bridge, managed fallback, settings adapter, durable journals
and independent SDK rescue. Do not make native selection the installation default
or remove fallback while lifecycle qualification is open. Native-only capability
entry and further runtime rewrites are deferred, not release prerequisites.

`python3 -m tvsetup.native_components --model qn90a --output NEW_DIRECTORY`
(also `s90d`) builds ordinary components without .NET. This is not an installable
native-only agent. Signed packages still require managed builds. Installation
and updates accept `--native-bundle` for setup acquisition through the existing
engine; uncertain native requests are never replayed through managed fallback.
See [usage](../../native-root-acquisition/README.md#build-and-use).

## Historical qualification and implementation notes

The entries below describe their original revisions, states and limits. They
are evidence, not an active work queue or the current installed state. In
particular, the owner paused the earlier endurance trials and cleaned their
controllers; neither shortened run qualified 24-hour endurance. Use the snapshot
above and release-readiness tracker for current scope. Preserve original failed
and uncertain trials without rewriting them as successful.

S90D recovered from its incomplete service restart after the owner reapplied the
Developer Mode Host PC setting without restarting. SDK inspection preserved the
original submitted request without replay, and a fresh guarded launch restored
managed readiness on the same boot with enrollment, jobs and protected hashes
unchanged. Its new rescue was retired unfired and owned staging was removed. See
[service recovery evidence](s90d-service-recovery-results.json).

A subsequent authorized native-selected reboot exposed an absent-unit startup
failure in signed 0.7.49. The bootstrap acquired root, but the launch script's
unconditional `systemctl stop` failed because the old transient unit was absent.
Public native admission stayed closed. The postboot rescue fired successfully
and restored host SDK access. The owner then restarted S90D again; identity and
firmware were reverified and the original receipt/job hashes still matched.
The interrupted state is archived privately. Signed 0.7.50 now repairs that state:
selected-native startup and interrupted-bootstrap reconciliation completed on the
owner's later boot, followed by a verified managed return. Original receipts and
saved job records survived; enrollment and protected files matched, and deployment
and return rescues retired unfired. All 86 installed entries were verified. This
qualifies recovery of actual cross-boot state after maintenance, not a clean boot
with 0.7.50 already installed. The failed original reboot remains rejected.
QN90A's endurance remains active and unchanged. See
[absent-unit failure and fix evidence](native-startup-absent-unit-results.json).

S90D's first endurance invocation after repair was refused before migration:
the private harness admitted a completed return, but the production API allows
only one migration per coordinator. No collector or quiet job started; selection,
jobs and enrollment matched, and its rescue retired unfired. A separate guarded
service restart with a retained launcher restored a fresh managed coordinator
on the same boot. Preservation and cleanup passed before retiring that rescue.
A new immutable invocation now runs the native worker, quiet job and collectors;
its admission requires no prior native operation. The production guard is
unchanged, and the failed invocation remains separate. See
[coordinator admission evidence](service-coordinator-endurance-admission-results.json).

Before the reboot trial, S90D passed the corrected observer's five-second probe with
five samples, no skipped intervals, complete kernel capture, successful retained
unit exit, owned cleanup and an unfired retired rescue. Its first sample arrived
0.439 ms after capture start. This qualifies the short probe, not endurance. See
[S90D observer admission](observer-s90d-admission-results.json).

S90D's endurance trial stopped after 96.444 minutes and 34 verified windows:
collector 34's first sample arrived 1.105 seconds late, leaving one skipped
interval. Its complete kernel capture and all five files were preserved and
hash-verified. Collector 35 completed, and the stopped trial was reconciled to
managed with retained jobs, enrollment and protected files preserved, owned scopes
removed, SDK on loopback and rescues retired unfired. The failed interval remains
rejected. See [S90D startup-gap evidence](observer-s90d-readiness-gap-results.json).
QN90A's corrected-observer trial remains active. Neither TV has passed 24 hours.

Before the reboot trial, S90D ran signed 0.7.49 and passed a same-boot native
migration, public execution/jobs, selected-native disable/enable recovery and
managed return.
Production/activation receipts and the native job remained byte-identical across
restart; original retained jobs, enrollment and protected files survived the round.
The deployment and trial rescues were retired unfired, owned scopes were removed
and SDK is on loopback. QN90A remains on 0.7.48 while its trial runs. See
[S90D installation and smoke evidence](cross-boot-s90d-install-results.json).
That earlier round did not qualify cross-boot recovery.

QN90A's fourth attempt stopped after about 39 minutes when collector 13 exited with status 1:
its first sample arrived 1.143 seconds after the declared start, leaving one
skipped interval. The failed capture was preserved, the following collector
finished successfully, and the trial was reconciled back to managed with original
jobs, enrollment and protected files intact. All owned rescues were retired
unfired and SDK is on loopback. No endurance acceptance is claimed. The three
previous QN90A attempts stopped at approximately 35, 15 and 61 minutes and were
also reconciled without replay. See [readiness-gap evidence](observer-readiness-gap-results.json).

S90D recovered after an authorized, verified full reboot and host-assisted SDK
loopback restoration. Couchroot readiness, original selection, retained jobs,
enrollment and protected hashes were verified before its fresh trial. Its owned
recovery diagnostics were reconciled. QN90A has not been rebooted. See
[transfer and recovery evidence](observer-transfer-recovery-results.json).
That recovery used the prior boot-bound selected-native startup implementation;
it does not qualify the subsequently installed cross-boot startup code.

Local source now integrates cross-boot guardian reconciliation with selected-native
startup, separate runtime receipts, startup fences, retained-state verification and
return to managed. Modeled reboot integration passes locally. S90D has this source
installed, with actual interrupted cross-boot recovery now verified after repair;
clean boot qualification remains open. The .NET entry, fallback and rescue remain
in place.
Local source now also reconciles interrupted bootstraps and pending returns
across boots, with fresh executor, unit-absence and retained-state checks.
Pending returns use bounded native offline reconciliation before restoring
managed state. Full power-lifecycle qualification is still open. QN90A has not
yet received these cross-boot changes.

Ordinary signed 0.7.49 candidates are now prepared from `4f39d1d` for both
profiles. Signatures and forward inventories passed verification; each native
build reproduced twice. Managed worker, acquisition bridge and all other
non-manifest payload members are unchanged from 0.7.48. S90D has received its
candidate; QN90A deployment waits for its endurance run to finish or be reconciled. See
[candidate evidence and hardware prerequisites](cross-boot-candidate-results.json).

The preceding signed 0.7.48 integrated qualification on both TVs ended
managed-ready. The authenticated timing header now separates file-sync and
directory-sync elapsed time and counts inside each journal phase. All 19 payload
members, including manifests, native/managed workers and acquisition bridge, are
byte-identical to 0.7.47. The JSON journal, archives and every durability barrier
are unchanged. Both TVs verified 147 timed requests, complete kernel capture and
identity-bound native resource samples; trial boots, retained jobs and enrollment
were preserved, all owned trial scopes were removed, SDK is on loopback and
independent deployment/trial rescue start counters were zero. See
[journal sync evidence](journal-sync-phase-results.json).

Both sync types contribute to the observed tails. QN90A's maximum single file
sync was 1048.478 ms and directory sync 863.684 ms; S90D's were 1050.400 and
1307.263 ms. S90D's slow native forget spent 1307.263 ms in one directory sync
within a 1488.142 ms HTTPS request. These measurements include runtime overhead
and descheduling; they identify the blocking API calls, not an underlying flash
or kernel cause. The performance gate remains open, but these particular tails
must not be treated as evidence of native-worker execution cost alone.

The bounded observer now has an offline continuity verifier and an adapter-driven
rolling controller. Both TVs passed a three-minute selected-native trial with
three overlapping windows, 240 identity-bound resource samples, mixed root/app
jobs and repeated independent rescue renewal. They ended managed-ready; this is
controller qualification, not the 24-hour gate. See
[controller evidence](observer-controller-results.json). Next: supervise a full
endurance invocation with free-space monitoring and the long-job/workload plan,
retaining original intents and both fallbacks. Continue native-entry investigation
from the existing mapping/capability boundary; no new usable entry route was
established by the latest source/evidence review.

The preceding signed 0.7.47 round introduced authenticated request phase timing
and ended managed-ready. All 17 non-manifest payload members are unchanged from 0.7.46,
including the native worker, managed bridge and fallback. Fresh integrated
acquisition/HTTPS/native-return rounds validated 147 timed requests per TV,
identity-bound native resource samples and complete kernel windows. Both preserved
their trial boots, retained jobs and enrollment, removed trial scopes/helpers,
and verified SDK loopback and zero starts of their independent trial rescues.
See [phase timing evidence](api-phase-timing-results.json).

The new timings reproduce and locate slow public requests in service journal
publication: S90D's additional native root admission took 1263.781 ms over HTTPS,
including 1129.298 ms in journal completion and 24.283 ms in the worker phase.
A managed forget took 1338.224 ms, including 1061.122 ms in journal completion.
Two QN90A maintenance commands likewise spent over one second there. This does
not prove an individual syscall/storage cause or retroactively attribute earlier
outliers. Next: partition service publication work and investigate these delays
without weakening durability; the no-regression and endurance gates remain open.

The preceding observer revision skips unrelated process reads, samples mapping
memory on first identity observation and every fifth tick, and populates its
bounded resource buffer progressively. In one counterbalanced 20-second idle
pair per TV, observer CPU fell 67.0% on QN90A and 65.0% on S90D. Maximum sampled
PSS plus Swap fell from approximately 10.3 MiB to 2.3 MiB; this is an accounting
proxy with sparser detail samples, not an exact physical-memory peak. Both fresh
integrated acquisition/HTTPS/managed-return rounds passed on unchanged signed
0.7.46, with complete kernel windows and identity-bound native resource samples.
Both ended managed-ready on their trial boots, with retained bytes/enrollment
preserved, owned scopes/helpers removed, SDK on loopback and rescues unfired.
See [observer overhead evidence](observer-overhead-results.json). The fresh rounds
did not reproduce the prior one-second admissions; the performance gate remains
open. This motivated the authenticated phase timings now qualified above; all
persistence barriers remain intact.

The preceding installed-path round spans managed HTTPS commands/jobs/transfers,
native service acquisition, committed native HTTPS operations and normal managed
return, with an independent resource/kernel observer. Both TVs passed on unchanged
signed 0.7.46. Native worker and guardian resource samples bind to their activation
identities and signed executable digest. QN90A enable-to-ready was 2.367 seconds,
migration 4.040 seconds and return 13.311 seconds; S90D was 2.583, 7.889 and
20.435 seconds. These are single host-observed trials, not latency distributions.
Both ended managed-ready with expected committed history transitions, original
retained bytes/enrollment and the same trial boot/coordinator process. All owned
units/scopes are inactive or removed, SDK is on loopback and independent .NET
rescues did not fire. See [integrated observation](integrated-observer-results.json).

The performance gate remains open: S90D native root admission again took
1141.376 ms, with observed completion at 1334.111 ms. Managed app through-forget
also reached 1917.448 ms. The sampler records its own CPU/swap overhead, and its
one-second snapshots miss short-lived processes; this is not complete process-tree
or endurance coverage. The acquisition bridge still requires .NET.

Both TVs remain managed-ready on signed 0.7.46. The latest diagnostic qualifies
continuous read-only kernel capture across two warmup and four measured
managed/native pairs on each TV. QN90A covered 102.799 seconds / 567 records;
S90D covered 88.663 seconds / 656 records, without sequence gaps, overruns,
read errors or capacity exhaustion. Each final round preserved its boot, managed
worker, history, retained jobs, enrollment and protected files; owned scopes and
helpers are removed, SDK is on loopback, and the independent .NET rescue is
inactive without firing. See [kernel capture evidence](kernel-capture-results.json).
This is benchmark-window coverage, not full acquisition/HTTPS or endurance.

Unexpected boot changes were observed between preceding qualification windows;
no power action was issued. In the first QN90A capture attempt, the benchmark
completed and saved a complete capture, but the boot changed before cleanup.
The original terminal job and files were reconciled without replay, its evidence
was retained, and only verified owned files were removed. That attempt is not
same-boot acceptance and its prior-boot rescue outcome remains unproven. A fresh
QN90A attempt with distinct intents passed all final checks. S90D's transient
unreachability cleared before its fresh preflight. These observations do not
qualify controlled reboot or standby behavior.

Both TVs are on signed 0.7.46 with native service acquisition enabled and
managed selected and ready. Successful native job admission exclusively
publishes one complete running record while the contained child remains gated;
file and directory sync still precede command execution. Both TVs passed public
root/app jobs, retained-job return to managed, bounded address-space refusal and
restart without replay, and a fresh ordinary-worker performance comparison.
Disposable pressure/benchmark scopes and helpers are retired; only fixture jobs
were forgotten. SDK is on loopback, and all four independent .NET rescue timers
per TV were inactive without firing. At that milestone, original
retained records, enrollment and boots were preserved. The bounded history still
contains 32 entries per TV: QN90A 26 committed / 6 rolled back; S90D 25 / 7.
Managed entry and worker DLLs are byte-identical to 0.7.45. See
[single-publication qualification](single-publication-results.json).

The performance no-regression gate remains unresolved. The prior four-pair
0.7.45 comparison found slower QN90A jobs and an S90D app-job admission sample
over one second. The 0.7.46 follow-up also recorded a 1.32-second S90D native root
completion. It is another bounded comparison, not proof
that prior outliers are resolved or full acquisition, HTTPS and endurance gates
are complete. Keep [the original observations](production-performance-results.json)
and [sync attribution](job-sync-timing-results.json) alongside the new results.

On signed 0.7.45, both passed modeled pre-readiness recovery with a partial
successor checkpoint and an unpublished initial checkpoint. The service sealed and archived each
original launch attempt, acquired a distinct native worker on the same
coordinator, preserved retained bytes, and returned normally to managed. All 21
owned trial units per TV and the deployment units are inactive; SDK is on loopback,
native scopes are absent, and no independent rescue fired. Installed contents,
enrollment and original boots are verified. Managed DLLs are unchanged; the native
worker now binds startup checkpoints to the durable attempt's token digest.
These hardware cases model lost readiness publication with disabled acquisition
and independent SDK readback; actual checkpoint fault exits are qualified locally.
See [launch-bound startup evidence](startup-binding-results.json).

On 0.7.44, both passed committed guardian loss with owned incomplete job-persistence files,
automatic native reacquisition through the same coordinator, normal managed
return, and public managed `job.forget` for every recovered fixture. The live
job retained its unknown exit code and single execution witness; no maintenance deletion of job records was needed. All owned
units are inactive, old/replacement native scopes are absent, and SDK is on loopback.
All 19 payload members were byte-identical to 0.7.43; that milestone changed
only service code. The preceding 0.7.43 managed worker upgrades preserved the
selection digest guard:
an independently verified managed probe and SDK-confirmed retirement supplied
receipts for an explicit managed-to-managed transition. The complete original
history is archived. This is host maintenance, not automatic upgrade admission.
See [interrupted-job and managed-upgrade evidence](interrupted-forget-results.json).
The service admits bounded intent/repair files and record-save temporaries only
with a complete stale guardian journal bound to the last accepted runtime. Native
alone reconciles them; record readback and metadata absence gate admission.
Managed-return snapshots remain strict. Pre-readiness guardian journals require
the new sealed submitted-attempt binding; unbound or foreign evidence remains
held. See [persistence recovery evidence](persistence-recovery-results.json)
and [committed guardian evidence](active-guardian-results.json).
Both also passed a bounded per-worker address-space pressure round on unchanged
0.7.41 bytes: new allocation refusal preserved a live job and saved result,
restored limits admitted fresh app work, and restart reconciled the refused
intent without replay. Allocation-site and fork failure injection are locally
qualified only. See [launch-pressure evidence](launch-pressure-results.json).
The native job execution budget now starts after durable launch preparation,
immediately before releasing the command gate. Slow failed persistence retries
back off from completion of the write. Local fixtures reproduce both preceding
bugs and verify execution, timeout, refusal, watchdog termination and recovery
without replay. Both TVs passed the fourteen resource groups and seventy
command-fault jobs each on the updated ordinary binary. See
[job timing evidence](job-start-timing-results.json).
Both passed fourteen bounded resource checks on exact ordinary production
worker bytes: startup descriptor admission, guardian exhaustion/reconciliation,
zero-descriptor idle and partial-frame deadlines, full/read-only storage,
retention, descriptor admission, command faults and transfers. The installed
managed workers stayed ready throughout these separate-worker trials. All owned
test scopes are removed and independent rescue timers are inactive. The first
0.7.40 QN90A run failed an existing two-second command-fault timeout after eleven
checks; the subsequent instrumented run passed unchanged limits. That initial
timeout remains unexplained and broader timing/endurance qualification is open.
See [startup/guardian evidence](startup-resource-results.json) and the preceding
[production resource evidence](production-resource-results.json).
Both now also qualify native production guardian loss while the production record
is submitted and readiness is pending, before selection commit. Each original
coordinator automatically rolled back and completed explicit cleanup, preserving
retained state and the original uncertain request. Installed package contents
were verified before the trials. See
[production readiness recovery evidence](production-recovery-results.json).
Both qualified automatic rollback/readmission after unpaused provider loss,
cleanup refusal on an inert owned test file, and a bound continuation of that
cleanup. The original coordinator stayed unchanged throughout. S90D's terminal
observer was retired by the service through its durable checkpoint, without
separate observer maintenance or a coordinator restart. Original uncertain
requests remain submitted; only the continuation is completed. See
[observer cleanup evidence](observer-cleanup-results.json).
The preceding 0.7.34 trial established automatic rollback/readmission but exposed
the observer-cleanup gap now closed. Its earlier paused S90D coordinator exit
remains unexplained; the independent .NET rescue restored access on that same
boot. See [live recovery evidence](live-recovery-results.json).
Earlier rounds qualified forward rollback at provider readiness and retained-state
readiness, plus provider loss followed by coordinator restart; see
[forward recovery evidence](forward-recovery-results.json).
The 0.7.33 package adds an opt-in read-only SDK entry probe. Both direct vendor-loader
trials returned without a capability receipt; native-only entry remains unqualified.
Both target codec checks passed and cleanup/restoration is verified; see
[entry investigation](../../native-root-acquisition/entry/results.json).
Subsequent managed diagnostics on 0.7.36 establish that the receipt cannot map
from writable VDFS or tmpfs on either TV, but executes from a private read-only
bind. This narrows the native-entry prerequisite without qualifying SDK entry;
see [mapping evidence](../../native-root-acquisition/entry/mapping-results.json).
Each passed native disable/enable, worker transport loss and coordinator restart,
then automatic recovery after coordinator interruption at both the submitted and
ready native-bootstrap phases. Recovery retired the original receipt without
replaying its launch, and native reacquisition preserved selection and retained
jobs. Bootstrap scopes/processes are absent; small sealed launch-fence tombstones
remain intentionally. Enrollment and .NET recovery bytes are unchanged, SDK is
on loopback, and all owned test/rescue units are inactive. See
[bootstrap recovery evidence](bootstrap-recovery-results.json).

The preceding 0.7.30 round qualified native held-bootstrap lifecycle on both TVs,
interrupted return on QN90A and normal return on S90D; see
[service acquisition evidence](service-acquisition-results.json).

On 0.7.28, both passed public-operation parity and interrupted-return acceptance.
Each transferred an
8 MiB-plus file through HTTPS, exercised command/job/app/helper operations,
refused a return with a live job, explicitly cancelled it, then recovered a service
restart during the return under the original transaction. Completed and cancelled
native-created records survived. History is settled at 16 committed entries on QN90A and 18 on S90D;
SDK is on loopback and rescue timers are disarmed. See
[public parity evidence](public-parity-results.json).

On 0.7.27, each completed native disable/enable, worker transport loss and service
restart while native was selected, then returned to managed. Original committed
history and activation records stayed unchanged across native reacquisition.
See [startup evidence](startup-results.json). Pending-return restart recovery is
also locally qualified at four interruption points.
Previously, on 0.7.26 each TV completed one native admission round: a committed migration
opened public admission on native, public requests ran there, and the active
native worker returned to managed through a provider it launched (see [native
admission evidence](native-admission-results.json)). Each completed a normal
round trip on 0.7.25; restart rollback is qualified locally only (see [restart rollback evidence](restart-rollback-results.json)).
Each completed a normal installed managed/native/managed rehearsal on 0.7.22 and
again on 0.7.24, and on 0.7.23 an installed rehearsal whose native exit observation
was deliberately interrupted and then explicitly recovered. On 0.7.24 the
read-only durable inventory reports both TVs as settled. Retained job bytes, prior selection
history and boot identity were preserved; no recovery timer or setup operation is
pending. See [round-trip evidence](roundtrip-results.json) and
[interrupted-exit evidence](exit-recovery-results.json).

Native public admission and same-boot recovery are qualified for the bounded
rounds above. Native-default and .NET-free completion still require:
- Wider interruption boundaries and maintenance lifecycle coverage beyond
  same-boot startup, active return, provider-ready/state-ready interruption and
  pre-commit provider/production guardian loss and committed guardian SIGKILL.
  Those bounded recovery cases now
  have both-TV evidence without operation replay.
- Establishing a .NET-free capability entry, then adopting it in agent-required
  setup/acquisition and recovery callers. The setup-control audit is complete;
  unrelated Hub `Control.dll` operations are outside this agent migration.
- Final production-binary performance, resource-pressure and endurance validation
  on both TVs; reboot and standby/resume gates remain unqualified.
- Native-default rollout, fallback observation, verified retirement of old staging,
  public release review and eventual removal of managed agent dependencies.

The standalone [native SDK-host recovery utility](../recovery/native/README.md)
now restores external SDK access independently of a suspended coordinator and
disabled worker on both TVs, then restores loopback. The original .NET utility
remains installed and unchanged.

The [native setup acquisition pilot](../../native-root-acquisition/README.md)
also passes independent SDK acquisition and bounded failure cleanup on both TVs
with the worker disabled. Namespace/archive and command logic now run in C under
an explicit opt-in. A small managed capability-entry/read-only-code-mount bridge
is still required; default setup acquisition remains managed. Service acquisition
now has a separately packaged native opt-in and explicit managed fallback.

The no-reboot constraint and deployed managed fallback remain in force. Earlier
failed journals and staging are preserved separately, not marked successful by
these later rehearsals.

## Local interrupted-exit recovery work

The production exit observer now supports an explicit read-only retry after an
interrupted observation. It retains the original boot, process and unit-start
binding, rejects overlapping calls and cannot replay a completed observation.
The original wait remains single-use. Linux validation passed all 22 production
exit and observer-retirement tests, including the process-disappearance race.

The retry is now connected through the retirement provider, session wrapper,
admission hold and managed-return controller. Explicit managed recovery can
reobserve the original shutdown and continue the same transaction without sending
shutdown again. Provider identity failures remain terminal, concurrent recovery
is refused, and closed transports cannot publish successful exit evidence.

Local validation passed 75 focused Linux tests plus 9 session tests. Four real
managed/native/managed process rehearsals passed: normal, interrupted activation,
lost shutdown response and interrupted exit observation. The last scenario
verified one shutdown, held admission until recovery, preserved imported and
native-created job results, and completed staging cleanup. TV systemd, mounting
and launch setup are substituted in this fixture; it is not hardware evidence.

Signed 0.7.22 packages from `00c328a` are installed on both TVs. All 48 service
members matched the source before deployment; installed readback, enrollment,
protected-file hashes and startup settings passed verification. Each TV completed
a normal managed/native/managed rehearsal, retained the completed job byte for
byte, removed the current native/provider scopes, disarmed recovery timers and
returned to a ready managed worker without changing boot identity. Existing
committed history was preserved; each selection journal now has four committed
entries. No setup operation remains pending.

Controlled interrupted-exit recovery on hardware, coordinator restart
reconstruction, and recovery from other interrupted mutation phases remain open.
The normal hardware rehearsal does not qualify the injected failure boundary.

## Decision and scope

Continue from the existing native worker and launcher. Keep the JavaScript HTTPS
service, enrolled Python client and shared setup engine; rewriting those would
increase migration scope without removing a .NET dependency. Complete public
behavior parity before selecting native as the default. Retire the managed worker
first, then remove managed acquisition and recovery dependencies, and only then
remove managed artifacts from the current agent distribution.

There are two separately reportable milestones:

1. **Native worker default:** commands, transfers, jobs and helper management run
   natively. Acquisition or recovery may still invoke a managed component. This
   milestone is not a .NET-free agent.
2. **Agent .NET sunset:** installation, acquisition, ordinary operation, reconnect,
   maintenance, upgrade and recovery no longer require project-owned managed code
   on either supported TV. Normal agent builds no longer need a .NET SDK.

Do not remove the TV manufacturer's .NET installation. Other Couchroot components
such as telemetry, saver and setup utilities need their own dependency inventory;
agent sunset is not a claim that the entire repository or TV is .NET-free. Any
managed setup utility required by the agent's supported fresh-install or recovery
path belongs in this migration, even if it lives outside `autonomous-root`.

## Review of Opus's work

The cleanup is useful and should be retained. The source replaces fixed guardian
polling with signal-aware `ppoll`, uses an eventfd to notify the job monitor, and
waits for foreground output or deadlines. Shared functions consolidate job-slot
release, record reads, directory scans, signal-masked thread starts and wait-status
handling. Descriptor admission now covers protocol allocation paths and reserves
one descriptor for the job monitor. The source still identifies itself as a
prototype and is not wired into the production builder or service launcher.

The recorded before/after device measurements show foreground cost per spawned
process falling from 40.9 to 3.4 ms on QN90A and 40.8 to 3.1 ms on S90D. Idle
guardian context switches fell from approximately 100/s to 10/s. These are
microbenchmark observations, not complete startup or end-to-end speedup claims.
The event-wait revision passed the extended suite on both TVs. The admission
revision subsequently passed one-hour endurance and 76 distinct extended checks
on each TV. See [cleanup results](cleanup-results.json) and
[admission results](admission-results.json).

Evidence qualifications that must survive the migration:

- S90D's first endurance attempt was interrupted by power-off/deep suspend. Its
  later successful rerun does not establish standby or resume parity.
- Kernel ring buffers retained only the final several minutes. Absence of errors
  in those tails does not establish absence throughout the hour.
- An earlier S90D recovery took 2,188 ms against a 2,000 ms gate. Later stopped-worker
  results of 1,069 ms and 1,031 ms do not explain that tail. Keep the threshold and
  investigate it under continuous observation.
- Descriptor admission is not a reservation against external limit changes and
  does not qualify guardian exhaustion or system-wide `ENFILE`.
- Tests commonly use the separately compiled fault-test worker. The final ordinary
  production executable needs its own smoke, parity and endurance qualification.

Local revalidation for this review passed all 49 native ASAN/UBSAN tests. The
repository runner discovered 275 tests: 226 passed and 49 native tests were
skipped there because they ran separately. No TV was contacted during this review.
This is a focused source and migration-readiness review, not an exhaustive audit
of every native code path.

This review inspected source changes and recorded evidence; it does not establish
why Opus paused. No motive should be inferred from the absence of an acquisition port.

## Dependency inventory

The [2026-10-15 caller and runtime inventory](DOTNET-INVENTORY.md) expands the
three remaining acquisition/setup/recovery dependencies and their removal order.

| Component | Current responsibility | Migration disposition |
| --- | --- | --- |
| `payload/SamsungTvRootAgent.cs`, `AgentOperations.cs`, `AgentJobs.cs`, `AgentHelpers.cs`, `AgentLauncher.cs` | Managed protocol worker, operations and launcher embedding | Replace with native worker after parity gates; retain managed artifacts during rollback window |
| `payload/SamsungTvArchiveRoot.cs` | Firmware-specific acquisition stage invoked by the service | Separate native acquisition adapter workstream; preserve existing supported behavior and profile restrictions |
| `recovery/Program.cs` | Maintenance setting readback, conditional restoration and delayed recovery | Native utility with equivalent validation, timing, drift refusal and result semantics |
| `service/agent.js` | Acquires workers, stages payloads, owns connection generations, readiness, retry budgets and cleanup | Retain JavaScript; introduce explicit implementation selection and manifests |
| `service/main.js`, `api.js`, `policy.js`, `vendor/root-agent.js` | HTTPS lifecycle, enrollment, request journal, operation routing and wire protocol | Retain; test with each worker through the real service |
| `tvsetup/autonomous_root.py`, artifact builder and launcher builder | Per-profile build, packaging, manifests and verification | Add native artifacts and reproducibility checks; remove managed build only at sunset |
| `tvsetup/root.py`, `transport.py`, `operations.py`, trial/recovery callers | Setup access, firmware/runtime guards, controls and maintenance orchestration | Trace the agent's actual call graph; replace any required managed control/bootstrap path before claiming fresh-install independence |
| `scripts/build-native.py`, `check-root-launcher.py`, `check-dependencies.py`, managed harness | Build and validation dependencies | Split agent-only checks from unrelated projects; replace managed oracle with retained fixtures at sunset |
| `native-launcher/app-launcher.c` | App identity, labels, environment and descriptor cleanup | Reuse as an independently versioned, manifest-bound native artifact |

`tvsetup/native_bootstrap.py` and `native_trial.py` concern a telemetry collector
pilot. Their existence does not establish native root-agent acquisition or production
integration. Reuse applicable journal/rollback patterns, not their qualification claims.

## Feature parity matrix

The public contract is [CAPABILITIES.md](../CAPABILITIES.md), enforced jointly by
the HTTPS service, client and managed worker. Preserve observable fields, limits,
error classification and side effects. Additional native diagnostics may be additive.

| Area | Current native coverage | Required closure before default |
| --- | --- | --- |
| Connection and frames | Existing authenticated sequence protocol, EXEC, OP, OPDATA and OPWRITE | Real service conformance: malformed/truncated frames, replay refusal, connection loss, partial bodies and shutdown; no automatic operation replay |
| HTTPS and enrollment | Supplied by unchanged JavaScript service | Native through real enrolled client: request IDs, request journal, certificate continuity, keep-alive, connection limits and serialized mutations |
| Readiness and identity | Boot, uptime, worker and guardian diagnostics | Production capability names; launcher implementation/digest shape; readiness only after validated worker status and required capabilities; acquisition timestamp and stale-generation behavior |
| Root foreground execution | Output, exit code, timeout, truncation and process cleanup | Compare byte output, nonzero exit, empty output, quoting, Unicode, invalid UTF-8, embedded NUL rejection, exact size limits and timeout boundaries through service |
| App execution | Independent native launcher and profile; 100–25,000 ms timeout | Preserve UID/EUID/GID, groups, label, working directory, environment, descriptor inheritance and result conversion; specify invalid UTF-8 replacement behavior |
| Transfers | Eight transfers, 2 GiB files, 1 MiB chunks, ranges, SHA-256, JSON/binary chunks, conditional commit | Expand beyond direct children of one experiment directory; full public read/write path policy and parent traversal; resume metadata and error parity |
| Transfer publication | Create-only link and digest-conditioned rename | Preserve 0600 publication, no unsolicited parent creation, partial-write offset reporting, worker-lifetime IDs and no blind retries; exercise concurrent external writers and document existing limits |
| Jobs | Sixteen retained jobs, 64 records, 1 MiB stream rings, 64 KiB tails, 100 ms–24 h timeouts | Production storage root, legacy record handling, exact state/nullable-exit/output semantics and same-boot/reboot interpretation |
| Cancellation | Current owned jobs and descendants supervised | Resolve explicit difference: managed code permits some saved-process cancellation; native refuses it. Do not silently advertise exact parity |
| Helpers | Digest-checked copy, app execution view, bounded active views and owned cleanup | Production source roots, retained-directory limits, returned metadata and old-helper cleanup policy; no assumption that IDs survive a worker switch |
| Launcher | Independent staging, digest checks and lifecycle recovery | Bind source and digest to package manifest; production readiness; interrupted update and old-version handling |
| Worker lifetime | Bounded experiment default; explicit `--production` removes worker/guardian expiry and separates idle from frame deadlines (local validation only) | Production lifetime separate from request/job deadlines; long-running idle sessions and 24-hour jobs without lifetime expiry |
| Crash recovery | Guardian, progress watchdog, ownership journals and same-boot reconciliation | Production start/stop/reacquisition integration, interrupted upgrade, prior-version journals, standby/resume and cross-boot qualification |
| Command signals | Core-producing signals intercepted, actual termination reported separately | Approve/document changed behavior or implement compatibility mode; managed command signal handlers may behave differently |
| Resource pressure | Protocol descriptor admission; bounded logs and counts | Guardian/startup descriptor budget, concurrent pressure, memory allocation failure, disk full/read-only, process exhaustion and large-file storage stalls |
| Acquisition and maintenance recovery | Borrowed from managed deployment | Native implementation and independent acceptance on each supported firmware; no hidden managed prerequisite |
| Diagnostics | Native status and fault ring | Service-readable bounded start/stop/failure status, selected implementation/version, fallback reason and actionable recovery state; replace managed status-file assumptions |
| Legacy READFILE/WRITEFILE | Omitted | Current public service/client do not expose them. Keep outside the replacement contract unless consumer inventory finds a supported user |

## Ordered implementation work

Phase-one implementation status is recorded in [PARITY.md](PARITY.md): the
contract and differential harness, opt-in production file access and offline
retained-job import/export are implemented. Live state installation and worker
selection are still gated on the later packaging/rollback work below. Local follow-ups
add explicit production lifetime and request-side storage progress. Service and bundled-client response budgets now distinguish storage operations
from ordinary operations, with local HTTPS/wire qualification using a scripted
peer. Native through the real service, device deployment and measured storage
limits remain unqualified; see `PARITY.md`.

### 1 Freeze the compatibility contract

Create a machine-readable operation/result matrix and differential tests that run
identical requests against managed and native workers. Normalize only generated
IDs, timestamps, process identities and explicitly additive fields. Compare known
failure versus unknown transport outcome, emitted bytes, filesystem side effects
and retained job state, not just exit zero. Include native through the existing
JavaScript service; a standalone controller is insufficient.

Record each intentional difference as a versioned contract decision: command
signals, saved-job cancellation, stronger descendant cleanup, malformed-input
handling, UTF-8 conversion and added status fields. Recommended saved-job policy:
refuse cancellation when ownership is no longer provable and expose that limitation
explicitly. Never recreate saved-PID signaling merely to satisfy a superficial test.

Deliverable: compatibility tests and an approved difference ledger. Gate: every
public operation has success, rejection, interrupted-response and boundary cases.

### 2 Complete paths, retained state and long-running behavior

Replace the single-directory transfer resolver with explicit production read and
write policies. Use component-based traversal suitable for these older kernels;
preserve refusal of symlink components and special-device files. Do not require
new kernel-only APIs without a supported fallback. Recalculate peak descriptor
use after introducing parent directory handles and test exactly at each threshold.

Move job storage from experiment `.jobs` to a versioned production layout. Import
or expose managed `/opt/couchroot-agent/jobs` records without replay. Keep completed
results, preserve ambiguous outcomes, and define behavior for malformed records,
partial `.next` files, duplicate IDs and capacity shared with legacy records.
Do not fabricate a native owner identity for an old managed record.

Use copy-and-verify migration or a read-only legacy view with an atomic manifest
commit. Keep legacy bytes unchanged until the rollback window closes. Test rollback
with native-created records: the managed worker must not misread them or reuse an
ID. Shared writers are prohibited; selection must establish a single owner.

Remove experiment alarms from the production mode while retaining bounded requests,
job deadlines, drain deadlines and watchdogs. A test-only bounded mode remains
available. Audit progress reporting through hashing, copying and durable writes:
a valid large operation must not look like a 30-second deadlock. Test sparse/large
files, slow storage, long idle connections and 24-hour jobs separately.

Deliverable: production-mode worker with public path/state behavior. Gate: full
contract suite and native host tests pass, including downgrade and interrupted
migration fixtures.

### 3 Integrate packaging and service selection

Installed-runtime update: QN90A's proc-stat path remains qualified. S90D's
0.7.11 external observer passed two complete non-stopping service probes,
including exact package-thread credentials, independent copied execution staging,
native termination receipts, non-blocking unit retirement and owned-file cleanup.
Both TVs retained their managed workers and boot identities. Direct WRT
child-process launch remains disabled. See the current
[deployment evidence](../native-observer/DEPLOYMENT.md).

The remaining handoff dependency is cleanup after the source worker exits.
The runtime now distinguishes probe and handoff purposes: a handoff requires an
explicit independent inspection/retirement provider before any launch intent.
Launch and fresh readiness checks still use the held source worker; cleanup gets
only the bound unit, boot and artifact digest, never its departing executor.
The internal shutdown path can use this boundary and keeps the selection pending
and admission held after shutdown. The installed service does not supply such a
provider, so its shutdown guard remains active. Local tests cover disconnect,
changed inventory, missing provider and uncertain cleanup. They do not qualify a
production provider or an on-TV stopping handoff.

The independent provider adapter now uses a separate, authenticated, bounded
native worker with isolated state. Both TVs passed scoped adapter tests against
ordinary native binaries, including real unit inspection/retirement and verified
provider/guardian exit. These were host-orchestrated tests with the managed source
left running, not installed-service handoffs. See the observer deployment record.

Durable provider submission is now implemented locally: exclusive launch and
pending records precede root mutation, candidate/token/source identities are
bound, and uncertain results block all replacement IDs. Readiness publication is also implemented locally: it binds the native guardian
to the running unit, rechecks source/native identities, and publishes a ready
record under an exclusive intent. Real-wire host tests include that transition.
Listener/token coordination and journal-driven teardown remain unintegrated.

Next, integrate the provider listener, submission and teardown into the service, then
exercise the real external observer across managed shutdown with retained records, followed by
live state installation/native trial and managed rollback. Do not substitute a
Mac-only controller for the deployed runtime or use the non-stopping probe as
proof of this gate. No native selection gate has passed.

Local packaging foundation is implemented: `--native-candidate` includes three
reproducibly built ordinary artifacts and a manifest while retaining managed
selection (worker, app launcher and process observer). See `PARITY.md` for build evidence. Service-side candidate manifest validation and diagnostics are also implemented,
without native launch. A durable selection journal and service guards now track
versions, transition phases and evidence hashes. Workers now expose bounded live
resource inventories, and an internal service admission hold drains admitted
requests before obtaining fresh inventory from the same worker connection. These
are locally tested. A journal-bound managed shutdown now waits for authenticated
acknowledgement/disconnect and independently observes original process identities
exiting. It leaves selection pending and admission held. Detached work, retained
resources and state installation still require reconciliation; process exit alone
does not establish the full transition gate.
Focused ordinary-sidecar checks now pass on both TVs, with a discovered integration
constraint: S90D's service identity receives EACCES reading root process stat files.
The direct observer must remain fail-closed there. A matching service-identity
probe successfully bound and polled pidfds across shutdown on S90D; QN90A's older
kernel passed the existing proc-stat approach. See `handoff-results.json` and
`PARITY.md`. Complete deployment integration before enabling S90D handoff.
An internal managed-handoff pidfd bridge now binds the handle before a fresh
authenticated inventory/identity confirmation and requires bounded observer exit
evidence. It is locally tested through the actual service hold and managed wire
session. Schema-2 candidates now package the observer with source/build hashes;
schema-1 candidates remain accepted without it. It is not enabled by the installed service. See
[`native-observer/README.md`](../native-observer/README.md). The staged executable
must still be verified against the package manifest and qualified in the TV service context.
Bind handles before a fresh authenticated identity confirmation; the test controller
owns the guardian child. Native status now checks its original guardian parent
relationship on every request (`guardian-parent-identity-v1`), without allocating
a descriptor. The bridge now binds both handles and requires this fresh confirmation
before arming. Local real-wire native shutdown tests pass with both exits and
separate guardian cleanup checks. Native service selection and TV launch remain
unqualified. A bare PID or an unreadable stat file is insufficient.
The runtime controller, live state installation/rollback and actual service
integration remain required; this is not phase-three completion.

The shared package updater now accepts an explicitly reviewed inventory digest
bound to both signed packages' complete member hashes, with union readback and
absence checks. Local tests pass; this is not hardware update/rollback evidence.
Signed candidates are prepared for both TVs but not installed. Read-only layout
inspection found installer-owned package files and a 2755 app data directory:
provide verified executable staging and a separate private selection-state
directory before service activation. See the observer
[deployment gate](../native-observer/DEPLOYMENT.md).
The private-state bootstrap is now implemented locally, using
`data/worker-state/worker-selection.json` and refusing conflicting legacy state.
Local tests include the unprivileged app UID. It is not yet deployed; rebuild the
previously prepared signed candidates before installation. Observer executable
staging and actual service-context validation remain open.
The subsequent internal handoff now stages the exact manifest-bound installed
observer's execute permission, verifies unchanged bytes/inode/owner, and binds
pidfds only after readback. Unknown outcomes or target drift retain the admission
hold and prepared journal. This is locally tested; actual TV service execution
and native selection remain unqualified.

Package ordinary worker, guardian functionality and app launcher from reproducible
source builds. Do not ship fault-control operations or depend on a copied binary
from a prior experiment. Record per-artifact hashes, ABI, dependencies and profile
compatibility in the manifest. Verify dynamic library availability on both TVs.

Retain the existing service and enrollment data. Add an explicit, durable selection
of managed or native, selected version and last-known-good version. Stage and verify
new artifacts before changing selection. Replace hard-coded managed launch arguments,
file allowlists, status-file assumptions and payload manifests in `service/agent.js`.
Require the expected implementation and capabilities during readiness, not merely
boot ID and a numeric uptime. The local service now implements this gate for
managed status and provides native readiness validation requiring pinned launcher
identity and production lifetime. It also rejects late connection status and
blocks requests before readiness. Native selection/staging and both-TV validation
remain required; the native validator alone does not enable a native launch.

Preserve connection-generation checks, capped acquisition retries and backoff.
On worker failure, reconcile its jobs and owned resources before selecting another
implementation. A fallback may restore availability; it must never replay the last
command, job start, upload chunk or commit. Preserve unknown outcomes in the journal.

Deliverable: opt-in native selection with managed default and tested rollback.
Gate: packaged native works through the unchanged client in a temporary trial;
managed rollback works with retained data and interrupted requests.

### 4 Replace acquisition and maintenance dependencies

Treat acquisition as a separate component with a narrow contract: validate the
supported profile, establish the required process identity and isolated execution
context, hand off the selected worker, report readiness/failure and clean only its
owned temporary resources. Port the existing supported behavior rather than adding
new device coverage or changing the method during the worker migration.

Inventory the complete managed call chain, including fresh installation and access
recovery. Replace `SamsungTvArchiveRoot` and any required managed bootstrap/control
utility with individually testable native components. Preserve profile checks,
one-launch behavior, retry bounds, result reporting and cleanup. A native worker
started by a managed bootstrap is only milestone one.

Replace the maintenance recovery utility's readback, conditional restore and delayed
restore behavior. Test invalid inputs, setting drift, already-restored state,
interrupted execution and failed readback using local fixtures before device trials.
The recovery path must remain usable when the selected worker fails before readiness.

Deliverable: native acquisition/recovery artifacts and agent-only build path.
Gate: each supported TV can start and reacquire native without a managed agent
process; required installation and recovery paths also demonstrate independence.
Actual device-setting changes require a separately authorized, journaled trial.

### 5 Qualify the integrated native agent

Use the exact ordinary packaged build on both TVs, first sequentially, while keeping
the managed fallback available. Record source revision and artifact hashes. Capture
kernel and lifecycle evidence continuously into bounded private logs, with explicit
coverage gaps and clock handling across suspend. A final ring-buffer tail is not
full-run evidence.

| Test group | Required observations |
| --- | --- |
| Public operations | Complete differential suite through HTTPS, app identity/environment, helper stage/execute/release, large transfers and conditional commit |
| Jobs and state | Concurrent quiet/noisy jobs, retention/cursors, cancel/timeout, 24-hour job, persisted outcome, migration and rollback without replay |
| Lifecycle | Graceful stop, worker loss, guardian loss, stalled main/monitor, service loss, reconnect, install interrupted before/after selection, interrupted cleanup |
| Pressure | Descriptor thresholds, guardian budget, ENOSPC/read-only, allocation/process failures and slow storage; no unintended command execution |
| Endurance | Proposed gate: at least 24 hours per TV with mixed work and idle periods; stable descriptor/thread/mount counts and no unexplained sustained memory growth |
| Timing | Preserve the two-second recovery gate where it applies; collect phase timings and tail distributions, including the previously observed S90D outlier |
| Power lifecycle | Separately authorized standby/resume, deep suspend, software reboot, cold start and interrupted-write/power-loss cases; validate old-boot journals and readiness |
| Recovery | Native failure before readiness restores the last-known-good implementation without host-side reconstruction or a managed utility hidden in the native-only path |

No reboot or deliberate power transition is authorized by this plan. Prepare those
fixtures and mark them pending. Native default and sunset remain gated until the
required transitions are actually tested, or the user explicitly approves a narrower
support contract. An accidental interruption is useful evidence, not a planned test.

Repeat full process-tree measurements for managed and native: guardian plus worker
RSS/PSS/private memory/swap, CPU, idle wakeups, peak descriptors, acquisition-to-ready
time, app startup, job latency and transfer throughput. Alternate versions under
comparable conditions; retain sample counts, medians and tails. Distinguish complete
acquisition from a warm worker launch. Propose no blanket speedup target: require
no material regression in supported workflows and quantify the intended benefit.

### 6 Deprecate, switch default and sunset

Use release gates rather than a fixed calendar deadline:

| Release stage | Behavior | Exit criteria |
| --- | --- | --- |
| Candidate | Managed default, explicit native trial | Contract/state/packaging gates and recovery rehearsal pass on both TVs |
| Native default | Native selected; verified managed package retained for rollback | Integrated acquisition and power-lifecycle qualification pass; no unresolved outcome-loss or duplicate-execution issue |
| Managed deprecated | Managed is maintenance-only; notices identify replacement and rollback policy | Proposed minimum 14 days of ordinary native use on each TV, including authorized lifecycle transitions; no unresolved fallback event; owner approves removal |
| Agent .NET sunset | Current package and agent build exclude managed worker/acquisition/recovery | Native-only fresh install, upgrade, reacquisition and recovery demonstrated on both profiles; zero required managed agent process in lifecycle observations |

The 24-hour qualification and 14-day observation periods are proposed minimums,
not already completed tests. A period with either TV unavailable does not count as
an equivalent amount of active observation. Record exceptions explicitly.

Before switching a device, quiesce mutations, inventory active jobs/transfers,
complete or explicitly cancel owned work, snapshot data, verify the rollback
package and recovery access, then commit selection. Never silently discard a
running job or treat an incomplete transfer as committed. Switch one TV first;
validate it before switching the other. A rollback uses the same journaled state
transition and preserves native-created outcomes for inspection.

At sunset remove managed agent artifacts from the package, current build graph and
runtime selection; update manifests, dependency checks, tests and documentation.
Retain the last supported managed release and its verified recovery material in
the private release archive for an explicitly documented retention period. Remove
only known project-owned stale device files after ownership checks. Leave vendor
runtime files and unrelated Couchroot components untouched. Historical source and
result records remain available; retirement does not require rewriting Git history.

## Work packages and dependencies

| Work package | Main files | Depends on | Completion evidence |
| --- | --- | --- | --- |
| Contract and intentional differences | `CAPABILITIES.md`, service/client tests, native and managed harnesses | Reviewed baseline | Differential matrix, accepted differences |
| Production paths and limits | Native `worker.c`, common helpers, transfer tests | Contract | Full path/size/race/descriptor threshold fixtures |
| Job migration and rollback | Native `jobs.h`, reconciliation, setup migration code | Contract | Legacy/native state import and downgrade tests |
| Lifetime and diagnostics | Native worker/guardian/progress, service status | Contract | Long-idle/long-job/slow-storage tests |
| Packaging and selection | `tvsetup/autonomous_root.py`, builders, `service/agent.js` | Contract, paths, state | Reproducible ordinary build and managed/native selection tests |
| Acquisition and maintenance ports | Acquisition payload, recovery utility, required setup callers | Dependency inventory | No managed process required for each lifecycle path |
| Integrated qualification | Acceptance harness, real service tests, private device runner | All above | Both-TV acceptance, continuous evidence and rollback rehearsal |
| Default and retirement | Release metadata, selection, build/dependency cleanup, docs | Qualification and observation window | Per-device approval and sunset checklist |

Start with the contract, path parity and retained-state work. Acquisition can be
specified independently, but default selection must wait for its acceptance. Avoid
another broad cleanup pass until these deliverables are complete.

## Definition of done

.NET is sunset for the agent only when all public features either match or have an
explicitly accepted versioned difference; retained outcomes survive upgrade and
rollback; both supported profiles pass integrated lifecycle acceptance; recovery
works without the managed components being retired; production artifacts contain
no test hooks; the agent-only build has no .NET SDK dependency; and the owner has
approved the final removal after the observation window. Keep .NET available until
then.

### Retirement session coordination (local only)

`retirement-session.js` composes a private loopback listener and fsynced random
token with journaled launch and provider readiness. It exposes only the verified
retirement adapter and transport closure; no generic command channel is returned.
A launch/readiness failure retains ownership material for reconciliation. Closing
the transport does not retire the unit, release the launch marker, or delete
staging. Host tests exercise ordering, token binding, listener failure, disconnect,
readiness rejection and refusal to launch over an existing pending record.

This coordinator is not yet enabled in the installed service. Provider teardown,
interrupted-session reconciliation and integration with the admission hold remain
required before a stopping handoff can be enabled or qualified on either TV.

### Retirement teardown (local only)

`retirement-teardown.js` now journals a verified native shutdown, checks successful
unit completion through an independent executor, verifies worker/guardian exit and
hash-bound staging, and stops the completed unit without blocking. It removes only
the expected worker, launcher and empty job-lock layout. Unexpected artifacts or
uncertain execution retain pending ownership. Service token deletion follows remote
cleanup; only then does completion release the launch marker. The session exposes
this one-shot teardown while preventing further adapter operations.

Linux host validation includes real native shutdown after managed-source exit,
completion of the private token journal, and execution of the cleanup shell against
controlled process/unit/filesystem fixtures. Systemd inspection remains simulated
in these host tests. Neither TV has received this coordinator. Interrupted cleanup
and token-deletion reconciliation, installed-service integration, and both-TV
stopping handoff qualification remain open; .NET remains the deployed fallback.

### Interrupted retirement reconciliation (local only)

`retirement-reconcile.js` handles a journaled shutdown whose reply was lost,
partial remote cleanup, and the local token/completion publication crash windows.
It distinguishes observed process exit from an acknowledged shutdown and never
replays launch or shutdown. A durable cleanup intent permits checking and removing
remaining owned entries after the unit has stopped; missing entries alone do not
prove success. If cleanup had not yet stopped the successfully completed unit,
the full original artifact layout must pass before the nonblocking stop. Live or
replaced processes, unexpected entries, changed hashes and inconsistent unit
snapshots retain pending ownership. Token removal and marker release follow the
persisted remote-cleanup result.

The combined Linux host suite passes 106 tests without skips, including partial
filesystem cleanup, lost responses, token deletion interruptions and real native
shutdown. Shared exact-path fixtures now serialize access to the isolated app
state. Unit state is simulated in reconciliation tests. Uncertain launch/readiness
before a verified provider record, installed-service orchestration and both-TV
handoff validation remain open. No device update or reboot was performed for this
change; the managed fallback remains deployed.

### Installed non-stopping provider integration — 2026-10-14

Both TVs now run service 0.7.13 with managed selection. The service holds admission,
opens a journaled native retirement session, verifies the original managed process,
performs its model-specific observer probe, then shuts down and retires the provider
before releasing admission. Provider probes have a distinct transaction namespace.
Uncertain launch, observation or cleanup retains admission and durable ownership;
WRT child-process execution remains disabled. S90D's independent provider performs
observer unit inspection/retirement; QN90A uses its qualified proc-stat path.

Two probes per TV passed with unchanged source-worker and boot identities; all 45
installed package members and provider cleanup were independently verified. The
initial S90D pilot exposed an immediate guardian-completion assumption after BYE;
the forward update adds bounded observation and passed both repeated probes. See
the observer deployment record for the failed-pilot limits and recovery evidence.

The final Linux rerun passed 109 tests without skips; seven API tests also passed.
An earlier combined run intermittently failed the existing managed retained-job
fixture while reading `/proc/<pid>/stat` for a short-lived job. Its five-test isolated
rerun and the final combined rerun passed. This remains an open short-job identity
capture investigation, not a proved fix or evidence of native parity.

This integration does not enable stopping handoff. Uncertain launch/readiness
reconciliation before provider identity is durably established, production native
startup/state transfer, managed rollback, and the broader lifecycle/sunset gates
remain required. The deployed .NET worker remains the fallback; no reboot was used.

### Service-readable retained state — local follow-up

The independent provider now exposes a dedicated snapshot operation for the stopped
managed source's fixed job directory. It preserves record bytes, validates them
against the supported offline import contract, checks source process/boot identity,
and rejects changed inventory before returning a digest-bound result. It neither
writes destination state nor launches or replays a job. A real native-channel host
test reads the retained fixture after the real managed process exits; shell tests
cover a live source, PID reuse, links, permissions, pending entries and overflow.

The combined Linux suite passes 116 tests without skips. A differential Python/JS
test checks standard JSON record acceptance against the existing offline importer,
including integer types, escaped duplicate keys and UTF-8 BOM preservation. These
are host results; both TVs remain on the previously qualified 0.7.13 packages.
Destination staging, durable installation receipts, production native launch and
rollback still need to consume this snapshot before stopping handoff is enabled.

### Durable retained-state installation — local follow-up

The independent provider can now install its own validated managed snapshot into
an exclusive native state directory. A durable local intent and saved snapshot
bind the selection transaction, source identity and target manifest before remote
writes. A remote pending manifest prevents native startup during copying. Records
are created without replacing differing content, checked against their hashes,
and published with a synced import manifest only after source inventory is
rechecked. The ready receipt retains transition ownership and does not change
selection or launch the worker.

Explicit resume requires the same saved snapshot, selection and remote ownership
manifest. Tests cover lost begin/copy/commit replies, bounded scratch cleanup,
source drift, conflicting destinations and all 64 records with maximum-length
identifiers. Interruption before the remote ownership manifest exists remains a
refusal requiring reconciliation; service restart/provider reacquisition is not
implemented by this operation.

A real native-channel host test now copies retained state after managed exit and
starts a production-mode native worker against the installed directory. Both
ordinary JSON and UTF-8 BOM records survive byte-for-byte through status readback
and shutdown. This exposed and fixed a native saved-record parser discrepancy:
the importer accepted BOM-prefixed JSON while the runtime rejected it. The fix
is confined to saved job records, including guardian reads.

The final combined Linux rerun passes 123 tests without skips, three targeted
native retained-state/recovery tests pass, and the Python/JS importer contract
comparison passes. An earlier combined run again exposed the existing managed
short-job process-identity race; it remains unresolved. The test container also
read an incomplete test source once; syntax validation and the complete rerun
passed. These are host results, not on-TV installation qualification. Both TVs
remain on service 0.7.13 with managed selection. Production launch orchestration,
rollback and stopping-handoff qualification remain open; no reboot was performed.

### Managed short-job baseline repair — local follow-up

The intermittent short-job failure is now reproduced deterministically: after a
tracked child exits and is reaped, its procfs stat read can raise
`DirectoryNotFoundException`, while job start previously caught only
`FileNotFoundException`. A live procfs read can also race process exit. Identity
capture now treats an I/O failure as absent start identity only when the tracked
`Process.HasExited` confirms exit. Other failures still propagate; retained-job
cancellation continues using the strict identity reader.

A Linux harness checks live identity, then forces exit before identity capture,
and verifies 64 immediate commands preserve output, exit code and retained record.
The deterministic test failed before the fix. The combined migration suite passes
124 tests without skips. This is host validation; the deployed managed payloads
on both TVs have not changed, and device qualification remains required before
calling the repair deployed. No reboot was performed.

### Retained-state receipt consumption — local follow-up

The provider now binds acceptance to the receipt returned by its own installation
operation. Acceptance reads the private durable receipt and saved snapshot,
reconstructs the expected destination plan, checks transition identity/version,
and rechecks both source inventory and installed content through the independent
provider. Local ownership is checked around every remote await. Only then does
it advance the selection journal from prepared to state-ready using the receipt
digest. Managed remains selected, admission remains the controller's responsibility,
and the installation ownership marker is retained for the launch/rollback phase.

Repeating acceptance after a lost return is idempotent only for the same receipt
and reverified remote state. Changed receipt, source, destination, saved snapshot,
marker or selection refuses progress. An unfinished selection writer prevents
remote work. This operation does not reacquire a provider after service restart.

The combined Linux suite passes 128 tests without skips. The real managed-exit /
independent-native-channel test now consumes the receipt before its host-fixture
production launch, for both ordinary and BOM-prefixed JSON. Production launch in
that test is still performed by the harness, not the installed service controller.
Journaled production launch, readiness acceptance, rollback and both-TV stopping
handoff therefore remain open. The deployed TV packages are unchanged; no reboot
was performed.

### Journaled production submission — local follow-up

An independent provider can now submit a production worker after accepting its
own retained-state installation. The launch binds the accepted receipt, source
identity, target manifest, packaged worker/launcher hashes and a private loopback
token. Before staging, it persists a single-use production launch record and
ownership marker. The generated command revalidates all installed records, rejects
an existing unit, stages root-owned code/launcher/token, checks source departure
again and requests production mode with no bounded probe lifetime.

Submission acknowledgement only changes the launch journal to submitted. It does
not mark a worker ready, commit selection, release admission or retire the
independent provider. A lost/failed result retains unknown ownership and refuses
replay. Local ownership drift retains the original intent instead of overwriting
newer state. A partial staging directory is not automatically adopted or removed.

The combined Linux suite passes 135 tests without skips. Shell tests exercise
actual filesystem ownership, hashes, retained record preservation and source-exit
guards, including maximum retention command size. Systemd submission is a fixture
in these tests; no production unit was launched on either TV. The private listener,
production readiness record, uncertain-launch reconciliation and rollback still
need integration before installed stopping handoff can be enabled. Deployed .NET
fallback and both TV boots remain unchanged.

### Production readiness acceptance — local follow-up

The independent provider now verifies its submitted production peer before a
state-ready transition can become trial-ready. Readiness requires the expected
root/System peer, production lifetime/capabilities, staged launcher digest,
empty owned-resource inventory and distinct source/provider/production process
identities. Two matching unit observations bind the guardian and monotonic unit
start. Independent shell checks verify live process start identities/executable
paths, staged artifacts, consumed token, import manifest and retained bytes in
both source and destination. Every retained record is also read through the new
worker's job-status operation and compared with the expected saved-record result.

The ready launch record is durably published before the selection journal gains
its readiness digest. Selection remains managed and pending, and the production
ownership marker remains. Drift, disconnects and publication uncertainty retain
reconciliation evidence; a ready record alone cannot bypass an unfinished
readiness intent or authorize launch replay.

The combined Linux suite passes 141 tests without skips. The real managed-exit
integration now verifies a staged production native worker via a separate native
provider, including actual procfs/executable/file checks and ordinary/BOM job
records. Systemd state and unavailable host Smack/mount setup remain fixtures;
this does not establish on-TV production readiness. Maximum-retention command
size, identity/unit drift, changed resources/records and lost ready-publication
acknowledgement are covered. The private production listener, recovery of partial
publication, controller adoption/rollback and both-TV stopping handoff remain
open. Deployed packages and TV boots are unchanged.

### Private production session and channel transfer — local follow-up

A production session now owns the private loopback listener and random token,
invokes the independent provider's launch/readiness operations, and validates the
result against durable trial evidence. It removes unused token material only for
failures before submission; all uncertain launch/readiness/disconnect outcomes
retain ownership evidence. The listener deadline is distinct from the bounded
readiness check. Transport closure never claims process or staging cleanup.

The channel is available exactly once after the controller commits the matching
trial, with the selected manifest, state receipt, readiness receipt and latest
history entry all matching. Adoption rechecks the live worker identity and local
ownership; a mismatch closes transport and requires reconciliation. This session
does not itself commit selection, retire the provider, clear launch markers or
implement rollback.

The combined Linux suite passes 147 tests without skips. The real-process test
now uses this listener/token/session through authenticated production readiness,
a test-harness commit and channel transfer, then reads retained state and shuts
down. Both ordinary and BOM-prefixed records survive. Host staging/systemd and
Smack/mount boundaries remain fixtures. The exact app-state fixture is serialized
across test processes. Timeout, listener failure, premature adoption, identity
drift, duplicate adoption and disconnects are covered separately.

Installed-controller adoption, interrupted-session recovery, rollback and both-TV
stopping-handoff validation remain open. The TV packages and boots are unchanged;
.NET remains deployed. The host-harness commit is not a native-default rollout.

### Agent ownership transfer — local follow-up

The held agent can now adopt a production session only after its source shutdown
and observer cleanup completed, the exact source inventory matches the committed
trial, and fresh native status confirms the recorded worker/guardian identity,
production capabilities, launcher and empty owned-resource inventory. Source-exit
and readiness receipts are copied before use so later caller mutation cannot
change the held evidence.

The agent advances its generation before closing the stopped managed listener.
Late source callbacks therefore cannot overwrite native state. The adopted
channel has a disconnect handler that retains the hold and requests reconciliation
without scheduling managed reacquisition. Adoption is one-shot, and uncertainty
closes the supplied session. Public admission remains held; this change does not
yet enable serving requests from the adopted native peer or native cold startup.
Provider retirement and final transition completion must precede admission release.

The combined Linux suite passes 148 tests without skips. Agent ownership-swap
unit tests cover pre-shutdown/precommit refusal, identity/selection drift, stale
callbacks, duplicate adoption, retained admission and disconnect behavior. The
separate real-process session/readiness integration remains passing. Installed
controller orchestration, admission release, rollback/recovery and both-TV handoff
remain open. Deployed packages and TV boots are unchanged.

### Provider retirement and live admission release — local follow-up

The adopted agent can now retire its matching temporary provider using the new
native channel as the independently checked executor. Activation consumes the
complete retirement receipt, rechecks the inactive/missing unit and absence of
the provider's process identities/staging, and confirms the production identity
before removing local production token material and transition markers. A durable
activation intent covers partial cleanup/publication. Failure retains the hold;
an active receipt with an unfinished intent is not automatically adopted.

After activation and another fresh status check, the agent admits requests only
for the bound channel/generation and exact committed selection. Cold startup is
still governed by the existing selection launch policy; live admission does not
permit an unverified native restart. Disconnect clears live admission without
starting a managed replacement. Provider, source and production identities must
remain distinct.

The combined Linux suite passes 153 tests without skips, followed by targeted
activation/admission reruns after tightening identity/selection binding. Tests
cover incomplete provider cleanup, altered token/receipts, live/replaced provider,
native drift, lost activation publication, blocked requests before completion and
successful routing afterward. Agent retirement/activation uses fixture evidence
in these unit tests; this is not an installed both-TV handoff result. The separate
real native session/readiness tests remain passing.

Full orchestration, interrupted-transition recovery, rollback, native cold-start
integration and both-TV qualification remain open. Deployed packages and TV boots
are unchanged; .NET remains deployed as fallback.

### Coordinated live handoff — local follow-up

The internal agent migration entry point now coordinates candidate/baseline checks,
admission drain, selection intent, independent provider preparation, source stop,
retained snapshot/install/acceptance, production session/readiness, selection commit,
channel adoption and retirement/activation. The provider is prepared under the
held source identity and cannot race source shutdown while startup is pending.
S90D's external observer retirement uses that same prepared provider.

The controller is single-use. Pre-handoff refusal releases only a hold it acquired
before a selection intent could have published. After begin, uncertainty keeps
admission held and retains live session references for explicit recovery instead
of discarding useful access or replaying launches. Agent stop closes retained
transports and prevents the controller progressing through its next phase. Status
reports the migration phase/transaction without token or command contents.

The combined Linux suite passes 159 tests without skips. Controller tests use real
selection journals with operation fixtures to verify order, each failure boundary,
preexisting ownership refusal and cancellation. Separate live managed/native
session tests and the provider-preparation/admission tests remain passing. This
is not yet a full installed controller run on a TV. No public migration endpoint
is enabled by this change; rollback and interrupted-transition recovery remain
required before on-TV cutover. Native cold startup and broader sunset gates also
remain open. Deployed packages and TV boots are unchanged.

### Live-channel activation reconciliation — local follow-up

Activation now has an explicit resume mode for the ordered local cleanup windows:
a removed token, an empty/removed token directory, each marker removal, published
activation with a remaining intent, and a fully published receipt whose return
was lost. Partial cleanup requires the exact durable intent. A completed receipt
without an intent is accepted only with the fully cleaned layout. Every resume
rechecks the native identity, committed selection, original receipts and remote
provider absence; it neither launches a worker nor repeats provider shutdown.

The held agent retains the completed retirement receipt before activation begins.
Its explicit completion retry reuses that receipt, excludes concurrent completion,
and keeps admission held on failure. The migration controller exposes this retry
only after its activation phase failed; earlier handoff failures cannot skip ahead.

The combined Linux suite passes 163 tests without skips. Fault tests interrupt
after every cleanup/publication boundary, then verify matching resume and repeated
receipt readback. Missing/changed intents, foreign directory entries, changed
markers and changed native identity refuse recovery. Agent/controller tests prove
provider retirement and earlier handoff phases are not replayed.

This recovery requires the verified production channel to remain alive. Service
restart/provider reacquisition, earlier launch/readiness reconciliation, rollback,
native cold startup and both-TV qualification remain open. Deployed packages and
TV boots are unchanged; .NET remains deployed as fallback.

### Assembled package qualification — 2026-10-14

Signed 0.7.14 candidate packages have been prepared privately for both TV profiles
through the shared builder. Each contains 53 signed members. The signed inventories
were reviewed against the installed 0.7.13 packages, and each assembled service
loads successfully, verifies its packaged native candidate and retains managed
selection. Seven API tests and six package-update tests pass. Private provisioning
keys/client configuration were excluded from the signed packages.

These artifacts are prepared, not installed. A fresh read-only status check found
both TVs ready on managed selection with admission released and unchanged boot
identities. The deployed baseline remains 0.7.13; no TV mutation or reboot was
performed during preparation. This validates package assembly, not native cutover,
rollback, restart recovery or the remaining sunset gates.

### Native retained-state export for rollback — local follow-up

A read-only native rollback snapshot now binds the production transaction, worker
and guardian identities, and original installation receipt. It requires the original
managed source plus production worker/guardian to be absent on the same boot,
checks the native lock and import-manifest metadata, rejects unresolved guardian,
intent, repair or partial-write entries, and compares inventories around byte reads.
Records use the existing importer validation contract and remain byte-preserved.

The result records the current native inventory exactly. Downstream managed
restoration must replace state from that inventory instead of merging the old
managed directory: a job explicitly forgotten under native must not reappear.
This change does not yet install rollback state or start/select a managed worker.

The combined Linux suite passes 168 tests without skips. Tests cover empty/full
retention, live worker/guardian/source refusal, metadata conflicts, changed inventory,
and forgotten records. The real-process integration exports through an independent
native connection after production shutdown, preserving ordinary and BOM records.
Both TVs and their deployed packages remain unchanged; no reboot was performed.
The prepared 0.7.14 artifacts predate this source-only export addition.

### Exact managed rollback replacement — local follow-up

The managed restore command plan binds the stopped native production identity,
original installation receipt and original managed snapshot. It builds a fresh
inventory, checks every byte digest and file/directory owner/mode, then preserves
the old managed directory before publishing the replacement. Forgotten native
records are not merged back. Ordinary and BOM-prefixed bytes remain unchanged.

Inspection distinguishes fully staged state, the interruption between the two
directory moves, and completed publication. Resuming publication requires an
absent managed destination, exact staged inventory and exact preserved baseline;
replaying either completed move is refused. Live source/native processes, changed
records, extra entries and links prevent replacement. The original backup remains
available. An absent empty managed inventory is normalized only when the original
snapshot is empty. Commands fit the protocol limit at full retention.

All 23 focused Linux retained-state/import/restore tests pass without skips. These
are actual filesystem/shell tests in a disposable container, not TV rollback
qualification. This module only produces commands: durable controller intent,
current native snapshot revalidation around restoration, admission ownership,
early partial-copy reconciliation, managed restart/readiness and selection rollback
must still be integrated before live use. Both TVs remain unchanged on managed
fallback; no reboot or native production cutover was performed.

### Durable managed state restoration — local follow-up

Managed restoration now saves a private intent, complete input snapshot and receipt
before submitting remote changes. It binds the production/readiness record,
original installation and baseline snapshot to a held selection transition. It
supports both rollback of a failed native trial and a new return transition after
native selection was committed. Every remote operation checks unchanged local
ownership/selection; native records are independently re-read before mutation,
before each directory move and after publication.

Resume inspects exact remote state rather than replaying completed moves. It can
continue an absent destination, a partially copied inventory of complete verified
records, the directory-swap gap or a completed publication whose reply was lost.
Changed or truncated records, missing ownership metadata and unexpected entries
remain unresolved and refuse automatic overwrite. The restore marker, original
baseline backup and pending selection remain until managed readiness is accepted.
The caller must retain exclusive admission/controller ownership throughout.

The combined Linux suite passes 174 tests without skips. Lost-reply tests cover
begin, record copy, baseline retirement and replacement publication. Drift tests
cover native inventory, local marker, selection and durable production receipt.
The real-process integration restores through an independent native connection
after production shutdown, preserving ordinary and BOM-prefixed bytes and checking
the retained baseline. Systemd/Smack/mount boundaries remain host fixtures.

This is state restoration, not completed rollback: managed restart/readiness,
selection acceptance and controller wiring remain open. Neither TV was changed or
rebooted; .NET remains the deployed fallback. Full native cutover and sunset gates
remain unfulfilled.

### Managed restore acceptance gate — local follow-up

A restored-state receipt can now advance the pending selection state only after
rereading its complete saved inputs, production/installation/baseline receipts,
current native inventory, restored managed inventory and preserved original
backup. Selection and local ownership are checked around every asynchronous
operation. A failed native trial advances to rollback-state-ready; a new return
transition after native commit advances to state-ready. Neither path commits
selection, starts a worker, removes the restore marker or releases admission.
Repeated acceptance verifies the same evidence again without adding a revision.

The combined Linux suite passes 177 tests without skips. Tests reject altered
receipts/digests/markers, pending selection writers, changed source/destination/
backup inventories and mutations during verification. Both real-process ordinary
and BOM record round trips include acceptance through the independent native
connection. These remain host results with fixture systemd/Smack/mount boundaries;
managed launch/readiness and controller integration are still required. Both TVs
remain unchanged on their deployed .NET fallback; no reboot occurred.

### One-shot managed rollback launch — local follow-up

Accepted rollback state can now produce a journaled managed-worker submission
through an independent executor. The launch binds the selected managed package
version, individual managed assembly/config/dependency hashes, runtime hash,
restoration receipt, boot/source identities, callback port and private token.
It reaccepts restored state before persisting exclusive launch intent. Remote
checks require absent staging/unit names, expected package/token metadata and
unchanged restored inventory. The managed assembly runs from root-owned read-only
code in a private systemd mount namespace; its writable token/status staging
remains beneath the worker's existing allowed SDK root. No acquisition launcher
is invoked by this rollback path.

Acknowledgement records submitted only. Lost replies retain unknown ownership
and refuse another launch; neither submission nor a copied package marks a worker
ready or changes selection. Partial staging/uncertain launch reconciliation still
requires the forthcoming session/readiness controller.

The combined Linux suite passes 181 tests without skips. Launch tests execute
actual staging/check commands against disposable files with fixture systemd tools,
cover full 64-record retention and command bounds, and reject runtime/token/package/
unit/selection drift. They do not run the TV-managed entry point or qualify this
systemd invocation on-device. Read-only inspection confirmed /usr/bin/dotnet is a
regular root-owned mode-755 file on both TVs. Neither worker nor TV was restarted;
both deployed .NET fallbacks remain unchanged. Managed session/readiness, cleanup,
controller integration and full native migration qualification remain open.

### Managed rollback readiness evidence — local follow-up

Managed readiness now binds the authenticated root/System peer to a distinct
worker identity, stable systemd unit, pinned runtime and exact command line. An
independent executor checks the live process start ticks, private mount namespace,
read-only code and launcher mounts, staged assembly/config/dependency hashes,
consumed token and launcher bytes. Restored state is reaccepted before inspection;
retained job results must match the saved records with no output available, and
resource inventory must be empty. Identity, unit and files are checked again
before publishing a durable ready receipt.

Readiness keeps selection pending and leaves both launch/restore ownership markers
in place. Publication uncertainty retains the readiness intent and prevents an
implicit second attempt. Managed-unit inspection has its own restricted namespace.

The combined Linux suite passes 186 tests without skips. Tests execute runtime
checks against disposable files/proc/mount fixtures, cover full retention and wire
bounds, and reject identity/resource/job/runtime/launcher/mount/command-line drift,
unit changes, local ownership changes, disconnection and lost publication replies.
These are host checks, not a live TV managed restart: the new readiness tests use
fixture peers and unit/proc/mount evidence. Session ownership, controller adoption,
provider retirement, selection commit and interrupted-readiness recovery remain
open. Both TVs and their deployed .NET fallbacks are unchanged; no reboot occurred.

### Managed rollback session ownership — local follow-up

A managed session now owns a private loopback listener and durable random token,
binds the submitted launch to the accepted restoration transition, and obtains
readiness through the independent provider. A failed trial retains its rollback
state gate; returning from committed native selection advances to a managed trial
only after verified readiness. The general channel is transferred once, after the
exact corresponding selection commit, with fresh identity/launcher checks and
unchanged token, restoration input, ready receipt and quiescence/history binding.

Listener failures remove unused private material. Submitted/unknown launches,
failed readiness and disconnects retain ownership evidence. Connection and
readiness deadlines also terminate waiting when a provider callback stalls;
closing the socket is never reported as process or resource cleanup. No public
migration endpoint or automatic rollback is enabled by this module.

Session tests cover both transition forms, precommit refusal, changed identity,
launcher/token/input/history, listener failure, stalled callbacks and disconnects.
A real managed harness authenticates to the actual listener, transfers its channel
after commit, executes a command and shuts down successfully. That test normalizes
the host Smack field and supplies fixture readiness/systemd evidence; it does not
qualify a TV launch, retained-state restart or full rollback controller. Both TVs
remain unchanged. Provider retirement, agent adoption/activation, controller
integration and interrupted session recovery remain open.

The combined Linux suite passes 195 tests without skips. No TV restart or reboot
was performed; .NET remains the deployed fallback.

### Held-agent managed adoption — local follow-up

An existing stopped handoff can now adopt its verified managed rollback session
without releasing admission. Adoption binds the original managed source/version,
original native production record and target, restored-state receipt, committed
rollback/return history, managed readiness digest and fresh peer identity/resources.
It supports the still-held handoff before native adoption and after native channel
adoption; it does not create a new rollback hold for an already activated native
service. The latter still requires controller work.

The agent invalidates old callbacks before closing the prior listener, records the
new managed channel under a new generation, and refuses public operations until
completion. Managed disconnection keeps the hold and does not schedule acquisition.
Native completion cannot accidentally activate a managed adoption. Failed adoption
retains the hold and requires reconciliation rather than taking another channel.

The combined Linux suite passes 196 tests without skips, and all seven API tests
pass. Agent tests use fixture channels/receipts and cover both held-source cases,
stale callbacks, identity/selection/receipt drift, blocked admission and disconnect.
They are not full rollback or on-TV acceptance. Managed completion still needs
provider retirement, transition cleanup, activation and controller orchestration.
Both TVs remain unchanged on .NET; neither was restarted or rebooted.

### Stopped native production retirement — local follow-up

Native production staging can now be retired only after a matching managed ready
receipt and committed rollback/return selection. The durable cleanup intent binds
the original native identity/unit, restored snapshot and installation, managed
readiness and transition. Checks require the original source and native processes
to be absent, the exact native file inventory/metadata/hashes, unchanged managed
restoration and preserved baseline, and the recorded systemd unit's successful
exit with the original monotonic start identity. The unit is stopped without a
blocking stop call and observed inactive before a second inventory check and
explicit file removal. No recursive deletion or arbitrary target path is used.

Remote cleanup records staging-retired only. Local tokens and launch/restore
markers remain owned for activation; a lost reply leaves the cleanup intent and
refuses repeated deletion. Changed native records, code, extra entries, unit
identity, managed identity and restoration receipts refuse cleanup. A partial
cleanup or lost acknowledgement still needs explicit reconciliation.

Host tests execute filesystem checks/removal with fixture unit/proc state and
cover preservation of the managed inventory/baseline, lost replies and full
retention within the protocol bound. This is not live TV cleanup qualification or
full rollback completion. Agent/controller wiring, local transition cleanup and
managed activation remain open. Both TVs remain unchanged on .NET; neither was
restarted or rebooted.

The combined Linux migration suite passes 200 tests without skips.

### Completed production cleanup reconciliation — local follow-up

Production retirement has an explicit read-only resume path for completed remote
cleanup whose reply was lost, published cleanup whose acknowledgement was lost,
and repeated receipt readback. Resume requires the exact durable intent or exact
published receipt, unchanged managed identity/selection/restoration/baseline, absent
native staging and stopped original native processes. The unit must be absent or
inactive; a remaining loaded unit must retain its original start identity and
successful exit status. Resume never issues stop, rm or rmdir.

Missing/changed ownership, partial staging, an active unit or changed managed
records refuse reconciliation. A completed remote state can publish the matching
receipt and clear its intent; repeated verification leaves the receipt unchanged.
Partial deletion recovery remains open and is not implicitly treated as complete.
Tests cover lost replies/publication, repeat readback and these refusal cases.
Both TVs remain unchanged on deployed .NET; no restart or reboot was performed.

The combined Linux migration suite passes 202 tests without skips. These are host
results; activation/controller integration and both-TV qualification remain open.

### Explicit partial production cleanup recovery — local follow-up

Interrupted native deletion can now be resumed with an explicit partial-finish
option. Unlike default read-only resume, this requires the exact pending cleanup
intent and no published completion receipt. It verifies an inactive/absent unit
(with original successful start/exit identity when loaded), stopped source/native
processes, unchanged managed restoration and backup, and every remaining native
entry before removing anything. Only a subset of the recorded files/directories
is allowed; existing files retain their expected hash, owner, mode and link count.
All entries are checked before the remaining explicit files and empty directories
are removed. No recursive deletion, wildcard target or unit stop is issued.

Tests interrupt before deletion, between file removals and between directory
removals, then verify completion and unchanged managed records. Unexpected entries,
changed bytes, file/directory links, changed units and missing intents refuse all
removal. Published completion cannot authorize partial deletion again; default
read-only receipt verification remains available. Full retention is included.
These are disposable host filesystem/unit-fixture tests, not on-TV qualification.
Both TVs remain unchanged on .NET; neither was restarted or rebooted. Activation
and controller integration remain required before live rollback qualification.

The combined Linux migration suite passes 204 tests without skips.

### Combined managed completion evidence — local follow-up

A final completion verifier now checks the managed ready record, committed
selection, exact restored state, completed native production retirement and
completed independent-provider retirement together. It requires provider tokens
and pending teardown/readiness entries to be absent, rechecks the provider's
processes/staging and inactive unit, verifies the managed unit/start identity,
runtime/command line/private mounts/staged files, and confirms the same managed
identity with empty resource inventory around those checks. The production cleanup
receipt is reverified through its completed read-only resume path.

The result is verification evidence only: no activation receipt is published,
no launch/restore marker is removed and admission is not released. This closes the
combined evidence check needed before ordered local activation cleanup. Tests use
actual shell/filesystem checks with fixture process/unit/channel state and reject
unresolved provider ownership, revived native staging, changed units/runtime,
identity drift and unexpected managed resources. Both TVs remain unchanged on
.NET; neither was restarted or rebooted. Local activation cleanup, controller
completion and on-TV migration qualification remain open.

The combined Linux migration suite passes 206 tests without skips.

### Ordered local managed activation — local follow-up

Managed activation now verifies combined live completion evidence, validates the
matching local tokens/markers, and persists an intent containing the exact cleanup
steps and bound activation record. It rechecks completion before removing native
ownership (when still present), then managed token ownership and transition markers,
and publishes the active receipt last. Historical snapshots, readiness records,
cleanup receipts and the preserved baseline remain available.

A native token/marker set already absent is accepted only with its prior activation
receipt and matching committed native history. Partial native ownership, changed
tokens and foreign token-directory entries refuse fresh activation. Local failure
or uncertain publication retains the activation intent and refuses implicit replay.
Explicit interrupted-activation recovery remains required before controller use.
This function publishes evidence; the held agent still must verify and release
admission through its completion path.

Tests cover successful ordered cleanup, both retained and previously retired native
ownership, mismatched/partial token state, and failures after token removal, marker
removal and receipt publication. They use disposable host state and fixture units,
not live TV activation. Both TVs remain unchanged on .NET; neither was restarted
or rebooted. Recovery/controller wiring and both-TV qualification remain open.

The combined Linux migration suite passes 210 tests without skips.

### Held managed rollback completion — local follow-up

The held agent now completes a freshly adopted managed rollback by retiring stopped
native production staging, retiring the matching independent provider through the
managed channel, and publishing managed activation after combined verification.
It confirms the same boot, channel, process identity, selection and empty resource
inventory around every command and again before releasing admission. Original
source callbacks remain invalidated. Failure at any phase retains admission and
refuses implicit replay; this entry point does not yet resume interrupted activation.

Agent tests exercise ordered completion from a failed native trial and from a
still-held adopted native worker, foreign-provider rejection before cleanup,
cleanup/provider/activation failures, final identity drift, public command admission
only after success, and refusal to repeat completion. These are host orchestration
fixtures; the underlying cleanup and activation modules have separate filesystem
and unit-fixture coverage. No TV deployment, worker restart or reboot was performed.
Both TVs retain their deployed managed fallback. Explicit activation recovery,
full rollback controller wiring and on-TV stopping handoff remain open.

The combined Linux migration suite passes 210 tests without skips. The tracked-file
privacy audit reports no findings across 607 files.

### Interrupted managed activation recovery — local follow-up

Managed activation now supports explicit resume from its durable cleanup intent.
It reconstructs the exact allowlisted steps from verified restoration records and
requires the saved intent to match current completion evidence. Missing entries
must form an ordered prefix; remaining tokens, directories and markers retain
expected bytes, ownership and modes. Published activation requires all cleanup
steps absent. A completed receipt can be reverified without replaying deletion.
Previously activated native ownership still requires its original activation
history when resuming the shorter managed-only cleanup sequence.

Completed native production retirement has a separate read-only verification mode.
It requires an exact published retirement receipt and no retirement intent, checks
live absence and restored state, and cannot publish or remove entries. This allows
combined runtime verification after activation has removed launch markers without
recreating those markers or weakening the mutation path's ownership requirements.

The held agent permits explicit activation retry only after both retirement phases
returned successfully and activation began. It retains admission on uncertainty,
rechecks the managed channel and selection, and does not replay provider or native
retirement. Earlier cleanup failures cannot skip forward through this retry.

Tests cover token/directory/marker/publication interruptions, completed readback,
previously activated native ownership, mismatched intents, missing intents,
out-of-order removal, extra entries, changed tokens/runtime/receipts, and agent
retry ordering. These are local fixtures, not on-TV qualification. No device was
changed or rebooted; .NET remains deployed. Full rollback controller orchestration,
earlier-phase reconciliation and live handoff/rollback qualification remain open.

The combined Linux migration suite passes 211 tests without skips. The tracked-file
privacy audit reports no findings across 607 files.

### Independent provider managed-rollback adapter — local follow-up

The authenticated independent provider now exposes native retained-job snapshot,
managed restoration/acceptance, managed launch and managed readiness operations.
It pins the native record to its original managed source and boot, excludes its own
worker/guardian from the retiring native identity, and retains copies of verified
snapshot inputs, restoration receipts and launch records internally. Caller-supplied
executors, replacement records or receipt identifiers cannot replace those bindings.
Entering rollback prevents subsequent forward state installation or native launch.

Each phase verifies the same idle provider before and after work, uses its bounded
executor, serializes operations, and is single-use. An uncertain phase poisons the
adapter rather than allowing replay. This supplies the missing provider methods
required by the existing managed-session listener and readiness path. It does not
yet add the top-level rollback controller or recovery of a poisoned provider.

Adapter tests cover phase prerequisites/order, source and boot mismatch, provider
process overlap, mutation of returned records, caller override attempts and unknown
outcomes at every phase. Lower-level filesystem and wire tests remain separate;
this adapter coverage is not an integrated TV rollback. No device was changed or
rebooted, and .NET remains deployed. Native shutdown under held admission, complete
controller orchestration, earlier-phase reconciliation and live validation remain
required. The provider's existing bounded lifetime is unchanged.

The combined Linux migration suite passes 214 tests without skips. The tracked-file
privacy audit reports no findings across 607 files.

### Independent native exit evidence for rollback — local follow-up

The rollback provider can now prepare a read-only observation of the native worker
and guardian before shutdown, then wait for both original process identities to
exit. It reads procfs through its independent authenticated executor, preserving
stat bytes for the shared parser and checking the boot around each observation.
Initial binding requires both identities present and the original running unit;
completion requires both absent/reused plus the same unit's successful exited
state. A worker disconnect or BYE alone is insufficient. The observer never signals
processes or removes staging, and rejects unreadable/malformed data, changed unit
start identity, failed termination and deadline expiry.

The provider pins the prepared native record, forbids a snapshot while its exit
observation is unresolved, and permits the bound wait only once. Unknown binding
or exit outcomes poison the provider and cannot authorize restoration. Fresh live
status/quiescence confirmation and the actual shutdown call still belong in the
held controller; this observation API alone does not stop a worker or release
admission. It complements the existing lower-level exit observers rather than
relying on service-thread access to root procfs.

Tests cover delayed guardian completion, PID reuse, failed/malformed reads, changed
unit identity, timeout, no replay, snapshot gating and provider failure. Linux shell
fixtures exercise actual procfs-format transport/parsing and boot guards; systemd
state remains simulated. This is not on-TV qualification. No TV was changed or
rebooted; .NET remains deployed. Held native shutdown and full rollback controller
integration are the next required steps.

The combined Linux migration suite passes 221 tests without skips. The tracked-file
privacy audit reports no findings across 609 files.

### Held adopted-native shutdown for managed return — local follow-up

The existing handoff hold now inventories its adopted native channel and can stop
it for an explicitly prepared return-to-managed transition. It binds the new
selection's quiescence digest to settled resources, the native ready receipt and
original managed version. The independent provider binds both native processes;
the agent then reconfirms inventory and selection before writing and syncing a
single-attempt native-stop record and issuing shutdown. Successful independent
exit evidence publishes a stopped receipt. Unknown shutdown/exit outcomes retain
the submitting receipt and admission hold, and cannot implicitly repeat shutdown.

Managed adoption after native adoption now requires this verified native stop.
Native activation cannot race a pending shutdown, and stale source callbacks remain
invalidated. This supports return within the original held handoff; creating a new
hold for an already activated native service remains separate work.

The retirement session now forwards the rollback methods added to its underlying
provider. It also owns the prepared exit-observation handle and refuses provider
retirement between binding and successful exit confirmation. Failed binding or
observation retains that guard; closing transport does not claim cleanup.

Tests cover the complete held native-stop-to-managed-adoption sequence, journal
publication before shutdown, changed identity/selection, an existing stop record,
lost shutdown reply, failed exit observation, blocked public admission and no
implicit replay. Session tests verify method forwarding and retirement exclusion
while exit evidence is pending or uncertain. These are local orchestration tests;
no TV was changed or rebooted, and .NET remains deployed. Top-level return/rollback
orchestration, interrupted-stop reconciliation, active-native holds and both-TV
qualification remain open.

The combined Linux migration suite passes 223 tests without skips. The tracked-file
privacy audit reports no findings across 609 files.

### Held trial return controller and rehearsal path — local follow-up

A return-to-managed controller now connects the original held native trial to
managed restoration and activation. Before starting, it verifies the committed
native selection, package-bound original managed version, native ready record,
installation receipt and baseline snapshot. It drains the held native inventory,
begins a separately journaled managed transition, stops native through the verified
provider path, snapshots/restores retained jobs, accepts restored state, opens the
managed session, commits readiness, adopts its channel and completes activation.
Admission remains held until the existing final completion checks pass.

The native migration controller has an explicit internal rehearsal mode requiring
a pinned managed runtime digest before acquiring admission. After native adoption
it returns to managed through that controller instead of releasing native admission.
The agent exposes internal rehearsal and managed-activation-resume methods; no HTTP
route or deployed default is enabled. This exercises a committed but still-held
trial, not return from an already activated native service or recovery of a native
launch that never produced a verified ready record.

Failures retain the hold and live sessions; ordinary retry is refused. Only a
failed final activation can delegate to explicit managed activation recovery.
Closing the controller while a listener resolves prevents commit and closes the
returned transport. Local controller tests use actual selection journals and
retained-state preflight validation with operation/session fixtures; they cover
phase order, every failure boundary, stale ownership, stopped-controller races,
rehearsal routing and activation retry. Full real-process rehearsal and both-TV
qualification remain required. No TV was changed or rebooted; .NET stays deployed.

The combined Linux migration suite passes 230 tests without skips. The tracked-file
privacy audit reports no findings across 611 files.

### Real-process held rehearsal — local Linux qualification

The complete agent/controller rehearsal now passes with real managed source,
independent native provider, native production worker/guardian and restored managed
processes. It uses actual authenticated listeners, protocol commands, process exit
observation, retained-state installation/restoration, selection journals, channel
adoption, production/provider teardown and activation cleanup. The held native
trial forgets one original job and creates a completed job with a one-time side
effect. After return, managed reports both preserved outcomes, the forgotten job
remains absent, original retained bytes match, and the side effect occurred once.
Public commands resume only after managed activation. Both retired native scopes,
provider tokens and pending ownership markers are independently checked absent.

A second real-process run injects a lost acknowledgement after managed activation
publication. Admission remains held, public execution refuses, and explicit
activation recovery rechecks the completed state before reopening requests. Neither
retirement nor the recorded job runs again. Both runs pass without skips.

This test intentionally runs alone in a fresh disposable Linux container because
it owns the real `/opt/couchroot-agent` fixture directory. Enable
`COUCHROOT_REHEARSAL=1` and `COUCHROOT_PARITY_CONTAINER=1`, provide the existing
`NATIVE_WORKER` and `MANAGED_PARITY` host test builds, and run
`node --test tests/native-rehearsal-integration.test.cjs`. The container needs the
existing SYS_PTRACE capability, disabled seccomp filter and disabled core dumps.
The restart suite also needs Docker's `--init` to reap orphaned EXITKILL victims
after guardian loss. The native host build stubs Smack/mount setup and must never
be deployed.

Boundaries remain explicit: artifact staging and process launch substitute host
binaries for signed TV packages; systemd inspection/stop uses a fixture tied to
real child exit state; credentials are normalized for the host; managed runtime
mount/staging checks are replaced by real process/executable and restored-state
checks. The other production controller and cleanup code is loaded unchanged.
This establishes integrated wire/process/state behavior, not TV runtime, signing,
mount-policy or power-lifecycle qualification. Both TVs remain unchanged on .NET;
neither was restarted or rebooted. Both-TV rehearsal and unresolved earlier-phase
recovery remain open before native-default or sunset decisions.

### Journaled asynchronous rehearsal administration

The candidate API now journals rehearsal intent before asynchronous dispatch and
returns HTTP 202. Authenticated status and journal reads stay available while
other administrative writes are refused. Explicit final managed-activation
recovery binds a distinct request ID to the original uncertain rehearsal. Unknown
original entries remain submitted even after a separately recorded recovery.
Restart preserves journal replay protection, not live controller handles.

The Python client exposes rehearsal, status and activation recovery without
submission retries. Agent preflight rejects missing or mismatched enrolled
managed-runtime pins and firmware mismatch before creating the controller or
holding admission. This is a configuration-pin check; runtime byte verification
remains in managed launch, and earlier live-byte preflight remains to be added.

Validation: 38 Node API/readiness/task tests, seven Python client tests and both
isolated real-process Linux rehearsal cases pass with no skips. The latter cover
normal return and lost final activation acknowledgement with explicit recovery.
The host fixture now supplies its actual managed runtime pin. These results do
not qualify TV execution. Both deployed TVs are unchanged; .NET remains fallback,
and neither TV was rebooted.

### Early live fallback runtime verification

Rehearsal now hashes the fixed `/usr/bin/dotnet` path through the current managed
worker before creating the migration controller. The enrolled pin, firmware
version, regular non-symlink file, successful command result and unchanged worker
generation must all agree. This is a read-only preflight: failure refuses migration
before admission hold, selection intent, provider staging or source shutdown.
Managed launch retains its later byte verification to detect subsequent drift.

Focused tests cover hash mismatch, timeout, transport uncertainty and worker
replacement; no migration starts on these failures. For failures that leave the
channel connected, ordinary commands remain available. Both real-process Linux
rehearsals pass with the actual host runtime hashed through the managed wire;
the fixture substitutes only the host runtime pathname for this new check.
No device changes or reboots were performed. Earlier-phase and service-restart
recovery, both-TV qualification and the remaining sunset gates are still open.

### Lost native shutdown acknowledgement

Held native return now runs its already-bound independent exit observer even if
the single shutdown submission loses its response. The shutdown receipt records
`acknowledged: false, outcome: unknown`; only independently verified worker and
guardian exit plus successful termination of the original systemd unit permit a
`stopped` receipt and managed restoration. No shutdown retry is sent. If exit
observation also fails, the submitting receipt and admission hold remain intact.
Ownership and journal checks still run before and after observation.

The real-process rehearsal adds a third case that discards the actual shutdown
response, verifies one submission, and completes retained-state restoration,
managed activation and scope cleanup. All three isolated Linux rehearsals pass.
A separate Linux run passes 46 controller, readiness and exit tests without skips,
including lost-response plus failed-observation refusal. Coordinator restart and
independent-provider loss still require further reconciliation work; this change
only handles acknowledgement loss while the bound observer remains available.
No TV was changed or rebooted, and .NET remains deployed.

### Fresh signed rehearsal candidates

Read-only device inspection confirms both TVs are reachable on 0.7.13, with
managed selected, ready workers, no admission hold and no pending shared setup
operation. Current runtime hashes and SDK settings were captured privately.

The shared setup builder prepared separate signed 0.7.15 candidates from commit
`10a7171` for QN90A and S90D. Update review verified each device's target/signing
binding, forward version and inventory against its installed 0.7.13 signed
artifact. All packaged service bytes match source; all 47 service JavaScript
files pass syntax checks and the packaged API, agent, task and migration modules
load successfully. No private provisioning material is included in either WGT.
Signed artifacts, manifests and raw device evidence remain outside Git.

These are preparation checks only: 0.7.15 has not been installed, no rehearsal
has run on hardware, and neither TV was rebooted. Installation must preserve the
existing enrollment and use the current 0.7.13 package as its recovery baseline;
older private deployment script source pointers are stale and must not be reused.

### QN90A candidate installation and bounded inventory readback

QN90A now runs the signed 0.7.15 candidate with managed selected and ready. Its
65 package members, enrollment certificates, protected files and startup flags
were checked against the expected installation. The boot ID remained unchanged,
SDK access returned to loopback, the temporary recovery timer was disarmed and
the shared installation journal completed. The new native-status API responds
with no active operation. No hardware native rehearsal has run yet; S90D remains
on 0.7.13 pending the same update.

The first post-install snapshot failed because the SDK diagnostic response omitted
middle inventory entries from its long output. The installer itself reported
success. Recovery used smaller read-only batches and the existing engine journal
to verify the installed after-state; installation was not replayed. The shared
pilot transport now reads at most 12 inventory entries per command and obtains
the SDK setting separately. Missing entries still refuse verification. Focused
large-inventory and missing-middle-entry tests pass; the full Python suite ran
360 tests successfully, with 108 environment-dependent skips. Private recovery
logs and signed packages remain outside Git. Neither TV was rebooted.

### Both 0.7.15 services installed with managed fallback

S90D's signed 0.7.15 update completed through the shared engine with bounded
inventory reads; no incomplete-output reconciliation or installer retry was
needed. Its 65 installed package files, existing enrollment, protected files and
startup flags match the expected state. The managed worker is ready, the original
boot ID is unchanged, SDK access is back on loopback and the temporary recovery
timer is disarmed. The installation journal is complete.

A final read-only check of both TVs confirms managed selected and ready, no
admission hold, no pending shared setup operation, unchanged workers/boots since
installation acceptance, and an idle native-status endpoint. Native hardware
rehearsal is still outstanding; installing the candidate does not establish
native worker readiness or migration parity. No TV was rebooted. Raw acceptance
and final-check evidence remain in the private candidate deployment directory.

### First QN90A hardware rehearsal — failed production readiness, managed restored

The first 0.7.15 hardware rehearsal reached retained-state `state-ready` after
stopping the managed source. The production launch record is `submitted`, but no
native readiness receipt was published. Independent SDK inspection found the
native production unit failed with exit status 1 and MainPID 0. The exact failure
inside startup/readiness is not yet established; the API discarded nested causes
and reported only a generic reconciliation error. This is a failed trial, not
native qualification. S90D was not trialed.

The pre-armed recovery timer restored external SDK access without a reboot.
Recovery preserved the old on-demand staging directory, closed the held service
transports, and independently verified zero production/provider main PIDs and no
matching native executables. Original managed retained state was empty before
and after the trial. With no active native processes, the failed coordinator-state
directory was archived privately on-device, a fresh app-owned state directory was
created, and the unchanged managed fallback was enabled. This was manual recovery,
not the automated rollback path. The failed journal was neither erased nor marked
successful. Native staging remains available for diagnosis.

QN90A is again managed-ready, accepts commands, uses loopback SDK access and has
the same boot ID. The original request remains unknown. The source controller now
exposes the failed phase and up to four bounded error causes to authenticated
status reads, with tests for caller mutation, long messages and cyclic causes.
This diagnostic change is local and requires a new candidate deployment. Native
hardware qualification and automatic earlier-phase recovery remain open.

### QN90A readiness failure reproduced and corrected

The archived readiness-intent marker establishes that the first native worker
connected and entered production verification. A separate native diagnostic
process, launched with the same private bind mount and production flags while
.NET stayed running, reproduced a verifier failure: QN90A exposes its executable
through `/proc/PID/exe` as `/worker`, rather than the full staging pathname.
The old literal `readlink` comparison therefore rejected the running process.
The unit's later exit status 1 alone did not establish a startup failure.

Production verification now compares `/proc/PID/exe` to the staged worker using
same-file inode identity. The existing staged-file digest, owner/mode, process
start-tick and repeated verification checks remain. A second QN90A diagnostic
passed the complete generated runtime verification command with this correction.
Both diagnostic workers were shut down, their timers disarmed and their exact
known staging files removed after confirming zero main PIDs. The original failed
migration evidence remains preserved for the broader recovery work.

Seven readiness tests pass, including alternate paths to the same inode and
rejection of identical bytes on a different inode. All three real-process Linux
rehearsals pass. Both TVs retained the same managed worker and boot throughout
these diagnostics. This validates the corrected runtime check on QN90A, not the
complete on-TV migration; packaging/deployment and both-TV rehearsals remain.

### Corrected verifier deployed to both TVs — 0.7.16

Separate signed 0.7.16 packages from `fb6fdbc` were built and reviewed against each
TV's installed 0.7.15 artifact. Signed service bytes match source and all packaged
service scripts pass syntax checks. QN90A and then S90D were updated through the
shared setup engine with bounded inventory reads and existing enrollment retained.
Each update passed installed-file, certificate, protected-file and startup-flag
verification before its installation journal was completed.

Both TVs are managed-ready, with unchanged boot IDs, no admission hold, no pending
setup operation and idle native administration endpoints. SDK access is restored
to loopback and both temporary installation recovery timers are disarmed. The
inode-based native runtime check and bounded failure-cause diagnostics are now
installed. No native rehearsal has yet been retried on this version. The earlier
QN90A failed-transition evidence remains preserved, and .NET remains selected.
Neither TV was rebooted; signed packages and raw evidence remain private.

### Inherited journal-directory setgid — rejected before handoff

The 0.7.16 QN90A retry was rejected during preflight, before a selection transaction
or worker shutdown. Inspection found the app-owned journal directory at mode
2700 after package installation. Bootstrap already permits inherited setgid, but
migration and downstream journal consumers required exactly 0700. The managed
worker remained ready on the same boot throughout. The unused SDK recovery timer
was disarmed while SDK access remained loopback. The completed test-job fixture
was explicitly forgotten after confirming its exit status; no native trial ran.

A shared private-directory predicate now consistently accepts 0700 or 2700 for
app-owned journal directories. It still rejects symlinks, other owners, group or
other access, sticky and setuid bits. It does not change existing metadata or
relax private-file/token checks. Bootstrap, migration, observer journals, retained
state, launch/readiness, rollback and completion now use the same predicate for
their shared journal parent.

All 245 Linux migration tests pass without skips. All three isolated real-process
rehearsals pass, including a complete managed/native/managed cycle under a 2700
journal parent. Focused tests cover invalid modes, file-mode strictness and
unchanged metadata; the observer fixture runs its shared predicate under the
simulated app identity. The correction is local and not yet deployed. Both TVs
remain on 0.7.16 with .NET selected; no TV was rebooted.

### 0.7.17 hardware rehearsal: canonical managed staging path

Both TVs received separately signed 0.7.17 packages through the shared setup
engine. All 48 service members matched source; installed inventory, enrollment,
protected files, startup flags, managed readiness and unchanged boot IDs were
verified before completing each installation journal. Installation rescue timers
were disarmed and SDK access returned to loopback.

QN90A's rehearsal passed native readiness, committed/adopted the native worker,
and entered the managed return. Native shutdown completed and managed retained
state was restored, but the managed launch command failed before creating its
staging directory or systemd unit. Independent inspection found that `/home` is
the TV's symlink to `/opt/usr/home`; the launch plan's symlink-parent refusal
therefore rejected its own `/home/owner/...` staging path. Earlier integration
fixtures substituted the managed launch and did not reproduce this filesystem
layout. This was a failed complete rehearsal, not hardware qualification.

The SDK rescue timer restored access without a reboot. Recovery preserved the
failed transition directory, independently checked production/provider exits and
absence of the managed unit, and verified that the retained test-job file still
matched its original digest. The unchanged managed fallback was then enabled.
Its restored job result was exit 7 with byte-identical retained data; only this
known test fixture was forgotten afterward. Both TVs are managed-ready on their
original boots with no admission hold and loopback SDK access. S90D was not
rehearsed. Original failed journals and staging remain preserved privately.

Managed launch and readiness now use `/opt/usr/home/owner/...` consistently.
Canonical parent checks remain strict. The generated-command fixture models the
TV's `/home` symlink, checks successful canonical staging, and rejects a symlink
inside the canonical parent chain. The new regression fails against the previous
launch implementation and passes with the correction. All 67 focused retained
state/readiness tests and all three isolated real-process rehearsals pass.
This correction is local, not yet deployed. Automatic recovery from this earlier
return failure and full both-TV rehearsal acceptance remain open.

### Managed entry-point argument contract retained

QN90A's 0.7.18 installation completed with managed readiness and unchanged boot,
but no rehearsal was submitted. Before handoff, inspection found a second path
constraint: the unchanged managed worker's `ValidateStagingDirectory` accepts
only the `/home/owner/share/tmp/sdk_tools/` prefix. The canonical-only argument
introduced by the previous correction would fail that startup check. S90D was
left on 0.7.17; its 0.7.18 package was not deployed.

Launch and readiness now keep canonical staging for filesystem checks and bind
the supported runtime alias to it using same-directory identity. The managed
worker receives its existing `/home/...` token and staging arguments. Unexpected
symlinks within the canonical chain and a `/home` alias to another directory are
still rejected. No managed production source or staging allowlist was changed.

A harness-only entry exposes the actual production staging validator. Generated
launch arguments now pass that validator; canonical-only and escaped paths fail.
The new regression fails against the 0.7.18 launch implementation (validator exit
64 instead of zero). All 69 focused tests pass without skips, as do all three
isolated real-process rehearsals. This closes a harness coverage gap; the latter
still substitute TV-specific process launch and are not hardware acceptance.
The argument correction is local pending packaging and both-TV deployment.

### QN90A 0.7.19 managed identity gate corrected

QN90A received the signed 0.7.19 candidate after installed-file and managed
readiness checks. Its rehearsal passed native activation, native shutdown and
retained-state restoration, then failed in managed readiness. The managed unit
had launched; its status reported peer disconnection after verification failed.
S90D remains managed on 0.7.17 and was not updated or rehearsed in this attempt.

The SDK recovery timer restored access. After independent process-exit and
retained-file checks, the failed journal was archived and the unchanged managed
fallback restored without a reboot. A separate managed diagnostic worker then
ran from copied, digest-checked payloads with the same unit properties while the
fallback stayed available. The generated runtime verification command passed
on QN90A (only the expected callback address digest was adapted for the diagnostic
host). Its authenticated identity reported Smack `User`. Read-only status from
both existing managed fallbacks also reported `User`.

The managed readiness/adoption checks incorrectly required the native worker's
`System` label. Replaying the captured diagnostic inputs locally reproduced
rejection of `User` and acceptance of `System`; changing only the managed checks
reverses that result. Native readiness retains its `System` contract. Host fixtures
now distinguish managed and native processes instead of normalizing every peer
to `System`, and managed adoption explicitly rejects label drift.

All 85 focused tests pass without skips, including managed session, production
readiness, retained state and adoption checks. All three isolated real-process
rehearsals pass. The first fixture revision failed because it matched native
worker PIDs to their guardian launch PIDs; the fixture now resolves the known
launched executable for forked native peers.

The diagnostic worker exited, its owned staging/launcher files are absent, and
its timer is inactive. Final unit stop reported that the timer had already removed
the unit; independent readback established cleanup rather than replaying removal.
The retained test job remained byte-identical with exit 7 and was then explicitly
forgotten. Both TVs remain managed-ready with loopback SDK access and unchanged
boot IDs. Original failed-transition evidence remains preserved. The managed
identity correction is local and still needs packaged hardware validation.

### QN90A 0.7.20 exit-observation race

QN90A's signed 0.7.20 update passed installed-file and managed readiness checks.
The rehearsal then stopped during independent native shutdown verification,
before managed restoration or launch. The native-stop receipt remained
`submitting`. After the SDK rescue timer restored access, independent inspection
found the native unit active/exited with MainPID 0, exit code 1 (normal exit),
exit status 0, and its original start timestamp. The provider was still running.
No abort is established by this attempt; the old observer did not retain which
process-read or unit-state predicate failed.

A concrete race was found in the remote observer: a process can disappear after
`test -d /proc/PID` and before `cat /proc/PID/stat`, causing an otherwise successful
exit to be classified as unavailable evidence. A deterministic shell test removes
the process fixture at that exact read boundary. It fails against the previous
observer and passes with the correction. The observer now attempts the read
first and accepts absence only after independently confirming the process
directory is gone. A failed read while the directory remains still fails closed.
Successful matching unit termination and both original process exits remain
mandatory. Unit-state/start/deadline and process-read failures now have bounded,
specific diagnostic messages. This fixes a demonstrated race but does not prove
it was the sole cause of the hardware attempt's generic failure.

Recovery closed the provider, independently verified process exits and unchanged
managed retained bytes, archived the failed transition, and restored .NET without
a reboot. The completed fixture still reported exit 7 and its original digest;
only that fixture was forgotten. Both TVs remain managed-ready on their original
boots, with no pending setup operation. S90D remains on 0.7.17 and was not rehearsed.
Seven focused exit-observer tests and all three isolated real-process rehearsals
pass. The observer correction is local pending hardware validation; no completed
both-TV round trip or automatic earlier-phase recovery is claimed.


### Both-TV 0.7.21 round trip accepted

QN90A and S90D received separately signed 0.7.21 packages built from `6080415`.
Each installation retained enrollment, verified installed members and protected
files, restored startup flags and loopback SDK access, and completed its shared
setup journal only after managed readiness. The actual previous signed package
was used for each device's update baseline.

Each TV then completed one installed-service rehearsal: managed admission drain,
independent provider and source-exit observation, native retained-state install,
native readiness and committed adoption, native shutdown, exact managed-state
restoration, managed readiness/adoption, provider/native retirement and final
managed activation. Selection history contains both committed transitions; final
admission is open on the managed worker. Readback confirmed current-trial staging
and transition markers absent and activation receipts present. The completed test
job retained its original bytes and exit code 7, then was explicitly forgotten.
Both recovery timers are disarmed and both boot IDs are unchanged.

The final read-only status checks confirmed the same restored managed workers,
completed rehearsal endpoints and no pending setup operations. Raw identities,
credentials, signed packages and receipts remain private. The sanitized evidence
in `roundtrip-results.json` explicitly excludes full public native parity,
native-created job migration, failure injection, restart/endurance and power-cycle
qualification. .NET remains deployed and selected; migration is not complete.

### Interrupted native exit recovered on both TVs — 0.7.23

Local review of the explicit exit-recovery path found that a failure while
publishing the stopped receipt, after independent exit verification had succeeded,
left no recovery path. The agent now retains the verified evidence before
publication; explicit recovery republishes it, or adopts the identical receipt
already renamed into place, without observing again or resending shutdown.
Provider failures now report bounded causes (earlier failure, closed or replaced
transport, deadline expiry). New local tests cover publication failure before and
after rename, a resumed return that fails at a later mutation (held, no further
resume, no replay), overlapping and repeated API recovery, and provider exit during
recovery. A fifth real-process rehearsal pauses only the real native guardian
after commit, so the exited worker stays a zombie and the real 10-second exit
deadline expires; after the guardian continues, explicit recovery completes with
one shutdown and preserved imported/native-created results. All five isolated
real-process rehearsals and the focused suites pass. Fixtures were rebuilt from
current source because the earlier host builds were not reproducible.

Signed 0.7.23 packages from `6b6016a` were installed on QN90A and then S90D through
the shared setup engine, using each TV's actual 0.7.22 package as the baseline.
Installed members (65), enrollment, protected files and startup flags verified;
boots were unchanged and rescue timers disarmed.

Each TV then ran one installed-service rehearsal with a test-only root transient
unit that waited for the new native commit, verified the guardian by unit MainPID
and start ticks, paused it with SIGSTOP and continued the same process 25 seconds
later. An SDK rescue timer and a separate continue-only safety timer were armed as
independent routes; neither was needed. No production API or package change was
made for the test. On both TVs the rehearsal stopped at `stopping-native` with
`exit deadline expired`, outcome unknown and admission held. One explicit
`POST /v1/native/resume-managed` request per TV re-observed the original bound
identities through the existing provider, published the stopped receipt and
completed restoration, managed readiness, provider/native retirement and
activation. The original rehearsal request remains submitted; the recovery has its
own completed journal entry. Retained bytes matched, current-trial scopes and
markers were absent, prior history was preserved (six committed entries) and boots
were unchanged.

The first QN90A arming attempt was refused before submission: Samsung's execution
protection rejects an unsigned shell script file. That attempt was cleaned up and
the watcher was instead passed inline to `systemd-run`, with `$` escaped for
systemd's argument expansion. On S90D, `systemd-run --wait` did not return within
the command budget during a harmless watcher check; the watcher had completed and
its leftover test files were removed explicitly.

This hardware evidence covers only the exit-deadline boundary while the live
coordinator and bounded provider remain available. Publication failure, transport
closure and provider loss are qualified locally only. Service-restart
reconciliation, earlier-phase recovery, public parity, native default and agent
.NET sunset remain open; no reboot was performed and .NET remains selected.

### Durable restart inventory and first reconciliation case — local

A service restart closes the transports of the bounded provider, native production
worker and managed worker, which all exit on disconnect. In-memory recovery handles
are lost, and a pending selection blocks every launch. `restart-inventory.js` now
reconstructs progress from durable journals alone. It reads; it never launches,
signals, deletes or rewrites. It reports each mutation as `not-submitted`,
`submitted-unknown` or `verified-complete`, the first unresolved boundary, remaining
ownership markers and bounded diagnostics. `GET /v1/native/status` returns it as
`durable`. A missing acknowledgement is always unknown, never replayable.

| Boundary | Durable evidence | Classification |
| --- | --- | --- |
| Forward begun | Selection `prepared`; no marker or file naming the transaction or its provider | Nothing submitted: abandoned at startup |
| Provider launch | `retirement-launch.pending`, provider record `submitting`/`submitted` | Unknown until an independent executor inspects the unit |
| Provider ready | Provider record `ready` or later | Verified |
| Source stop | No durable stop record; a retained snapshot proves verified exit | Unknown after a provider launch until the snapshot exists |
| State install | `state-install.pending`, install receipt | Verified only once the selection is `state-ready` |
| Production launch/readiness | `production-launch.pending`, production record, readiness intent | Verified only once the selection is `trial-ready` |
| Native commit | Committed history entry | Verified; native cold start is not integrated, so a return needs the durable native state |
| Native stop (return) | `.native-stop.json` `submitting` / `stopped` | Unknown / verified |
| Managed restore and launch | Restore and launch markers and records | Verified only at `state-ready` / `trial-ready` |
| Retirement and activation | Production-retirement, provider retirement and managed-activation receipts | Verified only with the final receipt; teardown intents are unknown |

Only the first row is reconciled automatically. When no live coordinator exists in
the process, startup abandons a forward `prepared` transition, but only if no marker,
writer lock or file names the transaction or its provider. Every mutation after
`begin` writes such a marker before its first remote command. The journal records
outcome `abandoned` with no state or readiness evidence, and managed acquisition
then follows its normal readiness gate. Every other boundary stays blocked with the
inventory as actionable diagnostics. Those boundaries need a freshly verified
independent executor under held admission, and that is not implemented.

Tests walk every listed boundary with real journals and private files, confirm the
inventory leaves the directory byte-identical, and cover refusal for markers,
provider records, transaction-named files, later phases, return transitions and
writer locks. They also cover idempotent repetition and journal validation. The
real-process rehearsals assert the interrupted inventory (`native-stop` unknown)
and a settled inventory after recovery. Read-only copies of both TVs' current
journals classify as settled with no diagnostics.

Signed 0.7.24 packages from `977230b` were installed on both TVs through the shared
engine, using the installed 0.7.23 packages as the baseline. All 66 members,
enrollment, protected files and startup flags verified, and boots were unchanged.
The first QN90A acceptance check failed after installation only because the
private acceptance script expected the native status object without the new
`durable` field. The engine journal stayed pending and the rescue timer stayed
armed until the corrected check completed. Both services then reported
`durable.action` `none`. Each TV completed one normal installed round trip on
0.7.24 with retained bytes, scope cleanup and prior history preserved, now eight
committed entries per TV. The inventory was settled again afterwards. A real
restart at the abandonment boundary has not been exercised on either TV; no TV
was rebooted.

### Restart rollback of uncommitted forward trials and explicit cleanup — local

A restart can interrupt a forward trial after its first remote mutation and
before native is committed. Such a trial is now reconciled on startup instead of
blocking all acquisition. Before commit, native never had public admission, and
retained-state installation only copies managed records into native scope. The
managed job directory is therefore still authoritative.

`restart-rollback.js` accepts such a transition only if the durable evidence binds
every recorded identity:

- the provider record, which holds the source identity;
- optionally the retained snapshot, the state-install receipt and the production
  record;
- markers that name this transaction;
- no unknown file naming it.

The service acquires the installed last-known-good managed worker, with public
admission and hand-off holds closed, and uses it only as an executor.

| Check | Evidence |
| --- | --- |
| Executor | Freshly authenticated managed readiness, same boot, no owned resources, not a recorded process |
| Old processes | Source worker, provider worker/guardian and native worker/guardian absent or reused PIDs |
| Units | Provider, source-exit observer and native unit: `MainPID=0`, idle state, empty `systemd` cgroup (or not-found) |
| Managed state | Current managed job manifest equals the retained snapshot when one exists |

The transition then goes through `rollback-required`, a receipt-bound
`rollback-state-ready` and `rolled-back`, all under a
`<id>.restart-rollback.pending` intent. Remnants are observed again just before
commit. Every command sent before commit is read-only, and tests check that no
mutating command reaches the executor. A rejected attempt is retried on the same
held worker, at most 36 times, to cover the provider's 300 s lifetime. An
interrupted attempt resumes from its journal phase on the next acquisition, and a
leftover intent after commit is finished. Admission opens only after the rollback
is committed. Staging, units and markers are retained.

`POST /v1/native/cleanup-restart` then removes that transaction's leftovers under
a drained hold, in this order:

1. It observes the remnants again.
2. It stops only idle units whose cgroup is empty.
3. It removes provider and native staging only when every present entry matches
   its recorded type, mode and digest.
4. It removes local token directories and readiness intents, then the markers.

Records and both receipts are kept, and the inventory returns to `settled`. Unknown
entries, live processes and S90D observer remnants leave the intent and markers
in place.

Local validation:

- **Unit tests (13):** every forward boundary; refusal for running, changing or
  non-empty units, changed managed jobs, unknown transaction files, foreign
  markers, a recorded executor, a different boot and later provider phases;
  resume and finalization; cleanup success, refusal and retry; `sh -n` on every
  generated plan shape.
- **Real-process restart tests (4)** in the parity container, stopped at:
  - `prepared` with nothing submitted (abandonment);
  - `prepared` after provider readiness;
  - `state-ready`;
  - `trial-ready` with native ready.

  Each test closes every listener of the first agent and starts a second agent
  with fresh modules and a new managed process. It checks reconciliation,
  cleanup and a settled inventory, then completes a normal round trip, and the
  retained job bytes stay unchanged.

A source managed worker that is never asked to stop ends with its transport. The
test harness's `--parity-wire` entry point aborts in that case. Production `Main`
catches the disconnect, stops jobs and exits with status 1.

Still open:

- A restart after native commit or during the return to managed (committed native
  without cold start, and pending to-managed). Both still block with diagnostics.
- S90D source-exit observer cleanup.
- Cross-boot records.
- Hardware qualification of a real service restart.

QN90A received signed 0.7.25 from `e277c44` through the shared engine, with all
install steps, member readback, enrollment and protected-file checks passing and its
boot unchanged. One normal installed round trip then completed: retained job bytes
and exit code 7 preserved, current-trial scopes and markers removed, ten committed
history entries, durable inventory `settled`. Acceptance ran after the rehearsal's
300 s SDK rescue timer had fired, so SDK briefly pointed at the operator host; the
pinned recovery utility restored loopback and the same worker stayed ready before
acceptance completed. S90D then received 0.7.25 the same way (68 members verified)
and completed one normal round trip, accepted within the rescue window, with the
same retained-state, cleanup and settled-inventory results. No real service restart has been
performed on either TV, so restart rollback and cleanup remain hardware-unqualified.

### Native public admission after a committed trial — local

A migration through `POST /v1/native/migrate` follows the rehearsal handoff to
commit. Then `completeProduction` retires the provider, verifies its unit and
processes are gone through the adopted native worker, and publishes the
activation receipt under an intent. It sets the live native runtime binding and
opens admission. Rehearsals keep `returnToManaged`. The managed fallback runtime
is verified before either direction starts. A lost activation acknowledgement
is resumed once through `POST /v1/native/resume-native`, and retirement is never
repeated. The durable inventory adds forward `provider-retirement` and
`native-activation` steps. A committed native with its receipt, no intent and
no markers is `native-active` / `none`.

Local validation: unit tests for the task routes, recovery binding,
fallback-pin refusal, status binding and inventory boundaries. The real-process
`native-active` mode in the parity container does the following:

- migrates with retained managed jobs;
- confirms that public exec, `job.status`, `job.forget`, `job.start` and
  `job.output` run on the staged native binary;
- confirms that the managed job bytes are unchanged.

The other five rehearsal modes and four restart modes still pass. Hardware is not
exercised. A hardware migration waits for the active-native return route, so a
TV is never left native without a way back.

### Return to managed from an active native worker — local

`POST /v1/native/return-managed` returns an admitted native runtime. The
original provider was retired at activation, so the return transition is
journaled first. A new bounded provider is then launched through the native
worker, with the native worker identity as its source. Return providers may
now be bound to either the trial's original managed source (rehearsal) or the
native worker they replace. The provider (`prepareNativeExit`,
`snapshotNativeJobs`), the admission hold and managed completion each verify
one of those two bindings. After that, the existing managed-return controller
runs unchanged: native stop, job records copied back, managed restore and
launch, commit, adoption, native and provider retirement, and managed
activation. Managed activation already accepts a native whose activation
removed its tokens and markers.

The active hold drains admitted public requests before the native snapshot. A
return refused before `begin` reports `rejected`, and native stays admitted.
The inventory names the return provider `providerId(return id)` and adds
`return-provider-launch` ahead of `native-stop`.

Local validation:
- Unit tests for the lazily opened provider, pre-begin refusal, the task route
  and its recovery binding, and the inventory for an active return through
  settlement.
- The parity container's `native-active` mode now migrates, serves public jobs
  on native, and returns. A native-created job (exit 9) and the retained managed
  bytes survive, and every provider, native staging directory and marker is
  removed.
- All other rehearsal and restart modes pass.

Not verified on hardware: `systemd-run` from inside the native unit
(`NoNewPrivileges`, `PrivateMounts`, System label). The parity container fakes
unit launches.

Signed 0.7.26 packages from `54a06be` were installed on both TVs through the
shared engine, using the installed 0.7.25 packages as the baseline. No members
were added or removed, all install steps passed, and boots were unchanged. Each
TV then completed one round:

- **Migrate:** native was committed and activated, with public admission open,
  in about 8 s on QN90A and 10 s on S90D.
- **On native:** a public exec ran. The retained managed job read exit 7. A
  native-created job ran with exit 9, and its output was read.
- **Return:** the native worker launched the return provider under its
  `NoNewPrivileges`/`PrivateMounts` unit, which was the open hardware question.
  Managed was restored and activated in about 14 s and 21 s.
- **Acceptance:** both jobs were preserved through the return, and the native
  and both provider scopes and all markers were removed. The rescue timer was
  disarmed, SDK was back on loopback, and the inventory was `settled`, with 12
  committed history entries per TV.

No failure, recovery route or restart was exercised on hardware.

### Selected-native startup and pending managed returns — 2026-10-15

A selected, activated native worker now starts through a temporary managed root
executor acquired by the existing SDK / SamsungTvArchiveRoot path. Public
admission stays closed throughout bootstrap. The executor proves the old native
process identities absent and its systemd unit idle with an empty cgroup, checks
retained jobs, and launches the existing digest-bound native staging with a new
single-use token. Authentication, root/System identity, process start ticks,
launcher digest, executable inode and systemd guardian readiness precede admission.
The managed bootstrap then loses its transport and exits.

Committed history, `<id>.production.json` and `<id>.activation.json` remain
unchanged. `<id>.runtime.json` binds the current process identities to those
original receipts. Return-to-managed consumers resolve this effective identity
without changing the committed readiness digest. `<id>.startup.json` journals
launch attempts; an uncertain attempt must have an empty unit before its token
can be reconciled and a new attempt launched. Prior attempts are archived under
unique IDs. Reacquisition never replays public commands, writes or jobs.

Disable/enable clears obsolete coordinator handles. Losing an admitted native
transport schedules acquisition with the existing bounded retry budget. A held
transition continues to block ordinary acquisition. Cross-boot bindings remain
refused; this milestone does not qualify reboot or standby.

A pending active-native return is resumed through a fresh managed bootstrap
under its original selection transaction. Recovery observes the old native,
provider and any managed launch before touching retained state. Existing restore
inputs and receipts drive the resumable restore plan; an uncertain mutation is
inspected rather than submitted again. The bootstrap verifies every saved job,
commits the original return, and removes digest-checked native/provider staging
and ownership markers. A replaced uncommitted readiness binding has its own
retained receipt. Original request IDs are stored separately so `resume-managed`
after restart can bind to the original request; its unknown request-journal entry
is not rewritten as a success. Previously launched managed code/staging remains
as explicitly reported audit material after restart recovery.

Local qualification: all 11 real-process restart cases and six rehearsal cases
passed in fresh containers with rebuilt native and managed fixtures. The restart
cases cover the four existing forward interruptions, committed-native restart,
disable/enable, transport loss, and pending returns before provider launch, after
native stop, after state restoration and after managed readiness. Native-created
and imported retained job records survive. The Node suite passed 359 tests with
125 platform/environment skips. Hardware qualification follows below.

Signed 0.7.27 passed the same-boot lifecycle round on both TVs. Each reacquired
native after disable/enable, identity-bound worker termination (transport loss),
and an application service restart; each then returned to managed with the
imported job (exit 7) and native-created job (exit 9) preserved. Native/provider
scopes were removed, rescue timers disarmed within their windows, SDK restored
to loopback, and history settled at 14 entries. The first QN90A loss-test timer
failed before signalling; inspection proved the worker unchanged before a new
ID and corrected quoting were used. Test timers were reconciled separately.
Pending-return interruption remains hardware-unqualified at this version.


### Public-operation parity and interrupted active return — 2026-10-15

Signed 0.7.28 closes the task-admission gap after a pre-begin live-resource refusal:
a fresh return request can proceed after the caller resolves the resource. The
original request ID still cannot be replayed. Restart-return completion now exposes
the original native and managed transaction IDs, matching normal public results.
The selection status reason describes required runtime verification rather than
claiming native launch is unimplemented.

Both TVs passed the operation matrix documented in
[CAPABILITIES.md](../CAPABILITIES.md#native-public-operation-parity--0728). They
also passed a service restart during the active return, automatic durable
reconciliation, and explicit completion under the original return request binding.
Retained managed, native-completed and native-cancelled records survived. Both
ended managed-ready, settled at 16 (QN90A) and 18 (S90D) history entries, with native/provider scopes
removed, SDK loopback restored and rescue timers disarmed before their deadlines.
Prior managed staging is retained as restart-recovery audit material.

The QN90A acceptance script initially assumed an app-context proc-label read would
work through `cat`, and caught the wrong client exception for an expected bad digest.
Neither failure changed selection. The known transfer was explicitly closed;
fresh isolated parity fixtures completed, and the abandoned empty directories
were removed. These were test-harness corrections, not worker changes. On S90D the initial
app-manager restart left the JavaScript coordinator alive and the return completed
normally. That round was accepted separately. A fresh recovery round terminated
the HTTPS-listener coordinator only after binding its executable, PID and start
ticks; it recovered the interrupted original return. The extra round accounts
for S90D's two additional history entries.

Validation: 360 Node tests passed, 125 environment/platform skips; seven differential
groups, six real-process rehearsals and eleven restart scenarios passed in fresh
containers with rebuilt native and managed fixtures. No client or tvsetup code
changed. No TV reboot or standby was requested. Signal-handler compatibility,
endurance, wider fault boundaries and native-only acquisition remain open.


### .NET caller inventory — 2026-10-15

[DOTNET-INVENTORY.md](DOTNET-INVENTORY.md) traces setup's NamespaceRootProbe and
RootIdentity, the private SDK rescue utility, and service SamsungTvArchiveRoot
through their actual callers, build paths, runtime requirements and replacement
options. The acquisition ports must preserve the capability context supplied by
Samsung's trusted runtime; a C translation alone does not establish that context.
The next implementation is a native conditional SDK-host recovery utility with
fake-vconf tests, followed by independent rescue qualification on both TVs.

No managed component was removed or replaced in this inventory milestone. The
selected-native bootstrap and managed return remain deployed fallback paths.
Validation is source/caller inspection, resolved local documentation links,
360 passing Node tests (125 platform/environment skips), and the privacy audit;
there is no additional device-behavior change or hardware acceptance claim.


### Native SDK-host recovery utility — 2026-10-15

The standalone C utility preserves `Recovery.dll`'s conditional SDK-host change,
late drift check, already-restored success, single setter call and readback
verification. It requires both real/effective root and canonical arguments;
there is no alternate key, production fault switch or retry. Ten Linux test
groups use fake vconf and a separate clock/identity interposer; a real 30-second
wait also verifies drift introduced while waiting. Two pinned-toolchain ARM builds
are byte-identical, with GLIBC 2.4 maximum requirements and no managed dependency.

Both TVs accepted `watch` rescue with the worker disabled and the identity-bound
HTTPS coordinator suspended. External SDK access returned while the coordinator
was still stopped and the 300-second .NET fallback remained armed. Prearmed
resumption and a native reverse switch restored loopback, after which
managed readiness, unchanged enrollment/selection/job bytes and the .NET utility digest
were verified. All final-round timers were disarmed; the .NET rescue never fired
in those final rounds. Earlier S90D trials restored SDK natively but lost their
coordinator listener after suspension; the preserved .NET backup
restored access for recovery. A trial relaunch unit also failed. The final harness
keeps the native-restored SDK window open long enough to relaunch the service
through SDK if its listener is unavailable, then restores loopback and enables
the worker. Earlier trials remain separate evidence rather than completed
acceptance; the cause of the platform listener loss is not established.

QN90A initially refused direct execution from writable staging before any vconf
call. Qualification then used the established root/System transient-unit pattern
with a private read-only code bind on both TVs. No security policy or file
capability was changed. The utility is installed separately beside the managed
recovery material; no WGT update or selection migration was required.

S90D exposed an undeclared `shm_open` import in system vconf. The final binary
explicitly retains `librt.so.1`; a link regression check and fake library with
the same import cover that dependency. Both TVs qualified the final identical
bytes, including a fresh QN90A round after the link correction.

Validation: ten Linux native groups passed; the repository Node suite passed
360 tests (125 skips); Python discovery passed 252 tests (118 skips, including
Linux-only cases exercised separately). The utility does not replace root
acquisition, migrate every older deployment-kit caller, or qualify reboot/standby.
See [contract and launch procedure](../recovery/native/README.md) and
[aggregate evidence](../recovery/native/results.json).


### Native acquisition through a trusted managed entry — 2026-10-15

The opt-in setup adapter builds a model-bound native library and minimal managed
loader twice, verifies identical artifacts and ARM softfp/GLIBC 2.17 compatibility,
then uses the existing physical/model/firmware/runtime/launcher guards, disposable
archive signing, original-resource hashes and exact staging cleanup. Bundle and
source drift refuse before device contact. A lost native reply never resubmits
the operation or silently invokes the managed path.

The trusted loader creates a private read-only code bind before loading C. Native
code then checks SDK credentials/capabilities, creates its own private mount
namespace, verifies private propagation, binds the disposable key, proves owner
identity, binds the narrowly edited passwd view, proves full root identity and
runs the bounded operation. It checks both owner fields against the observed
UID 5001/GID 100 contract. Command and archive deadlines are 25 and 30 seconds;
nonzero exits, signal death, output overflow, unconfirmed identity or cleanup
all refuse success. Code-bind setup still depends on the trusted managed host;
this is an intermediate capability-entry strategy, not .NET-free acquisition.

Both QN90A and S90D passed acquisition directly from SDK with the enrolled worker
disabled/disconnected. Each verified a distinct mount namespace, one root-only
command, nonzero-exit refusal, deadline expiry and absence of probe children after
cleanup. The original system passwd/key hashes remained unchanged outside the
namespace. Each then separately exercised the retained managed acquisition path.
Known service SDK archives were preserved by journaled rename and restored
byte-for-byte before the managed worker was re-enabled.

The final rounds returned to SDK loopback and managed readiness on the same boot,
with unchanged enrollment, selection and retained-job bytes. All trial timers
were disarmed within the 300-second window; the independent .NET rescue did not
fire. Signed agents remain 0.7.28; the acquisition bundles are temporary setup
artifacts, not WGT or service-selection changes.

Earlier QN90A trials established four boundaries: occupied shared SDK staging
must be preserved, writable native mappings are refused, the owner's GID is 100,
and Samsung's shell refuses an unsigned script-path argument. The final adapter
uses the private read-only code mount and the managed runner's verified-text
`sh -c` contract. Failed attempts were cleaned and restored separately, without
counting them as accepted or replaying an uncertain operation.

S90D's synchronous timer-stop command timed out after disarming the .NET backup.
Inspection confirmed both native units had completed and SDK remained on loopback.
The remaining owned timers were stopped without blocking and verified inactive;
acceptance continued from those receipts without replaying acquisition.

Validation: 15 focused Linux groups passed; Python discovery passed 258 tests
with 127 platform/environment skips, and Node passed 360 with 125 skips. The
next adapter work is service acquisition and held-bootstrap integration with
the existing transaction-recovery model. Fully native capability entry, broader
lifecycle qualification and removal of the managed fallback remain open.
See [contract](../../native-root-acquisition/README.md) and
[aggregate results](../../native-root-acquisition/results.json).

### Native service acquisition and held bootstrap — 2026-10-15

The service adapter shares the setup pilot's C namespace/archive state machine,
with independently validated unique stage names and an exact pre-created passwd
view. Both model-specific adapters and the updated worker were built twice with
identical artifacts. Signed package metadata binds the model, runtime and bytes;
incomplete or mismatched opt-in metadata refuses acquisition. The trusted managed
loader still provides capability entry and a private read-only code bind.

Selected-native reacquisition now uses a fixed 300-second native held bootstrap.
It exposes status and bounded exec for selection/retained-state verification and
launch, while public admission remains closed. Shutdown, process and unit identity,
artifact hashes and exact directory contents must agree before retirement opens
admission. An exclusive durable marker blocks another acquisition after uncertainty.
Managed selection and pending return/rollback recovery keep the managed worker;
the original archive adapter remains explicitly selectable and packaged.

Both signed 0.7.30 installations passed installed-content verification and one
managed/native/managed round. Native public exec and jobs worked, original retained
job bytes survived, and native-created jobs survived the return. Disable/enable,
identity-bound worker termination and service restart each produced a new native
worker under unchanged selection history and boot identity, using a distinct native
bootstrap. All six bootstrap receipts reached retired; their units, processes and
root scopes were verified inactive or absent. Final history is 18/20 committed
entries, managed is ready, no setup or selection operation is pending, and SDK is
on loopback. Fixture jobs were forgotten only after preservation checks.

QN90A recovered its interrupted return under the original transaction. On S90D,
the original return completed normally before the intended interruption was
observed. Its observation script therefore timed out waiting for a restart-return
receipt; inspection proved completion and acceptance continued from that evidence
without replay. S90D's interrupted-return hardware evidence remains the earlier
0.7.28 round, with current fresh-container recovery tests passing separately.

The preceding QN90A 0.7.29 attempt rejected the runtime's canonical assembly path
before C entry. The independent 300-second .NET rescue fired and restored SDK;
that attempt remains failed qualification. The loader now accepts only the exact
service stage or its canonical alias. Installed bytes and preserved state were
reconciled before the forward 0.7.30 install. S90D retained an old in-memory WRT
coordinator after package update and wrapper restart. Under a fresh rescue timer,
recovery terminated only the observed endpoint listener bound to its boot, PID and
start time, then relaunched the service. The new coordinator reported native
acquisition before qualification began. No shared WRT parent or unrelated app was
terminated. Private journals retain those recovery details and historical staging.

Validation: Node passed 369 tests with 129 skips; Python discovery passed 258 with
131 skips. Linux acquisition passed 19 focused groups, held-bootstrap protocol
integration passed four, and fresh-container rehearsal/restart suites passed six
and eleven cases. Tests cover malformed metadata, explicit managed fallback,
held admission through retirement, uncertainty, cancellation during retirement,
restricted bootstrap operations and lifetime, and staged passwd-view failures.

Automatic reconciliation of a coordinator crash during bootstrap remains open:
the marker deliberately refuses another acquisition until independent inspection.
Native-default rollout, endurance, reboot/standby and fully native capability
entry remain unqualified. The next step is durable interrupted-bootstrap
reconciliation without launch replay, followed by the remaining setup-control
dependency audit. The .NET fallback remains installed and available.


### Interrupted native-bootstrap reconciliation — 2026-10-15

Signed 0.7.32 publishes a complete schema-2 receipt before its exclusive atomic
pending pointer. The receipt binds the current boot, selection bytes, artifact
hashes and exact root scope. Original launch and recovery serialize on the same
root-owned file lock; recovery persists a seal that prevents a delayed original
SDK command from launching. Lock/seal tombstones remain after scope retirement.

A fresh authenticated managed executor remains held while it checks unit/cgroup
emptiness, recorded process absence and the complete remaining scope inventory.
Only exact known files or already-absent files are accepted. Cleanup can converge
after a lost reply without replaying launch or signalling any process. A failed
owned unit is reset only after those checks. The retired receipt is durable before
the pointer is removed. Native startup then resumes under the original selection;
malformed, legacy, changed-selection or changed-boot evidence still blocks.

Both TVs passed the same-boot lifecycle round and coordinator interruption at
submitted and ready bootstrap phases. A private watcher captured each exact
receipt before signalling only the observed endpoint coordinator, bound to its
boot, PID and start time. All four interrupted receipts were reconciled
independently and retired; admission reopened on a newly verified native worker.
Both then returned normally to managed with imported and native-created job
records preserved. Final history is 22 entries each, SDK is loopback, enrollment
and managed recovery digests are unchanged, and no setup/selection operation is
pending. QN90A has 23 and S90D 33 owned trial/rescue units verified inactive.

QN90A's preceding 0.7.31 trial remained held because an empty systemd unit stayed
failed after stop. Its independent 300-second .NET rescue restored SDK access.
Inspection and same-receipt cleanup established the missing reset-failed step;
the corrected implementation checks ownership, process absence and files before
reset. A Linux regression reproduces the failed-unit state. That earlier attempt
is failed autonomous qualification, preserved separately from accepted 0.7.32.

S90D's application-manager restart returned success while the coordinator kept
running, so it was not counted as interruption. An initial targeted timer then
failed before signalling; inspection confirmed the same live identity. A fresh
300-second rescue and a separately journaled timer with corrected command
encoding restarted only that bound coordinator. The original migration and its
operations were not replayed. Subsequent submitted/ready interruption checks
passed, and all extra timers were reconciled during final verification.

Validation: 377 Node tests passed with 135 platform/environment skips. Six focused
host recovery cases and six Linux filesystem/flock cases cover bindings, unsafe
state, late launches, missing files, lost cleanup replies and failed systemd units.
Fresh-fixture held-bootstrap, rehearsal and restart suites passed 4, 6 and 11
cases. Signed installed service trees match the working source on both TVs.
No Python/client code changed in this milestone.

The setup-control caller audit now confirms that standalone agent install/update
does not invoke Hub's Control.dll. A local capability-entry artifact audit found
no established native replacement for the trusted bridge; historical in-process
loader behavior is only a candidate pending current-firmware and package-route
evidence. See [the dependency inventory](DOTNET-INVENTORY.md). Broader handoff
failure/provider loss, final production endurance, native-default rollout and
power-lifecycle qualification remain open. The .NET fallback stays available.


### Installed forward rollback and provider loss — 2026-10-15

The existing signed 0.7.32 implementation now has hardware acceptance on both TVs
for three additional fault cases: coordinator interruption with a ready provider
while selection is prepared; interruption after retained state is accepted; and
loss of the ready provider followed by coordinator restart. No package, public
API or production code changed for this milestone.

A private watcher binds only the enrolled endpoint coordinator to its boot, PID
and start time. It briefly stops that process, rereads the target durable phase
with no selection writer present, saves exact selection/provider witness bytes,
then terminates and relaunches that coordinator. The provider-loss case first
signals only the guardian bound in the ready provider receipt. A separate bound
resume timer covers watcher failure while stopped, and every round keeps the
independent 300-second .NET SDK rescue armed. No shared WRT parent, unrelated
application, reboot or standby path is used.

Each fresh managed executor confirmed prior process/unit absence, retained-state
integrity and the original transaction binding before publishing rollback. The
original request remains submitted in its durable request journal, representing
an interrupted outcome; it is neither replayed nor rewritten as successful.
Explicit cleanup then removed only the original transaction's checked native and
provider scopes and ownership markers. Imported jobs and every pre-existing
retained record survived; fixture records were forgotten only after readback.

Both TVs ended managed-ready and settled, with 22 original committed history
entries plus three rolled-back entries. SDK is loopback, all 25 owned trial/rescue
units per TV are inactive, and exact test-only witness scopes were removed after
private capture. Enrollment, configuration, protected files and managed recovery
bytes are unchanged. No setup or selection operation remains pending.

QN90A's first acceptance script expected the original request to be rewritten as
unknown, but inspection found the intentionally retained submitted row. The test
was corrected to preserve that uncertainty. It also attempted to stop an unloaded
rescue service; the timer was already disarmed. Readback and guarded inactive-unit
handling completed acceptance without repeating migration, cleanup or job work.
These were private-harness corrections; all later rounds passed directly.

Validation: 377 Node tests passed with 135 skips. Fresh scratch native/managed
fixtures passed all six rehearsal and eleven restart cases in separate fresh
containers. Hardware evidence covers six interrupted rounds across the two TVs.
Later production-readiness interruption, provider loss without coordinator restart,
final production endurance and power lifecycle remain separate gates. See
[aggregate evidence](forward-recovery-results.json).


### SDK native-entry receipt investigation — 2026-10-15

Signed 0.7.33 includes an explicitly requested, inert-by-default native receipt
library built twice per model from original C. A bounded host encoder supplies
only a fixed preload path. The constructor validates a fresh nonce, records
credentials/capabilities and process metadata, and exits before returning to the
vendor loader. Focused tests cover wire vectors, reproducibility gates, malformed
metadata, credential slots, capability refusal and constructor termination.

Both TVs ran a direct SDK trial at UID/GID 901 with the worker disabled. Per-TV
locks, physical/firmware/boot/hash guards, unique intents, an absent exact loader
socket, process-bound watchdog and independent 300-second .NET rescue remained
in force. Neither trial produced a constructor receipt. QN90A exited 255 after
EFL diagnostics; exact binary analysis puts those diagnostics after the preload
loop. S90D reported a runtime-directory failure and signal 9 was observed during
its bounded trial. The original invocations were not replayed or treated as
successful acquisition.

Separate private managed diagnostics called each exact installed libbundle. Both
decoded the intended loader type and single fixed preload path, then re-encoded
byte-identical data. The wire format is therefore corroborated on both targets;
it does not explain away the failed code entry. The normal WGT payload remains
on writable VDFS. Earlier signed-TPK trials also failed native verification, so
package signing alone is not a demonstrated fix. A viable code mapping path and
actual vendor-loader capability receipts remain requirements for removing the
managed bridge. No HOME/XDG workaround or platform-policy change was attempted.

Both TVs ended managed-ready on SDK loopback, same boot, settled with their prior
25 history entries unchanged. Retained job records, enrollment/configuration and
.NET recovery digests match their baselines. Exact probe/codec scopes are absent;
all 14 owned install/trial timer and service identities per TV are inactive.

Validation: 263 macOS Python tests passed with 136 platform skips; all ten focused
Linux tests passed. Node passed 377 tests with 135 skips. Rebuilt native/managed
fixtures passed six rehearsal and eleven restart cases in fresh containers. One
initial macOS process-group deadline test errored; focused and full reruns passed.
See [entry evidence](../../native-root-acquisition/entry/results.json). This is
an implemented and tested diagnostic with unsuccessful native-entry qualification,
not .NET-free acquisition or native-default completion.


### Live coordinator forward-failure recovery — 2026-10-15

The coordinator now handles settled, uncommitted forward failures without needing
a service restart. It accepts only its current held controller and a matching
reconcilable durable transaction. Before closing source/provider/production
transports, it installs the rollback admission gate and invalidates stale channel
callbacks. A fresh managed executor runs the existing read-only rollback checks:
same boot, distinct identity, no old recorded processes or active unit cgroups,
no executor resources, and unchanged retained managed state. Transport closure
alone never authorizes reopening admission.

A missing or ambiguous receipt, selection writer, published commit, failed native
activation or failed managed return keeps its existing recovery boundary. A
transport-close exception retains the original hold. The forward request stays
unknown in memory and submitted in its journal; recovery neither repeats its
launch/install work nor rewrites it as success. The API binds a separate explicit
cleanup request to the exact recovered transaction. Unknown cleanup remains
blocked, and successful cleanup permits another handoff on the same coordinator.

Real-process tests cover provider termination, failure after state acceptance,
and failure just before commit while retaining the original coordinator object.
They verify held public admission, read-only reconciliation, retained bytes,
explicit cleanup and a subsequent normal round trip. Additional cases prove that
published commit and ambiguous writer outcomes stay held. Existing restart,
selected-native reacquisition, return and rehearsal cases remain covered.


Signed 0.7.34 qualified automatic rollback/readmission after provider loss on both
TVs. QN90A's bounded watcher briefly paused the bound coordinator and terminated
only the recorded provider guardian. The same coordinator acquired a fresh held
managed worker, verified rollback on the first attempt, and completed explicit
cleanup. S90D's unpaused watcher also produced first-attempt rollback with the
original coordinator PID/start time unchanged. Its failure was in source stopping;
QN90A's was in retained-state processing.

S90D exposed an outstanding cleanup boundary. Its source-exit observer had a
terminal failure receipt and idle unit, but the execution directory remained.
Generic cleanup stopped the idle unit and then refused that unsupported remnant,
retaining its cleanup intent and original request uncertainty. Separate guarded
maintenance checked the original observer receipt, process absence, exact artifact
and scope bytes, then retired only those resources. The coordinator was restarted
only after automatic rollback/readmission had succeeded, to clear the volatile
unknown-cleanup task slot. A fresh explicit request reconciled the same cleanup
intent. Neither the migration nor the original cleanup request was rewritten as
successful or blindly replayed. This does not qualify maintenance-free S90D cleanup.

An earlier S90D trial using a brief coordinator pause lost the endpoint process.
The guardian signal matched the recorded provider identity; the cause of the
coordinator exit remains unproven. The independent 300-second .NET rescue reopened
SDK access on the same boot. A single service restoration rolled back the original
transaction, and separate observer retirement completed recovery. No reboot,
standby, platform-policy change or unrelated-app operation was performed.

Both devices ended managed-ready and settled on SDK loopback. All retained job
bytes, enrollment/configuration, protected files and managed recovery digests
matched their baselines. Witness and observer scopes are absent, no setup or
selection operation remains pending, and all 11 owned units on QN90A and 30 on
S90D are inactive. The extra S90D units include independent rescue and explicit
cleanup recovery. Private harness corrections handled cached Developer Mode data,
verified empty inspection staging, exact serialized receipt bytes and encoded
systemd shell arguments; they did not repeat an uncertain migration.

Validation: 380 Node tests passed with 140 platform/fixture skips. Fresh scratch
native/managed fixtures passed six rehearsal cases and fourteen recovery cases;
two additional commit-refusal cases passed in a separate fresh container. Privacy
audit passed. No Python/client/setup source changed. See
[live recovery evidence](live-recovery-results.json).

Next: integrate evidence-bound S90D observer retirement into forward cleanup and
provide a bound reconciliation path for its existing unknown cleanup task, with
focused failure tests and both-TV acceptance. Later production-readiness faults,
final production endurance, native-default rollout and native-only code entry
remain separate gates. The managed bridge, fallback and independent rescue stay.

### Observer retirement and bound cleanup continuation — 2026-10-15

Forward rollback cleanup now handles a terminal S90D source-exit observer through
`observer-recovery.js`. It binds the observer record to the original provider,
source worker, boot, candidate manifest and observer artifact. Before any remote
removal it captures the original serialized record, terminal receipt, private
scope identity and exact token/result/socket identities in an fsynced checkpoint
under `observer-launches`. Active processes, nonempty cgroups, a live Unix listener,
changed bytes, unknown entries or an unfinished receipt publication refuse cleanup.

The remote command repeats process checks and enforces observer unit idleness
immediately before stopping an exited unit. It removes only the root-owned
executable whose metadata and digest match the record, then its empty directory.
Acknowledgement advances the checkpoint before local deletion. A lost reply repeats
only guarded cleanup of the remaining resources; partial local deletion resumes
only after remote absence and the remaining file identities are reverified.
The original observer record becomes cancelled with the terminal receipt and
recovery-evidence digest; its matching marker is removed last. The sealed checkpoint
remains as evidence. No observer or provider launch is replayed.

An uncertain cleanup can now continue through the existing cleanup route with a
fresh request ID, the same transaction ID and `cleanup_id` naming its original
cleanup request. The client exposes `--cleanup-id`. The live coordinator retains
that original binding across repeated uncertain continuations, rejects unrelated
requests and activation resumes, and leaves earlier request-journal rows submitted.
This does not authorize retrying an uncertain migration. A coordinator restart
still uses the existing ordinary cleanup route to reconcile durable state.

Focused tests cover wrong bindings, live units/listeners, unexpected scope entries,
changed bytes, lost remote acknowledgement and interrupted local deletion. Real
managed/native process tests model the terminal observer remnant, both ordinary
cleanup and lost-acknowledgement recovery, preserved retained jobs and a subsequent
normal handoff on the same coordinator. Three shell-executed refusal cases verify
that a newly live observer or foreign cgroup cannot be stopped after the first
observation. Local validation passed 404 Node tests with 142 fixture/platform
skips, 399 Python tests run with 136 skips, six fresh-container rehearsal cases
and eighteen fresh-container restart/recovery cases.

Signed 0.7.36 qualified the complete recovery path on both TVs. An unpaused watcher
terminated only the bound provider guardian. After automatic managed rollback,
an inert uniquely owned file in the recorded execution directory forced an
unknown cleanup result. The fixture removed only that exact file after mode and
digest checks. A fresh request naming the original cleanup and transaction then
completed service cleanup, with the original coordinator PID/start time unchanged.
On S90D the observer checkpoint remained prepared after refusal and became
complete after continuation; the observer executable, local scope and marker
were removed by service code. This closes the separate-maintenance gap found in
0.7.34. Lost replies and partial local deletion remain locally qualified cases;
the hardware fault was a known file obstruction.

Both devices are managed-ready, settled and on SDK loopback, with no pending setup
or selection. Retained job bytes, enrollment/configuration, protected files and
managed recovery hashes match their baselines. Packaged managed worker and
capability-entry bridge hashes also match the prior packages. All milestone-owned
units are inactive (15 on QN90A, including the interim installation units; nine
on S90D), and test witness scopes are absent. Original migration and refused
cleanup journal rows remain submitted; only the continuation is completed.
See [observer cleanup evidence](observer-cleanup-results.json).

Next: qualify later production-readiness interruption and continue the native-only
entry investigation. The earlier paused S90D coordinator exit, wider maintenance
lifecycle, final resource-pressure/endurance evidence, native-default rollout and
power lifecycle remain open. No reboot or standby was performed; .NET fallback
and independent rescue remain deployed.

### Production-readiness guardian loss — 2026-10-15

Both TVs passed an additional interruption boundary on the unchanged signed
0.7.36 packages. The private watcher waited for state-ready selection, a submitted
production record and the matching readiness intent. It verified the running unit,
executable inode and digest, boot, and guardian PID/start time twice before
terminating only that guardian. It never paused the coordinator or modified the
production API. The witness captures the production record and unit at that bound
fault point. Readiness had not been accepted or selection committed.

The same coordinator automatically acquired a fresh held managed executor,
verified old process/unit absence and unchanged retained state, and recorded a
rollback under the original transaction. The production record stayed submitted
and its readiness intent remained for explicit cleanup. Cleanup then retired all
recorded handoff units and removed their staging and intents without separate
maintenance. A final endpoint PID/start-time check confirmed the coordinator had
not restarted, and the original guardian identity was gone. The migration request
remains submitted in the durable journal; its separate cleanup request is completed.

Both TVs ended managed-ready and settled on SDK loopback. QN90A has 28 history
entries (22 committed, six rolled back); S90D has 29 (22 committed, seven rolled
back). Retained jobs, enrollment/configuration, protected files and managed rescue
hashes match their baselines. All three trial/rescue units and three handoff units
per device are inactive, and exact test witness scopes were removed. Installed
package members were verified against the preceding accepted installation before
each trial; no new deployment or production-code change was needed.

The new real-process test kills the connected production guardian during readiness
file verification after the intent is durable. It checks unknown outcome binding,
held admission, automatic read-only rollback, preserved jobs, explicit cleanup and
a subsequent normal handoff on the same coordinator. Validation passed 404 Node
tests with 143 platform/fixture skips, six fresh-container rehearsal cases and
nineteen fresh-container recovery cases with rebuilt scratch native/managed
fixtures. No Python/client/setup code changed. See
[production recovery evidence](production-recovery-results.json).

Next: continue the native-only capability-entry investigation and the remaining
maintenance, pressure and endurance qualification. This one pre-commit fault does
not establish every interruption or post-commit failure. The earlier paused S90D
coordinator exit remains unexplained; .NET fallback and rescue stay deployed, and
reboot/standby remain excluded.

### Native-entry mapping prerequisite — 2026-10-15

Both installed 0.7.36 targets were inspected under their per-device locks with
no pending setup. The file-capability inventory covered the direct entries in
`/bin`, `/sbin`, `/usr/bin` and `/usr/sbin`. The stock `mount`, `unshare` and
`nsenter` helpers are root-owned 0755 files without file capabilities. This
rules out those helpers as a direct capability-promotion step; it is not a
complete search of installed launchers or package execution paths.

A private managed diagnostic then called `dlopen(..., 0x1002)` on the exact
installed native receipt bytes. Writable package storage and a temporary copy
on writable tmpfs both returned `failed to map segment from shared object` on
each TV. In a separate process, `unshare(CLONE_NEWNS)`, private mount propagation
and a read-only bind of the payload directory allowed the receipt constructor
to execute on both targets. The complete receipts identify UID/GID 0, `dotnet`,
and `code_readonly: 1`; they correctly fail the SDK vendor-loader identity gate
with `capable: false` and exit 2. An initial diagnostic used the managed environment
setter and reached the constructor's nonce refusal; the corrected diagnostic
used libc `setenv` and produced the full nonce-bound receipt. No native-entry or
acquisition qualification is claimed from these managed diagnostics.

The captured QN90A loader's preload failure is logged through `__dlog_print`;
its inspected logging implementation reads fixed configuration files. No
environment override was found in that inspected path, and no logging settings
were changed. The original SDK-loader failures still lack a direct `dlerror`
receipt. Mapping failure in the managed diagnostic is evidence for the next
investigation, not proof of those original failures' exact cause.

All diagnostic files were removed after digest verification. Both original
managed workers remain ready on their original boots, with unchanged selection
history, retained jobs, enrollment, protected files and managed recovery bytes.
SDK remains on loopback. No diagnostic payload bind remains in the inspected
service/PID-1 namespaces. No vendor loader was invoked in this round, no package
was deployed, and no production source, policy, file capability, SMACK rule,
reboot or standby behavior changed. Raw evidence, vendor binaries and diagnostic
builds remain private. `npm test` passed 404 tests with 143 skips. No Python,
client, setup or production source changed, so the previously passing fresh
container suites were not repeated for this evidence-only milestone. See
[mapping results](../../native-root-acquisition/entry/mapping-results.json).

Next: inspect a native vendor namespace-preparation path before another SDK
loader trial. That path must prove code mapping and actual SDK capabilities
without relying on the managed bridge or changing global policy. The wider
maintenance, pressure, endurance, rollout and power-lifecycle gates remain open.

### Ordinary production worker resource pressure — 2026-10-15

Signed 0.7.38 qualifies an additional bounded pressure round on both TVs using
exact ordinary native worker bytes from the installed package. Each private
controller launches `--production`, verifies no lifetime expiry, and leaves the
installed managed worker running. This qualifies separate production worker
instances, not native-default service operation or long-duration endurance.

The production idle path previously terminated when an externally imposed zero
`RLIMIT_NOFILE` made `poll(nfds=1)` return `EINVAL`. It now waits by peeking the
existing socket with its receive timeout temporarily disabled, then restores the
active-frame deadline before parsing. It allocates no descriptor and never changes
the imposed limit. Review also found a race in an interim fix that consulted a
later `getrlimit`: restoration between the failing poll and that check could still
close the session. A test-only Linux interposer reproduces the real poll error,
restores the limit, and verifies continued authenticated requests. It fails on the
interim binary and passes on the corrected binary. No test interposer or fault
interface is included in the production worker.

Both TVs passed eleven acceptance groups. At descriptor limit zero, a worker
remained idle for 32 seconds, served another request, then enforced the existing
active-frame timeout after a partial request, exiting within 25–38 seconds.
The socket deadline or active-request watchdog can enforce this bound; the
controller accepts either termination path and verifies guardian cleanup.
Fresh children then passed terminal-result persistence recovery, rejected launch
intent publication on full and read-only storage, crash cleanup with retained
journal reconciliation, retention limits, descriptor admission, retained-intent
recovery without command replay, bounded command-fault diagnostics and mixed
JSON/binary uploads. Production file admission includes its extra parent-directory
descriptor. Storage faults were confined to a private disposable 2 MiB tmpfs;
no existing TV filesystem was filled or remounted read-only.

Local validation passed six focused resource tests, five ordinary lifetime and
bounded-admission checks, 404 Node tests with 143 platform/fixture skips, six
fresh-container rehearsal cases and nineteen fresh-container recovery cases.
Two extended lifetime cases were skipped; this milestone does not claim 24-hour
qualification. Native and managed fixtures were rebuilt in scratch directories.
Both signed native builds reproduced twice and matched each other. No client or
setup source changed, so full Python discovery was not repeated.

Both devices ended managed-ready and settled, with the original boot and unchanged
selection history: QN90A has 28 entries (22 committed, six rolled back), S90D 29
(22 committed, seven rolled back). Retained job records also match the accepted
0.7.36 baseline across the interim and final package updates. Owned test jobs,
helpers and scopes are removed, enrollment/protected hashes are unchanged, SDK
is on loopback, and independent 300-second managed rescue timers are inactive.
All three packaged managed DLLs are unchanged from the preceding packages.
See [production resource evidence](production-resource-results.json).

Next: guardian/startup descriptor budgets, concurrent memory/process pressure,
wider storage stalls and remaining maintenance/interruption boundaries, followed
by ordinary production endurance. The native-only entry investigation and native
default rollout remain open. The .NET entry bridge, worker fallback and independent
rescue remain deployed; no reboot, standby or global-policy change occurred.

### Startup admission and guardian descriptor exhaustion — 2026-10-15

Signed 0.7.40 qualifies startup refusal and two guardian-pressure recovery paths
on both TVs, followed by all eleven prior production resource checks. Each
controller-owned production launch receives exactly 32 free descriptor slots
below its soft limit, counting only descriptors that survive exec. The installed
managed worker stays ready throughout these separate-worker trials.

The worker now requires 32 free slots before optional-library loading, token
consumption or scope mutation. A 31-slot launch refuses with the token unchanged
and no job directory. The scan counts holes rather than using the largest open
descriptor. Startup and the single-threaded guardian also check their explicit
file, directory, pipe, socket and eventfd allocations before calling libc, since
these firmware kernels can abort on exhaustion instead of returning `EMFILE`.
The initialized protocol worker retains its existing operation admission under
the job mutex and monitor reserve. No limit is raised or inherited descriptor
closed to obtain capacity.

With the authenticated fixture guardian's soft limit held at zero, graceful
worker shutdown exits through incomplete guardian cleanup (125), retaining the
unchanged ownership journal. A fresh launch performs ordinary same-boot
reconciliation and preserves the known interrupted job exit code 137 byte for
byte. In the second case, SIGSEGV is directed only to the authenticated fixture
worker. Its ptrace stop requires task-identity inspection; the guardian refuses
that allocation and exits 1. `PTRACE_O_EXITKILL` terminates its owned tasks. The
controller observes the original task identities dead before a fresh launch
reconciles the job as interrupted with unknown exit status. Both cases preserve
prior terminal records, verify a single command execution and clean up through
normal job APIs. The controller never deletes the journal to force takeover.

Review also exposed an unsafe generic fatal-exit cleanup path: with spare
descriptors, an identity-allocation failure could remove the journal before
traced tasks had exited. The guardian now disables generic runtime cleanup once
ptrace supervision is active. Its normal completion path still drains tasks and
explicitly retires resources; fatal exits preserve evidence for takeover. A local
interposer returning `ENOMEM` for task-identity inspection reproduces journal
loss on the interim build and passes after this fix. This simulated allocation
failure was not injected on either TV.

Six focused Linux cases cover refusal, admitted startup, sparse inherited
handles, both guardian descriptor failures and a simulated identity-allocation
failure. A test-only interposer models the fatal
firmware boundary by exiting 93 if an exhausted allocation reaches libc. Both
previous-binary guardian cases reach that sentinel; the guarded cases recover.
The previous binary also fails the new early-startup refusal test. No interposer
or fault interface is included in a signed package or used on a TV.

Across the broader native and policy/bootstrap runs, 78 Python cases passed and
19 optional fixture/extended cases were skipped. Validation also passed 404 Node
tests with 143 platform/fixture skips,
six fresh-container rehearsals and nineteen fresh-container recovery cases with
rebuilt native and managed fixtures. Both ordinary native builds reproduced
twice and matched each other. No client/setup source changed.

The first final-candidate QN90A trial passed eleven checks, including all three
new cases, then failed when an existing command-fault job reached its unchanged
two-second timeout. Its result was preserved and cleanup verified before another
trial. A private controller added per-iteration timing and slow-result snapshots;
it retained all original checks and the 2000 ms job/3000 ms observation limits.
The subsequent full QN90A trial passed with the exact same ordinary worker bytes.
Its 70 fault jobs had a median start-to-terminal-observation duration of 221 ms
and a maximum of 1629 ms. This includes admission and persistence, not solely
guardian processing. The earlier timeout is not explained by this passing run;
it remains an explicit timing/endurance gap. No threshold was relaxed. S90D passed the same instrumented full trial; its
70 fault jobs had a median of 79 ms and maximum of 1388 ms.

Both devices ended managed-ready and settled on their original boots, with
unchanged selection history, enrollment and retained job records across the
package update. QN90A has 28 history entries (22 committed, six rolled back),
S90D 29 (22 committed, seven rolled back). All owned test jobs, helpers and scopes
are removed; SDK is on loopback and independent 300-second managed rescue timers
are inactive. All three packaged managed DLLs remain unchanged. See
[startup and guardian resource evidence](startup-resource-results.json).

These checks do not cover dynamic ELF-loader allocation before `main`; the
hardware refusal deliberately leaves 31 free slots for that phase. Capacity
inspection and allocation are not atomic against an unrelated concurrent limit
change. Guardian exhaustion preserves ownership for later takeover rather than
claiming cleanup completed at zero capacity. Concurrent memory/process pressure,
wider storage stalls, remaining lifecycle faults, endurance and native-default
observation remain open. Native-only capability entry remains unqualified; the
.NET entry bridge, worker fallback and rescue remain deployed. No reboot, standby
or global-policy change occurred.

### Job execution budgets after durable preparation — 2026-10-15

Signed 0.7.41 moves the native background-job deadline to just before the command
release gate, after the running record and directory entry have been synced.
Previously, the deadline was armed before that persistence: a slow save could
consume the entire execution budget while the child was still unable to run.
This differs from managed jobs, whose timeout task starts after launch state is
saved. The native child remains gated throughout preparation, and failed identity
or persistence still cancels it without executing the command or reusing its ID.
The existing progress watchdog remains responsible for stalled preparation.

A host-only fsync fixture reproduced premature expiry on the preceding binary:
a two-second running-record save caused a command with a 500 ms budget to return
`timed_out` instead of exit 7. With the corrected deadline, it runs once, persists
exit 7 and retains the exact record across restart. A separate genuinely long
command still times out after slow preparation and cannot write its final witness.

A second fixture exposed overdue persistence retries: the retry timestamp was
computed before the save, so a two-second failed write could leave its next retry
already due and repeatedly occupy the jobs mutex. A status request timed out in
that fixture before the fix. Retry backoff now starts one second after the save
returns. The delayed EIO case returns status, refuses the duplicate start and
reconciles its retained intent without ever executing the command.

A fourth case blocks only the protocol worker's preparation fsync for forty
seconds. The progress watchdog terminates the worker before it executes the
command, and ordinary same-boot recovery reports interruption without replay.
The fixture explicitly selects the worker PID, keeping the independent
guardian's persistence available.
This does not qualify recovery while the guardian's storage is itself stalled.
No interposer or failure interface is packaged or used on either TV.

Both TVs passed the existing fourteen production resource groups with their exact
installed ordinary worker bytes and a private timing controller. This includes
seventy command-fault jobs per device at the unchanged 2000 ms execution and
3000 ms observation limits. S90D's slowest start response took 2292 ms and its
terminal result was observed at 2326 ms with a completed outcome. These are
controller timings including admission and persistence, not measurements of a
particular fsync or guardian phase. Their scopes, helpers and outer jobs were removed;
retained records, enrollment, protected hashes and selection history are unchanged.
Both remain managed-ready and settled on the original boot, with SDK on loopback
and independent managed rescue timers inactive. All three packaged managed DLLs
remain unchanged. See [job timing evidence](job-start-timing-results.json).

Local validation passed four focused cases, 60 unique Python cases overall with
12 optional cases skipped, 404 Node tests with 143 skips, six fresh-container
rehearsals and nineteen fresh-container restart cases. Native and managed scratch
fixtures were rebuilt; each signed native build reproduced twice. No client or
setup source changed, so full Python discovery was not repeated.

The original 0.7.40 QN90A timeout remains historically unexplained: it did not
record phase timings. The premature-budget bug is consistent with the subsequent
long admission observations but does not prove that original cause. These local
simulations and bounded hardware runs do not qualify forced slow storage on a TV,
strict job deadlines during concurrent persistence stalls, broad pressure or
endurance. Native-only entry, remaining lifecycle coverage and native-default
rollout stay open. The .NET entry bridge, worker fallback and independent rescue
remain available. No reboot, standby or global-policy change occurred.

### Launch allocation and process-failure qualification — 2026-10-15

A new controller-only pressure mode qualifies the existing ordinary 0.7.41 worker
on both TVs. It constrains only the live authenticated fixture worker's
`RLIMIT_AS` to its current virtual mapping size. The independent guardian,
installed managed worker and already-running command child keep their original
limits. This produces allocation refusal without filling TV RAM or changing a
system-wide policy.

Each worker refuses a new job with `Insufficient memory; job intent retained,
not launched`. Its execution witness stays absent and the published intent stays
`unknown`; a duplicate start is refused even after restoring the limit. The
existing live job is held at a FIFO gate throughout the refusal and is checked
still running before the controller releases it. It then finishes with exit 9
and one witness write; a saved exit-7 record remains byte-identical, and fresh app work exits 11. Normal shutdown and
fresh launch reconcile the refused intent as interrupted with unknown exit
status. No command is replayed. Normal job operations retire the owned records,
then the controller removes its empty scope.

Four local cases cover real address-space limitation, ENOMEM at the first and
second one-MiB output-buffer allocations, and EAGAIN at fork. The injected cases
preserve the descriptor set, retain intent, refuse duplicate execution and recover
fresh work. The glibc interposer targets only an explicitly named protocol PID;
it is never packaged or used on a TV. Two additional cases check controller-mode
refusal before state creation. All six pass, and npm test passes 404 with 143
platform/fixture skips. Linux and ARM acceptance controllers were freshly built.

No worker/runtime implementation, package or selection changed in this milestone.
The preceding c218c05 runtime, rehearsal and restart results remain their own
qualification; those passing suites were not repeated for controller-only work.
No client or setup source changed. Both devices remain managed-ready and settled
on the original boot with unchanged enrollment, protected hashes, retained jobs
and selection history. Test jobs, helpers and scopes are removed, SDK is on
loopback, and independent 300-second .NET rescue timers are inactive. See
[launch-pressure evidence](launch-pressure-results.json).

This establishes bounded per-process virtual-address refusal with one live job,
not allocator fragmentation, aggregate multi-job guarantees, whole-TV OOM or
sustained pressure. Process-launch injection is locally qualified only. Broader
pressure, post-commit lifecycle interruption, endurance and native-only entry
remain open. The .NET entry bridge, worker fallback and independent rescue remain
available; no reboot, standby or global-policy change occurred.

### Committed guardian-loss recovery — 2026-10-15

Signed 0.7.42 separates selected-native restart snapshots from managed-return
snapshots. A committed guardian killed without cleanup leaves its ownership
journal behind. Startup previously required that journal to be absent, so it
refused before the native worker could perform its existing reconciliation.

Selected-native startup now reads a complete ready journal, binds its boot,
worker ID, guardian PID and start time to the last accepted runtime, and pins its
bytes throughout the retained-record snapshot. The old process identities must
already be gone and the unit must be idle. Native alone validates the scope/runtime bindings and
reconciles the journal under its exclusive lock; startup requires its explicit
reconciliation report before admission. No coordinator code removes the journal
or replays commands. Managed-return snapshots still refuse any guardian journal.
Malformed, mismatched or partial journals, extra persistence metadata, live old
identities, changed records and changed import manifests remain fail-closed.
Recovery from partial startup/persistence metadata through this service path is
still unqualified and held for reconciliation.

The new fresh-container integration case reproduces the preceding refusal and
passes with the fix: SIGKILL targets the committed guardian while a command is
live; the same coordinator reacquires native, preserves commitment and terminal
record bytes, records the live job as interrupted with an unknown exit code, and
returns both retained results to managed without replay. Docker's --init option
is required for this case to reap the orphaned EXITKILL victims, as the TVs' init
does; without it the original process identities remain unreaped and correctly
block startup. Three focused snapshot tests cover the new admission and refusal
boundaries. The full local run passed 20 restart cases, six rehearsals, 48
retained-state/startup cases with one optional managed-fixture skip, and 404 Node
tests with 147 platform/fixture skips. Native and managed scratch fixtures were
rebuilt. No client or setup implementation changed.

Both installed TVs passed the same bounded fault case on their ordinary native
binary. Each migrated, retained a completed native result, and started a command
that wrote one witness before sleeping. A separate transient unit delivered one
SIGKILL after fresh boot/PID/start-time/executable/unit checks. The original
coordinator reacquired native through a retired held bootstrap under the same
committed transaction. The job reported `stale-guardian-reconciled`, interrupted
with a null exit code, and its witness remained singular. Production/activation
receipts and the completed record stayed byte-identical. Normal managed return
preserved all tested outcomes. Original retained jobs, enrollment and protected
hashes survived the update and trials. QN90A ended with 32 history entries
(26 committed, six rolled back), S90D with 31 (24 committed, seven rolled back).
Both remain on their original boots, managed-ready and settled with SDK on
loopback; all 20 QN90A and 10 S90D milestone units are inactive, and old/replacement
native processes, helper scopes and freezer groups are absent. See
[committed guardian evidence](active-guardian-results.json).

An initial QN90A private trial was not accepted: its status probe used an
unexposed public operation, then its guarded timer exited before sending the
signal. The original guardian remained alive with the same start identity.
The trial returned normally to managed and removed only its fixtures. A further
migration was refused by the one-task-per-coordinator API gate; that preflight
fixture and rescue were also cleaned. A service restart preceded the fresh
qualified trial. The original requests and failed evidence were retained; no
migration or signal was blindly replayed. A second guarded timer also exited
before signalling; the same read-only guards passed through the worker. Its terminal failure and unchanged guardian
identity were verified before a separately journaled signal. The corrected timer
sets the firmware system-bus address and uses the existing base64 shell wrapper
to preserve shell parameters through systemd argument processing. These were
private harness errors, not evidence of failed native guardian recovery.

The returned interrupted fixture exposed an existing managed API limitation:
`job.forget` refuses same-boot saved `interrupted` records. The native API supports
forgetting them. This milestone preserves the managed fallback bytes and records
that gap; after acceptance of the returned record, private maintenance removes
only the owned fixture with its exact digest and an original-process-disappearance
guard. Prior retained records are untouched. Managed interrupted-job retirement
needs a focused follow-up.

The ordinary native binary and all three managed DLLs are unchanged from
0.7.41; this is a service startup change. The .NET entry bridge, worker fallback
and independent 300-second rescue remain deployed. No reboot, standby or global
policy change occurred. Native-only entry, broader interruptions and pressure,
performance/endurance and native-default rollout remain open.

### Managed retirement of interrupted native jobs — 2026-10-15

Signed 0.7.43 permits `job.forget` for a saved `interrupted` record on the
current boot. The preceding guardian-loss round exposed that managed rejected
this terminal state after native recovery and return, despite preserving the
record correctly. Native already permitted forgetting it. The managed change
only deletes saved metadata; it does not signal processes or assign an exit code.
Worker-owned live jobs and same-boot saved starting/running/cancelling/unknown
records remain refused. Old-boot behavior is unchanged.

The differential test reproduced the preceding managed refusal and now passes
nine saved-record scenarios with identical managed/native results. It also
checks that a rejected live-job forget leaves supervision intact. The actual
committed-guardian-loss restart case now forgets the returned interrupted record
through managed and verifies that the other retained records and single witness
remain unchanged. Fresh rebuilt fixtures passed seven differential tests,
20 restart cases and six rehearsals. npm test passed 410 with 147 platform/fixture
skips. No client or setup implementation changed.

Both TVs passed the updated committed-guardian-loss round on their installed
ordinary native worker. Each retained completed managed and native results,
started one live job with a single execution witness, and lost its freshly bound
guardian to one SIGKILL. The original coordinator automatically reacquired native,
reported the live record as `interrupted` with a null exit code and
`stale-guardian-reconciled`, and preserved committed receipts without replay.
Normal return preserved all tested records. Public managed `job.forget` then
removed the interrupted record, and the completed fixtures were retired through
the same API. No raw job-record deletion was used. Both devices remain on their
original boots, managed-ready and settled with unchanged enrollment and protected
hashes. All 17 QN90A and 11 S90D tracked milestone units are inactive, probe staging
is gone, native runtime/freezer scopes are absent, and SDK is on loopback. See
[qualification evidence](interrupted-forget-results.json).

Changing the managed DLL exposed an upgrade boundary: selection correctly pinned
the preceding managed digest and refused startup. The new
[maintenance primitives](../maintenance/README.md) verify exact signed installed
bytes, runtime/command-line hashes, root identity, private read-only mounts, unit
identity and retained-state readback through an independent authenticated worker.
Six focused tests cover refusal boundaries, nonempty retained records and held
selection evidence. An exclusive remote writer held admission while quiescence,
state and readiness receipts were archived. Each probe shut down; the independent
SDK route then verified process/launcher/runtime disappearance and successful
unit exit before the original managed-to-managed transaction committed. Both full
pre-upgrade selection histories remain archived, including entries rotated out of
the bounded history ring. The original mismatch guard is unchanged. Publication
and interruption recovery remain explicit maintenance orchestration; no automatic
upgrade API was added.

Both upgrade baselines contained zero saved jobs. Nonempty retained upgrade
snapshots and inconsistent managed readback are locally tested; the following
hardware guardian rounds exercise nonempty state across recovery and return.
QN90A's first two independent probe callbacks failed before authentication. A
local reproduction found LAN-bound Node sockets resetting while loopback Node and
LAN Python sockets worked. A temporary byte relay retained end-to-end worker
protocol authentication; no network policy changed. Both failed units were
confirmed terminal and their owned resources retired. During QN90A metadata
publication, inherited directory setgid and an unavailable comparison command
stopped the private harness with admission held. Actual writer/file/unit state was
inspected and the same transaction continued with exact hash checks. Failed
attempts and receipts were preserved; neither installation nor selection history
was reset or blindly replayed. S90D passed the corrected maintenance sequence.


The signed native binary, NativeEntry DLL and archive-acquisition DLL are
unchanged; only the managed worker DLL changes. Both managed fallback and the
independent 300-second .NET rescue remain deployed. The intentional interrupted
forget difference has been removed from the parity contract. This is metadata
retirement after verified reconciliation, not a new descendant-cleanup guarantee.
Native-only entry, service recovery with partial journals, broader pressure,
performance/endurance and native-default rollout remain open. No reboot, standby
or global-policy change occurred.


### Guardian-owned persistence recovery — 2026-10-15

Signed 0.7.44 extends selected-native restart beyond a clean job directory or a
lone stale guardian journal. A complete ready guardian journal must still match
the last accepted boot, worker ID, guardian PID and process start. With the old
processes absent and unit idle, the service inventories bounded initial intents,
repair temporaries and atomic record-save temporaries. Names, ownership, mode,
size, link count and hashes are pinned throughout the snapshot. Publication hard
links are admitted only when they are the exact corresponding final inode and
bytes. Repair files require their initial intent; record-save temporaries require
an existing record owned by this guardian. Foreign metadata, unknown entries,
unsafe links, changed bytes and a resulting retention count above 64 remain held.

The coordinator never deletes or repairs these files. The ordinary native worker
reconciles them under its exclusive scope lock. Before admission, the service
requires its stale-guardian reconciliation report, reads every retained result,
checks interrupted records and unpublished intent outcomes, verifies unchanged
record bytes, and checks the exact final inventory and absence of every admitted
temporary. The managed-return snapshot contract is unchanged.

Focused snapshot cases cover empty and partial intents, interrupted repairs,
initial/repair publication links, record-save temporaries and refusal boundaries.
Readback tests reject missing or changed records, wrong owners, invented exits,
replay indicators and unexpected final inventories. Fresh native and managed
fixtures passed all 21 restart cases and six rehearsals; the full repository run
passed 413 tests with 150 optional platform/fixture skips. The retained-state
suite passed 46 cases with one optional managed-fixture skip. No client or setup
production code changed.

Both installed TVs passed one guarded round on their ordinary binaries. After a
real committed guardian SIGKILL and scope-lock acquisition, a private bounded
fault script created six persistence boundary forms: an empty initial intent,
a partial intent with a partial repair, an initial publication hard link, a repair
publication hard link, a live-record save temporary, and a terminal-record save
temporary. The same coordinator automatically reacquired native. The unpublished
IDs became interrupted without launch, the live command retained an unknown exit
and a single execution witness, and terminal records and commitment receipts
remained byte-identical. Normal managed return preserved all results; public
managed job forgetting removed only the fixtures. Original retained jobs,
enrollment and protected hashes survived. Both ended managed-ready and settled,
with SDK on loopback, original boots unchanged, all 14 owned units inactive, and
old/replacement native processes, helper scopes and freezer groups absent.
See [sanitized evidence](persistence-recovery-results.json).

These trials model persistence boundaries with owned files after guardian loss;
they do not establish power-loss or crash-during-fsync behavior. All 19 payload
members, including the native worker and three managed DLLs, are unchanged from
0.7.43. The .NET fallback and independent 300-second rescue remain available;
neither rescue fired. No reboot, standby or global policy change occurred.

The next recovery step is a durable binding from pre-readiness guardian startup
journals to their original launch attempt. Incomplete or differently owned
guardian journals remain held rather than adopted. Fully native capability entry,
broader lifecycle coverage, performance/endurance and native-default rollout are
still open.

### Launch-bound pre-readiness recovery — 2026-10-15

Selected-native startup now records a schema-2 attempt before submitting its
launch. It binds the original transaction, boot, last accepted worker, private
token digest and a unique startup fence. The command and retirement share the
same exclusive fence lock. Retirement seals that fence before proving unit and
process absence; a delayed original command cannot launch afterward. The small
sealed fence remains as a tombstone, as with held-bootstrap recovery.

Native hashes its private launch token before creating new startup checkpoints.
Every complete checkpoint carries that digest, and authenticated readiness must
report the same binding. Token consumption checks it again. Complete successor
checkpoints cannot change, remove or introduce a binding; older journals without
the field retain their existing native reconciliation contract.

After sealing a submitted attempt, the service can admit its bounded startup
checkpoints even when that worker never acquired an accepted runtime receipt.
Complete journals must bind to that attempt and boot, and successor identities
and phases must agree. Empty or partial initial files rely on the sealed attempt,
not an inferred identity from incomplete bytes. Every present file and absent
checkpoint name is pinned during the retained-state snapshot. Native still
validates resource ownership and performs reconciliation under its scope lock.
Unexpected job metadata or records owned by an unaccepted startup are refused.

Retained-record readback, temporary-checkpoint absence, reconciliation reporting
and a final authenticated identity check precede runtime publication and public
admission. The original intent stays available if snapshot validation fails;
recovery archives that original attempt and creates a fresh one instead of
replaying its launch. Legacy service attempts cannot authorize this new path.

Local validation passed 414 repository tests (157 optional skips), 49 native
regression cases (one optional skip), five launch-binding groups, three Linux
launch-fence cases, six bootstrap-recovery cases and 49 retained-state cases.
Freshly rebuilt native and managed fixtures passed six rehearsal cases and all
21 ordinary restart cases. A separate fault build passed three coordinator
restart cases after real exits at a complete successor, partial successor and
unpublished initial checkpoint. These test-only exits are not in signed builds.

Both signed 0.7.45 installations passed the two hardware cases on their ordinary
production worker. A real guardian SIGKILL preceded the partial-successor
fixture; a graceful worker exit preceded the empty unpublished-initial fixture.
With acquisition disabled, the private harness preserved the accepted receipts,
restored the last accepted source runtime, and changed the actual new attempt
back to submitted. It pinned the checkpoint bytes under the scope lock and
verified the modeled state through independent SDK acquisition before enabling
ordinary service recovery. This models interrupted readiness publication; it
does not establish a natural crash at the exact write instruction or power loss.

Each original coordinator retired and sealed the uncertain attempt, reconciled
the checkpoints and admitted a distinct worker. Committed receipts and retained
records stayed byte-identical. Normal managed return preserved both fixture
results; public managed forgetting removed only those fixtures. Enrollment,
protected hashes, original retained inventory and boot identity survived.
All 21 trial units per TV and the deployment units are inactive; all old and
replacement native process/runtime/freezer identities are absent. SDK is on
loopback, no setup operation is pending, and none of the independent 300-second
.NET rescues fired. All managed DLLs remain unchanged. See
[sanitized evidence](startup-binding-results.json).

Fully native capability entry, remaining lifecycle coverage, production
performance/endurance and native-default observation remain open. The .NET
bridge, worker fallback and independent rescue remain deployed; no reboot,
standby or global policy change occurred.

### Vendor native-entry preparation boundary — 2026-10-16

Static review of exact read-only firmware captures found a concrete S90D
read-only overlay helper in the later Launchpad execution pipeline. That pipeline
then prepares app security before invoking app code. Both targets' exact security
libraries apply an empty capability set on the traced preparation path. QN90A's
receiver and security callback required analyst-assisted Thumb reconstruction;
unresolved indirect calls and runtime behavior remain explicit limitations.
Thus the later code-mapping helper alone does not supply native acquisition's
required capabilities. QN90A's corresponding overlay path remains unestablished.

Both `launchpad-starter` binaries were also inspected without invocation. Their
shared-state initialization and fixed process-pool execution make them unsuitable
as isolated caller-code hosts. No new entry was qualified, and the original
preload trial was not repeated. See the [entry findings and provenance](../../native-root-acquisition/entry/vendor-preparation-results.json).

Keep the managed entry, worker fallback and independent rescue. Further native
entry work needs an earlier isolated mapping mechanism. Production performance
and endurance qualification can proceed independently on the current ordinary
signed worker; power transitions and native-default rollout retain their gates.

### Ordinary-worker performance observations — 2026-10-16

The benchmark now requires native production lifetime and verifies its guardian.
It measures root/app job admission and observed completion, checks exit/output,
and forgets only verified jobs. Per-process phase snapshots include descriptors,
threads, mounts, RSS high-water and per-thread context switches. Missing optional
fields remain unknown; context switches are not reported as wakeups. The `wait4`
high-water value is explicitly not an additive process-tree RSS total.

Both TVs ran exact ordinary worker bytes from signed 0.7.45, with the matching
installed managed DLL, on private loopback connections. Two warmup pairs preceded
four measured pairs; execution order alternated. Each measured worker verified
four upload/download cycles and root/app jobs. Five focused Linux benchmark tests
passed, the diagnostic binary reproduced across two builds, and npm passed 414
tests with 157 optional skips. No service, worker or setup production code changed;
no new signed package was installed.

| Median observation | QN90A managed | QN90A native | S90D managed | S90D native |
| --- | ---: | ---: | ---: | ---: |
| Warm launch to authenticated status (ms) | 511 | 544 | 800 | 193 |
| Settled worker + guardian PSS (KiB) | 5,822 | 549 | 5,914 | 451 |
| First upload (MiB/s) | 13.26 | 13.62 | 19.65 | 20.35 |
| First download (MiB/s) | 87.47 | 86.14 | 65.70 | 76.59 |
| Root-job observed completion (ms) | 145 | 264 | 104 | 99 |
| App-job observed completion (ms) | 73 | 242 | 60 | 90 |

QN90A native root-job completion reached 518 ms; S90D native app-job admission
reached 1,016 ms and observed completion 1,062 ms. Do not discard these samples or
declare the performance no-regression gate passed. Investigate launch persistence,
supervision and scheduling costs before the final endurance run. The measurements
do not yet establish the cause; repeating passing samples would not resolve it.

Warm launch excludes acquisition, service scheduling, HTTPS and boot readiness.
Job completion includes ten-millisecond polling. The installed fallback and
controller remained alive, which affects shared-mapping PSS attribution. Four
pairs cannot establish stable tails; nearest-rank p95 is the maximum at this
sample count. Phase snapshots are not continuous peaks, and captured kernel tails
are not full-run observation. Raw logs and identity bindings remain private;
[sanitized results](production-performance-results.json) retain sample counts,
warmups, ranges, medians, order and these limits.

Both TVs ended with their original managed worker ready, unchanged retained jobs,
history, enrollment and boot identity, SDK loopback, no native helper/freezer
remnants, and independent rescue inactive without firing. All trial helpers,
uploads, jobs and private scopes were retired. The QN90A harness initially stopped
before launch at an obsolete managed-code path assertion; exact staged hashes and
the current signed DLL were reconciled without repeating uploads. An additional
read-only inventory found old empty service directories outside this experiment;
they were preserved and excluded from claims about owned benchmark cleanup.

Next: diagnose the measured job-latency cost, then complete full acquisition/public
path timing, continuous resource/lifecycle observation and 24-hour qualification.
Native-only entry, authorized power transitions and native-default observation
remain separate open gates. Keep all .NET fallback and recovery paths.

### Job persistence timing attribution — 2026-10-16

A separately staged timing interposer measured the original `fsync` calls in
disposable comparison processes on both TVs. It did not modify the ordinary
signed 0.7.45 worker, change sync results, remove a sync, or enter the installed
service. A Linux fixture verifies the private-scope filter, unchanged file bytes
and preserved invalid-descriptor error. Two builds reproduced; npm passed 414
tests with 157 optional skips. The existing benchmark again completed two warmup
pairs and four measured pairs per TV.

Each of the eight measured native jobs per TV had the expected seven-call order:
initial intent file + directory, running record file + directory, terminal record
file + directory, then forget directory. All 56 calls per TV succeeded. The trace
collector binds the first six calls to the corresponding benchmark job and checks
that their summed durations fit inside admission/completion intervals.

On QN90A, sync calls account for a median 97.0% of admission time and 91.7% of
observed completion time. Individual calls commonly take 35–40 ms. On S90D the
corresponding fractions are 86.2% and 71.0%. The largest job sync was 67.180 ms on
QN90A and 39.418 ms on S90D. The earlier ordinary S90D one-second sample did not
recur; these later samples do not explain or invalidate it. The observations
identify synchronous persistence as the dominant typical cost, not the underlying
storage/kernel cause of either that cost or the earlier tail.

The managed reference saves JSON without the native path's explicit file and
directory sync barriers. Do not remove those barriers to match its timings.
See [sanitized attribution](job-sync-timing-results.json); raw process identities,
paths and timing lines remain private. Logging/preload perturb scheduling, and
the performance no-regression gate remains unresolved.

Both TVs retained their original managed worker, selection history, retained
records, enrollment and boot identity. All diagnostic helpers/uploads/jobs/scopes
were removed; native helper runtimes/freezers are absent, SDK is on loopback, and
the independent 300-second rescue is inactive without firing.

The next implementation candidate is one exclusive publication of the complete
running record after creating a contained child held behind its existing gate.
It would eliminate the successful path's separate PID-zero intent publication,
while retaining file sync and directory sync before releasing the command. This
is a proposed change, not an implemented or qualified optimization. Its acceptance
requirements are:

- Existing IDs and foreign metadata remain refused without command execution;
  publication must never replace an existing record.
- Allocation, pipe, fork and identity failures retain the applicable rejected-ID
  evidence; no child can outlive failed preparation or bypass its gate.
- Crashes at temporary creation, partial write, sync, publication and gate release
  preserve ownership/reconciliation and never replay a command. Include faults
  with a real gated child, not only an empty fixture directory.
- A complete record with the original child identity and both persistence barriers
  precedes command execution. Failed sync keeps the child gated. The execution
  deadline still starts only after successful preparation.
- Terminal persistence, saved-record compatibility, unknown exit handling,
  retention, cancellation and managed return keep their existing guarantees.
- Focused failure/storage tests, fresh restart/rehearsal fixtures and both-TV
  qualification of the ordinary signed candidate must precede performance claims.

Implement and qualify that design before the final endurance run; retain the
earlier performance samples and all .NET fallback/recovery paths.


## Single durable job publication — 2026-10-16

Signed 0.7.46 implements the preceding proposal. Successful admission allocates
and forks a contained child behind its existing gate, then exclusively publishes
the complete running identity. File sync and directory sync must finish before
releasing the gate and starting the execution deadline. Admission therefore uses
two sync calls instead of four; terminal persistence and record format remain
unchanged. There is no durability relaxation to imitate the managed timings.

Final/update-temporary/same-worker intent names are refused before fork, and the
exclusive link protects against a late conflicting final record. Unpublished
failure kills and verifies reaping of the gated child before clearing its slot;
the monitor cannot later create a record over foreign bytes. Allocation, partial
pipe, fork and identity failure retain a rejected ID when persistence is possible.
A linked record remains reserved after directory-sync failure. Worker loss before
any record exists cannot execute the command; only an explicit later request may
reuse that unrecorded ID after reconciliation. Recovery never replays work.

Local verification passed 50 native regression tests, seven timing/storage groups,
six launch-pressure groups, and two publication tests. The publication tests cover
five pre-fork metadata shapes and real gated-child loss before publication;
initial-intent interruption also covers six stages through gate release. Fresh
managed/native fixtures passed six rehearsal cases, 21 ordinary restart cases
(three fault-only skips), and all 24 cases with a fault-enabled worker. npm passed
414 with 157 skips. The two initial restart failures were reproduced without
container init: a killed worker remained a zombie owned by PID 1, and the service
correctly refused recovery. Fresh `--init` runs passed; no process-absence guard
was changed. A failed build/test attempt against stale binaries was discarded;
reported tests use the fresh source-bound build.

Both TVs installed verified signed contents and completed native public root/app
jobs, normal managed return and public fixture forgetting. Separate ordinary
workers passed per-process address-space refusal with a live job and saved result,
restored app execution, refused-ID reconciliation after restart, and cleanup.
Allocation/pipe/fork/identity injection remains local-only. Each then completed
two warmup pairs and four measured managed/native pairs using the unchanged
benchmark. Median admission / observed-completion milliseconds were:

| Device/profile | Prior 0.7.45 native | 0.7.46 managed | 0.7.46 native |
| --- | ---: | ---: | ---: |
| QN90A root | 168 / 264 | 106 / 141 | 98 / 185 |
| QN90A app | 149 / 242 | 57 / 77 | 73 / 166 |
| S90D root | 60 / 99 | 65 / 89 | 59 / 90 |
| S90D app | 50 / 90 | 22 / 55 | 23 / 61 |

These samples do not establish a stable tail distribution; nearest-rank p95 is
the maximum at n=4. They exclude full acquisition and HTTPS service scheduling.
A new S90D native root sample took 1125.913 ms to admit and 1324.662 ms to
complete. Its cause, the previous S90D one-second app admission, and the historical
QN90A command timeout remain unexplained. The performance no-regression gate
stays open. See
[sanitized samples and preservation evidence](single-publication-results.json).

Both ended managed-ready and settled on their original boots, with original
retained records and enrollment preserved. Disposable pressure/benchmark helpers,
uploads, jobs and scopes are removed;
native helper runtimes and freezer scopes are absent. Historical service staging
and sealed launch-fence tombstones remain under the existing recovery contract.
Owned trial units and all four independent .NET rescue pairs per TV are inactive,
with no rescue service start. Managed DLLs are unchanged.
No reboot, standby, global policy, persistent capability or SMACK change occurred.
Raw logs, package/signing data, device identities and journals remain private.

Next: measure integrated acquisition/public-path latency with continuous resource
and kernel evidence, investigate remaining tails, and complete mixed endurance.
Native-only capability entry remains separate unfinished work; preserve the
managed bridge, fallback and independent rescue throughout. Power transitions
remain outside the current authorization, and native-default observation and
.NET retirement are not complete.

## Sync tails and continuous kernel capture — 2026-10-16

The eight-pair S90D sync diagnostic used unchanged ordinary 0.7.46 worker bytes
and the previously qualified interposer. Every measured native job made five
successful sync calls: initial file/directory, terminal file/directory and forget
directory. Admissions ranged from 22.362 to 53.400 ms, so the original one-second
admission outliers were not reproduced. A terminal-directory sync took 132.423 ms
and a forget-directory sync took 381.886 ms. Two warm launches took 1401.740 and
1435.698 ms; their six guardian publications spent 96.4% and 96.9% of those
intervals in sync calls. Elapsed syscall time includes scheduling and does not
prove a flash or writeback cause. This diagnostic used kernel tails, not the new
collector. See [sync attribution](tail-sync-results.json).

The benchmark now optionally captures whole `/dev/kmsg` records continuously in
a prefaulted 2 MiB memory buffer. Persistence happens after measurements. It
reports gaps, overruns, malformed/reordered input, read errors, capacity limits
and suspend-clock divergence; incomplete coverage fails the run. Launch-to-exit
and per-job monotonic boundaries permit independent coverage checks. Output and
forget durations are explicit, while admission and observed completion retain
their existing definitions. This is diagnostic tooling only: neither production
worker bytes, service code nor installed packages changed.

Nine synthetic capture tests and six benchmark protocol/resource tests passed
from a fresh source-bound Linux snapshot. npm passed 414 with 157 skips. Two ARM
builds produced identical benchmark bytes with a GLIBC 2.28 ceiling. The raw
captures independently match their metadata sizes and contiguous sequence ranges;
their clock windows bracket all twelve launches through retirement per TV. The
specified OOM, panic/oops/warning, I/O-error and hung-task signature scans had no
matches. Those scans are not a comprehensive error detector or proof of a latency
cause. Raw logs, identities and operation receipts remain private.

Fresh same-boot hardware rounds passed on both TVs with ordinary signed worker
bytes and no timing interposer. Median measured milliseconds were:

| Device/profile | Managed completion / through forget | Native completion / through forget |
| --- | ---: | ---: |
| QN90A root | 97.313 / 132.136 | 63.840 / 75.373 |
| QN90A app | 37.143 / 58.504 | 53.144 / 64.531 |
| S90D root | 114.019 / 157.599 | 84.483 / 100.741 |
| S90D app | 48.441 / 82.824 | 73.053 / 91.642 |

The four-pair samples are too small to settle tails. Native app completion remains
slower in these samples, and earlier outliers remain unexplained. The observer's
CPU and memory are excluded from worker accounting but may perturb scheduling
and pressure. Keep all earlier results; this does not close the no-regression,
integrated acquisition/HTTPS, continuous resource or endurance gates.

Both fresh rounds ended managed-ready on their preflight boots with original
worker identity, history and retained bytes. Enrollment/protected files are
unchanged, native helper runtimes/freezers and disposable files are absent,
SDK is on loopback and each independent 300-second .NET rescue is inactive without
firing. The preceding QN90A boot-change attempt is separately recorded as
incomplete acceptance, despite a completed benchmark and later verified cleanup.
No deployment, deliberate power transition, global policy or persistent
capability/SMACK change occurred. Next: measure the integrated acquisition/public
path and continuous resources, retaining this capture coverage and all fallback
paths; native-only entry and long-duration qualification remain open.

## Integrated HTTPS/acquisition resource observation — 2026-10-16

`observe` is a standalone diagnostic executable, excluded from installed payloads.
It combines the continuous kernel cursor with bounded in-memory resource samples.
An independent transient unit gives it a private read-only code mount, so source
worker retirement and acquisition cannot stop observation or leave a registered
helper blocking handoff. The existing 300-second .NET SDK rescue remains separate.
Readiness, PID/start identity, boot, signed worker digest, sample windows and
owned cleanup are verified before attributing results.

Samples bracket process identity and executable/argument observations, preserve
CPU/start counters as full-width decimal strings, and record memory, swap,
descriptors, threads and mounts. Missing fields stay unknown. Actual sample gaps,
duration, skipped intervals, lost coordinator, bounded-buffer/cache exhaustion
and kernel gaps remain explicit. SIGTERM ends observation and persists evidence.
The observer never changes kernel logging, worker policy or installed code.

Nine observer tests, nine kernel-capture tests and five candidate-packaging tests
passed. They include partial proc data, PID reuse during a sample, bounded runtime,
signal-driven finish, coordinator loss, output preservation and the private bind
path/digest regression. npm passed 414 with 157 skips. Two ordinary ARM builds
were byte-identical. No service/client/tvsetup production code or worker changed;
the full fixture migration suite was not repeated for this diagnostic-only change.

Each final hardware round ran two commands and two jobs per root/app profile on
each implementation, uploaded and checksum-verified an 8,677,890-byte download,
disabled/re-enabled native service acquisition while managed was selected, migrated
to native, and returned normally to managed. Managed/native fixture results survived
the relevant transitions and were forgotten through the public API. Fresh TLS is
used for individual job requests; transfers retain pinned keep-alive sessions.
Host job/transfer durations include durable local journaling, polling and local
checksum/fsync work. The saved RPC measurements separately exclude surrounding
journal writes. These costs differ from the earlier direct worker benchmark.

| TV | Enable-to-ready | Migrate-to-native | Return-to-managed | Resource samples / kernel records |
| --- | ---: | ---: | ---: | ---: |
| QN90A | 2367.464 ms | 4040.360 ms | 13311.208 ms | 41 / 332 |
| S90D | 2582.892 ms | 7889.016 ms | 20435.403 ms | 50 / 388 |

Each native worker and guardian had at least twelve valid observations bound to
its activation identity, with no field-read errors. Native worker peak sampled
PSS was 383 KiB on QN90A and 1385 KiB on S90D; corresponding guardian values were
219 and 251 KiB. These are sampled values, not exact process-tree peaks. The
one-second schedule skipped no whole intervals; the largest observed gap was
1302.362 ms on S90D. Short-lived acquisition processes can be missed: QN90A had
no managed-entry sample and S90D had one candidate sample.

Observer overhead is material. Its prefaulted resource/kernel buffers total
10 MiB and can subsequently swap: observed swap reached 10,380 KiB on QN90A and
4572 KiB on S90D. Observer CPU deltas were 3476 ms over approximately 40 seconds
and 6220 ms over approximately 49 seconds. Keep this cost separate from worker
usage, but do not assume it has no scheduling/pressure effect. Per-role CPU
intervals differ and exclude exited descendants; idle wakeups remain unknown.

The new S90D root admission/completion outlier was 1141.376 / 1334.111 ms, and a
managed app job took 1917.448 ms through forget. Kernel sequence coverage was
complete across both final rounds, with no gaps, overruns, capacity exhaustion or
read errors. The specified OOM, panic/oops/warning, I/O-error and hung-task scans
had no matches; this neither proves all errors absent nor attributes the tails.
No no-regression, exact resource-peak or endurance gate is closed by these trials.

Earlier attempts remain distinct evidence. The first QN90A observer missed native
processes because proc exposed a private bind root as `/worker`; read-only
inspection proved the signed executable digest at that path. Discovery now
recognizes it and still requires the digest. An unsupported read-only public
status operation in the investigation was rejected; the original committed trial
continued only through its remaining measurements/return/cleanup, without replay.
S90D's first migration was rejected before launch by the one-trial-per-coordinator
guard. Its fixture and observer were reconciled and cleaned before service relaunch
and a fresh trial. Relaunch reset its task in the same WRT host PID; QN90A's hosting
PID changed. No guard was weakened. A disappearing proc mountinfo entry also caused
probe cleanup to stop before deletion; explicit absence/terminal-state checks
permitted its later cleanup. Original evidence remains private.

Both final rounds preserved enrollment, protected files, unrelated apps, retained
jobs and their trial boots. Selection history contains the expected two committed
transitions. Native processes/freezer scopes, observer mounts and disposable files
are absent; all owned units are inactive, SDK is on loopback, and no independent
rescue fired. No package deployment, deliberate power transition, global policy,
persistent capability or SMACK change occurred. Next: reduce/quantify observation
overhead and investigate the remaining latency tails before final mixed endurance;
native-only entry, broader lifecycle/24-hour evidence and native-default observation
remain unfinished.

## Reduced observer overhead and fresh integrated qualification — 2026-10-16

The standalone observer retains its 8 MiB resource capacity without prefaulting
unused pages. The continuous kernel collector retains its 2 MiB prefaulted
buffer. Every tick still measures identity, CPU, resident pages, lifetime peak
RSS, descriptors, threads and mounts. Mapping details are read on first sight of
a PID/start/executable identity and every fifth tick; fast rows explicitly leave
those fields null. Metadata schema 2 records this cadence. Executable device and
inode checks detect replacements at the same pathname. Applying the unchanged
executable discovery filter before unrelated stat/cmdline reads reduces scan cost.
No ordinary worker, service or signed package bytes changed.

Thirteen observer and nine kernel tests passed from a source-bound Linux snapshot.
New fixtures prove that fast sampling never opens smaps, unrelated processes do
not trigger stat/cmdline reads, new identities force detail, and same-path inode
replacement invalidates a sample. npm passed 414 with 157 skips. Two ARM builds
were byte-identical. The ordinary worker remains the qualified 0.7.46 binary.

Each TV ran one 20-second baseline/reduced idle pair, with reversed order between
TVs and the same boot, coordinator, worker and history within each pair:

| TV | Baseline / reduced CPU, percent of one core | CPU reduction | Maximum sampled PSS + Swap, KiB |
| --- | ---: | ---: | ---: |
| QN90A | 8.616 / 2.843 | 66.998% | 10526 / 2354 |
| S90D | 13.106 / 4.593 | 64.953% | 10545 / 2369 |

CPU covers the first-to-last sample interval, excluding launch and persistence.
PSS plus Swap is an accounting proxy; baseline has twenty mapping observations
and reduced has four. Sparse details can miss peaks. Progressive buffer growth
can fault pages during sampling. This bounded comparison is not a statistical
cost distribution or proof of negligible scheduling/pressure effects.

Fresh integrated rounds repeated managed/native commands, root/app jobs,
8,677,890-byte checksum transfers, service disable/enable acquisition, native
migration and normal managed return. QN90A collected 40 resource samples and 332
contiguous kernel records; S90D collected 52 and 402. No whole sample interval
was skipped, and accepted process rows had no identity or field-read errors.
Native worker and guardian each have at least eleven identity-bound observations
and three detailed mapping samples. Observer CPU was 3.098% and 4.543% of one core;
maximum sampled PSS plus Swap was 2467 and 2503 KiB respectively.

QN90A enable-to-ready/migrate/return measured 1455.643 / 5599.823 / 14597.185 ms;
S90D measured 2586.942 / 8215.247 / 21085.309 ms. These are single host-observed
trials. Native public job admissions ranged 117.199–150.450 ms on QN90A and
151.757–166.797 ms on S90D. Prior outliers remain unresolved. The earlier S90D
root outlier spent 1138.673 ms inside HTTPS versus 1141.376 ms in the outer
harness; local intent/result writes explain only about 2.703 ms. The earlier
managed forget RPC took 1547.874 ms. Successful journaled operations have two
service publications, each with file and directory sync, in addition to worker
persistence. Existing measurements cannot partition these costs from worker,
TLS/network and scheduling time. No persistence barrier was removed.

Both final rounds preserved their trial boots/coordinators, retained jobs,
enrollment and protected files, and ended managed-ready. Native and observer
scopes/mounts/helpers are absent, owned units are inactive, SDK is on loopback,
and independent 300-second .NET rescues did not fire. No deployment, power
transition, global policy, persistent capability or SMACK change occurred.
Raw device data and journals remain private; see
[sanitized qualification](observer-overhead-results.json).

Next: add authenticated service phase timing and investigate the remaining tails.
Native-only capability entry, complete lifecycle/resource and 24-hour mixed
endurance evidence, native-default observation and .NET retirement remain open.
The managed bridge, worker fallback and independent rescue remain required.

## Authenticated request phase timing — 2026-10-16

The worker API now returns `Server-Timing` durations for attempted journal begin,
worker execution and journal finish phases, plus a containing handler duration.
The per-request monotonic measurements cover exec, operation and binary transfer
routes. Read-only operations omit journal phases; rejected/unknown operations
retain their existing outcomes and replay protection. Failed phases are measured
without inventing success or retrying. Enrollment/browser checks precede timing
enablement. Status and asynchronous native administration do not report worker
phases. Response bodies, deadlines and file/directory sync barriers are unchanged.
See [timing semantics](../README.md#request-phase-timing).

Four deterministic tests cover ordering, failures, unknown results/replay,
keep-alive reset, binary responses and restricted access. Real mutual-TLS tests
also verify headers for upload/download and their absence on browser rejection.
The focused run passed 32 tests with one opt-in long-deadline test skipped; npm
passed 418 with 157 skips. Fresh rebuilt managed/native fixtures passed all six
rehearsal cases and 21 restart cases, with three fault-binary cases skipped.
No client or tvsetup production source changed.

Both signed 0.7.47 installations passed physical/model/firmware/signing admission,
installed-content readback and enrollment/protected-file checks. Only API code,
version/signatures and manifest metadata changed. Native manifest source entries
now include the previously committed diagnostic headers/build script; artifact
entries and all 17 non-manifest payload members are unchanged. The managed entry,
managed worker and independent .NET rescue remain available.

Each TV completed the same bounded integrated sequence: managed commands/jobs and
8,677,890-byte checksum transfer, native service disable/enable acquisition,
committed native commands/jobs/transfer, normal managed return, retained fixture
verification and public API cleanup. All 147 successful worker requests per TV
reported the expected phases; handler durations contained their phase intervals.
QN90A recorded 41 resource samples and 336 contiguous kernel records; S90D recorded
51 and 396. No whole interval was skipped. Each native worker/guardian had at least
thirteen identity-bound samples and three detailed mapping observations.

The fixed public sample set contains two root and two app jobs per implementation:

| TV / implementation | HTTPS admission median / maximum | Worker-phase median | Journal begin / finish medians |
| --- | ---: | ---: | ---: |
| QN90A managed | 131.802 / 147.703 ms | 29.823 ms | 24.772 / 30.446 ms |
| QN90A native | 108.419 / 111.361 ms | 18.697 ms | 21.456 / 21.964 ms |
| S90D managed | 142.744 / 151.967 ms | 38.340 ms | 29.174 / 29.514 ms |
| S90D native | 134.053 / 143.497 ms | 24.687 ms | 28.261 / 29.532 ms |

These small mixed-profile samples are descriptive, not tail distributions. More
usefully, the additional S90D native root retained-fixture admission took
1263.781 ms: journal begin 30.847 ms, worker 24.283 ms and journal finish
1129.298 ms. Its request is bound to the saved fixture intent and verified native
selection. S90D also reproduced a slow public managed forget at 1338.224 ms:
journal begin 193.771 ms, worker 20.394 ms and journal finish 1061.122 ms.
QN90A maintenance exec requests took 1307.403 and 1256.663 ms, dominated by
1220.967 and 1151.516 ms in journal finish. Other S90D journal-begin delays also
occurred, including an upload chunk. These observations locate these particular
delays in service publication, not worker execution. Existing historical outliers
remain distinct evidence.

Journal publication includes serialization, file write/sync, rename, parent
sync and scheduling. Phase timing cannot separate these subintervals or prove a
storage mechanism. Handler duration excludes prior TLS setup and subsequent
response transmission; its difference from HTTPS elapsed time is not pure network
latency. The observer still perturbs resource use and can miss short-lived processes.
No durability optimization or no-regression/endurance gate is claimed here.

Both rounds ended managed-ready on their trial boots/coordinators, with retained
jobs/enrollment protected, native/observer scopes removed, SDK loopback restored,
owned units inactive and independent trial rescue start counters zero. S90D's
deployment rescue was also checked before disarming. QN90A deployment acceptance
disarmed its 300-second rescue about 26.948 seconds after the restore intent; a
later cleanup check found all six deployment timer/service entries unloaded and
inactive, so their historical start counters were unavailable. The extra cleanup
initially refused an unloaded timer; read-only reconciliation preceded a check
that skips already-inactive timers. No installation or uncertain request was
replayed. This evidence limitation remains explicit in the sanitized record.

No reboot, standby, global policy, persistent capability or SMACK change occurred.
Raw requests, identities, signing data and captures remain private. Next: partition
service publication costs and address the reproduced tails while preserving
intent/result durability. Native-only capability entry, full lifecycle/resource
and 24-hour mixed endurance evidence, native-default observation and eventual
.NET retirement remain unfinished.

## Journal sync attribution without a format change — 2026-10-16

Optional request-local counters now bracket the existing synchronous file and
directory sync calls in journal publication. The API reports their aggregate
elapsed milliseconds and attempt counts as nested `Server-Timing` metrics.
Automatic archive work includes the archive file, archive-parent and active-file
barriers. Failed sync attempts are measured once and retain the original failure
and uncertainty behavior. Main journal durations contain these measurements;
adding both levels would double-count time. No barrier, rename, JSON field,
archive format, replay check, response body or operation deadline changed.

Four new journal tests verify exact barrier order/counts, automatic archival,
failed admission and failed completion. An API test verifies attempted-sync
metrics on failure without worker dispatch. Real mutual-TLS tests verify nested
upload metrics and unchanged read-only download metrics. The focused run passed
44 tests with one opt-in long-deadline case skipped; npm passed 423 with 157 skips.
Fresh rebuilt managed/native fixtures passed six rehearsal and 21 restart cases,
with three fault-binary cases skipped. Separately, the actual 0.7.47 policy reader
accepted the current writer's journal and archives, rejected replay of all 106
fixture IDs, and wrote a completion accepted by the current reader. That is local
format compatibility evidence, not a signed rollback trial.

Both signed 0.7.48 updates passed installed-content, model/firmware/signing and
enrollment/protected-file verification. API/policy code and version/signature
metadata changed; all 19 payload members and their manifests are unchanged.
Each TV completed managed/native commands, root/app jobs and 8,677,890-byte
checksum transfers, service disable/enable acquisition, committed native
migration and normal managed return. Each validated 147 timed requests, with
198 file-sync and 198 directory-sync calls. Every measured phase aggregate had
one call in these runs, so these tails were not repeated automatic-archive syncs.

| TV | Longest single file sync | Longest single directory sync | Resource samples / kernel records |
| --- | ---: | ---: | ---: |
| QN90A | 1048.478 ms | 863.684 ms | 40 / 329 |
| S90D | 1050.400 ms | 1307.263 ms | 51 / 448 |

QN90A's slow native upload request spent 1048.478 ms in its intent file sync and
192.594 ms in the following directory sync, within 1467.207 ms over HTTPS. A later
observer-data `file.open` result publication spent 308.133 ms in file sync
and 863.684 ms in directory sync. S90D's managed job admission spent 697.116 ms
in its result directory sync, while a managed forget spent 704.676 ms in its
intent file sync. A native forget spent 1307.263 ms in its result directory sync
versus 23.040 ms in the worker phase, within 1488.142 ms over HTTPS. Another native
upload spent 1050.400 ms in its intent file sync. Keep the full sanitized intervals
in [the evidence record](journal-sync-phase-results.json).

The four fixed mixed root/app admission samples per implementation had HTTPS
median/maximum values of 122.520/133.563 ms managed and 116.729/143.755 ms native
on QN90A; S90D measured 147.269/840.698 ms managed and 140.940/161.377 ms native.
These are descriptive samples, not stable tail distributions. Both implementations
encounter service publication delays. Sync elapsed time includes runtime binding
overhead and descheduling; it does not prove the underlying storage or kernel
mechanism. Do not weaken durability or attribute every historical outlier from
these observations. Earlier direct-worker timing remains separate evidence.

Continuous kernel captures were complete; no whole resource interval was skipped.
Every native worker/guardian had at least thirteen identity-bound observations
and four mapping-detail samples. Both rounds ended managed-ready on their original
trial boots/coordinators with retained jobs and enrollment unchanged. Trial scopes,
observer mounts and disposable helpers are absent; deployment and trial units are
inactive, SDK is on loopback, and rescue start counters were checked as zero.
No reboot, standby, global policy, persistent capability or SMACK change occurred.
Private journals, raw captures, identities and signing data remain outside Git.

Next: prepare sustained integrated observation with bounded capture storage and
verified continuity, then gather the remaining mixed endurance/resource evidence.
The existing 240-second observer cannot stand in for that qualification. Native-only
entry, the broader performance gate, separately authorized power lifecycle,
native-default observation and .NET retirement remain unfinished. The managed
bridge, worker fallback and independent SDK rescue remain required.

## Overlapping capture continuity — 2026-10-16

The offline `verify-observer-series.py` checks caller-bound private capture
series: bounded regular files and hashes, successful exits, boot/coordinator
identity, advancing overlapping clocks, suspend offsets, complete resource rows,
actual sample spacing, kernel sequence continuity and byte-identical duplicate
records. It refuses gaps and inconsistent evidence rather than summing window
durations. Seventeen focused tests passed, including sequence holes across an
empty middle window, changed overlap bytes, partial identities, invalid clocks,
symlink refusal and missing requested boundaries. The npm suite passed 423 tests
with 157 skips. No deployed service or native binary changed.

Both TVs completed two independent 40-second collectors approximately 20 seconds
apart while keeping managed selected. Each verified its predeclared 55-second
interval with 80 resource samples. QN90A had 285 unique kernel records and 100
matching duplicates, with a maximum merged sample gap of 1000.980 ms. S90D had
317 unique records and 101 matching duplicates, with a maximum gap of 1001.778 ms.
Both preserved the original boot, coordinator, worker, retained jobs, enrollment
and protected files. Owned capture scopes were removed, observer/rescue units
were inactive, rescue start counters were zero before disarming, and SDK remained
on loopback. See [sanitized evidence](observer-continuity-results.json).

This qualifies the short overlap method, not sustained native operation or
24-hour endurance. The next controller must roll bounded captures and downloads,
verify native activation identities, renew independent recovery without a gap,
and stop on uncertainty without replay. Native-only entry, performance and full
resource/endurance gates, separately authorized power lifecycle, native-default
observation and eventual .NET retirement remain open. No power transition was
performed; the .NET acquisition bridge, worker fallback and rescue remain intact.

## Rolling native observation controller — 2026-10-16

The adapter-driven host scheduler keeps at most two owned collectors, waits for
successful completion before download/cleanup, checks health throughout, and
renews the independent 300-second SDK rescue. A replacement timer must be active
before its predecessor is retired; retirement verifies the predecessor never
fired. Normal renewal is every 120 seconds with a conservative 30-second margin.
Exceptions stop scheduling without replay and leave recovery/receipts available.
The successful result keeps the final rescue armed for managed return. Device
identity, firmware/signing checks, durable intents and owned cleanup belong to
the adapter; TV-clock/kernel continuity still requires the offline verifier.

Nine scheduler tests passed, including uncertain arm/retirement, selection drift,
failed collection, lost overlap and recovery-budget exhaustion. The 17 continuity
tests also passed; 13 Linux-only observer tests were skipped in this host run.
The npm suite passed 423 tests with 157 skips. No signed package, native binary,
service behavior or durability barrier changed; both TVs remain on 0.7.48.

Both TVs then ran three 80-second observers with a requested 50-second stride,
45-second rescue renewal and 180 seconds of predeclared native coverage. Each
collected 240 resource rows; both production-receipt native process identities
were present and valid in every row. Each performed eight small root/app jobs and
a 150-second quiet job, whose completed exit status survived managed return.
Each used six rescue timers, including bootstrap and rolling renewals; all were
retired without firing. QN90A verified 924 unique kernel records and 257 matching
duplicates, with a 1001.496 ms maximum merged sample gap. S90D verified 1,014 unique
records and 261 matching duplicates, with a 1001.362 ms maximum gap. See
[sanitized evidence](observer-controller-results.json).

QN90A's first final acceptance incorrectly requested volatile job output after
worker retirement. Capture and managed return had already completed; saved status
still showed the expected exit code. The journal and completed return receipt were
inspected, and only remaining fixture cleanup/preservation checks continued. No
launch or handoff was replayed. The S90D harness checked output before retirement
and saved status afterward, matching the documented worker-lifetime contract.

S90D's initial supported service relaunch ended without resetting its worker/task.
The unchanged ready state was inspected and rescue disarmed. A proposed direct
TERM was refused before submission because registered app and listener PIDs did
not match. A fresh supported relaunch captured successful launcher exit codes and
reset the worker/task while retaining the shared WRT host. Its owned diagnostic
log was verified and removed. The initial elapsed launcher timer was explicitly
stopped during final reconciliation; all owned launcher units are now inactive.

Both trials ended managed-ready on their original boots/coordinators, with
original retained jobs, enrollment and protected files preserved. Owned collectors,
mounts, fixture jobs and native scopes were cleaned, trial/rescue units are inactive,
and SDK remains on loopback. No reboot, standby or shared-runtime signal occurred.
The next step is a supervised 24-hour invocation with free-space monitoring and a
full-duration job plus mixed work/idle workload. This short qualification closes
neither endurance, full resource/performance comparison, native-only entry, power
lifecycle nor native-default/sunset gates. Both .NET fallbacks remain required.

## Full-duration endurance preparation and start — 2026-10-16

The scheduler accepts up to 25 hours of requested coverage so a 24-hour job can
start under observation and reach a terminal result before capture ends. The
full-day fake-clock test completes all 540 windows of a 24-hour-plus-one-minute
plan with bounded collector ownership and only the last rescue armed. New storage
checks budget maximum capture sizes plus 1 GiB of receipts per concurrent run and
a shared 2 GiB floor. Twelve controller/storage tests and 17 continuity tests
passed; 13 Linux-only observer tests were skipped. npm passed 423 with 157 skips.
No client, installed service, native binary or signed package changed.

The private supervising harness pins its source snapshot and the installed
manifest, keeps the Mac awake only for its bound run, records process/terminal
state, and never restarts a failed child. It bounds adapter callbacks to 45
seconds, maintains source-bound native identity checks, verifies each adjacent
capture pair while collecting, and requires full-series verification at the end.
The quiet job receives the full 86,400,000 ms timeout and deliberately outlasts it;
acceptance requires the expected timed-out result, preserved record bytes after
managed return and no execution beyond the timeout. Small root/app jobs run every
five minutes and a 1 MiB checksum round-trip runs hourly. Host-space checks and a
separate read-only TV-space monitor protect bounded storage. A low TV-space result
can stop only the identity-bound host controller, leaving recovery for inspection.

QN90A completed its captured launcher reset, entered native, started the full-day
job, passed its first checksum transfer and began verified 220-second windows.
Its original boot and selected native identities remain bound to the trial.
This initial observation is not endurance acceptance or a leak-free result.

S90D's captured force-kill/start returned successful launcher codes but did not
reset the worker/task. The completed attempt, timer states and owned log were
reconciled without resubmitting its mutations. A fresh graceful termination then
closed the service connection before the launch request returned. Read-only
checks found the TV API reachable but Couchroot absent; the scheduled .NET rescue
did not restore usable SDK access. Its unit result is currently unobservable, so
no cause or successful rescue is claimed. The owned administration UI was launched
once through the model/device-bound HTTP app API and closed afterward; it did not
restore the service. The service-only app returned HTTP 404. That API method is
also described by the [upstream REST implementation](https://github.com/xchwarze/samsung-tv-ws-api/blob/master/samsungtvws/rest.py);
no third-party code was copied into this repository.

S90D has no submitted endurance job. Its restart units/log and request outcome
remain for reconciliation when access returns. User direction for a physical
restart is pending under the original prohibition on reboot/standby. No power
command, package update, persistent capability or platform-policy change was
performed. QN90A's independent trial continues. Native-only entry, resource and
performance conclusions, both-TV endurance, power lifecycle, native-default
observation and .NET retirement remain open.

## Resource analysis and serialized storage checks — 2026-10-16

The offline analyzer first verifies capture continuity, then binds native worker
and guardian samples to the production receipt, boot and executable digest. It
uses recorded clock-tick/page-size units, subtracts full-width CPU counters before
conversion, and assigns overlapping samples to one collector at a time. It
reports per-process and same-scan native totals, fixed-time bins, sampled extrema,
endpoint differences, and known/unknown memory counts. Sparse mapping details
remain unknown; lifetime RSS high-water marks and summed namespace mount counts
are excluded. Each observer's own measurements remain separate from application
measurements and from other concurrent observers.

Thirteen analyzer tests cover overlap weighting, growth, full-width CPU counters,
sparse/missing detail, production identity/source changes, counter regression,
invalid units, partial intervals and integrity/CLI failures. It successfully
analyzed the previous 180-second selected-native captures from both TVs. Each
retained 182 samples after interval clipping and overlap removal; combined native
CPU was 0.387% of one core on QN90A and 0.602% on S90D. These short workload samples
are descriptive, not a comparative performance gate.

A distinct completed-prefix manifest also verified 33.510 minutes from the first
12 completed windows of QN90A's stopped attempt. The original 24-hour intent was
not changed. Its 2,017 retained samples showed worker descriptors between 12 and
16, three worker threads, and a worker PSS-plus-Swap proxy between 348 and 415 KiB.
Guardian descriptors/threads remained 11/1 in those samples. Combined native CPU
was 0.269% of one core. The record is too short for an endurance or leak-free claim;
the analysis explicitly excludes unobserved processes and between-sample peaks.

The failure was a host-harness scheduling conflict. The controller and separate
space monitor both used the service API; a `job.status` received an administrative
busy rejection and the controller correctly stopped. Its sole unretired rescue
later executed with exit zero, and the expected non-loopback SDK setting was read
back through the still-working Couchroot service. External SDK usability was not
tested during that interval. A new bounded rescue protected reconciliation; the
final collector completed successfully, the owned quiet job was cancelled, its
record bytes survived managed return and were then forgotten, and original
retained jobs/enrollment/protected hashes were preserved. SDK returned to loopback,
the old timer was stopped, and the reconciliation rescue was retired unfired.
There was no power transition or replay of the rejected request.

Device-space checks now run serially inside the bounded health callback, using a
strict two-filesystem POSIX `df` parser and the existing 256 MiB floor. Three new
tests cover minimum capacity, malformed/partial data and low-space stop behavior
with recovery left armed. The controller has 15 passing tests, continuity has 17,
and resource analysis has 13; 13 Linux-only observer tests were skipped. npm passed
423 tests with 157 skips. No installed service, worker, bridge or package changed.

After reconciliation, a fresh captured QN90A service relaunch reset the task and
preserved its boot, enrollment, history and retained jobs. A new 24-hour invocation
has started with serialized device-space checks, mixed jobs, checksum transfers,
and the original rescue/coverage requirements. Source snapshots and operation
intents remain private and immutable. See [sanitized evidence](observer-resource-analysis-results.json).
S90D recovery remains pending; this work closes neither both-TV endurance nor
performance, native-only entry, power lifecycle, native-default or .NET retirement.

## Collector exit retention — 2026-10-16

The serialized-storage endurance attempt stopped after approximately 14.7 minutes.
A collector was still active when the host's sampling-duration estimate elapsed;
its default zero exit status was not a completed result. Both pending collectors
subsequently produced complete files. The owned quiet job was cancelled, its
record bytes verified across managed return and then forgotten, and original
retained jobs/enrollment/protected hashes were preserved. The old and replacement
recovery timers were retired within their budgets without observed execution.
No mutation was replayed and no power transition occurred.

A five-second exit-wait diagnostic exposed a separate evidence problem: after
running, its transient unit became `not-found` and exposed zero execution-start
and exit-status defaults. The host correctly refused that missing evidence. Its
files were preserved, the bound process and code mount were confirmed absent,
and only its owned scope was cleaned. That diagnostic is not an accepted capture.
Earlier unretained unit polls, which checked only inactive/success/zero, do not
independently prove collector exit. Historical resource numbers remain analysis
of saved files; they must not be promoted to successful-exit or endurance proof.

Collectors now use `Type=simple` with `RemainAfterExit=yes`, preserving their
execution result until the adapter records it. A bounded read-only wait requires
loaded/active/exited, a positive execution timestamp, success and exit zero.
The adapter additionally matches the unit's executed PID to `observer.ready`
and requires normal process exit before stopping the owned unit and cleaning its
verified files. Missing/discarded state, inspection errors, failed exit or timeout
stop the run with evidence and independent recovery preserved.

The corrected QN90A five-second probe observed 13 states over 5.225 seconds. It
waited through active/running with zero status, then recorded retained successful
exit with the matching PID and positive timestamp. Five resource rows and 23
kernel records verified; the owned unit/scope were removed, the original boot and
managed worker remained ready, and recovery was retired unfired. S90D could not
repeat this probe because service and usable SDK access remain unavailable.

Continuity schema 2 now requires each retained exit receipt and validates its
load/retention/result fields, distinct unit identity, matching observer PID and
execution timestamp. Legacy schema 1 stays readable but explicitly reports
`caller-asserted-only` exit evidence. Six new controller tests cover delayed exit,
discarded/failed units, missing execution evidence, timeout, inspection errors
and bounded observation; four verifier tests cover retained versus legacy proof,
default zero status, mismatched execution and reused unit identities. There are
21 controller, 21 continuity and 13 resource-analysis tests passing, with 13
Linux-only skips. npm passes 423 tests with 157 skips. No installed package,
observer/native worker binary, managed bridge or fallback changed.

A fresh QN90A trial uses the retained units and schema 2 while preserving the full
24-hour job, original coverage duration, mixed workload, serialized storage checks
and independent 300-second rescue renewal. Its first 220-sample window passed retained-exit verification and owned cleanup.
This is initial progress, not endurance acceptance. See [sanitized exit evidence](observer-exit-retention-results.json).
S90D recovery, both-TV endurance, performance, native-only entry, power lifecycle,
native-default observation and eventual .NET retirement remain open.


## Consecutive transfers and S90D recovery — 2026-10-16

The retained-exit QN90A trial stopped after 60.909 minutes, with 22 completed
windows, when its second hourly transfer tried to reuse the first local download.
The client's exclusive destination check correctly refused it. The remaining
collector was verified using its retained exit receipt and cleaned. The owned
remote transfer was hash-checked and removed; the quiet job was cancelled, its
record bytes preserved across managed return, and then forgotten. Original jobs,
enrollment and protected hashes were preserved and SDK returned to loopback.
This stopped run does not satisfy the 24-hour gate.

`observer-transfer.py` now gives every index separate download, intent and
completion files. It durably records an exclusive intent before upload, verifies
saved bytes independently of the download receipt, and invokes guarded cleanup
only after checksum and size match. Any existing evidence refuses replay before
upload. Six focused tests cover consecutive transfers, retained earlier bytes,
uncertain upload/download/cleanup, corrupt content, existing paths and invalid
inputs. QN90A passed two consecutive native 1 MiB transfers using this helper,
then returned to managed with original jobs/enrollment preserved and its rescue
retired unfired. The affected observer suites pass 61 tests with 13 Linux-only
skips; npm passes 423 with 157 skips. The installed package remains signed 0.7.48.

The owner restored S90D's Developer Mode Host PC IP and authorized rebooting both
TVs. SDK access then proved S90D was still on its original boot. Read-only root
reconciliation recovered the earlier graceful restart log: termination and launch
reported success and reached the final marker, despite the missing service.
That log does not establish a healthy coordinator. A preservation guard initially
refused the recovery helper's intentionally private passwd view before submitting
any reboot. Outside that view, original enrollment and protected files verified.
The maintenance helper used an isolated archive-directory bind in its private
mount namespace, preserving unrelated service staging files.

A fresh, journaled software reboot produced a new S90D boot and restored the
Couchroot API. Its stale host SDK connection was detached and re-admitted. Under
an independent 300-second .NET rescue, host-assisted loopback restoration brought
managed acquisition back to readiness. Original selection, retained jobs,
enrollment and protected hashes verified; inventory settled and the rescue was
retired unfired. The earlier owned log scope and failed helper stage were removed.
This is recovery on a new boot, not native cross-boot or unassisted SDK recovery
qualification. QN90A was not rebooted; its interrupted SDK-setting change was
reconciled, its acquisition retry budget reset through authenticated disable/enable,
and its managed readiness and preservation checks passed before the new trial.

S90D also passed the five-second retained collector probe: active zero status was
not accepted as completion, and loaded/active/exited success was bound to the
observer PID before cleanup. Fresh supervised trials are now running on both TVs,
using the unique-download helper, original full coverage intent, mixed work,
24-hour quiet job and independent rescue renewal. Their source snapshots remain
immutable. Initial progress does not close endurance or resource/performance gates.
See [sanitized evidence](observer-transfer-recovery-results.json).

The installed selected-native restart path still binds readiness and runtime
receipts to the original boot. Reboot authorization removes the operational
permission blocker; it does not make those receipts valid across boots. Native
cross-boot reconciliation needs implementation and tests before qualification.
Native-only entry, remaining power transitions, native-default observation and
.NET retirement remain open; both .NET fallbacks remain deployed.

## Boot-aware guardian reconciliation prerequisite — 2026-10-16

Local native source now accepts a previous-boot schema-4 journal only with a
valid launch-token binding and the original persistent scope/runtime ownership.
Both boot IDs must be canonical. Old PID/start pairs are not inspected as current
processes. A present freezer with the old name is a current-boot object and blocks
recovery before any thaw or cleanup, even if its inode matches the journal.
Missing freezers are accepted; symlinks and inaccessible resources remain refused.

Across boots, every visible mount namespace is checked for owned runtime views,
including moved bind roots and namespaces whose inode differs from the old one.
Namespace descriptor pins and nsfs bind pins conservatively block cleanup rather
than deriving authority from an old kernel inode. The existing isolated recovery
child, deadline, scope lock, persistent inode checks and successor checks remain.
Completed records stay byte-identical; interrupted jobs keep their IDs and are
never replayed. Legacy journals still require the original boot.

Local validation passed seven focused reboot fixtures, five startup-token binding
fixtures, 49 native regression cases (one storage case skipped), all 24 restart
integration cases including startup faults, and all six managed/native/managed
rehearsals. Native fixtures were rebuilt with ASAN/UBSAN; managed fixtures were
freshly built, and the two integration suites ran in separate disposable containers.
The focused kernel-resource fixture compiles production checks without host-mode
substitutions and redirects only filesystem inputs. npm passed 423 tests with
157 environment-gated skips; the production ARM worker/launcher build succeeded.
These are synthetic boot and resource tests, not on-TV reboot qualification.

No TV package or active endurance source snapshot changed. Both installed trials
remain on 0.7.48 with .NET entry, managed fallback and independent rescue. The
service still rejects cross-boot selected-native startup: runtime/activation
receipt handling, startup fences, retained-state snapshots and managed return
must be integrated before fresh both-TV qualification. The 24-hour endurance,
performance, native-only entry and .NET retirement gates remain open.

## Selected-native boot-transition integration — 2026-10-16

Local service source now separates the immutable original activation from the
current runtime boot. Runtime receipt schema 2 may replace only the boot, worker
identity and unit start binding; source, artifacts, installation and activation
hashes remain pinned. Initial production launches still require the managed
source and native launch to share a boot. Schema-1 runtime receipts retain their
same-boot format and checks.

Startup authenticates and pins the held executor's current boot, checks current
unit/cgroup emptiness, and observes saved PID/start pairs only within their own
boot. Cross-boot startup attempts use schema 3 with both source and launch boot
IDs. The old attempt's fence can be sealed on the current boot, but that override
cannot launch anything or apply to a bootstrap fence. Interrupted checkpoints
must match the attempt token, source worker and launch boot. A crash after runtime
publication but before marking the attempt ready is recoverable without repeating
the original launch. Every replacement gets a new token and fenced intent.

Retained snapshots keep the original identities and record bytes. Native owns
stale-journal reconciliation; the service reads back each result before admission.
Managed return, staging retirement and activation now verify current runtime
processes while retaining the original activation's boot and worker binding.
Current-boot PID collisions still refuse admission; historical PID collisions do
not identify a current process.

Three modeled reboot cases passed with real native/managed fixture processes:
stale guardian recovery, a failed new-boot startup checkpoint, and a runtime
receipt published before startup completion. All three also completed another
service restart on the new boot and returned to managed, preserving completed
records and refusing replay of the interrupted job. Historical receipts are
synthetic fixtures, rewritten before the tested restart and then required to stay
immutable. Signing, SDK acquisition and systemd are modeled; no kernel reboot or
TV mutation occurred in these tests. The first run exposed an activation check
still comparing the original activation to the new boot; fixing that comparison
allowed managed return to complete.

Validation passed all 27 distinct restart integration cases (26 in the complete
matrix and the added receipt-crash case separately), six managed/native/managed
rehearsals, 63 focused Linux cases with one environment-gated skip, and the final
npm suite with 427 passed and 162 skipped. Native ASAN/UBSAN and managed fixtures
were freshly built; integration suites used separate disposable containers.

Installed version remains 0.7.48 on both TVs. Their live endurance source snapshots
and packages were not changed. Both-TV deployment/reboot qualification remains
pending until the active trials finish. Reboot during an already pending bootstrap
or return transition, wider power lifecycle, 24-hour endurance, performance,
native-only entry and .NET retirement remain open. No .NET fallback was removed.


## QN90A observer startup gap — 2026-10-16

The fourth QN90A trial stopped after about 39 minutes with 13 verified windows.
Collector 13 exited normally with status 1 because it reported 219 samples and
one skipped interval. Its first resource snapshot began 1142.935 ms after the
reported interval start. Subsequent maximum sample spacing was 1000.924 ms;
maximum sample duration was 73.482 ms. Kernel capture completed with 1071 records,
no overruns, no sequence gaps and no detected suspend. The source starts the
sampling clock before writing and synchronously publishing readiness. These
observations identify a startup gap; they do not time each startup syscall.
The acceptance rule correctly rejected this capture and remains unchanged.

A fresh independent rescue was armed before retiring the old timer unfired.
Every failed-capture file was downloaded and independently hash-verified, and
only its verified owned scope was removed after confirming unit exit and mount
absence. Collector 14 completed successfully and was collected/cleaned normally.
The owned quiet job was cancelled, its saved bytes verified across return to
managed, then forgotten. Original retained jobs, enrollment, protected hashes,
boot and coordinator remained unchanged. Native processes exited; replacement
rescue was retired unfired and SDK stayed on loopback. S90D's independent trial
continues with its original immutable source snapshot.

The observer startup-persistence correction and focused delayed-I/O tests are
described below, followed by fresh qualification and a separate QN90A attempt.
No failed window will be accepted, patched or merged into a shortened interval.
See [sanitized evidence](observer-readiness-gap-results.json).

## Observer persistence before capture admission — 2026-10-16

The observer now syncs the empty readiness file and output directory entries
before starting the capture clock. Its readiness payload supplies live timing
and identity evidence, then receives its final sync before successful exit.
Acceptance still requires the retained successful unit-exit receipt as well as
complete capture files. A delayed write inside the declared interval still
invalidates coverage; a failed final sync still prevents successful exit.

All 78 observer tests pass, including a 1.2-second admission-sync delay, a delayed
write after capture start, admission failure and final persistence failure. npm
passes 427 tests with 162 environment-gated skips. Two production ARM observer
builds are byte-identical. The failure injection fixture is test-only.

QN90A passed a five-second managed-worker probe with five samples, zero skipped
intervals and its first sample 0.329 ms after the declared start. The retained
unit proved successful exit, the owned scope was removed, the same managed worker
and boot remained, and its independent rescue was retired unfired. This short
probe does not qualify the 24-hour gate. The first endurance launch refused before
mutation because a completed return operation remained in coordinator memory;
its refused intent is preserved separately from the fresh run. A guarded service
restart then cleared that state with jobs, enrollment and boot preserved and its
rescue retired unfired. The new supervised trial uses a fresh immutable source
snapshot and the corrected observer; it has not completed endurance acceptance.

S90D continues its original endurance trial with the original observer and source
snapshot. The corrected observer has not yet been qualified there. Both signed
packages remain 0.7.48; the installed workers and .NET entry, fallback and rescue
are unchanged. See [observer admission evidence](observer-admission-results.json).


## Interrupted bootstrap recovery across boots — 2026-10-16

A schema-2 bootstrap intent can now be reconciled by a fresh authenticated managed
executor on a different boot. The marker, selection digest, artifact hashes,
owned paths and receipt still have to match. Recovery seals the original launch
fence under the current boot; boot overrides can seal an attempt but cannot
launch it. Recorded PID/start pairs are observed only on their own boot, so an
unrelated process with a recycled PID cannot stand in for the old bootstrap.

After a boot change, the old transient unit must be absent. A newly loaded unit
with the same name refuses cleanup even if it is inactive with PID zero. This
path does not stop or reset any current unit. Same-boot recovery retains its
existing live-process, unit-start and empty-cgroup checks. Both paths inspect
all remaining scope entries before removing only absent-or-exact files, and
preserve unknown bytes. Lost cleanup replies converge under the original intent;
launch is never replayed. The retired receipt keeps its original boot and records
`reconciled_boot_id` before the pending marker is removed.

Focused tests cover authenticated boot mismatch, malformed boot IDs, lost replies,
real shell/flock sealing, historical PID collision, current-boot PID refusal,
new-boot unit-name reuse and changed staging. A new coordinator integration case
models a persisted old-boot bootstrap receipt, performs real owned staging cleanup,
starts native, restarts again, and returns to managed. Original activation and
completed job bytes remain unchanged; the interrupted native job is not replayed.
The historical receipt and systemd/SDK behavior are fixtures, not a kernel reboot.

Validation passed 15 focused Node cases, 12 Linux shell/fence cases, all 28
coordinator restart integration cases and six managed/native/managed rehearsals.
Native fixtures were freshly built with ASAN/UBSAN and the managed harness was
rebuilt; the integration suites ran in separate disposable containers. npm passed
429 tests with 165 environment-gated skips. The privacy audit found no findings.

Both TVs remain on signed 0.7.48 with their independent endurance trials running.
No installed worker, service, trial snapshot or .NET fallback changed. Hardware
qualification of the new cross-boot paths is pending. A reboot during a pending
native-to-managed return is the next local recovery boundary; that path must also
handle any unclean native journal before restoring managed state.

## Pending managed returns across boots — 2026-10-16

A fresh held managed executor can now finish a native-to-managed return after
reboot under the original request and transaction ID. All execution binds to its
authenticated current boot; old PID/start pairs are not treated as current
processes. Every old transient unit must be absent after a boot change. A reused
unit name holds admission even with PID zero, and recovery never stops that unit.
The original native activation, source identities and durable restore inputs
remain unchanged. Restore plans use an explicit observed boot for their guards
without changing their original state receipts or byte hashes.

The native worker adds a root-only `--reconcile-state` mode. It opens existing
private state and an exclusive job lock, pins current boot, old owner and journal
digest, then reuses the existing guardian recovery checks. It opens no command
channel and creates no successor guardian, launcher, token or scope. Recovery
retains its 15-second child deadline within a 20-second outer limit; core dumps
are disabled and no generic exit cleanup is registered. Live scope ownership,
changed identity/digest, pending startup journals and unsafe files refuse before
recovery. Its successful exit is followed by independent record verification.

Before native cleanup, the coordinator persists the original snapshot and
understood persistence debris. It accepts changes only to that guardian's
interrupted records or unpublished intents; completed bytes remain exact and
no job is replayed. A lost reply resumes from that same snapshot. Recovery boots
are recorded before invocation so orphan records created before another restart
can be attributed to an admitted attempt. Providers have no public jobs: their
remaining journal must bind to the original startup token, boot and optional
readiness identity, with no extra job entries. The executable digest and owned
code layout are checked before execution in a private read-only mount view.

Nine modeled reboot cases cover return preparation, live provider loss, stopped
native, restored state, managed readiness, lost native/provider recovery replies,
partial restore cutover and a conflicting current unit name. They retain the
original request ID and completed record bytes, preserve immutable activation
receipts, and finish with managed admission. Historical boot receipts and systemd
state are fixtures; real native/managed processes and the offline recovery binary
perform the state transitions. These are not on-TV reboot observations.

Validation passed all 37 distinct restart integration cases: the full run passed
28 and exposed a misplaced test-only lost-reply hook in nine other cases. After
repair, a fresh targeted run passed all 24 affected/return cases; the remaining
13 passed in the full run. All six managed/native/managed rehearsals also passed.
Native ASAN/UBSAN and managed fixtures were freshly built. Native regression
passed 50 cases with 11 gated skips, including all four offline recovery tests
and seven reboot journal/kernel checks; focused Linux service tests passed 78
with one gated skip. npm passed 431 with 174 environment-gated skips, and the
production ARM worker/launcher build succeeded. No client or tvsetup code changed.

Both signed 0.7.48 endurance runs remain unchanged and active. Deployment and
both-TV qualification of the cross-boot changes, the full 24-hour resource review,
performance gate and native-only entry remain open. The .NET entry bridge,
managed fallback and independent SDK rescue remain available.

## Absent transient units during selected-native startup — 2026-10-16

The S90D reboot trial reached a held root bootstrap, then refused public admission
when its native launch command tried to stop a transient unit that no longer
existed. Independent SDK inspection found the old production unit absent and no
new scope token, with the original receipt and job hashes intact. A separate
unique absent-unit diagnostic returned systemd exit code 5. The original startup
intent remains submitted; it has not been replayed. Its rescue restored SDK
access. A later owner-initiated restart is recorded separately from the trial.

Launch now accepts an absent unit without stop/reset. On a different boot it
requires absence again immediately before token publication, refusing a reused
unit without stopping it. On the same boot, a verified empty loaded unit still
uses the existing stop/reset path. The full generated shell is exercised against
systemd stubs that reproduce absent-unit failure, current-boot name reuse and
same-boot loaded/collected units. Three new cases failed before the correction;
all four pass afterward. Token, ownership, boot, fence and scope guards remain.

Fresh native and managed fixtures passed all six rehearsals and all 37 distinct
restart cases across the full and focused runs. The initial restart run passed
31, failed two orphan-reaping cases and skipped four fault cases; a fresh
container with init and a separately rebuilt fault-enabled worker passed all six
remaining cases. Four real shell cases and four fence cases also pass. npm passed
431 with 178 environment-gated skips. Deployment and interrupted-state recovery
are pending; this local result does not accept the failed TV reboot trial.
