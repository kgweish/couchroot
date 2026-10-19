# S90D boot checkpoints and recovery

This tool prepares recovery for **one separately reviewed helper or cache trial**
on QN55S90DAFXZA firmware T-PTMDAKUC-0090-2130.0. It does not implement a boot-speed
trial, install a native Hub, launch anything, stop processes or reboot the TV.
Implementation and tests are local/offline only; hardware acceptance is pending.

The old splash-only `helper.sh` allowlist remains narrow. It must not be expanded
to overwrite composite helpers with the older splash build. The public
`tools/s90d/splash.py` entry point now calls `tvsetup.s90d_recovery` instead of the
historical fixed-address collector. Old `apply`, bare `status` and bare `rollback`
commands are no longer the interface.

## Offline planning

From the repository root, consume an already-saved recovery snapshot and the
SHA256 of a separately reviewed proposed helper or cache. `plan` never opens site
configuration, connects to a device, builds code or creates remote backups:

```sh
python3 tools/s90d/splash.py plan --snapshot /private/path/baseline.json \
  --kind helper --trial-sha256 REVIEWED_TRIAL_SHA256
```

Use `--kind cache` for a cache-only trial. The snapshot format is emitted by
`inspect`: `device`, `firmware`, and complete `files`/`metadata` maps. Digests include
helper, runtime/deps, renderer, diagnostic script, cache/table, stock cache backup,
splash binary/resource and four enabled markers. An absent marker is explicitly
null in both maps. Metadata contains `[uid:gid:mode:link-count, chsmack-attributes]`.
Incomplete evidence refuses planning. A saved snapshot is not a recovery backup,
and successful planning reports `recovery_ready: false`.

The baseline must have a reviewed helper and the known patched cache, original
cache backup and unchanged table. Known historical helper hashes are accepted
only as baselines; the tool never chooses one as a replacement. Unknown helper or
cache bytes require evidence review and a source change, not a force flag.

## Future device workflow — requires separate authorization

These commands are documented for later use. **None was run during this work.**
Even `inspect`/`verify` contacts the TV and uses the privileged transport. They
require `--live`; writes of backups or restoration also require `--yes`.
Targets come from explicit private `--site` configuration, checked by the shared
transport against model/platform/UUID/firmware. There is no hard-coded TV address.

1. Read back the baseline, after authorization for inspection:

   ```sh
   python3 tools/s90d/splash.py inspect --site /private/path/site.json --live \
     > /private/path/baseline.json
   ```

2. After a single proposed change and its hash have been reviewed, authorize and
   create a fresh checkpoint **before** allowing the trial to execute:

   ```sh
   python3 tools/s90d/splash.py checkpoint --site /private/path/site.json --live --yes \
     --kind helper --trial-sha256 REVIEWED_TRIAL_SHA256
   ```

   Save the printed run ID. This reads current state again, takes a run-specific
   on-TV backup with metadata, checks it and durably marks `checkpoint_ready`.
   It makes no helper/cache/marker change. An exception or missing success response
   does not authorize a trial. Local status can inspect the durable outcome:

   ```sh
   python3 tools/s90d/splash.py status --run RUN_ID
   ```

3. A separately reviewed/authorized trial may change only the pinned helper
   **or** cache bytes, preserving mode, ownership and SMACK attributes. The checkpoint
   remains pending so ordinary setup refuses concurrent work. It records the
   expected trial hash, not evidence that the trial ran. There is intentionally
   no `apply`/`resume` path in this tool.

4. Restore using that original checkout, run and site configuration:

   ```sh
   python3 tools/s90d/splash.py rollback --site /private/path/site.json --live --yes --run RUN_ID
   python3 tools/s90d/splash.py verify --site /private/path/site.json --live --run RUN_ID
   ```

   Recovery accepts only the captured baseline or the pinned trial state. It
   checks all other captured files, metadata and markers before touching the
   target; a cache trial restores the **previous patched cache**, not stock.
   Marker state is never changed, including absence of the legacy telemetry marker.
   This prevents accidentally reenabling a second collector. Cache restoration
   reloads systemd in PID 1's mount namespace, without restarting AT-HUB.

## Interruptions and boundaries

The tool uses the shared per-device lock and Engine journal. It refuses another
pending S90D run at checkpoint time. Failed checkpoint preparation does not admit
a trial; remote backup remnants and private evidence remain for inspection.
An incomplete checkpoint is not a usable recovery run. If the host died during
backup and left a pending, never-armed checkpoint, inspect its local journal and
use `python3 tools/s90d/splash.py cancel-incomplete --run RUN_ID --yes`. This only
cancels a journal that never became ready; it contacts no TV and retains remote
backup remnants. Armed checkpoints must use verified live rollback instead. A successfully armed run
stays pending until restored, even if the intended trial was never applied.

An interrupted inverse remains `rollback-partial`. Inspect its evidence, then
repeat rollback: exact already-restored bytes are accepted, and an interrupted
cache reload is repeated. Exact run-specific temporary restoration bytes may be
reused; unknown temporary files, symlinks, hardlinks, corrupt backups, changed
metadata or later file/marker edits cause refusal. Do not delete them blindly.
A repeat rollback verifies the complete baseline even after the journal is terminal.

This is a configuration recovery mechanism, not an automatic TV-side watchdog.
It needs working host/device transport and its remote backup; it cannot recover
a TV that can no longer accept that transport. It does not stop an already-running
experimental helper or undo in-memory effects, settings, packages, source routing
or signed service state. A future trial plan must separately address bounded
execution, any automatic fallback and an authorized verification restart. A
successful checksum restore is not proof of physical boot behavior.

Stock-cache fallback and full Home-settings restoration are different operations.
The original cache is guarded as a prerequisite, but this command intentionally
restores the immediate prior patched cache. The historical `disable-boot.sh` and
`restore.py` are not general inverses for a new trial. For a change made by
`tv-setup`, use its own original journal and rollback entry point.

Offline tests execute the generated backup/restoration shell against a temporary
filesystem, with simulated ownership/SMACK utilities, and inject reply loss,
reload failure, drift, metadata changes, missing/corrupt backups and staging
conflicts. They do not establish TV utility, namespace or transport behavior.
