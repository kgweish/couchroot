"""Offline migration transactions, original preservation and rollback ID union."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tvsetup.native_job_migration import migrate, PENDING, MANIFEST

BOOT = '00000000-0000-0000-0000-000000000001'

class NativeJobMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root/'managed'; self.source.mkdir(mode=0o700)
        self.target = self.root/'native'; self.target.mkdir(mode=0o700)
        self.names = ['retained-job-0001', 'retained-job-0002']
        for name, state in zip(self.names, ('completed', 'unknown')):
            self.record(self.source, name, state)
    def tearDown(self): self.temp.cleanup()
    def record(self, folder, name, state='completed'):
        p=folder/(name+'.json')
        p.write_text(json.dumps(dict(id=name, boot_id=BOOT, state=state, pid=0,
                                    process_start=None, exit_code=7 if state=='completed' else None)))
        p.chmod(0o600)
    def contents(self, folder):
        return {p.name:p.read_bytes() for p in folder.glob('*.json')}
    def test_copy_preserves_bytes_and_idempotence(self):
        before=self.contents(self.source)
        plan=migrate(self.source,self.target)
        self.assertEqual(self.contents(self.source),before)
        self.assertEqual(self.contents(self.target),before)
        self.assertEqual(migrate(self.source,self.target),plan)
        self.assertFalse((self.target/PENDING).exists())
        self.assertTrue((self.target/MANIFEST).exists())
    def test_interruption_resumes_at_every_publication_stage(self):
        for phase in ('pending','record_staged',self.names[0]+'.json','before_commit'):
            with self.subTest(phase=phase):
                target=self.root/phase;target.mkdir(mode=0o700)
                def stop(got):
                    if got==phase: raise RuntimeError('simulated interruption')
                with self.assertRaises(RuntimeError):migrate(self.source,target,checkpoint=stop)
                self.assertTrue((target/PENDING).exists())
                migrate(self.source,target)
                self.assertEqual(self.contents(target),self.contents(self.source))
                self.assertFalse((target/PENDING).exists())
    def test_partial_record_scratch_recovered_but_changed_source_refused(self):
        def stop(phase):
            if phase=='pending':raise RuntimeError()
        with self.assertRaises(RuntimeError):migrate(self.source,self.target,checkpoint=stop)
        scratch=self.target/'.import-record';scratch.write_bytes(b'{partial');scratch.chmod(0o600)
        self.record(self.source,self.names[0], 'cancelled')
        with self.assertRaises(ValueError):migrate(self.source,self.target)
        self.assertTrue(scratch.exists())
        self.record(self.source,self.names[0])
        migrate(self.source,self.target)
        self.assertFalse(scratch.exists())
    def test_id_collision_refuses_without_overwrite(self):
        self.record(self.target,self.names[0],'cancelled');before=self.contents(self.target)
        with self.assertRaises(ValueError):migrate(self.source,self.target)
        self.assertEqual(self.contents(self.target),before)
        self.assertFalse((self.target/PENDING).exists())
    def test_rollback_union_preserves_original_and_new_ids(self):
        migrate(self.source,self.target)
        self.record(self.target,'native-new-job-0003','timed_out')
        # Export to a new offline rollback snapshot, retaining the original archive.
        rollback=self.root/'rollback';rollback.mkdir(mode=0o700)
        before=self.contents(self.source)
        migrate(self.target,rollback,'rollback')
        self.assertEqual(set(self.contents(rollback)),set(before)|{'native-new-job-0003.json'})
        self.assertEqual(self.contents(self.source),before)
        for name,data in before.items():self.assertEqual((rollback/name).read_bytes(),data)
    def test_combined_retention_rejects_before_publication(self):
        for i in range(63):self.record(self.target,f'other-job-number-{i:04}')
        with self.assertRaises(ValueError):migrate(self.source,self.target)
        self.assertFalse((self.target/PENDING).exists())
    def test_unreconciled_and_invalid_records_refuse(self):
        for content in (b'{}',b'{',b'{"id":1,"id":2}',b'x'*2048):
            with self.subTest(content=content[:20]):
                p=self.source/(self.names[0]+'.json');p.write_bytes(content)
                with self.assertRaises(ValueError):migrate(self.source,self.target)
                self.assertFalse((self.target/PENDING).exists())
        self.record(self.source,self.names[0])
        extra=self.source/'job.json.next';extra.write_text('{}');extra.chmod(0o600)
        with self.assertRaises(ValueError):migrate(self.source,self.target)
    def test_links_and_permissions_refuse(self):
        p=self.source/(self.names[0]+'.json');p.chmod(0o644)
        with self.assertRaises(ValueError):migrate(self.source,self.target)
        p.chmod(0o600);os.link(p,self.root/'extra-link')
        with self.assertRaises(ValueError):migrate(self.source,self.target)
        (self.root/'extra-link').unlink();p.unlink();p.symlink_to(self.source/(self.names[1]+'.json'))
        with self.assertRaises(OSError):migrate(self.source,self.target)
    def test_live_destination_lock_refuses(self):
        import fcntl
        with (self.target/'lock').open('w') as lock:
            os.chmod(lock.name,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):migrate(self.source,self.target)
    def test_destination_guardian_refuses(self):
        (self.target/'guardian').write_text('{}')
        with self.assertRaises(ValueError):migrate(self.source,self.target)

if __name__=='__main__':unittest.main()
