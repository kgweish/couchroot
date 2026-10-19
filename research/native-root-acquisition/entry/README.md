# SDK capability-entry receipt

This opt-in diagnostic tests a possible replacement for the managed capability
entry. It performs no root acquisition, mount, system-file change or operation.
The existing acquisition bridge and .NET recovery utility remain available.

## Deferred experiment

The release candidate retains the small managed capability-entry bridge. The
normal package command no longer accepts `--native-entry-probe`; this diagnostic
is not needed for startup, managed return or SDK rescue. The original research
source, `tvsetup.native_entry.build`, tests and dated results remain for evidence
and explicitly scoped future investigation. Existing captured recovery packages
must be used unchanged; do not rebuild them from this candidate.

The historical trials packaged the receipt at the fixed path below. Their
builder snapshots sources, pins the compiler image, builds twice and checks ARM
softfp/GLIBC compatibility. This is research tooling, not a supported release
installation option.

The host encoder supplies only `loader_type=common-loader` and one fixed preload:
`/opt/usr/apps/MiniRoot01/res/wgt/payload/libentry-receipt.so`. It implements the
string and string-array records observed in both current `libbundle` artifacts:
little-endian lengths and tags, NUL-inclusive string lengths, then a lowercase
ASCII MD5 checksum and Base64 wrapper. MD5 is a vendor wire checksum; it does not
replace the package, source or artifact SHA-256 guards. No vendor code is bundled.

QN90A uses its existing `/usr/bin/launchpad-loader`; S90D uses its existing
`/usr/bin/app-defined-loader`. Static evidence puts the preload callback before
the normal Launchpad connection. The original DSO constructor requires a fresh
32-hex `COUCHROOT_ENTRY_NONCE`, reads bounded process metadata and prints a single
receipt. It exits the process immediately, including on refusal. The receipt
contains all UID/GID slots, effective/permitted/inheritable/bounding capability
sets, executable, mount namespace, label, boot identity and the code filesystem's
read-only flag. Missing `NoNewPrivs` or filesystem data is explicitly unknown.

Exit 0 means the expected vendor executable has SDK UID/GID 901 in every slot
and SETGID/SYS_ADMIN in its effective, permitted and inheritable sets. It does
not mean root acquisition succeeded. `code_readonly` is independent evidence:
a successfully mapped signed package need not reside on a read-only filesystem.
Exit 2 reports a complete receipt that does not meet the capability/identity gate;
64 rejects the nonce; 65 rejects incomplete metadata; 66 rejects output failure.

A caller must hold the per-TV lock, reject pending setup, bind physical identity,
firmware, boot and source/package/loader hashes, and journal one fresh invocation.
The loader ID is nonce-derived, but the caller must separately prove its exact
per-UID socket is absent. Verify the fixed library before submitting. A failed
`dlopen` does not run this constructor: vendor code can continue toward its normal
startup path. An independent, bounded watchdog must therefore bind the expected
loader to boot/PID/start time and terminate it if needed. Keep the independent
300-second .NET SDK rescue active, inspect an uncertain outcome without replay,
and verify process absence, exact staging cleanup, loopback and managed readiness.
Do not change file capabilities, SMACK, loader registration or another app.

Local tests cover explicit wire vectors, fixed bundle contents, malformed inputs,
reproducible build gates, all identity slots, required capability sets, duplicate
and partial status fields, missing optional fields and constructor refusal/exit.
Linux fixture results do not establish TV code mapping or capability inheritance.
Hardware results are recorded separately in the migration evidence.


The signed 0.7.33 trial on each TV returned without a constructor receipt. The
fixed codec passed exact target-library round trips, but SDK native entry remains
unqualified. Both TVs were restored and every trial scope removed. See
[results](results.json); this probe must not replace the managed bridge.

The subsequent 0.7.36 mapping diagnostic isolates a prerequisite on both TVs:
the installed receipt fails `dlopen(..., 0x1002)` from writable VDFS, and an
identical copy fails from writable `/tmp` tmpfs. Both report `failed to map
segment from shared object`. Binding the installed payload directory read-only
inside a private mount namespace lets the constructor emit its complete receipt.
These diagnostics ran as root under the existing managed executor; their receipts
correctly report `capable: false` and exit 2 because they are not SDK vendor-loader
processes. They establish code-mapping behavior in that context, not the exact
cause of either earlier SDK-loader failure or a .NET-free entry.

The stock `mount`, `unshare` and `nsenter` helpers have mode 0755, owner root and
no file capabilities on either target. Invoking those helpers directly therefore
does not supply the missing capability promotion. The next entry investigation
must establish a native vendor path that prepares a usable code view before
loading the receipt. Package signing and a writable tmpfs copy alone do not
establish that path. See [mapping evidence](mapping-results.json).

### Vendor mount and credential boundary

Read-only captures and static analysis of both targets narrow the next entry
investigation. S90D's Launchpad preparation pipeline has a read-only overlay helper
for app libraries. It runs in the later launch-request pipeline, followed by
`security_manager_prepare_app2`, before the app callback. The exact security
library applies an empty capability set during thread synchronization. A usable
read-only code view at that later point therefore does not by itself preserve the
authority required by native acquisition.

QN90A's older receiver similarly calls `security_manager_prepare_app` before
the app callback. Its security preparation reaches a helper that applies an empty
capability set. Two missing Thumb callbacks were recovered in separate Ghidra
analysis projects using the low-bit function pointers from their callers. This
analyst-assisted reconstruction has unresolved indirect calls; it is not a runtime
trace or an exhaustive account of every vendor path. An equivalent QN90A overlay
path was not established.

The file-capability inventory also identified `launchpad-starter`. Both exact
binaries execute the fixed `launchpad-process-pool`; their startup paths touch
shared Launchpad files or sockets. They are not isolated caller-code hosts and
were not invoked. The inventory does not rule out every other capable executable.

These findings rule out treating the later ordinary app path or the starter as a
qualified replacement for the managed entry bridge. Another SDK preload trial
needs evidence of code mapping **before** capability loss, with isolated ownership
and bounded cleanup. Do not repeat the earlier preload or invoke shared daemons
based only on their file capabilities. No new runtime entry trial, package update,
registration, mount or policy change was performed for this investigation.
Sanitized provenance and limitations are in
[vendor preparation findings](vendor-preparation-results.json); raw binaries,
decompiler output and analysis projects remain private.
