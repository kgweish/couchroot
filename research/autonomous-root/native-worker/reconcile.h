/* Reconcile a bound guardian journal under the scope
 * lock. No saved process ID is ever a signal target. SPDX-License-Identifier:
 * 0BSD */
static int reconcile_refuse(const char *reason) {
  fprintf(stderr, "prototype: reconciliation refused: %s\n", reason);
  return 0;
}
static int reconcile_boot_valid(const char *boot) {
  if (!boot || strlen(boot) != 36)
    return 0;
  for (int i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (boot[i] != '-')
        return 0;
    } else if (!((boot[i] >= '0' && boot[i] <= '9') ||
                 (boot[i] >= 'a' && boot[i] <= 'f')))
      return 0;
  }
  return 1;
}
static int reconcile_bound(J *j, const char *prefix, const struct stat *st) {
  char key[64];
  int64_t dev, ino;
  snprintf(key, sizeof key, "%s_dev", prefix);
  if (!integer(j, key, &dev) || dev < 0)
    return 0;
  snprintf(key, sizeof key, "%s_ino", prefix);
  return integer(j, key, &ino) && ino > 0 &&
         (uint64_t)dev == (uint64_t)st->st_dev &&
         (uint64_t)ino == (uint64_t)st->st_ino;
}
static int reconcile_dir(int parent, const char *name) {
  int fd =
      openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (fd >= 0 && (fstat(fd, &st) || st.st_uid || (st.st_mode & 022))) {
    close(fd);
    errno = EPERM;
    return -1;
  }
  return fd;
}
static int reconcile_mount_namespace_refs(long pid, int64_t ino) {
  char path[80], expected[80], line[8192];
  snprintf(path, sizeof path, "/proc/%ld/mountinfo", pid);
  snprintf(expected, sizeof expected, "mnt:[%" PRId64 "]", ino);
  FILE *f = fopen(path, "r");
  if (!f)
    return errno == ENOENT || errno == ESRCH;
  int good = 1;
  while (fgets(line, sizeof line, f)) {
    char mount_root[128];
    /* Older nsfs implementations omit the namespace identity in mountinfo.
     * Such a pin cannot be classified safely, so retain the journal. */
    int anonymous_nsfs = strstr(line, " - nsfs ") &&
                         (sscanf(line, "%*s %*s %*s %127s", mount_root) != 1 ||
                          !strstr(mount_root, ":["));
    /* A different boot gives no authority over any current namespace inode.
     * Without a process whose mount table can be checked, retain all pins. */
    if (strstr(line, expected) || anonymous_nsfs ||
        (ino < 0 && strstr(line, " - nsfs ")) || !strchr(line, '\n')) {
      good = 0;
      break;
    }
  }
  if (ferror(f))
    good = 0;
  fclose(f);
  return good;
}
/* nsfs inode numbers may be recycled after the original namespace dies.
 * A same-number live namespace is relevant only if it still contains an owned
 * execution view. Check both mount roots and targets so moved bind mounts also
 * retain ownership. Descriptor-only and anonymous bind pins stay conservative.
 */
static int reconcile_namespace_without_views(long pid) {
  char path[80], needle[96], line[8192];
  if (!hexvalid(worker_id, 32))
    return 0;
  snprintf(path, sizeof path, "/proc/%ld/mountinfo", pid);
  snprintf(needle, sizeof needle, "/native-helpers/%s", worker_id);
  FILE *f = fopen(path, "r");
  if (!f)
    return 0;
  int good = 1;
  while (fgets(line, sizeof line, f)) {
    if (!strchr(line, '\n') || strstr(line, needle)) {
      good = 0;
      break;
    }
  }
  if (ferror(f))
    good = 0;
  fclose(f);
  return good;
}
static int reconcile_namespace_unused(J *journal) {
#ifndef NATIVE_WORKER_TEST
  int rebooted = strcmp(textval(journal, "boot_id"), current_boot) != 0;
  int64_t dev, ino;
  if (!integer(journal, "namespace_dev", &dev) || dev < 0 ||
      !integer(journal, "namespace_ino", &ino) || ino <= 0)
    return 0;
  DIR *proc = opendir("/proc");
  if (!proc)
    return 0;
  int good = 1;
  struct {
    dev_t dev;
    ino_t ino;
  } seen[256];
  size_t seen_count = 0;
  struct dirent *e;
  while (good && (e = readdir(proc))) {
    char *end;
    long pid = strtol(e->d_name, &end, 10);
    if (*end || pid < 1 || pid > INT_MAX)
      continue;
    char path[96];
    struct stat st;
    snprintf(path, sizeof path, "/proc/%ld/ns/mnt", pid);
    if (!stat(path, &st)) {
      if ((rebooted || ((uint64_t)st.st_dev == (uint64_t)dev &&
                       (uint64_t)st.st_ino == (uint64_t)ino)) &&
          !reconcile_namespace_without_views(pid)) {
        good = 0;
        break;
      }
      size_t index;
      for (index = 0; index < seen_count; index++)
        if (seen[index].dev == st.st_dev && seen[index].ino == st.st_ino)
          break;
      if (index == seen_count) {
        if (seen_count == sizeof seen / sizeof *seen ||
            !reconcile_mount_namespace_refs(pid, rebooted ? -1 : ino)) {
          good = 0;
          break;
        }
        seen[seen_count].dev = st.st_dev;
        seen[seen_count++].ino = st.st_ino;
      }
    } else if (errno != ENOENT && errno != ESRCH) {
      good = 0;
      break;
    }
    /* Also refuse an explicitly retained namespace handle. Missing tasks/fds
     * are normal races; inaccessible tasks are not proof of absence. */
    snprintf(path, sizeof path, "/proc/%ld/fd", pid);
    DIR *fds = opendir(path);
    if (!fds) {
      if (errno != ENOENT && errno != ESRCH)
        good = 0;
      continue;
    }
    struct dirent *f;
    while (good && (f = readdir(fds))) {
      if (f->d_name[0] == '.')
        continue;
      char target[128], expected[80];
      ssize_t n = readlinkat(dirfd(fds), f->d_name, target, sizeof target - 1);
      if (n < 0) {
        if (errno != ENOENT && errno != ESRCH)
          good = 0;
      } else {
        target[n] = 0;
        snprintf(expected, sizeof expected, "mnt:[%" PRId64 "]", ino);
        if (!strcmp(target, expected) ||
            (rebooted && !strncmp(target, "mnt:[", 5)))
          good = 0;
      }
    }
    closedir(fds);
  }
  closedir(proc);
  return good;
#else
  /* Host tests lack mount namespaces/Smack. Device tests must prove this. */
  (void)journal;
  return 1;
#endif
}
static int reconcile_no_mounts(const char *owner_path) {
  FILE *f = fopen("/proc/self/mountinfo", "r");
  if (!f)
    return 0;
  char line[8192];
  int good = 1;
  size_t length = strlen(owner_path);
  while (fgets(line, sizeof line, f)) {
    char *save, *field = strtok_r(line, " ", &save);
    for (int i = 0; i < 4 && field; i++)
      field = strtok_r(NULL, " ", &save);
    if (field && !strncmp(field, owner_path, length) &&
        (!field[length] || field[length] == '/'))
      good = 0;
  }
  if (ferror(f))
    good = 0;
  fclose(f);
  return good;
}
static int reconcile_reservation(J *j, const char *phase) {
  int64_t schema;
  const char *actual = textval(j, "phase");
  return integer(j, "schema", &schema) && schema == 4 && actual &&
         !strcmp(actual, phase);
}
static int reconcile_empty_directory(int fd) {
  DIR *d = scan_directory(fd);
  if (!d)
    return 0;
  struct dirent *e;
  int empty = 1;
  errno = 0;
  while ((e = readdir(d))) {
    if (strcmp(e->d_name, ".") && strcmp(e->d_name, "..")) {
      empty = 0;
      break;
    }
  }
  if (errno)
    empty = 0;
  closedir(d);
  return empty;
}
static int reconcile_freezer(J *j) {
#ifndef NATIVE_WORKER_TEST
  freezer_root = open("/sys/fs/cgroup/freezer",
                      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (freezer_root < 0)
    return 0;
  snprintf(freezer_name, sizeof freezer_name, "couchroot-native-%s", worker_id);
  freezer_dir = reconcile_dir(freezer_root, freezer_name);
  if (freezer_dir < 0)
    return errno == ENOENT; /* A previous reconciliation may have removed it. */
  /* Freezer cgroups cannot survive a reboot. Even the same name and inode now
   * identify a current-boot object; never thaw or remove it using old evidence. */
  if (strcmp(textval(j, "boot_id"), current_boot))
    return 0;
  struct stat st;
  int reserved =
      !get(j, "freezer_ino") && reconcile_reservation(j, "freezer-reserved");
  if (reserved) {
    if (fstat(freezer_root, &st) || !reconcile_bound(j, "freezer_parent", &st))
      return 0;
  } else if (fstat(freezer_dir, &st) || !reconcile_bound(j, "freezer", &st))
    return 0;
  /* EXITKILL is inherited by every released descendant. If the guardian died
   * during freezing, old kernels may retain their pending kills until thaw.
   * Thaw only this inode-bound leaf; never signal enumerated or saved PIDs. */
  if (!reserved && !freezer_write("freezer.state", "THAWED"))
    return 0;
  double deadline = stamp() + 5000;
  for (;;) {
    int empty = 1;
    const char *names[] = {"cgroup.procs", "tasks"};
    for (int i = 0; i < 2; i++) {
      int fd = openat(freezer_dir, names[i], O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
      char data[128];
      ssize_t n = fd < 0 ? -1 : read(fd, data, sizeof data);
      if (fd >= 0)
        close(fd);
      if (n < 0)
        return 0;
      if (n)
        empty = 0;
    }
    if (empty)
      return 1;
    if (reserved || stamp() >= deadline)
      return 0; /* An unbound reservation must already be empty; never thaw it.
                 */
    usleep(10000);
  }
#else
  (void)j;
  return 1;
#endif
}
static int reconcile_resources(J *j) {
  struct stat st;
  const char *id = textval(j, "worker_id"), *boot = textval(j, "boot_id"),
             *start = textval(j, "process_start");
  int64_t schema, pid;
  J *prepared = get(j, "prepared");
  const char *phase = textval(j, "phase");
  if (get(j, "startup_token_sha256") &&
      !hexvalid(textval(j, "startup_token_sha256"), 64))
    return 0;
  if (!integer(j, "schema", &schema) || !prepared ||
      !json_object_is_type(prepared, 1) ||
      !((schema == 2 && json_object_get_boolean(prepared)) ||
        ((schema == 3 || schema == 4) && phase &&
         ((!strcmp(phase, "ready") && json_object_get_boolean(prepared)) ||
          ((!strcmp(phase, "namespace") || !strcmp(phase, "runtime") ||
            !strcmp(phase, "contained") ||
            (schema == 4 && (!strcmp(phase, "runtime-reserved") ||
                             !strcmp(phase, "freezer-reserved")))) &&
           !json_object_get_boolean(prepared))))) ||
      !hexvalid(id, 32) || !reconcile_boot_valid(boot) ||
      !reconcile_boot_valid(current_boot) || !start ||
      !*start || !integer(j, "pid", &pid) || pid < 1 || pid > INT_MAX ||
      fstat(directory, &st) || !reconcile_bound(j, "scope", &st))
    return 0;
  int rebooted = strcmp(boot, current_boot) != 0;
  /* Cross-boot recovery requires the current journal format and its launch
   * binding. Legacy journals retain their original same-boot recovery path. */
  if (rebooted &&
      (schema != 4 || !hexvalid(textval(j, "startup_token_sha256"), 64)))
    return 0;
  char actual[32];
  errno = 0;
  if (!rebooted && job_identity((pid_t)pid, actual)) {
    if (!strcmp(actual, start))
      return 0; /* Still live (or unreaped): no takeover, even without its lock.
                 */
  } else if (!rebooted && errno != ENOENT && errno != ESRCH)
    return 0;
  strcpy(worker_id, id);
#ifdef NATIVE_WORKER_TEST
  helper_parent = reconcile_dir(directory, ".views");
  if (snprintf(helper_owner_path, sizeof helper_owner_path, "%s/.views/%s",
               root, id) >= (int)sizeof helper_owner_path)
    return 0;
#else
  int opt = reconcile_dir(AT_FDCWD, "/opt");
  if (opt < 0)
    return 0;
  int agent = reconcile_dir(opt, "couchroot-agent");
  close(opt);
  if (agent < 0)
    return 0;
  helper_parent = reconcile_dir(agent, "native-helpers");
  close(agent);
  snprintf(helper_owner_path, sizeof helper_owner_path,
           "/opt/couchroot-agent/native-helpers/%s", id);
#endif
  if (helper_parent < 0 && errno != ENOENT)
    return 0;
  if (helper_parent >= 0) {
    helper_owner = reconcile_dir(helper_parent, id);
    if (helper_owner < 0 && errno != ENOENT)
      return 0;
    if (helper_owner >= 0) {
      if (!get(j, "runtime_ino") &&
          reconcile_reservation(j, "runtime-reserved")) {
        if (fstat(helper_parent, &st) ||
            !reconcile_bound(j, "runtime_parent", &st) ||
            !reconcile_empty_directory(helper_owner))
          return 0;
      } else if (fstat(helper_owner, &st) ||
                 !reconcile_bound(j, "runtime", &st))
        return 0;
    }
  }
  /* Bindings are validated before any cleanup. Missing resources are allowed
   * for idempotence; existing mismatched resources are never adopted. */
  helper_parent_created = json_object_get_boolean(get(j, "parent_created"));
  if (!reconcile_freezer(j))
    return reconcile_refuse("freezer identity or remaining tasks");
  double deadline = stamp() + 5000;
  while (!reconcile_namespace_unused(j)) {
    if (stamp() >= deadline)
      return reconcile_refuse("namespace remains referenced or inaccessible");
    usleep(20000);
  }
  if (!reconcile_no_mounts(helper_owner_path))
    return reconcile_refuse("unexpected visible runtime mount");
  guardian_recovery_kind = "stale-guardian-reconciled";
  if (helper_owner < 0 && helper_parent >= 0)
    helpers_cleanup();
  if (!guardian_recover_records() || !runtime_sweep() || !containment_cleanup())
    return 0;
  return 1;
}
static J *reconcile_read_journal(const char *name, int *partial) {
  struct stat st;
  int fd = openat(jobs_dir, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) {
    if (errno == ENOENT)
      return NULL;
    fatal("unresolved guardian journal access");
  }
  char bytes[4096];
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid ||
      (st.st_mode & 077) || st.st_nlink != 1 ||
      st.st_size < (partial ? 0 : 1) || st.st_size >= (off_t)sizeof bytes)
    fatal("unresolved guardian journal metadata");
  ssize_t n = read(fd, bytes, sizeof bytes - 1);
  close(fd);
  if (n != st.st_size)
    fatal("unresolved guardian journal read");
  bytes[n] = 0;
  J *j = parse(bytes);
  if (!j) {
    if (partial) {
      *partial = 1;
      return NULL;
    }
    fatal("unresolved guardian journal format");
  }
  return j;
}
static int reconcile_phase(J *j) {
  int64_t schema;
  const char *phase = textval(j, "phase");
  if (!integer(j, "schema", &schema) || (schema != 3 && schema != 4) || !phase)
    return 0;
  if (schema == 4) {
    const char *phases[] = {"namespace",        "runtime-reserved", "runtime",
                            "freezer-reserved", "contained",        "ready"};
    for (int i = 0; i < 6; i++)
      if (!strcmp(phase, phases[i]))
        return i + 1;
    return 0;
  }
  const char *phases[] = {"namespace", "runtime", "contained", "ready"};
  for (int i = 0; i < 4; i++)
    if (!strcmp(phase, phases[i]))
      return i + 1;
  return 0;
}
static int reconcile_successor(J *old, J *next) {
  int a = reconcile_phase(old), b = reconcile_phase(next);
  if (!a || b != a + 1)
    return 0;
  /* Legacy checkpoints remain recoverable, but a successor cannot add,
   * remove or change a launch binding midway through startup. */
  const char *old_token = textval(old, "startup_token_sha256"),
             *next_token = textval(next, "startup_token_sha256");
  if (get(old, "startup_token_sha256") ||
      get(next, "startup_token_sha256")) {
    if (!hexvalid(old_token, 64) || !hexvalid(next_token, 64) ||
        strcmp(old_token, next_token))
      return 0;
  }
  const char *identity[] = {"worker_id", "boot_id", "process_start"};
  for (size_t i = 0; i < sizeof identity / sizeof *identity; i++) {
    const char *x = textval(old, identity[i]), *y = textval(next, identity[i]);
    if (!x || !y || strcmp(x, y))
      return 0;
  }
  const char *bindings[] = {"schema",
                            "runtime_parent_dev",
                            "runtime_parent_ino",
                            "freezer_parent_dev",
                            "freezer_parent_ino",
                            "pid",
                            "scope_dev",
                            "scope_ino",
                            "namespace_dev",
                            "namespace_ino",
                            "runtime_dev",
                            "runtime_ino",
                            "freezer_dev",
                            "freezer_ino"};
  for (size_t i = 0; i < sizeof bindings / sizeof *bindings; i++) {
    int64_t x, y;
    if (get(old, bindings[i]) && (!integer(old, bindings[i], &x) ||
                                  !integer(next, bindings[i], &y) || x != y))
      return 0;
  }
  return 1;
}
/* This name is reserved exclusively for the first, unpublished journal.
 * No runtime directory, freezer, descendant or command can exist from that
 * startup until this file is renamed and its directory synced. The scope lock
 * excludes a live writer. A published or successor journal makes it ambiguous.
 */
static void reconcile_initial(void) {
  int fd =
      openat(jobs_dir, "guardian.initial", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) {
    if (errno == ENOENT)
      return;
    fatal("unresolved guardian journal initial access");
  }
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid ||
      (st.st_mode & 077) || st.st_nlink != 1 || st.st_size < 0 ||
      st.st_size > 4095)
    fatal("unresolved guardian journal initial metadata");
  close(fd);
  const char *names[] = {"guardian", "guardian.next"};
  for (size_t i = 0; i < sizeof names / sizeof *names; i++)
    if (!fstatat(jobs_dir, names[i], &st, AT_SYMLINK_NOFOLLOW) ||
        errno != ENOENT)
      fatal(
          "unresolved guardian journal initial conflicts with published state");
  if (unlinkat(jobs_dir, "guardian.initial", 0) || fsync(jobs_dir))
    fatal("unresolved guardian journal initial cleanup");
  guardian_reconciled = 1;
}
static void guardian_reconcile(void) {
  reconcile_initial();
  int partial = 0;
  J *j = reconcile_read_journal("guardian", NULL);
  J *next = reconcile_read_journal("guardian.next", &partial);
  int pending_next = next != NULL || partial;
  if (partial) {
    int64_t schema;
    int phase = j ? reconcile_phase(j) : 0;
    if (!j || !integer(j, "schema", &schema) ||
        !((schema == 4 && phase >= 1 && phase < 6) ||
          (schema == 3 && phase == 3)))
      fatal("unresolved guardian journal partial successor without recoverable "
            "base");
    /* The committed base remains authoritative. Its bindings or empty-only
     * reservations must independently prove cleanup; no partial data is used.
     */
  }
  if (next) {
    if (!j || !reconcile_successor(j, next))
      fatal("unresolved guardian journal temporary ownership");
    json_object_put(j);
    j = next;
  }
  if (!j)
    return;
  /* Recovery gets no command channel. Isolate globals and bypass atexit on
   * every failure so partial inspection can never trigger generic cleanup. */
  pid_t recovery = fork();
  if (recovery < 0)
    fatal("guardian reconciliation fork");
  if (!recovery) {
    signal(SIGTERM, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGALRM, SIG_DFL);
    alarm(15);
    int good = reconcile_resources(j);
    if (good && pending_next)
      good = !unlinkat(jobs_dir, "guardian.next", 0) && !fsync(jobs_dir);
    if (good)
      good = !unlinkat(jobs_dir, "guardian", 0) && !fsync(jobs_dir);
    _exit(good ? 0 : 125);
  }
  json_object_put(j);
  int status;
  pid_t got;
  do {
    got = waitpid(recovery, &status, 0);
  } while (got < 0 && errno == EINTR);
  if (got != recovery || !WIFEXITED(status) || WEXITSTATUS(status))
    fatal("unresolved guardian journal; ownership or cleanup not proven");
  guardian_reconciled = 1;
}
