/* Bounded continuous /dev/kmsg observation for the benchmark only.
 * Never included in the worker or packaged payload. SPDX-License-Identifier: 0BSD */
#include <pthread.h>

typedef struct {
  int input, stop[2], directory, raw, metadata;
  pthread_t thread;
  unsigned char *bytes;
  size_t capacity, used;
  uint64_t records, first, last, lost, overruns, malformed, reordered;
  int have_sequence, error, limit;
  double monotonic_start, boottime_start, monotonic_end, boottime_end;
  char boot[80];
} BenchKernel;

static double kernel_clock(clockid_t clock) {
  struct timespec value;
  if (clock_gettime(clock, &value))
    fatal("kernel observation clock");
  return value.tv_sec * 1000.0 + value.tv_nsec / 1e6;
}

static int kernel_decimal(const unsigned char **cursor, const unsigned char *end,
                          uint64_t *value) {
  const unsigned char *p = *cursor;
  uint64_t n = 0;
  if (p == end || *p < '0' || *p > '9')
    return 0;
  while (p < end && *p >= '0' && *p <= '9') {
    unsigned digit = *p++ - '0';
    if (n > (UINT64_MAX - digit) / 10)
      return 0;
    n = n * 10 + digit;
  }
  if (p == end || *p++ != ',')
    return 0;
  *cursor = p;
  *value = n;
  return 1;
}

static void kernel_record(BenchKernel *k, const unsigned char *bytes, size_t n) {
  const unsigned char *p = bytes, *end = bytes + n;
  uint64_t priority, sequence, timestamp;
  k->records++;
  /* Additional header fields and continuation lines are preserved verbatim.
   * Only the stable numeric prefix is interpreted. */
  if (!kernel_decimal(&p, end, &priority) ||
      !kernel_decimal(&p, end, &sequence) ||
      !kernel_decimal(&p, end, &timestamp) ||
      !memchr(p, ';', (size_t)(end - p)) || !n || bytes[n - 1] != '\n') {
    k->malformed++;
    return;
  }
  if (!k->have_sequence) {
    k->first = sequence;
    k->have_sequence = 1;
  } else if (sequence <= k->last) {
    k->reordered++;
  } else if (sequence - k->last > 1) {
    uint64_t missing = sequence - k->last - 1;
    if (UINT64_MAX - k->lost < missing)
      k->error = EOVERFLOW;
    else
      k->lost += missing;
  }
  k->last = sequence;
}

static void *kernel_reader(void *argument) {
  BenchKernel *k = argument;
  unsigned char record[65536];
  for (;;) {
    struct pollfd fds[2] = {{k->input, POLLIN, 0}, {k->stop[0], POLLIN, 0}};
    int ready;
    do {
      ready = poll(fds, 2, 250);
    } while (ready < 0 && errno == EINTR);
    if (ready < 0) {
      k->error = errno;
      break;
    }
    int stopping = fds[1].revents != 0;
    if (fds[0].revents || stopping) {
      /* Stop draining a perpetually busy source within a bounded interval.
       * A bounded-prefix result is explicit incomplete evidence. */
      double deadline = kernel_clock(CLOCK_MONOTONIC) + 500;
      for (;;) {
        ssize_t n = read(k->input, record, sizeof record);
        if (n < 0 && errno == EINTR)
          continue;
        if (n < 0 && errno == EPIPE) {
          k->overruns++;
        } else if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
          break;
        } else if (n <= 0) {
          k->error = n < 0 ? errno : EIO;
          break;
        } else if ((size_t)n > k->capacity - k->used) {
          k->limit = 1;
          break;
        } else {
          memcpy(k->bytes + k->used, record, (size_t)n);
          k->used += (size_t)n;
          kernel_record(k, record, (size_t)n);
        }
        if (kernel_clock(CLOCK_MONOTONIC) >= deadline) {
          if (stopping)
            k->error = ETIMEDOUT;
          break;
        }
      }
    }
    if (stopping || k->error || k->limit)
      break;
  }
  k->monotonic_end = kernel_clock(CLOCK_MONOTONIC);
  k->boottime_end = kernel_clock(CLOCK_BOOTTIME);
  return NULL;
}

/* The internal fd entry permits socket-record fixtures without a kernel write.
 * The benchmark entry below always opens the real kernel device read-only. */
static void kernel_begin_fd(BenchKernel *k, int input, const char *directory,
                            size_t capacity) {
  memset(k, 0, sizeof *k);
  if (!capacity || capacity > 2 * CHUNK)
    fatal("kernel observation capacity");
  k->input = input;
  k->capacity = capacity;
  k->bytes = allocate(capacity);
  /* Touch the bounded capture allocation before the measurement window. */
  long page = sysconf(_SC_PAGESIZE);
  if (page <= 0)
    fatal("kernel observation page size");
  volatile unsigned char *touch = k->bytes;
  for (size_t i = 0; i < capacity; i += (size_t)page)
    touch[i] = 0;
  touch[capacity - 1] = 0;
  k->directory = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (k->directory < 0 || fstat(k->directory, &st) || st.st_uid ||
      (st.st_mode & 077))
    fatal("private kernel observation directory");
  k->raw = openat(k->directory, "kernel.raw",
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (k->raw < 0)
    fatal("exclusive kernel observation data");
  k->metadata = openat(k->directory, "kernel.json",
                       O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (k->raw < 0 || k->metadata < 0)
    fatal("exclusive kernel observation files");
  int flags = fcntl(input, F_GETFL);
  if (flags < 0 || fcntl(input, F_SETFL, flags | O_NONBLOCK) ||
      pipe2(k->stop, O_CLOEXEC))
    fatal("kernel observation descriptors");
  readtext("/proc/sys/kernel/random/boot_id", k->boot, sizeof k->boot);
  k->boot[strcspn(k->boot, "\n")] = 0;
  k->monotonic_start = kernel_clock(CLOCK_MONOTONIC);
  k->boottime_start = kernel_clock(CLOCK_BOOTTIME);
  if (pthread_create(&k->thread, NULL, kernel_reader, k))
    fatal("kernel observation thread");
}

static void kernel_begin(BenchKernel *k, const char *directory) {
  int input = open("/dev/kmsg", O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW);
  struct stat st;
  if (input < 0 || fstat(input, &st) || !S_ISCHR(st.st_mode) ||
      lseek(input, 0, SEEK_END) < 0)
    fatal("kernel observation cursor");
  kernel_begin_fd(k, input, directory, 2 * CHUNK);
}

static int kernel_end(BenchKernel *k) {
  writeall(k->stop[1], "1", 1);
  if (pthread_join(k->thread, NULL))
    fatal("kernel observation join");
  double elapsed = k->monotonic_end - k->monotonic_start;
  double suspend = (k->boottime_end - k->boottime_start) - elapsed;
  if (k->lost > INT64_MAX)
    k->error = EOVERFLOW;
  int complete = !k->error && !k->limit && !k->overruns && !k->lost &&
                 !k->malformed && !k->reordered && suspend < 100;
  J *report = obj();
  num(report, "schema", 1);
  str(report, "source", "/dev/kmsg read-only cursor after SEEK_END");
  str(report, "boot_id", k->boot);
  boolean(report, "complete", complete);
  num(report, "records", k->records);
  num(report, "bytes", k->used);
  num(report, "capacity_bytes", k->capacity);
  num(report, "overruns", k->overruns);
  json_object_object_add(report, "known_sequence_gaps",
                         k->lost <= INT64_MAX ? json_object_new_int64(k->lost) : NULL);
  num(report, "malformed_records", k->malformed);
  num(report, "reordered_records", k->reordered);
  num(report, "read_error", k->error);
  boolean(report, "capacity_exceeded", k->limit);
  boolean(report, "suspend_detected", suspend >= 100);
  /* Preserve all 64 sequence bits, including for JavaScript consumers. */
  char first[32], last[32];
  snprintf(first, sizeof first, "%" PRIu64, k->first);
  snprintf(last, sizeof last, "%" PRIu64, k->last);
  json_object_object_add(report, "first_sequence", k->have_sequence ? json_object_new_string(first) : NULL);
  json_object_object_add(report, "last_sequence", k->have_sequence ? json_object_new_string(last) : NULL);
  json_object_object_add(report, "monotonic_start_ms", json_object_new_double(k->monotonic_start));
  json_object_object_add(report, "monotonic_end_ms", json_object_new_double(k->monotonic_end));
  json_object_object_add(report, "boottime_start_ms", json_object_new_double(k->boottime_start));
  json_object_object_add(report, "boottime_end_ms", json_object_new_double(k->boottime_end));
  str(report, "storage", "bounded memory during capture; files synced after capture ends");
  writeall(k->raw, k->bytes, k->used);
  const char *text = json(report);
  writeall(k->metadata, text, strlen(text));
  if (fsync(k->raw) || fsync(k->metadata) || fsync(k->directory))
    fatal("kernel observation persistence");
  json_object_put(report);
  close(k->raw);
  close(k->metadata);
  close(k->directory);
  close(k->input);
  close(k->stop[0]);
  close(k->stop[1]);
  free(k->bytes);
  return complete;
}
