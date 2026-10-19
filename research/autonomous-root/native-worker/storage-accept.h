/* Bounded storage faults on a disposable, private tmpfs; never fill TV storage.
 * SPDX-License-Identifier: 0BSD */
static void storage_readonly(int readonly) {
  /* Change this disposable tmpfs superblock, not only one namespace's mount
   * flags: directory descriptors opened before unshare retain the old mount. */
  if (mount(NULL, filescope, NULL,
            MS_REMOUNT | MS_NOSUID | MS_NODEV | (readonly ? MS_RDONLY : 0),
            NULL))
    fatal("storage test tmpfs remount");
}
static void storage_job_rejected(const char *witness) {
  J *j = job_req("job.start", "native-storage-job");
  char *cmd = format("touch '%s'", witness);
  str(j, "command", cmd);
  str(j, "profile", "root");
  num(j, "timeout_ms", 1000);
  free(cmd);
  rejected(j);
  struct stat st;
  if (!lstat(witness, &st) || errno != ENOENT)
    fatal("storage failure released a command");
  char *record = format("%s/.jobs/native-storage-job.json", filescope),
       *temp = format("%s/.jobs/native-storage-job.json.next", filescope);
  if (!lstat(record, &st) || errno != ENOENT || !lstat(temp, &st) ||
      errno != ENOENT)
    fatal("storage failure retained partial job intent");
  free(record);
  free(temp);
  char *directory = format("%s/.jobs", filescope);
  DIR *d = opendir(directory);
  free(directory);
  if (!d)
    fatal("storage intent directory");
  struct dirent *entry;
  while ((entry = readdir(d)))
    if (!strncmp(entry->d_name, ".intent-", 8))
      fatal("storage failure retained unpublished job intent");
  closedir(d);
}
static void storage_fill(const char *filler) {
  int fd =
      open(filler, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("storage filler");
  unsigned char bytes[65536] = {0};
  size_t total = 0;
  for (;;) {
    ssize_t n = write(fd, bytes, sizeof bytes);
    if (n < 0 && errno == EINTR)
      continue;
    if (n < 0 && errno == ENOSPC)
      break;
    if (n <= 0 || (total += n) > 2097152)
      fatal("storage fixture failed to reach bounded ENOSPC");
  }
  close(fd);
}
static void storage_recovery_checks(void) {
  finish(0);
  int fd = open(app, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || st.st_size < 1 || st.st_size > CHUNK)
    fatal("storage launcher source");
  unsigned char *launcher_bytes = allocate(st.st_size);
  if (read(fd, launcher_bytes, st.st_size) != st.st_size)
    fatal("storage launcher read");
  close(fd);
  /* Controller namespace is already private. This 2 MiB filesystem exists
   * only for these probes and is inherited by the experimental worker. */
  if (mount("tmpfs", filescope, "tmpfs", MS_NOSUID | MS_NODEV,
            "size=2097152,nr_inodes=1024,mode=0700"))
    fatal("storage test tmpfs");
  fd = open(app, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("storage launcher create");
  writeall(fd, launcher_bytes, st.st_size);
  close(fd);
  free(launcher_bytes);
  launch();
  char *counter = format("%s/storage-run-count", scope),
       *cmd = format("printf x >> '%s'; sleep 1; exit 19", counter);
  discard(start_job("native-storage-finish", cmd, 5000, "root"));
  free(cmd);
  char *witness = format("%s/storage-unexpected-command", scope),
       *filler = format("%s/storage-filler", filescope);
  storage_fill(filler);
  storage_job_rejected(witness);
  double completion_deadline = stamp() + 7000;
  J *terminal;
  for (;;) {
    terminal = call(job_req("job.status", "native-storage-finish"));
    J *result = get(terminal, "result");
    if (!strcmp(textval(result, "state"), "completed") &&
        number(result, "exit_code") == 19)
      break;
    discard(terminal);
    if (stamp() >= completion_deadline)
      fatal("storage job did not finish");
    usleep(20000);
  }
  if (!json_object_get_boolean(
          get(get(terminal, "result"), "persistence_failed")))
    fatal("full storage did not expose failed terminal persistence");
  discard(terminal);
  if (unlink(filler))
    fatal("storage filler cleanup");
  double deadline = stamp() + 5000;
  for (;;) {
    terminal = call(job_req("job.status", "native-storage-finish"));
    int failed = json_object_get_boolean(
        get(get(terminal, "result"), "persistence_failed"));
    discard(terminal);
    if (!failed)
      break;
    if (stamp() >= deadline)
      fatal("terminal persistence did not recover");
    usleep(50000);
  }
  char *saved_path = format("%s/.jobs/native-storage-finish.json", filescope),
       saved_bytes[2048];
  readtext(saved_path, saved_bytes, sizeof saved_bytes);
  J *saved = parse(saved_bytes);
  if (!saved || strcmp(textval(saved, "state"), "completed") ||
      number(saved, "exit_code") != 19)
    fatal("terminal persistence lost actual result");
  discard(saved);
  free(saved_path);
  char count[16];
  readtext(counter, count, sizeof count);
  if (strcmp(count, "x") || unlink(counter))
    fatal("storage retry replayed command");
  free(counter);
  discard(call(job_req("job.forget", "native-storage-finish")));
  mark("enospc_terminal_result_retried_without_command_replay");
  discard(start_job("native-storage-job", "exit 7", 5000, "root"));
  await_job("native-storage-job", "completed", 7, 7000);
  discard(call(job_req("job.forget", "native-storage-job")));
  mark("enospc_intent_not_published_or_executed_then_retry");
  storage_readonly(1);
  storage_job_rejected(witness);
  storage_readonly(0);
  discard(
      start_job("native-storage-job", "printf storage-recovered", 5000, "app"));
  await_job("native-storage-job", "completed", 0, 7000);
  discard(call(job_req("job.forget", "native-storage-job")));
  mark("readonly_intent_not_published_or_executed_then_app_retry");
  J *before = call(req("status"));
  char *old_launcher =
           strdup(textval(get(get(before, "result"), "app_launcher"), "path")),
       *old_group = format("/sys/fs/cgroup/freezer/%s",
                           textval(get(before, "result"), "freezer_group"));
  discard(before);
  discard(start_job("native-storage-crash", "sleep 30", 60000, "root"));
  storage_fill(filler);
  if (kill(worker_pid, SIGKILL))
    fatal("storage crash injection");
  close(w.fd);
  w.fd = -1;
  double crash_deadline = stamp() + 15000;
  int crash_status;
  pid_t got;
  do {
    got = waitpid(child, &crash_status, WNOHANG);
    if (!got)
      usleep(10000);
  } while (!got && stamp() < crash_deadline);
  if (got != child || !WIFEXITED(crash_status) ||
      WEXITSTATUS(crash_status) != 125)
    fatal("storage crash guardian did not retain metadata failure");
  child = 0;
  char *journal = format("%s/.jobs/guardian", filescope);
  if (!lstat(old_launcher, &st) || errno != ENOENT || !lstat(old_group, &st) ||
      errno != ENOENT || lstat(journal, &st))
    fatal("storage crash resources retained or journal lost");
  free(old_launcher);
  free(old_group);
  free(journal);
  if (unlink(filler))
    fatal("storage crash free space");
  launch();
  J *recovered = call(job_req("job.status", "native-storage-crash"));
  if (strcmp(textval(get(recovered, "result"), "state"), "interrupted"))
    fatal("storage crash record not reconciled");
  discard(recovered);
  discard(call(job_req("job.forget", "native-storage-crash")));
  mark("enospc_crash_cleans_resources_retains_journal_then_reconciles");
  finish(0);
  if (umount2(filescope, UMOUNT_NOFOLLOW))
    fatal("storage test unmount");
  free(witness);
  free(filler);
  launch();
}
