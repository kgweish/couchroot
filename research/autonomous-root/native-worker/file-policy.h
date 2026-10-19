/* Production path policy. Traversal holds directory descriptors and never
 * follows symlink components. The experiment policy remains the default.
 * SPDX-License-Identifier: 0BSD */
static int production_files;
static char staging_root[PATH_MAX];
static int path_below(const char *path, const char *base) {
  size_t n = strlen(base);
  return !strncmp(path, base, n) && path[n] == '/' && path[n + 1];
}
static int canonical_file(const char *path) {
  if (!path || path[0] != '/' || strlen(path) >= PATH_MAX || !path[1])
    return 0;
  for (const char *p = path + 1; *p;) {
    const char *end = strchr(p, '/');
    size_t n = end ? (size_t)(end - p) : strlen(p);
    if (!n || n > 255 || (n == 1 && *p == '.') ||
        (n == 2 && p[0] == '.' && p[1] == '.') || (end && !end[1]))
      return 0;
    p += n + (end != NULL);
  }
  return 1;
}
static int file_path_allowed(const char *path, int upload) {
  if (!canonical_file(path))
    return 0;
  /* Keep the experiment's journals and execution views outside file writes. */
  if (path_below(path, root)) {
    const char *relative = path + strlen(root) + 1;
    if (!strncmp(relative, ".jobs", 5) && (!relative[5] || relative[5] == '/'))
      return 0;
    if (!strncmp(relative, ".views", 6) && (!relative[6] || relative[6] == '/'))
      return 0;
  }
  if (!upload)
    return strcmp(path, "/proc") && !path_below(path, "/proc") &&
           strcmp(path, "/sys") && !path_below(path, "/sys") &&
           strcmp(path, "/dev") && !path_below(path, "/dev");
  return path_below(path, root) || path_below(path, staging_root) ||
         path_below(path, "/home/owner/share/tmp/sdk_tools") ||
         path_below(path, "/opt/couchroot-agent/files");
}
/* At most two new descriptors during traversal. Only the fixed managed files
 * directory may be created; arbitrary parents must already exist. */
static int file_parent(const char *path, int upload, char name[256]) {
  if (!file_path_allowed(path, upload)) {
    errno = EINVAL;
    return -1;
  }
  char copy[PATH_MAX];
  strcpy(copy, path);
  char *last = strrchr(copy, '/');
  strcpy(name, last + 1);
  *last = 0;
  int current = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (current < 0)
    return -1;
  char walked[PATH_MAX] = "", *save;
  for (char *part = last == copy ? NULL : strtok_r(copy + 1, "/", &save); part;
       part = strtok_r(NULL, "/", &save)) {
    strcat(walked, "/");
    strcat(walked, part);
    int managed = upload && !strcmp(walked, "/opt/couchroot-agent/files");
    if (managed && mkdirat(current, part, 0700) && errno != EEXIST) {
      close(current);
      return -1;
    }
    int next =
        openat(current, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(current);
    if (next < 0)
      return -1;
    current = next;
    if (managed) {
      struct stat st;
      if (fstat(current, &st) || st.st_uid || fchmod(current, 0700)) {
        close(current);
        return -1;
      }
    }
  }
  return current;
}
/* A replacement must still name the same parent that owns the staged upload.
 * A moved or symlink-substituted parent is rejected; cleanup uses the held fd.
 */
static int file_parent_unchanged(Transfer *t) {
  if (!production_files)
    return 1;
  char name[256];
  int parent = file_parent(t->path, 0, name);
  struct stat old, now;
  int same = parent >= 0 && !strcmp(name, t->name) && !fstat(t->parent, &old) &&
             !fstat(parent, &now) && old.st_dev == now.st_dev &&
             old.st_ino == now.st_ino;
  if (parent >= 0)
    close(parent);
  return same;
}
