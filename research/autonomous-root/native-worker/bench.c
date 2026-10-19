/* TV-local side-by-side worker measurement. SPDX-License-Identifier: 0BSD */
#include "common.h"
#include "controller.h"
#include "bench-resources.h"
#include "bench-kernel.h"
extern char **environ;
static double worker_cpu(pid_t pid) {
  char path[64], buf[4096];
  snprintf(path, sizeof path, "/proc/%d/stat", pid);
  readtext(path, buf, sizeof buf);
  char *p = strrchr(buf, ')');
  if (!p)
    fatal("stat");
  p += 2;
  int index = 0;
  double ticks = 0;
  char *save;
  for (char *v = strtok_r(p, " ", &save); v;
       v = strtok_r(NULL, " ", &save), index++)
    if (index == 11 || index == 12)
      ticks += strtod(v, NULL);
  return ticks * 1000.0 / sysconf(_SC_CLK_TCK);
}
static double live_cpu(void) {
  return worker_cpu(worker_pid) + (worker_pid != child ? worker_cpu(child) : 0);
}
static J *memory(pid_t pid) {
  char path[64], linebuf[512];
  snprintf(path, sizeof path, "/proc/%d/smaps", pid);
  FILE *f = fopen(path, "r");
  if (!f)
    fatal("smaps");
  long rss = 0, pss = 0, private = 0, swap = 0, swappss = 0, n;
  while (fgets(linebuf, sizeof linebuf, f)) {
    if (sscanf(linebuf, "Rss: %ld kB", &n) == 1)
      rss += n;
    else if (sscanf(linebuf, "Pss: %ld kB", &n) == 1)
      pss += n;
    else if (sscanf(linebuf, "Private_Clean: %ld kB", &n) == 1 ||
             sscanf(linebuf, "Private_Dirty: %ld kB", &n) == 1)
    private += n;
    else if (sscanf(linebuf, "Swap: %ld kB", &n) == 1) swap += n;
    else if (sscanf(linebuf, "SwapPss: %ld kB", &n) == 1) swappss += n;
  }
  fclose(f);
  J *j = obj();
  num(j, "rss_kib", rss);
  num(j, "pss_kib", pss);
  num(j, "private_kib", private);
  num(j, "swap_kib", swap);
  num(j, "swap_pss_kib", swappss);
  return j;
}
static J *workload(void) {
  int size = 8 * CHUNK + 17;
  unsigned char *data = allocate(size);
  random_bytes(data, size);
  char sha[65];
  digest(data, size, sha);
  char *path = format("%s/bench-file", filescope);
  char *id = begin(path, size, sha, "absent");
  upload(id, 1, data, CHUNK, 0);
  double cpu = live_cpu(), start = stamp();
  for (int offset = 0; offset < size; offset += CHUNK)
    upload(id, offset, data + offset,
           size - offset > CHUNK ? CHUNK : size - offset, 1);
  transfer_op("file.commit", id, 1);
  double up = stamp() - start, upcpu = live_cpu() - cpu;
  free(id);
  J *j = req("file.open");
  str(j, "path", path);
  J *r = call(j);
  id = strdup(textval(get(r, "result"), "transfer_id"));
  if (strcmp(textval(get(r, "result"), "sha256"), sha))
    fatal("file hash");
  json_object_put(r);
  cpu = live_cpu();
  start = stamp();
  for (int offset = 0; offset < size; offset += CHUNK) {
    int n = size - offset > CHUNK ? CHUNK : size - offset;
    download(id, offset, n, data + offset, n);
  }
  double down = stamp() - start, downcpu = live_cpu() - cpu;
  download(id, CHUNK - 7, 17, data + CHUNK - 7, 17);
  download(id, size, 1, data, 0);
  transfer_op("file.close", id, 1);
  free(id);
  char replacement_sha[65];
  digest(data, 17, replacement_sha);
  id =
      begin(path, 17, replacement_sha,
            "0000000000000000000000000000000000000000000000000000000000000000");
  upload(id, 0, data, 17, 1);
  transfer_op("file.commit", id, 0);
  transfer_op("file.close", id, 1);
  free(id);
  id = begin(path, 17, replacement_sha, sha);
  upload(id, 0, data, 17, 1);
  upload(id, 0, data, 17, 0);
  transfer_op("file.commit", id, 1);
  free(id);
  if (unlink(path))
    fatal("file cleanup");
  free(path);
  free(data);
  J *out = obj();
  num(out, "bytes", size);
  json_object_object_add(out, "upload_ms", json_object_new_double(up));
  json_object_object_add(out, "upload_cpu_ms", json_object_new_double(upcpu));
  json_object_object_add(out, "download_ms", json_object_new_double(down));
  json_object_object_add(out, "download_cpu_ms",
                         json_object_new_double(downcpu));
  return out;
}
static J *job_timing(const char *profile) {
  unsigned char random[16];
  char id[33];
  random_bytes(random, sizeof random);
  hex(random, sizeof random, id);
  J *j = req("job.start");
  str(j, "id", id);
  str(j, "profile", profile);
  str(j, "command", "printf bench; exit 7");
  num(j, "timeout_ms", 5000);
  double start = stamp();
  J *r = call(j);
  double admitted = stamp();
  json_object_put(r);
  int polls = 0;
  for (;;) {
    j = req("job.status");
    str(j, "id", id);
    r = call(j);
    polls++;
    J *result = get(r, "result");
    const char *state = textval(result, "state");
    if (!state)
      fatal("job timing state missing");
    if (strcmp(state, "running")) {
      if (strcmp(state, "completed") || !get(result, "exit_code") ||
          number(result, "exit_code") != 7 ||
          json_object_get_boolean(get(result, "persistence_failed")))
        fatal("job timing result");
      json_object_put(r);
      break;
    }
    json_object_put(r);
    if (stamp() - start > 10000)
      fatal("job timing deadline");
    usleep(10000);
  }
  double completed = stamp();
  j = req("job.output");
  str(j, "id", id);
  num(j, "stdout_cursor", 0);
  num(j, "stderr_cursor", 0);
  double output_start = stamp();
  r = call(j);
  double output_end = stamp();
  const char *encoded = textval(get(get(r, "result"), "stdout"), "data");
  size_t length = 0;
  unsigned char *bytes = encoded ? decode(encoded, &length) : NULL;
  if (!bytes || length != 5 || memcmp(bytes, "bench", 5))
    fatal("job timing output");
  free(bytes);
  json_object_put(r);
  j = req("job.forget");
  str(j, "id", id);
  double forget_start = stamp();
  r = call(j);
  double forgotten = stamp();
  json_object_put(r);
  J *out = obj();
  str(out, "profile", profile);
  str(out, "job_id", id);
  json_object_object_add(out, "start_monotonic_ms", json_object_new_double(start));
  json_object_object_add(out, "admitted_monotonic_ms", json_object_new_double(admitted));
  json_object_object_add(out, "completion_monotonic_ms", json_object_new_double(completed));
  json_object_object_add(out, "forget_start_monotonic_ms", json_object_new_double(forget_start));
  json_object_object_add(out, "forgotten_monotonic_ms", json_object_new_double(forgotten));
  json_object_object_add(out, "admission_ms", json_object_new_double(admitted - start));
  json_object_object_add(out, "observed_completion_ms", json_object_new_double(completed - start));
  json_object_object_add(out, "output_ms", json_object_new_double(output_end - output_start));
  json_object_object_add(out, "forget_ms", json_object_new_double(forgotten - forget_start));
  json_object_object_add(out, "through_forget_ms", json_object_new_double(forgotten - start));
  num(out, "status_polls", polls);
  num(out, "poll_interval_ms", 10);
  return out;
}
static J *parity(int native) {
  command("printf stdout; printf stderr >&2; exit 7", 1000, 7, 0);
  command("sleep 2", 100, 124, 1);
  J *j = req("app.exec");
  str(j, "command",
      "id; cat /proc/self/attr/current; printf '\\n%s' \"$XDG_RUNTIME_DIR\"; "
      "exit 7");
  num(j, "timeout_ms", 5000);
  J *r = call(j), *result = get(r, "result");
  const char *out = textval(result, "stdout");
  if (number(result, "exit_code") != 7 || !out || !strstr(out, "uid=5001") ||
      !strstr(out, "User") || !strstr(out, "/run/user/5001"))
    fatal("app identity");
  json_object_put(r);
  j = req("app.exec");
  str(j, "command", "printf '%s' \"apostrophe's \\\"double\\\" and café\"");
  num(j, "timeout_ms", 5000);
  r = call(j);
  if (strcmp(textval(get(r, "result"), "stdout"),
             "apostrophe's \"double\" and café"))
    fatal("app quoting");
  json_object_put(r);
  const char *helper = getenv("COUCHROOT_BENCH_HELPER");
  if (helper) {
    j = req("app.exec");
    str(j, "command", helper);
    num(j, "timeout_ms", 5000);
    r = call(j);
    result = get(r, "result");
    out = textval(result, "stdout");
    if (number(result, "exit_code") || !out ||
        !strstr(out, "uid=5001 euid=5001 gid=100 smack=User"))
      fatal("borrowed helper execution");
    json_object_put(r);
  }
  J *record = obj();
  boolean(record, "root_exit_and_timeout", 1);
  boolean(record, "app_identity_environment_quotes", 1);
  boolean(record, "borrowed_unsigned_helper", helper != NULL);
  if (native) {
    j = req("job.status");
    str(j, "id", "prototype-missing-job");
    rejected(j);
    j = req("helper.release");
    str(j, "helper_id", "00000000000000000000000000000000");
    rejected(j);
    str(record, "jobs", "covered by accept controller");
    str(record, "helper_lifecycle", "covered by accept controller");
  } else {
    str(record, "jobs", "deployed acceptance; not timed here");
    str(record, "helper_lifecycle", "deployed acceptance; not timed here");
  }
  return record;
}
static void sample(const char *dll, const char *binary, const char *app,
                   const char *appsha, int native, int round) {
  sequence = 0;
  memset(&w, 0, sizeof w);
  random_bytes(w.secret, 32);
  random_bytes(w.nonce, 32);
  char *token = format("%s/token", scope), *encoded = base64(w.secret, 32);
  int fd = open(token, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal("token create");
  writeall(fd, encoded, strlen(encoded));
  close(fd);
  free(encoded);
  int listener = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0)
    fatal("listener");
  struct sockaddr_in address = {.sin_family = AF_INET,
                                .sin_addr = {htonl(INADDR_LOOPBACK)}};
  if (bind(listener, (struct sockaddr *)&address, sizeof address) ||
      listen(listener, 1))
    fatal("listen");
  socklen_t length = sizeof address;
  if (getsockname(listener, (struct sockaddr *)&address, &length))
    fatal("getsockname");
  char port[16];
  snprintf(port, sizeof port, "%u", ntohs(address.sin_port));
  double start = stamp();
  child = fork();
  if (child < 0)
    fatal("fork worker");
  if (!child) {
    alarm(90);
    /* The optional kernel reader is a parent thread. Keep this path limited
     * to signal-safe calls and pre-existing argument/environment bytes. */
    if (native) {
      char *const args[] = {(char *)binary, "127.0.0.1", port, token,
                            (char *)filescope, (char *)app, (char *)appsha,
                            "--production", NULL};
      execve(binary, args, environ);
    } else {
      char *const args[] = {"dotnet", (char *)dll, "127.0.0.1", port,
                            token, (char *)scope, NULL};
      execve("/usr/bin/dotnet", args, environ);
    }
    _exit(127);
  }
  struct pollfd ready = {listener, POLLIN, 0};
  if (poll(&ready, 1, 15000) != 1)
    fatal("worker connect timeout");
  w.fd = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
  if (w.fd < 0)
    fatal("accept");
  close(listener);
  int one = 1;
  setsockopt(w.fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
  struct timeval timeout = {30, 0};
  setsockopt(w.fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout);
  setsockopt(w.fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof timeout);
  char nonce[65];
  hex(w.nonce, 32, nonce);
  char *hello = format("SAMSUNG-TV-ROOT/1\t%s\n", nonce);
  writeall(w.fd, hello, strlen(hello));
  free(hello);
  char *auth = receive(&w), *fields_a[10];
  if (fields(auth, fields_a, 10) != 8 || strcmp(fields_a[0], "AUTH") ||
      atoi(fields_a[1]) <= 0 || (!native && atoi(fields_a[1]) != child))
    fatal("AUTH identity");
  for (int i = 2; i <= 5; i++)
    if (strcmp(fields_a[i], "0"))
      fatal("AUTH not root");
  worker_pid = atoi(fields_a[1]);
  free(auth);
  J *r = call(req("status"));
  if (native && (number(get(r, "result"), "guardian_pid") != child ||
                 !textval(get(r, "result"), "lifetime_mode") ||
                 strcmp(textval(get(r, "result"), "lifetime_mode"), "production") ||
                 number(get(r, "result"), "lifetime_seconds") != 0))
    fatal("benchmark requires ordinary production lifetime and owned guardian");
  json_object_put(r);
  double startup = stamp() - start, startcpu = live_cpu();
  J *report = obj();
  str(report, "kind", native ? "native" : "dotnet");
  str(report, "startup_scope", "warm root-executor launch through authenticated status; excludes acquisition");
  boolean(report, "native_production_mode", native);
  num(report, "round", round);
  json_object_object_add(report, "startup_ms", json_object_new_double(startup));
  json_object_object_add(report, "launch_start_monotonic_ms", json_object_new_double(start));
  json_object_object_add(report, "ready_monotonic_ms", json_object_new_double(start + startup));
  json_object_object_add(report, "startup_cpu_ms",
                         json_object_new_double(startcpu));
  json_object_object_add(report, "ready_memory", memory(worker_pid));
  if (native)
    json_object_object_add(report, "guardian_ready_memory", memory(child));
  str(report, "resource_accounting",
      "CPU includes guardian, excludes exited command descendants; memory and resources report worker and guardian separately; descriptors sampled at phase boundaries, not a continuous peak; scheduling counters are not wakeups");
  json_object_object_add(report, "ready_resources", bench_tree_resources());
  if (round >= 0) {
    json_object_object_add(report, "parity", parity(native));
    json_object_object_add(report, "transfer", workload());
    J *jobs = json_object_new_array();
    json_object_array_add(jobs, job_timing("root"));
    json_object_array_add(jobs, job_timing("app"));
    json_object_object_add(report, "jobs", jobs);
    json_object_object_add(report, "loaded_memory", memory(worker_pid));
    if (native)
      json_object_object_add(report, "guardian_loaded_memory", memory(child));
    json_object_object_add(report, "loaded_resources", bench_tree_resources());
    int64_t seconds = 1;
    const char *setting = getenv("COUCHROOT_BENCH_IDLE_SECONDS");
    if (setting && (!decimal(setting, &seconds) || seconds < 1 || seconds > 30))
      fatal("idle window");
    double idlecpu = live_cpu(), idle = stamp(), prior = idlecpu;
    J *series = json_object_new_array();
    for (int64_t i = 0; i < seconds; i++) {
      usleep(1000000);
      double now = live_cpu();
      json_object_array_add(series, json_object_new_double(now - prior));
      prior = now;
    }
    json_object_object_add(report, "idle_cpu_ms",
                           json_object_new_double(prior - idlecpu));
    json_object_object_add(report, "idle_elapsed_ms",
                           json_object_new_double(stamp() - idle));
    json_object_object_add(report, "idle_cpu_series_ms", series);
    json_object_object_add(report, "settled_memory", memory(worker_pid));
    json_object_object_add(report, "settled_resources", bench_tree_resources());
    if (native)
      json_object_object_add(report, "guardian_settled_memory", memory(child));
    if (seconds > 1) {
      J *warm = json_object_new_array();
      for (int i = 0; i < 3; i++)
        json_object_array_add(warm, workload());
      json_object_object_add(report, "warm_transfers", warm);
      json_object_object_add(report, "warm_memory", memory(worker_pid));
      if (native)
        json_object_object_add(report, "guardian_warm_memory", memory(child));
    }
  }
  double shutdown_start = stamp();
  char *bye = format("SHUTDOWN\t%d", ++sequence);
  sendframe(&w, bye);
  free(bye);
  char *response = receive(&w);
  if (strncmp(response, "BYE\t", 4))
    fatal("shutdown response");
  free(response);
  close(w.fd);
  w.fd = -1;
  int status;
  struct rusage usage;
  while (wait4(child, &status, 0, &usage) < 0)
    if (errno != EINTR)
      fatal("wait4");
  child = 0;
  if (!WIFEXITED(status) || WEXITSTATUS(status))
    fatal("worker exit");
  json_object_object_add(report, "shutdown_start_monotonic_ms", json_object_new_double(shutdown_start));
  json_object_object_add(report, "retired_monotonic_ms", json_object_new_double(stamp()));
  num(report, "wait4_peak_rss_kib", usage.ru_maxrss);
  str(report, "wait4_peak_scope", "waited child and reaped descendants kernel high-water; not additive tree RSS");
  puts(json(report));
  fflush(stdout);
  json_object_put(report);
  free(token);
}
int main(int argc, char **argv) {
  if (argc != 7) {
    fputs("usage: bench DOTNET_DLL NATIVE_WORKER EXPERIMENT_DIRECTORY "
          "APP_LAUNCHER SHA256 ROUNDS\n",
          stderr);
    return 64;
  }
  if (getuid() || geteuid())
    return 77;
  signal(SIGPIPE, SIG_IGN);
  alarm(240);
  atexit(stop_child);
  libraries();
  scope = argv[3];
  filescope = getenv("COUCHROOT_BENCH_FILES");
  if (!filescope)
    fatal("COUCHROOT_BENCH_FILES is required");
  int64_t rounds;
  if (!decimal(argv[6], &rounds) || rounds < 1 || rounds > 20)
    return 64;
  const char *capture = getenv("COUCHROOT_BENCH_KERNEL_CAPTURE");
  if (capture && strcmp(capture, "1"))
    return 64;
  BenchKernel kernel;
  if (capture)
    kernel_begin(&kernel, scope);
  for (int i = -2; i < rounds; i++) {
    int first = (i % 2) == 0;
    sample(argv[1], argv[2], argv[4], argv[5], first, i);
    sample(argv[1], argv[2], argv[4], argv[5], !first, i);
  }
  if (capture && !kernel_end(&kernel))
    fatal("kernel capture incomplete; inspect private coverage metadata");
  return 0;
}
