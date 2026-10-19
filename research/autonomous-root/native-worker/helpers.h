/* Isolated prototype helper views. Original Couchroot code.
 * SPDX-License-Identifier: 0BSD */
#include <sched.h>
#include <sys/mount.h>
#include <sys/xattr.h>
typedef struct {
  char id[33], path[PATH_MAX];
  int mounted;
} Helper;
static Helper helpers[8];
static int helper_parent = -1, helper_owner = -1, helper_parent_created;
static char helper_owner_path[PATH_MAX];
static int helpers_available;
static int helper_label(int fd) {
#ifdef NATIVE_WORKER_TEST
  (void)fd;
  return 0;
#else
  return fsetxattr(fd, "security.SMACK64", "User", 4, 0);
#endif
}
static int helper_directory(int parent, const char *name, int *created) {
  if (mkdirat(parent, name, 0755) == 0) {
    if (created)
      *created = 1;
  } else if (errno != EEXIST)
    return -1;
  int fd =
      openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (fd < 0)
    return -1;
  if (fstat(fd, &st) || st.st_uid || (st.st_mode & 0777) != 0755 ||
      helper_label(fd)) {
    close(fd);
    return -1;
  }
  return fd;
}
static void helpers_init(void) {
#ifndef NATIVE_WORKER_TEST
  /* Do this before creating threads. CLONE_NEWNS also unshares filesystem
   * state. */
  if (unshare(CLONE_NEWNS) || mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL))
    fatal("isolated helper namespace");
  helpers_available = 1;
#endif
}
static int helper_parent_storage(void) {
  if (helper_parent >= 0)
    return 1;
#ifdef NATIVE_WORKER_TEST
  helper_parent = helper_directory(directory, ".views", &helper_parent_created);
#else
  int opt = open("/opt", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (opt < 0)
    return 0;
  int agent = helper_directory(opt, "couchroot-agent", NULL);
  close(opt);
  if (agent < 0)
    return 0;
  helper_parent =
      helper_directory(agent, "native-helpers", &helper_parent_created);
  close(agent);
#endif
  return helper_parent >= 0;
}
static int helper_storage(void) {
  if (helper_owner >= 0)
    return 1;
  if (helper_owner_path[0] || !helper_parent_storage())
    return 0;
  DIR *entries = scan_directory(helper_parent);
  if (!entries)
    return 0;
  int retained = 0;
  struct dirent *entry;
  while ((entry = readdir(entries)))
    if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, ".."))
      retained++;
  closedir(entries);
  if (retained >= 64)
    return 0;
  /* Worker ID is random and ownership must be exclusive, never adopt old views.
   */
  if (mkdirat(helper_parent, worker_id, 0755))
    return 0;
  startup_fault("runtime-created");
#ifdef NATIVE_WORKER_TEST
  if (snprintf(helper_owner_path, sizeof helper_owner_path, "%s/.views/%s",
               root, worker_id) >= (int)sizeof helper_owner_path)
    fatal("runtime path");
#else
  snprintf(helper_owner_path, sizeof helper_owner_path,
           "/opt/couchroot-agent/native-helpers/%s", worker_id);
#endif
  helper_owner = helper_directory(helper_parent, worker_id, NULL);
  return helper_owner >= 0;
}
static int helper_remove(Helper *h) {
  if (h->mounted) {
    if (umount2(h->path, UMOUNT_NOFOLLOW))
      return 0;
    h->mounted = 0;
  }
  int fd = openat(helper_owner, h->id,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0)
    return 0;
  int ok = !unlinkat(fd, "helper", 0) || errno == ENOENT;
  close(fd);
  if (!ok || unlinkat(helper_owner, h->id, AT_REMOVEDIR))
    return 0;
  memset(h, 0, sizeof *h);
  return 1;
}
static void helpers_cleanup(void) {
  for (int i = 0; i < 8; i++)
    if (helpers[i].id[0] && !helper_remove(&helpers[i]))
      fprintf(stderr, "prototype: helper cleanup retained owned view\n");
  if (helper_owner >= 0) {
    close(helper_owner);
    helper_owner = -1;
  }
  if (helper_parent >= 0) {
    if (helper_owner_path[0] &&
        unlinkat(helper_parent, worker_id, AT_REMOVEDIR) && errno != ENOENT)
      fprintf(stderr, "prototype: retained helper owner directory\n");
    /* The shared managed parent can be left empty by an interrupted creator
     * or a different worker's final cleanup. Remove only the same directory
     * we opened, and only when empty; never traverse or remove foreign data. */
    struct stat opened, named;
#ifdef NATIVE_WORKER_TEST
    int same = !fstat(helper_parent, &opened) &&
               !fstatat(directory, ".views", &named, AT_SYMLINK_NOFOLLOW) &&
               S_ISDIR(named.st_mode) && opened.st_dev == named.st_dev &&
               opened.st_ino == named.st_ino;
    if (same)
      unlinkat(directory, ".views", AT_REMOVEDIR);
#else
    int same = !fstat(helper_parent, &opened) &&
               !lstat("/opt/couchroot-agent/native-helpers", &named) &&
               S_ISDIR(named.st_mode) && opened.st_dev == named.st_dev &&
               opened.st_ino == named.st_ino;
    if (same)
      rmdir("/opt/couchroot-agent/native-helpers");
#endif
    close(helper_parent);
    helper_parent = -1;
  }
}
static J *helper_operation(J *request, const char *op) {
  if (!strcmp(op, "helper.release")) {
    const char *id = textval(request, "helper_id");
    if (!hexvalid(id, 32))
      return failure("Invalid helper ID");
    Helper *h = NULL;
    for (int i = 0; i < 8; i++)
      if (!strcmp(helpers[i].id, id))
        h = &helpers[i];
    if (!h)
      return failure("Unknown helper");
    pthread_mutex_lock(&jobs_mutex);
    int active = 0;
    for (int i = 0; i < 16; i++)
      if (jobs[i].id[0] && !jobs[i].finished)
        active = 1;
    pthread_mutex_unlock(&jobs_mutex);
    if (active)
      return failure("Active jobs must finish before releasing helper views");
    if (!helper_remove(h))
      return failure("Cannot release helper view; retained for inspection");
    J *r = obj();
    boolean(r, "released", 1);
    return success(r);
  }
  if (strcmp(op, "helper.prepare"))
    return failure("Unsupported helper operation");
  const char *path = textval(request, "path"),
             *sha = textval(request, "sha256"), *name;
  if ((production_files ? (!file_path_allowed(path, 1) ||
                           !path_below(path, "/opt/couchroot-agent/files"))
                        : !leaf(path, &name)) ||
      !hexvalid(sha, 64))
    return failure("Invalid helper source or digest");
  Helper *h = NULL;
  for (int i = 0; i < 8; i++)
    if (!helpers[i].id[0]) {
      h = &helpers[i];
      break;
    }
  if (!h)
    return failure("Helper retention limit reached");
  char leafname[256];
  int parent = production_files ? file_parent(path, 0, leafname) : directory;
  if (parent < 0)
    return failure("Helper parent unavailable");
  if (production_files)
    name = leafname;
  int source =
      openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  if (production_files)
    close(parent);
  struct stat st;
  if (source < 0)
    return failure("Helper source unavailable");
  if (fstat(source, &st) || !S_ISREG(st.st_mode) || st.st_uid ||
      (st.st_mode & 022) || st.st_size < 1 || st.st_size > 64 * CHUNK) {
    close(source);
    return failure("Invalid helper source file");
  }
  if (!helpers_available || !helper_storage()) {
    close(source);
    return failure("Private Smack helper staging unavailable");
  }
  unsigned char random[16];
  random_bytes(random, sizeof random);
  hex(random, sizeof random, h->id);
  if (snprintf(h->path, sizeof h->path, "%s/%s", helper_owner_path, h->id) >=
      (int)sizeof h->path)
    fatal("helper path length");
  if (mkdirat(helper_owner, h->id, 0755)) {
    close(source);
    memset(h, 0, sizeof *h);
    return failure("Helper directory unavailable");
  }
  int dir = helper_directory(helper_owner, h->id, NULL), target = -1,
      ok = dir >= 0;
  if (ok) {
    target = openat(dir, "helper",
                    O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0500);
    ok = target >= 0;
  }
  unsigned char buf[65536];
  off_t copied = 0;
  while (ok && copied < st.st_size) {
    size_t wanted = st.st_size - copied > (off_t)sizeof buf
                        ? sizeof buf
                        : (size_t)(st.st_size - copied);
    ssize_t n = request_read(source, buf, wanted);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0 || !request_write(target, buf, n)) {
      ok = 0;
      break;
    }
    copied += n;
  }
  char actual[65];
  if (ok)
    ok = request_filedigest(target, actual) && !strcmp(actual, sha) &&
         !fchmod(target, 0555) && !helper_label(target) && !request_sync(target) &&
         !request_sync(dir);
  close(source);
  if (target >= 0)
    close(target);
  if (dir >= 0)
    close(dir);
  if (ok) {
    ok = !mount(h->path, h->path, NULL, MS_BIND, NULL);
    if (ok) {
      h->mounted = 1;
      ok =
          !mount(NULL, h->path, NULL,
                 MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV, NULL);
    }
  }
  if (!ok) {
    /* Never remove backing files if unmount fails. Keep the ID inspectable. */
    char retained[33];
    strcpy(retained, h->id);
    int removed = helper_remove(h);
    J *r = failure(removed ? "Helper staging failed"
                           : "Helper staging failed; cleanup retained view");
    if (!removed)
      str(r, "helper_id", retained);
    return r;
  }
  J *r = obj();
  str(r, "helper_id", h->id);
  char *binary = format("%s/helper", h->path);
  str(r, "path", binary);
  free(binary);
  str(r, "sha256", sha);
  str(r, "profile", "app");
  return success(r);
}
