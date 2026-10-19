/* Bounded startup and guardian pressure on the controller's own children.
 * Ordinary binaries only; no production fault interface. SPDX-License-Identifier: 0BSD */
static void startup_refusal_checks(void) {
  char *token = format("%s/startup-token", scope),
       *jobs = format("%s/.jobs", filescope);
  unsigned char secret[32];
  random_bytes(secret, sizeof secret);
  char *encoded = base64(secret, sizeof secret);
  int fd = open(token, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("startup refusal token");
  writeall(fd, encoded, strlen(encoded));
  close(fd);
  resource_no_witness(jobs);
  int errors[2];
  if (pipe2(errors, O_CLOEXEC))
    fatal("startup refusal pipe");
  pid_t probe = fork();
  if (probe < 0)
    fatal("startup refusal fork");
  if (!probe) {
    if (dup2(errors[1], STDERR_FILENO) < 0)
      _exit(127);
    close(errors[0]);
    close(errors[1]);
    /* Leave 31 slots for the ELF loader; do not subject pre-main firmware
     * mapping to an exhausted table. main must refuse before scope changes. */
    startup_slots(31);
    execl(binary, binary, "127.0.0.1", "1", token, filescope, app, appsha,
          "--production", (char *)NULL);
    _exit(127);
  }
  close(errors[1]);
  int status;
  pid_t got;
  double deadline = stamp() + 10000;
  do {
    got = waitpid(probe, &status, WNOHANG);
    if (!got)
      usleep(10000);
  } while (!got && stamp() < deadline);
  if (got != probe) {
    kill(probe, SIGKILL);
    waitpid(probe, NULL, 0);
    fatal("startup refusal timeout");
  }
  char message[1024] = {0}, after[128];
  ssize_t n = read(errors[0], message, sizeof message - 1);
  close(errors[0]);
  readtext(token, after, sizeof after);
  if (n <= 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 1 ||
      !strstr(message, "insufficient startup descriptors; state untouched") ||
      strcmp(after, encoded))
    fatal("startup refusal changed state or failed unexpectedly");
  resource_no_witness(jobs);
  if (unlink(token))
    fatal("startup refusal token cleanup");
  free(token);
  free(jobs);
  free(encoded);
  mark("startup_one_slot_short_refuses_without_consuming_token_or_creating_state");
}
static void startup_wait_gone(pid_t pid, const char *ticks) {
  char path[64], bytes[4096];
  snprintf(path, sizeof path, "/proc/%d/stat", pid);
  double deadline = stamp() + 5000;
  for (;;) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) {
      if (errno == ENOENT)
        return;
      fatal("guardian pressure process observation");
    }
    ssize_t n = read(fd, bytes, sizeof bytes - 1);
    close(fd);
    if (n <= 0 || n == sizeof bytes - 1)
      fatal("guardian pressure process stat");
    bytes[n] = 0;
    char *tail = strrchr(bytes, ')'), *save = NULL, *start = NULL;
    int field = 0, dead = 0;
    for (char *p = tail ? strtok_r(tail + 2, " \n", &save) : NULL; p;
         p = strtok_r(NULL, " \n", &save), field++) {
      if (!field)
        dead = !strcmp(p, "Z") || !strcmp(p, "X");
      if (field == 19) {
        start = p;
        break;
      }
    }
    if (!start)
      fatal("guardian pressure process identity");
    if (dead || strcmp(start, ticks))
      return;
    if (stamp() > deadline)
      fatal("guardian pressure left a live owned task");
    usleep(10000);
  }
}
static void guardian_resource_checks(int fault) {
  const char *saved_id = "native-guardian-saved", *live_id = "native-guardian-live";
  discard(start_job(saved_id, "exit 7", 5000, "root"));
  await_job(saved_id, "completed", 7, 7000);
  char *saved = format("%s/.jobs/%s.json", filescope, saved_id),
       *live = format("%s/.jobs/%s.json", filescope, live_id),
       *journal = format("%s/.jobs/guardian", filescope),
       *counter = format("%s/guardian-run-count", scope);
  char saved_before[2048], journal_before[4096], stopped[2048], after[4096];
  readtext(saved, saved_before, sizeof saved_before);
  readtext(journal, journal_before, sizeof journal_before);
  J *identity = call(req("status"));
  char *worker_ticks = strdup(textval(
      get(get(get(identity, "result"), "processes"), "worker"), "start_ticks"));
  discard(identity);
  char *cmd = format("printf x >> '%s'; exec sleep 60", counter);
  J *started = start_job(live_id, cmd, 120000, "root");
  pid_t live_pid = (pid_t)number(get(started, "result"), "pid");
  char *live_ticks = strdup(textval(get(started, "result"), "process_start"));
  discard(started);
  free(cmd);
  struct stat st;
  double deadline = stamp() + 5000;
  while (stat(counter, &st)) {
    if (errno != ENOENT || stamp() > deadline)
      fatal("guardian pressure command did not start");
    usleep(10000);
  }
  struct { uint64_t current, maximum; } original, limited;
  if (syscall(SYS_prlimit64, child, RLIMIT_NOFILE, NULL, &original))
    fatal("guardian pressure limit read");
  limited = original;
  limited.current = 0;
  if (syscall(SYS_prlimit64, child, RLIMIT_NOFILE, &limited, NULL))
    fatal("guardian pressure limit set");
  if (fault) {
    if (kill(worker_pid, SIGSEGV))
      fatal("guardian pressure supervised fault");
  } else {
    char *bye = format("SHUTDOWN\t%d", ++sequence);
    sendframe(&w, bye);
    free(bye);
    char *reply = receive(&w), *expected = format("BYE\t%d", sequence);
    if (strcmp(reply, expected))
      fatal("guardian pressure shutdown reply");
    free(reply);
    free(expected);
  }
  close(w.fd);
  w.fd = -1;
  int status;
  pid_t got;
  deadline = stamp() + 10000;
  do {
    got = waitpid(child, &status, WNOHANG);
    if (!got)
      usleep(10000);
  } while (!got && stamp() < deadline);
  if (got != child || !WIFEXITED(status) ||
      WEXITSTATUS(status) != (fault ? 1 : 125))
    fatal("guardian pressure did not retain a recoverable outcome");
  child = 0;
  startup_wait_gone(worker_pid, worker_ticks);
  startup_wait_gone(live_pid, live_ticks);
  free(worker_ticks);
  free(live_ticks);
  readtext(journal, after, sizeof after);
  if (strcmp(journal_before, after))
    fatal("guardian pressure changed retained ownership");
  readtext(live, stopped, sizeof stopped);
  /* A fresh launch uses ordinary same-boot reconciliation; never replay the
   * command or remove the journal ourselves. Every launch has 32 free slots. */
  launch();
  readtext(saved, after, sizeof after);
  if (strcmp(saved_before, after))
    fatal("guardian pressure changed saved terminal result");
  J *result = call(job_req("job.status", live_id));
  J *record = get(get(result, "result"), "record");
  if (strcmp(textval(get(result, "result"), "state"), "interrupted") ||
      (fault ? !json_object_is_type(get(record, "exit_code"), 0)
             : number(record, "exit_code") != 137))
    fatal("guardian pressure lost interrupted result");
  discard(result);
  if (!fault) {
    readtext(live, after, sizeof after);
    if (strcmp(stopped, after))
      fatal("guardian pressure rewrote known shutdown outcome");
  }
  readtext(counter, after, sizeof after);
  if (strcmp(after, "x") || unlink(counter))
    fatal("guardian pressure replayed command");
  discard(call(job_req("job.forget", live_id)));
  discard(call(job_req("job.forget", saved_id)));
  free(saved);
  free(live);
  free(journal);
  free(counter);
  mark(fault ? "guardian_zero_descriptor_fault_retains_then_reconciles_without_replay"
             : "guardian_zero_descriptor_shutdown_preserves_known_outcome_then_reconciles");
}
