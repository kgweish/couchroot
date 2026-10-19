"""Boot-aware journal recovery in disposable Linux fixtures, never TV evidence."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import native_worker_test

OLD_BOOT = '00000000-0000-0000-0000-000000000001'
NEW_BOOT = '00000000-0000-0000-0000-000000000002'


@unittest.skipUnless(os.environ.get('NATIVE_WORKER') and os.environ.get('COUCHROOT_PARITY_CONTAINER'),
                     'isolated native container required')
class RebootJournalTests(unittest.TestCase):
    def setUp(self):
        self.n = native_worker_test.NativeWorkerTests('runTest')
        self.n.extra_worker_args = ['--production']
        self.n.setUp()

    def tearDown(self):
        self.n.tearDown()

    def old_journal(self):
        status, journal = self.n.guardian_loss()
        self.assertNotEqual(journal['boot_id'], OLD_BOOT)
        journal['boot_id'] = OLD_BOOT
        # Both PID and start ticks collide with a live current-boot process.
        journal['pid'] = os.getpid()
        journal['process_start'] = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19]
        path = self.n.root/'.jobs/guardian'
        path.write_text(json.dumps(journal))
        return status, journal, path

    def test_previous_boot_pid_collision_preserves_records_and_never_replays(self):
        status, journal, _ = self.old_journal()
        retained = self.n.root/'.jobs/native-old-complete.json'
        retained.write_text(json.dumps(dict(worker_id=journal['worker_id'], id='native-old-complete',
                                           boot_id=OLD_BOOT, state='completed', exit_code=7)))
        retained.chmod(0o600)
        original = retained.read_bytes()
        running = self.n.root/'.jobs/native-test-job-01.json'
        record = json.loads(running.read_bytes())
        record['boot_id'] = OLD_BOOT
        running.write_text(json.dumps(record))
        foreign = self.n.root/'.views/foreign-owner'
        foreign.mkdir()
        (foreign/'keep').write_text('keep')
        self.n.restart()
        self.assertTrue(self.n.op('status')['result']['stale_guardian_reconciled'])
        self.assertFalse(Path(status['app_launcher']['path']).exists())
        self.assertEqual(retained.read_bytes(), original)
        self.assertEqual((foreign/'keep').read_text(), 'keep')
        saved = self.n.job('job.status')['result']['record']
        self.assertEqual(saved['boot_id'], OLD_BOOT)
        self.assertEqual(saved['state'], 'interrupted')
        self.assertIsNone(saved['exit_code'])
        self.assertFalse(self.n.job('job.start', command='touch '+str(self.n.root/'replayed'),
                                    profile='root', timeout_ms=1000)['ok'])
        self.assertFalse((self.n.root/'replayed').exists())

    def test_old_boot_keeps_persistent_ownership_and_launch_binding_guards(self):
        status, journal, path = self.old_journal()
        launcher = Path(status['app_launcher']['path'])
        launcher_bytes = launcher.read_bytes()
        variants = [('scope_ino', journal['scope_ino']+1),
                    ('runtime_ino', journal['runtime_ino']+1),
                    ('schema', 3), ('startup_token_sha256', None),
                    ('boot_id', 'different-boot'), ('boot_id', OLD_BOOT+'\n')]
        for key, value in variants:
            with self.subTest(key=key, value=value):
                changed = {**journal, key: value}
                if value is None:
                    del changed[key]
                raw = json.dumps(changed)
                path.write_text(raw)
                denied = subprocess.run(self.n.worker_args, capture_output=True, timeout=5)
                self.assertNotEqual(denied.returncode, 0)
                self.assertIn(b'unresolved guardian journal', denied.stderr)
                self.assertEqual(path.read_text(), raw)
                self.assertEqual(launcher.read_bytes(), launcher_bytes)
        path.write_text(json.dumps(journal))
        self.n.restart()


@unittest.skipUnless(os.environ.get('COUCHROOT_PARITY_CONTAINER'), 'Linux fixture required')
class RebootKernelGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        native = Path(__file__).resolve().parents[1]/'research/autonomous-root/native-worker'
        source = cls.root/'fixture.c'
        # Only paths are redirected. Compile the production freezer and namespace
        # checks, without NATIVE_WORKER_TEST's kernel-resource substitutions.
        source.write_text(r'''
#define COUCHROOT_NATIVE_WORKER 1
#include "common.h"
#include <stdarg.h>
static int fixture_open(const char *p, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap); }
  if (!strcmp(p, "/sys/fs/cgroup/freezer")) p = getenv("FREEZER_FIXTURE");
  return open(p, flags, mode);
}
static FILE *fixture_fopen(const char *p, const char *mode) {
  if (strstr(p, "/mountinfo")) p = getenv("MOUNTINFO_FIXTURE");
  return fopen(p, mode);
}
#undef open
#undef fopen
#define open fixture_open
#define fopen fixture_fopen
#define main worker_program
#include "worker.c"
#undef main
#undef open
#undef fopen
int main(int argc, char **argv) {
  if (argc != 3) return 64;
  libraries();
  if (!strcmp(argv[1], "namespace")) {
    printf("%d\n", reconcile_mount_namespace_refs(123, strtoll(argv[2], NULL, 10)));
    return 0;
  }
  if (!strcmp(argv[1], "views")) {
    strcpy(worker_id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    printf("%d\n", reconcile_namespace_without_views(123));
    return 0;
  }
  strcpy(current_boot, "00000000-0000-0000-0000-000000000002");
  strcpy(worker_id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  J *j = obj(); str(j, "boot_id", argv[2]);
  if (!strcmp(argv[1], "scan")) {
    struct stat ns;
    if (stat("/proc/self/ns/mnt", &ns)) return 65;
    num(j, "namespace_dev", ns.st_dev); num(j, "namespace_ino", ns.st_ino + 1);
    int pin = getenv("PIN_CURRENT_NAMESPACE") ? open("/proc/self/ns/mnt", O_RDONLY) : -1;
    if (getenv("PIN_CURRENT_NAMESPACE") && pin < 0) return 66;
    printf("%d\n", reconcile_namespace_unused(j));
    if (pin >= 0) close(pin);
    json_object_put(j); return 0;
  }
  if (strcmp(argv[1], "freezer")) return 64;
  char leaf[PATH_MAX]; struct stat st;
  snprintf(leaf, sizeof leaf, "%s/couchroot-native-%s", getenv("FREEZER_FIXTURE"), worker_id);
  if (!stat(leaf, &st)) { num(j, "freezer_dev", st.st_dev); num(j, "freezer_ino", st.st_ino); }
  printf("%d\n", reconcile_freezer(j));
  json_object_put(j);
  if (freezer_dir >= 0) close(freezer_dir);
  if (freezer_root >= 0) close(freezer_root);
  return 0;
}
''')
        cls.binary = cls.root/'fixture'
        subprocess.run(['cc', '-std=c99', '-O0', '-Wall', '-Wextra', '-Werror',
                        '-Wno-unused-function', '-I', str(native), str(source),
                        '-ldl', '-pthread', '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mounts = self.root/'mountinfo'
        self.mounts.write_text('1 0 0:1 / / rw - rootfs rootfs rw\n')
        self.env = {**os.environ, 'FREEZER_FIXTURE': str(self.root),
                    'MOUNTINFO_FIXTURE': str(self.mounts)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_guard(self, action, value):
        result = subprocess.run([str(self.binary), action, str(value)], env=self.env,
                                check=True, capture_output=True, text=True, timeout=5)
        return result.stdout.strip() == '1'

    def test_new_boot_freezer_collision_is_not_thawed_even_with_matching_inode(self):
        leaf = self.root/('couchroot-native-'+'a'*32)
        leaf.mkdir(mode=0o700)
        for name, value in [('freezer.state', 'FROZEN'), ('cgroup.procs', ''), ('tasks', '')]:
            (leaf/name).write_text(value)
        self.assertFalse(self.run_guard('freezer', OLD_BOOT))
        self.assertEqual((leaf/'freezer.state').read_text(), 'FROZEN')
        self.assertTrue(leaf.exists())
        # The same fixture is still eligible under same-boot ownership.
        self.assertTrue(self.run_guard('freezer', NEW_BOOT))
        self.assertEqual((leaf/'freezer.state').read_text(), 'THAWED')

    def test_absent_old_freezer_is_accepted_but_symlink_is_not(self):
        self.assertTrue(self.run_guard('freezer', OLD_BOOT))
        (self.root/('couchroot-native-'+'a'*32)).symlink_to(self.root, target_is_directory=True)
        self.assertFalse(self.run_guard('freezer', OLD_BOOT))

    def test_cross_boot_pins_are_conservative_without_trusting_old_inode(self):
        self.assertTrue(self.run_guard('namespace', -1))
        for root in ['mnt:[456]', '/']:
            self.mounts.write_text(f'2 1 0:4 {root} /pin rw - nsfs nsfs rw\n')
            self.assertFalse(self.run_guard('namespace', -1))
        self.mounts.write_text('2 1 0:4 mnt:[456] /pin rw - nsfs nsfs rw\n')
        self.assertTrue(self.run_guard('namespace', 123))
        self.assertFalse(self.run_guard('namespace', 456))

    def test_owned_view_roots_and_targets_block_cleanup(self):
        owned = '/opt/couchroot-agent/native-helpers/'+'a'*32
        for root, target in [(owned, '/moved'), ('/', owned+'/code')]:
            self.mounts.write_text(f'2 1 0:4 {root} {target} rw - tmpfs tmpfs rw\n')
            self.assertFalse(self.run_guard('views', 0))
        self.mounts.write_text('1 0 0:1 / / rw - rootfs rootfs rw\n')
        self.assertTrue(self.run_guard('views', 0))

    def test_cross_boot_scans_other_namespace_inodes_and_refuses_descriptor_pins(self):
        self.assertTrue(self.run_guard('scan', OLD_BOOT))
        owned = '/opt/couchroot-agent/native-helpers/'+'a'*32
        self.mounts.write_text(f'2 1 0:4 {owned} /moved rw - tmpfs tmpfs rw\n')
        self.assertFalse(self.run_guard('scan', OLD_BOOT))
        self.mounts.write_text('1 0 0:1 / / rw - rootfs rootfs rw\n')
        self.env['PIN_CURRENT_NAMESPACE'] = '1'
        self.assertFalse(self.run_guard('scan', OLD_BOOT))
        self.assertTrue(self.run_guard('scan', NEW_BOOT))
