/* Bounded production-path and synthetic legacy-record acceptance. No deployed
 * managed job directory is read or changed. SPDX-License-Identifier: 0BSD */
static void parity_checks(void) {
  char *nested = format("%s/nested", filescope);
  if (mkdir(nested, 0700))
    fatal("parity nested fixture");
  const unsigned char bytes[] = "nested production transfer";
  char sha[65];
  digest(bytes, sizeof bytes, sha);
  char *path = format("%s/data", nested);
  char *id = begin(path, sizeof bytes, sha, "absent");
  upload(id, 0, bytes, sizeof bytes, 1);
  transfer_op("file.commit", id, 1);
  free(id);
  J *j = req("file.open");
  str(j, "path", path);
  J *r = call(j);
  id = strdup(textval(get(r, "result"), "transfer_id"));
  discard(r);
  j = req("file.status");
  str(j, "transfer_id", id);
  r = call(j);
  if (number(get(r, "result"), "offset") != sizeof bytes ||
      get(get(r, "result"), "expected_sha256") != NULL)
    fatal("download status parity");
  discard(r);
  transfer_op("file.close", id, 1);
  free(id);
  char *outside = format("%s-external-read", filescope);
  int fd = open(outside, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("external read fixture");
  writeall(fd, bytes, sizeof bytes);
  close(fd);
  j = req("file.open");
  str(j, "path", outside);
  r = call(j);
  if (strcmp(textval(get(r, "result"), "sha256"), sha))
    fatal("external digest");
  id = strdup(textval(get(r, "result"), "transfer_id"));
  discard(r);
  transfer_op("file.close", id, 1);
  free(id);
  char *link = format("%s/link", nested);
  if (symlink(outside, link))
    fatal("parity symlink fixture");
  j = req("file.open");
  str(j, "path", link);
  rejected(j);
  j = req("file.open");
  str(j, "path", "/proc/self/status");
  rejected(j);
  mark("production_nested_paths_external_download_and_refusals");
  char *helper_id, *helper_path = stage_helper_from(&helper_id, source_helper,
                                                    "nested/helper-source");
  discard(start_job("native-parity-app-01", helper_path, 5000, "app"));
  await_job("native-parity-app-01", "completed", 0, 7000);
  r = output("native-parity-app-01", 0, 0);
  contains(r, "stdout", "uid=5001 euid=5001 gid=100 smack=User");
  discard(r);
  discard(call(job_req("job.forget", "native-parity-app-01")));
  j = req("helper.release");
  str(j, "helper_id", helper_id);
  discard(call(j));
  free(helper_id);
  free(helper_path);
  mark("production_nested_helper_app_identity_and_release");
  /* Stop before installing fixtures, just as offline import requires. */
  finish(0);
  char *legacy = format("%s/.jobs/native-parity-legacy", filescope);
  char *record_path = format("%s.json", legacy);
  J *record = obj();
  str(record, "id", "native-parity-legacy");
  str(record, "boot_id", boot);
  str(record, "state", "unknown");
  num(record, "pid", 0);
  json_object_object_add(record, "exit_code", NULL);
  json_object_object_add(record, "process_start", NULL);
  char *saved = strdup(json(record));
  discard(record);
  fd = open(record_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            0600);
  if (fd < 0)
    fatal("legacy fixture");
  writeall(fd, saved, strlen(saved));
  if (fsync(fd) || close(fd))
    fatal("legacy fixture persistence");
  launch();
  r = call(job_req("job.status", "native-parity-legacy"));
  if (strcmp(textval(get(r, "result"), "state"), "unknown") ||
      json_object_get_boolean(get(get(r, "result"), "output_available")))
    fatal("legacy outcome changed");
  discard(r);
  j = job_req("job.start", "native-parity-legacy");
  str(j, "command", ":");
  str(j, "profile", "root");
  num(j, "timeout_ms", 1000);
  rejected(j);
  rejected(job_req("job.cancel", "native-parity-legacy"));
  rejected(job_req("job.forget", "native-parity-legacy"));
  mark("legacy_unknown_record_preserved_without_replay_or_saved_pid_signals");
  json_upload_checks();
  finish(0);
  fd = open(record_path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  char actual[65], expected[65];
  digest(saved, strlen(saved), expected);
  if (fd < 0 || !filedigest(fd, actual) || strcmp(actual, expected))
    fatal("legacy fixture changed");
  close(fd);
  free(saved);
  char *source = format("%s/helper-source", nested);
  char *lock = format("%s/.jobs/lock", filescope),
       *jobs = format("%s/.jobs", filescope);
  if (unlink(record_path) || unlink(source) || unlink(path) || unlink(link) ||
      unlink(outside) || rmdir(nested) || unlink(app) || unlink(lock) ||
      rmdir(jobs))
    fatal("parity owned cleanup");
  free(source);
  free(lock);
  free(jobs);
  free(record_path);
  free(legacy);
  free(path);
  free(link);
  free(outside);
  free(nested);
  mark("production_parity_owned_storage_cleanup");
}
