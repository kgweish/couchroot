/* Root-only, bounded reconciliation without a new guardian or command channel.
 * No atexit cleanup is registered: inspection failure must preserve evidence.
 * The coordinator pins the current boot, old owner and journal digest before
 * invoking this mode, then independently verifies all retained records. */
static int offline_reconcile(int argc, char **argv) {
  if (argc != 6 || !reconcile_boot_valid(argv[3]) ||
      !hexvalid(argv[4], 32) ||
      (strcmp(argv[5], "absent") && !hexvalid(argv[5], 64)))
    return 64;
  if (getuid() || geteuid() || getgid() || getegid())
    return 77;
  if (!descriptor_capacity(32))
    fatal("insufficient offline recovery descriptors");
  struct rlimit core_limit = {0, 0};
  if (setrlimit(RLIMIT_CORE, &core_limit) || prctl(PR_SET_DUMPABLE, 0))
    fatal("disable offline recovery core dumps");
  signal(SIGTERM, SIG_DFL);
  signal(SIGINT, SIG_DFL);
  signal(SIGALRM, SIG_DFL);
  alarm(20);
  libraries();
  char resolved[PATH_MAX];
  if (!realpath(argv[2], resolved) || strcmp(resolved, argv[2]) ||
      strlen(resolved) > PATH_MAX - 257)
    fatal("canonical offline recovery scope required");
  strcpy(root, resolved);
  directory = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (directory < 0 || fstat(directory, &st) || st.st_uid ||
      (st.st_mode & 07777) != 0700)
    fatal("private offline recovery scope required");
  jobs_dir = openat(directory, ".jobs", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (jobs_dir < 0 || fstat(jobs_dir, &st) || st.st_uid ||
      (st.st_mode & 07777) != 0700)
    fatal("existing private offline jobs required");
  jobs_lock = openat(jobs_dir, "lock", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (jobs_lock < 0 || fstat(jobs_lock, &st) || !S_ISREG(st.st_mode) ||
      st.st_uid || st.st_nlink != 1 || st.st_size ||
      (st.st_mode & 07777) != 0600 || flock(jobs_lock, LOCK_EX | LOCK_NB))
    fatal("exclusive offline job ownership required");
  const char *blocked[] = {".import-pending", "guardian.initial", "guardian.next"};
  for (size_t i = 0; i < sizeof blocked / sizeof blocked[0]; i++)
    if (!fstatat(jobs_dir, blocked[i], &st, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
      fatal("offline recovery requires a committed journal");
  readtext("/proc/sys/kernel/random/boot_id", current_boot, sizeof current_boot);
  if (strcmp(current_boot, argv[3]))
    fatal("offline recovery boot changed");
  if (!strcmp(argv[5], "absent")) {
    if (!fstatat(jobs_dir, "guardian", &st, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
      fatal("offline recovery journal unexpectedly present");
  } else {
    int fd = openat(jobs_dir, "guardian", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    char actual[65];
    if (fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid ||
        st.st_nlink != 1 || (st.st_mode & 07777) != 0600 || st.st_size < 1 ||
        st.st_size >= 4096 || !request_filedigest(fd, actual) || strcmp(actual, argv[5]))
      fatal("offline recovery journal digest changed");
    close(fd);
    J *j = reconcile_read_journal("guardian", NULL);
    const char *owner = j ? textval(j, "worker_id") : NULL;
    if (!owner || strcmp(owner, argv[4]))
      fatal("offline recovery owner changed");
    json_object_put(j);
    guardian_reconcile();
  }
  if (!fstatat(jobs_dir, "guardian", &st, AT_SYMLINK_NOFOLLOW) || errno != ENOENT)
    fatal("offline recovery journal remains");
  if (fsync(jobs_dir))
    fatal("offline recovery persistence");
  puts("NATIVE-STATE-RECONCILED");
  return 0;
}
