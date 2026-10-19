/* Resource limits affect only the controller-owned experimental worker.
 * SPDX-License-Identifier: 0BSD */
#include <sys/syscall.h>
static void resource_no_witness(const char *path) {
  struct stat st;
  if (!lstat(path, &st) || errno != ENOENT)
    fatal("resource rejection executed a command");
}
static void resource_reject_job(const char *id, const char *marker) {
  J *j = job_req("job.start", id);
  char *cmd = format("touch '%s'", marker);
  str(j, "command", cmd);
  str(j, "profile", "root");
  num(j, "timeout_ms", 1000);
  free(cmd);
  rejected(j);
  resource_no_witness(marker);
}
/* prlimit64 is available since Linux 2.6.36. Use its fixed-width kernel ABI
 * so the ARM32 controller does not confuse it with libc's 32-bit rlim_t.
 * The target comes from this live authenticated child, never a saved PID.
 */
static struct {
  uint64_t current, maximum;
} resource_original;
static void resource_free_slots(unsigned slots) {
  struct {
    uint64_t current, maximum;
  } limited;
  if (syscall(SYS_prlimit64, worker_pid, RLIMIT_NOFILE, NULL,
              &resource_original))
    fatal("read native descriptor limit");
  char *fdpath = format("/proc/%d/fd", worker_pid);
  DIR *d = opendir(fdpath);
  free(fdpath);
  if (!d)
    fatal("native descriptor inventory");
  unsigned char occupied[4096] = {0};
  struct dirent *entry;
  while ((entry = readdir(d))) {
    char *end;
    unsigned long fd = strtoul(entry->d_name, &end, 10);
    if (!*end && fd < sizeof occupied)
      occupied[fd] = 1;
  }
  closedir(d);
  unsigned limit = 0, available = 0;
  while (limit < sizeof occupied && available < slots) {
    if (!occupied[limit])
      available++;
    limit++;
  }
  if (available != slots)
    fatal("cannot establish bounded descriptor fixture");
  /* Existing descriptors above the new soft limit remain usable. Count free
   * slots below it instead of using the highest open descriptor: inherited
   * descriptor tables can contain holes, as observed on both TVs.
   */
  limited.current = limit;
  limited.maximum = resource_original.maximum;
  if (limited.current >= resource_original.current ||
      syscall(SYS_prlimit64, worker_pid, RLIMIT_NOFILE, &limited, NULL))
    fatal("constrain native descriptor limit");
}
static void resource_restore_slots(void) {
  if (syscall(SYS_prlimit64, worker_pid, RLIMIT_NOFILE, &resource_original,
              NULL))
    fatal("restore native descriptor limit");
}
static void production_idle_limit_checks(void) {
  resource_free_slots(0);
  discard(call(req("status")));
  discard(call(req("status")));
  /* Cross the active-frame deadline while genuinely idle. Existing descriptors
   * remain usable even though poll(nfds=1) rejects the zero soft limit. */
  sleep(32);
  discard(call(req("status")));
  writeall(w.fd, "OP\t", 3);
  double started = stamp();
  struct pollfd closed = {w.fd, POLLIN, 0};
  char byte;
  if (poll(&closed, 1, 38000) != 1)
    fatal("production partial frame deadline");
  ssize_t n = read(w.fd, &byte, 1);
  if (n > 0 || (n < 0 && errno != ECONNRESET))
    fatal("production partial frame disconnect");
  close(w.fd);
  w.fd = -1;
  int status;
  pid_t got;
  do {
    got = waitpid(child, &status, WNOHANG);
    if (!got)
      usleep(10000);
  } while (!got && stamp() - started < 38000);
  if (got != child || !WIFEXITED(status) ||
      (WEXITSTATUS(status) != 1 && WEXITSTATUS(status) != 137) ||
      stamp() - started < 25000 ||
      stamp() - started >= 38000)
    fatal("production partial frame termination");
  child = 0;
  char *journal = format("%s/.jobs/guardian", filescope);
  resource_no_witness(journal);
  free(journal);
  launch();
  mark("production_zero_descriptor_idle_and_partial_frame_deadline");
}
/* One slot short of each operation's admission must reject it cleanly; at the
 * threshold the operation must complete. On these kernels an undercounted
 * allocation would abort the worker instead. */
static void resource_operation_rejected(unsigned slots, J *j) {
  resource_free_slots(slots);
  J *r = request(j);
  resource_restore_slots();
  json_object_put(j);
  const char *error = textval(r, "error");
  if (json_object_get_boolean(get(r, "ok")) || !error ||
      strncmp(error, "Insufficient descriptors", 24))
    fatal("operation descriptor admission");
  json_object_put(r);
}
static J *resource_operation_admitted(unsigned slots, J *j) {
  resource_free_slots(slots);
  J *r = request(j);
  resource_restore_slots();
  json_object_put(j);
  if (!json_object_get_boolean(get(r, "ok"))) {
    fprintf(stderr, "operation failed: %s\n", json(r));
    fatal("operation at descriptor threshold");
  }
  return r;
}
static void operation_admission_checks(const char *marker) {
  resource_free_slots(0);
  discard(call(req("status")));
  resource_restore_slots();
  resource_operation_rejected(0,
                              job_req("job.status", "native-descriptor-limit"));
  discard(resource_operation_admitted(
      1, job_req("job.status", "native-descriptor-limit")));
  J *j = req("file.open");
  str(j, "path", app);
  /* Production policy also holds a parent directory descriptor. */
  unsigned file_slots = production_resources ? 3 : 2;
  resource_operation_rejected(file_slots - 1, j);
  j = req("file.open");
  str(j, "path", app);
  J *r = resource_operation_admitted(file_slots, j);
  char *id = strdup(textval(get(r, "result"), "transfer_id"));
  discard(r);
  transfer_op("file.close", id, 1);
  free(id);
  for (unsigned slots = 3; slots <= 4; slots++) {
    j = req("helper.prepare");
    str(j, "path", app);
    str(j, "sha256", appsha);
    if (slots == 3) {
      resource_operation_rejected(slots, j);
      continue;
    }
    r = resource_operation_admitted(slots, j);
    id = strdup(textval(get(r, "result"), "helper_id"));
    discard(r);
    j = req("helper.release");
    str(j, "helper_id", id);
    resource_operation_rejected(1, j);
    j = req("helper.release");
    str(j, "helper_id", id);
    discard(resource_operation_admitted(2, j));
    free(id);
  }
  char *cmd = format("touch '%s'", marker);
  j = req("app.exec");
  str(j, "command", cmd);
  num(j, "timeout_ms", 5000);
  resource_operation_rejected(5, j);
  resource_no_witness(marker);
  j = req("app.exec");
  str(j, "command", "true");
  num(j, "timeout_ms", 5000);
  r = resource_operation_admitted(6, j);
  if (number(get(r, "result"), "exit_code"))
    fatal("app command at descriptor threshold");
  discard(r);
  resource_free_slots(6);
  command("true", 5000, 0, 0);
  resource_restore_slots();
  /* A legacy EXEC frame has no failure result: the worker ends the session
   * without running it, as the managed worker does when a start fails. */
  char *b = base64(cmd, strlen(cmd)),
       *frame = format("EXEC\t%d\t5000\t%s", ++sequence, b);
  resource_free_slots(5);
  sendframe(&w, frame);
  free(b);
  free(frame);
  free(cmd);
  struct pollfd closed = {w.fd, POLLIN, 0};
  char byte;
  if (poll(&closed, 1, 5000) != 1 || read(w.fd, &byte, 1) != 0)
    fatal("legacy command descriptor rejection");
  close(w.fd);
  w.fd = -1;
  int status;
  double deadline = stamp() + 10000;
  pid_t got;
  while (!(got = waitpid(child, &status, WNOHANG)) && stamp() < deadline)
    usleep(10000);
  if (got != child || !WIFEXITED(status) || WEXITSTATUS(status) != 1)
    fatal("legacy command rejection did not end the session cleanly");
  child = 0;
  resource_no_witness(marker);
  char *journal = format("%s/.jobs/guardian", filescope);
  resource_no_witness(journal);
  free(journal);
  launch();
  mark("operation_descriptor_admission_without_abort");
}
static void resource_limit_checks(void) {
  char *marker = format("%s/resource-unexpected-command", scope);
  for (int i = 0; i < 64; i++) {
    char *path = format("%s/.jobs/native-saved-limit-%02d.json", filescope, i);
    J *r = obj();
    char id[64];
    snprintf(id, sizeof id, "native-saved-limit-%02d", i);
    str(r, "id", id);
    str(r, "worker_id", "ffffffffffffffffffffffffffffffff");
    str(r, "boot_id", boot);
    str(r, "state", "completed");
    num(r, "exit_code", i);
    int fd =
        open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0)
      fatal("saved retention fixture");
    writeall(fd, json(r), strlen(json(r)));
    if (fsync(fd) || close(fd))
      fatal("saved retention persistence");
    free(path);
    discard(r);
  }
  resource_reject_job("native-retention-rejected", marker);
  for (int i = 0; i < 64; i++) {
    char id[64];
    snprintf(id, sizeof id, "native-saved-limit-%02d", i);
    J *r = call(job_req("job.status", id)), *result = get(r, "result");
    if (strcmp(textval(result, "state"), "completed") ||
        number(get(result, "record"), "exit_code") != i)
      fatal("retention rejection changed saved outcome");
    discard(r);
  }
  discard(call(job_req("job.forget", "native-saved-limit-00")));
  discard(
      start_job("native-capacity-recovered", "printf recovered", 2000, "app"));
  await_job("native-capacity-recovered", "completed", 0, 3000);
  discard(call(job_req("job.forget", "native-capacity-recovered")));
  for (int i = 1; i < 64; i++) {
    char id[64];
    snprintf(id, sizeof id, "native-saved-limit-%02d", i);
    discard(call(job_req("job.forget", id)));
  }
  mark("saved_retention_limit_preserves_records_and_app_capacity_recovers");

  resource_free_slots(3);
  resource_reject_job("native-descriptor-limit", marker);
  resource_restore_slots();
  J *r = call(job_req("job.status", "native-descriptor-limit"));
  if (strcmp(textval(get(r, "result"), "state"), "unknown"))
    fatal("descriptor exhaustion lost launch intent");
  discard(r);
  resource_reject_job("native-descriptor-limit", marker);
  discard(start_job("native-descriptor-recovered", "printf recovered", 2000,
                    "app"));
  await_job("native-descriptor-recovered", "completed", 0, 3000);
  discard(call(job_req("job.forget", "native-descriptor-recovered")));
  operation_admission_checks(marker);
  finish(0);
  launch();
  r = call(job_req("job.status", "native-descriptor-limit"));
  if (strcmp(textval(get(r, "result"), "state"), "interrupted") ||
      get(get(get(r, "result"), "record"), "exit_code") != NULL)
    fatal("descriptor intent restart reconciliation");
  discard(r);
  resource_no_witness(marker);
  discard(call(job_req("job.forget", "native-descriptor-limit")));
  free(marker);
  mark("descriptor_exhaustion_no_launch_then_app_execution_and_reconciliation");
}
