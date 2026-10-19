/* Address-space pressure on one authenticated controller-owned worker only.
 * No global memory pressure or production fault hook. SPDX-License-Identifier: 0BSD */
static void launch_pressure_checks(void) {
  const char *saved_id = "native-pressure-saved", *live_id = "native-pressure-live",
             *failed_id = "native-pressure-refused";
  discard(start_job(saved_id, "exit 7", 5000, "root"));
  await_job(saved_id, "completed", 7, 7000);
  char *saved = format("%s/.jobs/%s.json", filescope, saved_id),
       *marker = format("%s/unexpected-execution", scope),
       *witness = format("%s/live-execution", scope),
       *release = format("%s/live-release", scope);
  char before[2048], after[2048];
  readtext(saved, before, sizeof before);
  if (mkfifo(release, 0600))
    fatal("memory pressure live gate");
  char *cmd = format("printf x > '%s'; read permit < '%s'; "
                     "test \"$permit\" = proceed || exit 12; exit 9",
                     witness, release);
  discard(start_job(live_id, cmd, 15000, "root"));
  free(cmd);
  double deadline = stamp() + 5000;
  struct stat st;
  while (stat(witness, &st)) {
    if (errno != ENOENT || stamp() >= deadline)
      fatal("memory pressure live job not started");
    usleep(10000);
  }
  discard(call(req("status")));
  char *path = format("/proc/%d/statm", worker_pid), bytes[256];
  readtext(path, bytes, sizeof bytes);
  free(path);
  uint64_t pages;
  long page_size = sysconf(_SC_PAGESIZE);
  if (sscanf(bytes, "%" SCNu64, &pages) != 1 || !pages || page_size <= 0 ||
      pages > UINT64_MAX / (uint64_t)page_size)
    fatal("memory pressure address-space inventory");
  struct { uint64_t current, maximum; } original, limited;
  if (syscall(SYS_prlimit64, worker_pid, RLIMIT_AS, NULL, &original))
    fatal("memory pressure read limit");
  limited = original;
  limited.current = pages * (uint64_t)page_size;
  if (limited.current >= original.current ||
      syscall(SYS_prlimit64, worker_pid, RLIMIT_AS, &limited, NULL))
    fatal("memory pressure set limit");
  J *j = job_req("job.start", failed_id);
  cmd = format("touch '%s'", marker);
  str(j, "command", cmd);
  str(j, "profile", "root");
  num(j, "timeout_ms", 1000);
  free(cmd);
  J *r = request(j);
  discard(j);
  if (syscall(SYS_prlimit64, worker_pid, RLIMIT_AS, &original, NULL))
    fatal("memory pressure restore limit");
  const char *error = textval(r, "error");
  if (json_object_get_boolean(get(r, "ok")) || !error ||
      strcmp(error, "Insufficient memory; job intent retained, not launched")) {
    fprintf(stderr, "memory pressure response %s\n", json(r));
    fatal("memory pressure did not refuse at allocation boundary");
  }
  discard(r);
  resource_no_witness(marker);
  r = call(job_req("job.status", failed_id));
  if (strcmp(textval(get(r, "result"), "state"), "unknown"))
    fatal("memory pressure lost launch intent");
  discard(r);
  resource_reject_job(failed_id, marker);
  r = call(job_req("job.status", live_id));
  if (strcmp(textval(get(r, "result"), "state"), "running") ||
      !json_object_is_type(get(get(r, "result"), "exit_code"), 0))
    fatal("memory pressure did not preserve the gated live job");
  discard(r);
  int gate = open(release, O_WRONLY | O_NONBLOCK | O_CLOEXEC);
  if (gate < 0)
    fatal("memory pressure live reader missing");
  writeall(gate, "proceed\n", 8);
  close(gate);
  await_job(live_id, "completed", 9, 7000);
  readtext(saved, after, sizeof after);
  if (strcmp(before, after))
    fatal("memory pressure changed saved outcome");
  readtext(witness, after, sizeof after);
  if (strcmp(after, "x"))
    fatal("memory pressure replayed live command");
  discard(start_job("native-pressure-recovered", "exit 11", 5000, "app"));
  await_job("native-pressure-recovered", "completed", 11, 7000);
  discard(call(job_req("job.forget", "native-pressure-recovered")));
  discard(call(job_req("job.forget", live_id)));
  finish(0);
  launch();
  r = call(job_req("job.status", failed_id));
  if (strcmp(textval(get(r, "result"), "state"), "interrupted") ||
      !json_object_is_type(get(get(get(r, "result"), "record"), "exit_code"), 0))
    fatal("memory pressure intent reconciliation");
  discard(r);
  resource_no_witness(marker);
  readtext(saved, after, sizeof after);
  if (strcmp(before, after))
    fatal("memory pressure restart changed saved outcome");
  discard(call(job_req("job.forget", failed_id)));
  discard(call(job_req("job.forget", saved_id)));
  if (unlink(witness) || unlink(release))
    fatal("memory pressure witness cleanup");
  free(saved);
  free(marker);
  free(witness);
  free(release);
  mark("address_space_refusal_preserves_live_and_saved_jobs_then_recovers_without_replay");
}
