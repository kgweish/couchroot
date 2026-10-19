/* Successful storage I/O advances the protocol thread's progress lease.
 * Never call these from the job monitor, guardian or pulse thread.
 * EINTR, EOF and failed calls do not prove progress. A blocked syscall stays
 * subject to the existing watchdog; no timer thread extends its lease.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
static void request_progress(void) { progress_touch(&progress_main); }
static int request_filedigest(int fd, char out[65]) {
  return filedigest_progress(fd, out, request_progress);
}
static ssize_t request_read(int fd, void *buf, size_t size) {
  ssize_t n = read(fd, buf, size);
  if (n > 0)
    request_progress();
  return n;
}
static ssize_t request_pread(int fd, void *buf, size_t size, off_t offset) {
  ssize_t n = pread(fd, buf, size, offset);
  if (n > 0)
    request_progress();
  return n;
}
static ssize_t request_pwrite(int fd, const void *buf, size_t size, off_t offset) {
  ssize_t n = pwrite(fd, buf, size, offset);
  if (n > 0)
    request_progress();
  return n;
}
static int request_write(int fd, const void *buf, size_t size) {
  const unsigned char *p = buf;
  while (size) {
    ssize_t n = write(fd, p, size);
    if (n < 0 && errno == EINTR)
      continue;
    if (n <= 0)
      return 0;
    request_progress();
    p += n;
    size -= n;
  }
  return 1;
}
static int request_sync(int fd) {
  int result = fsync(fd);
  if (!result)
    request_progress();
  return result;
}

/* poll rejects nfds=1 when an external resource limit lowers RLIMIT_NOFILE to
 * zero, even though our connected socket remains usable. Preserve production's
 * unbounded idle wait without allocating a descriptor or changing that limit.
 * The limit may already have been restored when poll returns, so do not use a
 * later getrlimit result to reject this fallback. Peek only the first byte,
 * then restore the active-frame receive deadline
 * before the parser runs. The ordinary path remains a single poll call. */
static int request_wait_idle(int fd) {
  struct pollfd ready = {.fd = fd, .events = POLLIN};
  int result;
  do {
    result = poll(&ready, 1, -1);
  } while (result < 0 && errno == EINTR);
  if (result >= 0 || errno != EINVAL)
    return result;
  struct timeval original, idle = {0, 0};
  socklen_t size = sizeof original;
  if (getsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &original, &size) ||
      size != sizeof original ||
      setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &idle, sizeof idle))
    return -1;
  char byte;
  do {
    result = (int)recv(fd, &byte, 1, MSG_PEEK);
  } while (result < 0 && errno == EINTR);
  int saved_errno = errno;
  if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &original, sizeof original))
    return -1;
  errno = saved_errno;
  return result;
}
