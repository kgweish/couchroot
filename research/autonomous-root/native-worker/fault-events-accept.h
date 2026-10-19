/* Bounded command-fault telemetry; actual termination remains SIGKILL.
 * SPDX-License-Identifier: 0BSD */
static void fault_diagnostic_checks(void) {
  J *r = call(req("status"));
  int64_t before = number(get(get(r, "result"), "command_faults"), "total");
  if (strcmp(textval(get(r, "result"), "command_fault_policy"),
             "terminate-core-signals-before-handlers"))
    fatal("command signal policy missing");
  discard(r);
  for (int i = 0; i < 70; i++) {
    r = start_job("native-diagnostic-fault", "kill -ABRT $$", 2000, "root");
    int64_t pid = number(get(r, "result"), "pid");
    discard(r);
    await_job("native-diagnostic-fault", "completed", 137, 3000);
    r = call(req("status"));
    J *faults = get(get(r, "result"), "command_faults");
    /* Parse the array's serialized last object through the json-c APIs already
     * used by the prototype, keeping this controller's dynamic ABI unchanged.
     */
    const char *events = json(get(faults, "events")),
               *last = strrchr(events, '{');
    if (!last)
      fatal("missing command fault diagnostic");
    char *copy = strdup(last), *end = strrchr(copy, '}');
    if (!end)
      fatal("malformed command fault diagnostic");
    end[1] = 0;
    J *event = parse(copy);
    free(copy);
    int64_t total = before + i + 1;
    if (!event || number(faults, "total") != total ||
        number(faults, "capacity") != 64 ||
        number(faults, "overwritten") != (total > 64 ? total - 64 : 0) ||
        json_object_get_boolean(get(faults, "durable")) ||
        json_object_get_boolean(get(faults, "snapshot_incomplete")) ||
        number(event, "sequence") != total || number(event, "pid") != pid ||
        number(event, "thread_id") != pid ||
        number(event, "original_signal") != SIGABRT ||
        number(event, "termination_signal") != SIGKILL ||
        number(event, "signal_code") != 0)
      fatal("command fault diagnostic mismatch");
    discard(event);
    discard(r);
    discard(call(job_req("job.forget", "native-diagnostic-fault")));
  }
  finish(0);
  launch();
  r = call(req("status"));
  if (number(get(get(r, "result"), "command_faults"), "total"))
    fatal("command fault history reused across workers");
  discard(r);
  mark("bounded_original_command_fault_history_preserves_actual_exit_and_"
       "resets");
}
