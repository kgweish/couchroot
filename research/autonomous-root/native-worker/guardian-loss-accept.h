/* Actual guardian death and conservative journal takeover on the TV.
 * These test fixtures remain inside the experiment scope.
 * SPDX-License-Identifier: 0BSD */
static void loss_journal_write(const char *path, const char *bytes,
                               int exclusive) {
  int fd = open(path,
                O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC |
                    (exclusive ? O_EXCL : O_TRUNC),
                0600);
  if (fd < 0)
    fatal("guardian-loss fixture create");
  writeall(fd, bytes, strlen(bytes));
  if (fsync(fd))
    fatal("guardian-loss fixture persistence");
  close(fd);
}
static void loss_rejected(J *journal, const char *path) {
  char *before = strdup(json(journal));
  loss_journal_write(path, before, 0);
  int errors[2];
  if (pipe2(errors, O_CLOEXEC))
    fatal("reconciliation probe pipe");
  pid_t probe = fork();
  if (probe < 0)
    fatal("reconciliation probe fork");
  if (!probe) {
    dup2(errors[1], STDERR_FILENO);
    close(errors[0]);
    close(errors[1]);
    execl(binary, binary, "127.0.0.1", "1", "/nonexistent-native-test-token",
          filescope, app, appsha, (char *)NULL);
    _exit(127);
  }
  close(errors[1]);
  int status;
  double deadline = stamp() + 20000;
  pid_t got;
  do {
    got = waitpid(probe, &status, WNOHANG);
    if (!got)
      usleep(10000);
  } while (!got && stamp() < deadline);
  if (got != probe) {
    kill(probe, SIGKILL);
    waitpid(probe, NULL, 0);
    fatal("reconciliation rejection probe hung");
  }
  char message[4096] = {0}, after[4096];
  ssize_t n = read(errors[0], message, sizeof message - 1);
  close(errors[0]);
  readtext(path, after, sizeof after);
  if (n <= 0 || !WIFEXITED(status) || !WEXITSTATUS(status) ||
      !strstr(message, "unresolved guardian journal") || strcmp(before, after))
    fatal("unsafe journal reconciliation");
  free(before);
  discard(journal);
}
static void guardian_loss_checks(int frozen) {
  J *status = call(req("status"));
  char *old_launcher =
      strdup(textval(get(get(status, "result"), "app_launcher"), "path"));
  char *group = strdup(textval(get(status, "result"), "freezer_group"));
  discard(status);
  char *journal_path = format("%s/.jobs/guardian", filescope);
  char journal_bytes[4096];
  readtext(journal_path, journal_bytes, sizeof journal_bytes);
  char *backup = format("%s/guardian-test-backup", filescope);
  loss_journal_write(backup, journal_bytes, 1);
  char *helper_source = format("%s/helper-source", filescope), sha[65];
  int fd = open(helper_source, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0 || !filedigest(fd, sha))
    fatal("guardian loss helper source");
  close(fd);
  J *j = req("helper.prepare");
  str(j, "path", helper_source);
  str(j, "sha256", sha);
  J *r = call(j);
  char *helper_path = strdup(textval(get(r, "result"), "path"));
  discard(r);
  free(helper_source);
  discard(start_job("native-loss-complete", "exit 7", 5000, "root"));
  await_job("native-loss-complete", "completed", 7, 7000);
  char *cmd = format("setsid sh -c \"sleep 2; touch '%s/loss-survivor'\" "
                     ">/dev/null 2>&1 & printf ready; sleep 30",
                     filescope);
  discard(start_job("native-loss-root-01", cmd, 60000, "root"));
  free(cmd);
  discard(
      start_job("native-loss-app-001", "printf ready; sleep 30", 60000, "app"));
  for (int i = 0; i < 2; i++) {
    const char *id = i ? "native-loss-app-001" : "native-loss-root-01";
    double until = stamp() + 5000;
    for (;;) {
      r = output(id, 0, 0);
      size_t n;
      unsigned char *bytes =
          decode(textval(get(get(r, "result"), "stdout"), "data"), &n);
      int ready = bytes && strstr((char *)bytes, "ready");
      free(bytes);
      discard(r);
      if (ready)
        break;
      if (stamp() >= until)
        fatal("guardian loss job readiness");
      usleep(10000);
    }
  }
  char ns_path[80];
  snprintf(ns_path, sizeof ns_path, "/proc/%d/ns/mnt", worker_pid);
  int pin = open(ns_path, O_RDONLY | O_CLOEXEC);
  if (pin < 0)
    fatal("retain test namespace");
  char *mount_pin = format("%s/guardian-ns-pin", filescope);
  int pin_file = open(mount_pin, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (pin_file < 0)
    fatal("namespace pin fixture");
  close(pin_file);
  if (mount(ns_path, mount_pin, NULL, MS_BIND, NULL))
    fatal("bind test namespace handle");
  if (frozen) {
    char *state_path = format("/sys/fs/cgroup/freezer/%s/freezer.state", group);
    int state_fd = open(state_path, O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
    if (state_fd < 0)
      fatal("test freezer open");
    writeall(state_fd, "FROZEN", 6);
    close(state_fd);
    double frozen_until = stamp() + 750;
    char state[32];
    for (;;) {
      readtext(state_path, state, sizeof state);
      if (!strcmp(state, "FROZEN"))
        break;
      if (stamp() >= frozen_until)
        fatal("test freezer readiness");
      usleep(1000);
    }
    free(state_path);
  }
  /* child is our unreaped guardian, not a PID taken from the journal. */
  if (kill(child, SIGKILL))
    fatal("guardian loss injection");
  int exit_status;
  if (waitpid(child, &exit_status, 0) != child || !WIFSIGNALED(exit_status) ||
      WTERMSIG(exit_status) != SIGKILL)
    fatal("guardian loss status");
  child = 0;
  close(w.fd);
  w.fd = -1;
  char *lock_path = format("%s/.jobs/lock", filescope);
  fd = open(lock_path, O_RDONLY | O_CLOEXEC);
  free(lock_path);
  double until = stamp() + 5000;
  if (fd < 0)
    fatal("guardian loss lock");
  while (flock(fd, LOCK_EX | LOCK_NB)) {
    if ((errno != EWOULDBLOCK && errno != EAGAIN) || stamp() >= until)
      fatal("guardian loss descendants retained lock");
    usleep(10000);
  }
  flock(fd, LOCK_UN);
  close(fd);
  usleep(2200000);
  char *marker = format("%s/loss-survivor", filescope);
  if (!access(marker, F_OK))
    fatal("guardian loss left running descendants");
  free(marker);
  loss_rejected(parse(journal_bytes), journal_path);
  close(pin);
  /* No fd retains the namespace now; its nsfs bind mount must still block
   * backing-file deletion. The fixture exists only in controller's namespace.
   */
  loss_rejected(parse(journal_bytes), journal_path);
  if (umount2(mount_pin, UMOUNT_NOFOLLOW) || unlink(mount_pin))
    fatal("namespace pin fixture removal");
  free(mount_pin);
  mark("stale_journal_refuses_namespace_bind_mount_pin");
  usleep(2200000);
  marker = format("%s/loss-survivor", filescope);
  if (!access(marker, F_OK))
    fatal("thawed guardian-loss descendant survived");
  free(marker);
  mark(frozen ? "frozen_guardian_loss_thaws_pending_exitkill_without_replay"
              : "guardian_loss_exitkill_and_pinned_namespace_refusal");
  const char *keys[] = {"schema", "scope_ino", "runtime_ino", "freezer_ino"};
  for (size_t i = 0; i < sizeof keys / sizeof *keys; i++) {
    j = parse(journal_bytes);
    num(j, keys[i], number(j, keys[i]) + 1);
    loss_rejected(j, journal_path);
  }
  j = parse(journal_bytes);
  boolean(j, "prepared", 0);
  loss_rejected(j, journal_path);
  j = parse(journal_bytes);
  str(j, "boot_id", "different-boot");
  loss_rejected(j, journal_path);
  char process[4096];
  readtext("/proc/self/stat", process, sizeof process);
  char *tail = strrchr(process, ')'), *save, *start = NULL;
  int index = 0;
  for (char *field = tail ? strtok_r(tail + 2, " ", &save) : NULL; field;
       field = strtok_r(NULL, " ", &save), index++)
    if (index == 19) {
      start = field;
      break;
    }
  if (!start)
    fatal("controller identity");
  j = parse(journal_bytes);
  num(j, "pid", getpid());
  str(j, "process_start", start);
  loss_rejected(j, journal_path);
  mark("stale_journal_scope_resource_boot_and_live_identity_refusal");
  /* Simulate PID reuse. The still-live controller must never be signaled. */
  j = parse(journal_bytes);
  num(j, "pid", getpid());
  str(j, "process_start", "0");
  if (frozen) {
    /* Model a namespace number reused by an unrelated, still-live process.
     * This controller namespace has none of the old worker's owned mounts. */
    struct stat ns;
    if (stat("/proc/self/ns/mnt", &ns))
      fatal("namespace reuse fixture");
    num(j, "namespace_dev", ns.st_dev);
    num(j, "namespace_ino", ns.st_ino);
  }
  loss_journal_write(journal_path, json(j), 0);
  discard(j);
  launch();
  r = call(req("status"));
  if (!json_object_get_boolean(
          get(get(r, "result"), "stale_guardian_reconciled")))
    fatal("guardian journal was not reconciled");
  discard(r);
  if (frozen)
    mark("stale_namespace_number_reuse_preserves_unrelated_process");
  if (!access(helper_path, F_OK) || !access(old_launcher, F_OK))
    fatal("guardian loss left runtime storage");
  char *old_group = format("/sys/fs/cgroup/freezer/%s", group);
  if (!access(old_group, F_OK))
    fatal("guardian loss left freezer group");
  for (int i = 0; i < 2; i++) {
    const char *id = i ? "native-loss-app-001" : "native-loss-root-01";
    r = call(job_req("job.status", id));
    J *result = get(r, "result"), *record = get(result, "record");
    if (strcmp(textval(result, "state"), "interrupted") ||
        strcmp(textval(record, "recovery"), "stale-guardian-reconciled") ||
        get(record, "exit_code") != NULL)
      fatal("guardian loss record outcome");
    discard(r);
    j = job_req("job.start", id);
    str(j, "command", ":");
    str(j, "profile", "root");
    num(j, "timeout_ms", 1000);
    rejected(j);
    discard(call(job_req("job.forget", id)));
  }
  r = call(job_req("job.status", "native-loss-complete"));
  if (strcmp(textval(get(r, "result"), "state"), "completed") ||
      number(get(get(r, "result"), "record"), "exit_code") != 7)
    fatal("guardian loss changed completed record");
  discard(r);
  discard(call(job_req("job.forget", "native-loss-complete")));
  discard(start_job("native-loss-recovered", "printf recovered", 5000, "app"));
  await_job("native-loss-recovered", "completed", 0, 7000);
  discard(call(job_req("job.forget", "native-loss-recovered")));
  if (unlink(backup))
    fatal("guardian loss fixture cleanup");
  free(backup);
  free(helper_path);
  free(old_launcher);
  free(group);
  free(old_group);
  free(journal_path);
  mark("guardian_loss_reconciles_without_pid_signals_or_job_replay");
}

#ifdef NATIVE_WORKER_FAULT_TEST
static void orphan_intent_checks(void) {
  const char *stages[] = {"created", "partial", "synced", "linked"};
  for (size_t i = 0; i < sizeof stages / sizeof *stages; i++) {
    finish(0);
    if (setenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT", stages[i], 1))
      fatal("intent fault environment");
    launch();
    if (unsetenv("COUCHROOT_NATIVE_JOB_INTENT_FAULT"))
      fatal("intent fault environment reset");
    char *marker = format("%s/unexpected-intent-command", scope),
         *command_text = format("touch '%s'", marker);
    J *j = job_req("job.start", "native-orphan-intent");
    str(j, "command", command_text);
    str(j, "profile", "root");
    num(j, "timeout_ms", 1000);
    char *body = base64(json(j), strlen(json(j))),
         *frame = format("OP\t%d\t%s", ++sequence, body);
    sendframe(&w, frame);
    free(body);
    free(frame);
    free(command_text);
    discard(j);
    close(w.fd);
    w.fd = -1;
    double deadline = stamp() + 15000;
    int status;
    pid_t got;
    do {
      got = waitpid(child, &status, WNOHANG);
      if (!got)
        usleep(10000);
    } while (!got && stamp() < deadline);
    if (got != child || !WIFEXITED(status) || WEXITSTATUS(status) != 86)
      fatal("intent publication crash did not recover");
    child = 0;
    struct stat st;
    if (!lstat(marker, &st) || errno != ENOENT)
      fatal("unpublished intent executed a command");
    free(marker);
    launch();
    J *r = call(job_req("job.status", "native-orphan-intent")),
      *result = get(r, "result"), *record = get(result, "record");
    if (strcmp(textval(result, "state"), "interrupted") ||
        get(record, "exit_code") != NULL ||
        (i < 3 && (!get(record, "launch_started") ||
                   json_object_get_boolean(get(record, "launch_started")))))
      fatal("orphan intent record did not preserve unknown exit and nonlaunch");
    discard(r);
    j = job_req("job.start", "native-orphan-intent");
    str(j, "command", ":");
    str(j, "profile", "root");
    num(j, "timeout_ms", 1000);
    rejected(j);
    discard(call(job_req("job.forget", "native-orphan-intent")));
    char *directory = format("%s/.jobs", filescope);
    DIR *d = opendir(directory);
    free(directory);
    if (!d)
      fatal("intent recovery directory");
    struct dirent *entry;
    while ((entry = readdir(d)))
      if (!strncmp(entry->d_name, ".intent-", 8) ||
          !strncmp(entry->d_name, ".repair-", 8))
        fatal("orphan intent temporary retained");
    closedir(d);
    char check[128];
    snprintf(check, sizeof check, "orphan_intent_%s_interrupted_without_replay",
             stages[i]);
    mark(check);
  }
}
static void startup_reservation_refusal(const char *stage, const char *path,
                                        const char *bytes, const char *owner,
                                        const char *group) {
  if (!strcmp(stage, "runtime-created")) {
    char *sentinel = format("%s/unbound-sentinel", owner);
    loss_journal_write(sentinel, "preserve", 1);
    loss_rejected(parse(bytes), path);
    char value[32];
    readtext(sentinel, value, sizeof value);
    if (strcmp(value, "preserve") || unlink(sentinel))
      fatal("nonempty runtime reservation was changed");
    free(sentinel);
    J *wrong = parse(bytes);
    num(wrong, "runtime_parent_ino", number(wrong, "runtime_parent_ino") + 1);
    loss_rejected(wrong, path);
    loss_journal_write(path, bytes, 0);
    mark("runtime_reservation_rejects_foreign_content_and_parent_mismatch");
  }
  if (!strcmp(stage, "freezer-created")) {
    J *wrong = parse(bytes);
    num(wrong, "freezer_parent_ino", number(wrong, "freezer_parent_ino") + 1);
    loss_rejected(wrong, path);
    loss_journal_write(path, bytes, 0);
    char membership[4096], controllers[128], original[PATH_MAX] = {0}, *save;
    readtext("/proc/self/cgroup", membership, sizeof membership);
    for (char *line = strtok_r(membership, "\n", &save); line;
         line = strtok_r(NULL, "\n", &save)) {
      char location[2048];
      if (sscanf(line, "%*d:%127[^:]:%2047s", controllers, location) == 2 &&
          !strcmp(controllers, "freezer")) {
        snprintf(original, sizeof original,
                 "/sys/fs/cgroup/freezer%s/cgroup.procs", location);
        break;
      }
    }
    char *target = format("%s/cgroup.procs", group),
         *state = format("%s/freezer.state", group);
    int restore = open(original, O_WRONLY | O_NOFOLLOW | O_CLOEXEC),
        move = open(target, O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
    if (!original[0] || restore < 0 || move < 0)
      fatal("reservation test membership descriptors");
    char before[32], after[32], pid[32];
    readtext(state, before, sizeof before);
    snprintf(pid, sizeof pid, "%d", getpid());
    writeall(move, pid, strlen(pid));
    close(move);
    loss_rejected(parse(bytes), path);
    writeall(restore, pid, strlen(pid));
    close(restore);
    readtext(state, after, sizeof after);
    if (strcmp(before, after))
      fatal("busy unbound freezer was modified");
    free(target);
    free(state);
    mark("freezer_reservation_rejects_busy_group_and_parent_mismatch");
  }
}
static void startup_recovery_checks(void) {
  const char *stages[] = {"initial-created",
                          "initial-partial",
                          "initial-synced",
                          "namespace",
                          "runtime-parent-created",
                          "runtime-reserved",
                          "runtime-created",
                          "runtime",
                          "launcher-created",
                          "launcher-partial-copy",
                          "launcher-copy",
                          "launcher",
                          "freezer-reserved",
                          "freezer-created",
                          "contained",
                          "ready",
                          "journal-runtime-reserved",
                          "journal-runtime",
                          "journal-freezer-reserved",
                          "journal-contained",
                          "journal-ready",
                          "partial-runtime-reserved",
                          "partial-runtime",
                          "partial-freezer-reserved",
                          "partial-contained",
                          "partial-ready",
                          "fail-namespace",
                          "fail-runtime-reserved",
                          "fail-runtime",
                          "fail-freezer-reserved",
                          "fail-contained",
                          "fail-ready"};
  for (size_t i = 0; i < sizeof stages / sizeof *stages; i++) {
    finish(0);
    pid_t probe = fork();
    if (probe < 0)
      fatal("startup recovery probe fork");
    if (!probe) {
      if (setenv("COUCHROOT_NATIVE_STARTUP_FAULT", stages[i], 1))
        _exit(127);
      execl(binary, binary, "127.0.0.1", "1", "/nonexistent-native-test-token",
            filescope, app, appsha, (char *)NULL);
      _exit(127);
    }
    double deadline = stamp() + 10000;
    int status;
    pid_t got;
    do {
      got = waitpid(probe, &status, WNOHANG);
      if (!got)
        usleep(10000);
    } while (!got && stamp() < deadline);
    if (got != probe) {
      kill(probe, SIGKILL);
      waitpid(probe, NULL, 0);
      fatal("startup recovery probe hung");
    }
    int failed = !strncmp(stages[i], "fail-", 5),
        initial = !strncmp(stages[i], "initial-", 8);
    if (!WIFEXITED(status) || WEXITSTATUS(status) != (failed ? 1 : 86))
      fatal("startup recovery injection did not run");
    char *path = format("%s/.jobs/guardian", filescope), bytes[4096];
    char *old = NULL, *group = NULL;
    struct stat st;
    if (failed || initial) {
      if (!lstat(path, &st) || errno != ENOENT ||
          !lstat("/opt/couchroot-agent/native-helpers", &st) || errno != ENOENT)
        fatal("unpublished startup retained runtime or final journal");
      char *temp = format("%s/.jobs/guardian.initial", filescope);
      int present = !lstat(temp, &st);
      if (present != initial || (!present && errno != ENOENT))
        fatal("initial journal cleanup state");
      free(temp);
      temp = format("%s/.jobs/guardian.next", filescope);
      if (!lstat(temp, &st) || errno != ENOENT)
        fatal("journal write error left successor temporary");
      free(temp);
    } else {
      readtext(path, bytes, sizeof bytes);
      J *journal = parse(bytes);
      const char *id = journal ? textval(journal, "worker_id") : NULL;
      if (!hexvalid(id, 32))
        fatal("startup recovery journal identity");
      old = format("/opt/couchroot-agent/native-helpers/%s", id);
      group = format("/sys/fs/cgroup/freezer/couchroot-native-%s", id);
      startup_reservation_refusal(stages[i], path, bytes, old, group);
      discard(journal);
    }
    free(path);
    launch();
    J *r = call(req("status"));
    if (!failed && !json_object_get_boolean(
                       get(get(r, "result"), "stale_guardian_reconciled")))
      fatal("startup reconciliation not reported");
    discard(r);
    if (old && (!lstat(old, &st) || errno != ENOENT || !lstat(group, &st) ||
                errno != ENOENT))
      fatal("startup reconciliation retained resources");
    free(old);
    free(group);
    discard(start_job("native-startup-app", "printf startup-recovered", 5000,
                      "app"));
    await_job("native-startup-app", "completed", 0, 7000);
    discard(call(job_req("job.forget", "native-startup-app")));
    char check[128];
    snprintf(check, sizeof check, "startup_checkpoint_recovery_%s", stages[i]);
    mark(check);
  }
}
#endif
