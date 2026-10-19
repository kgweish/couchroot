/* Bounded progress leases; only the pulse thread communicates with guardian.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
static unsigned progress_main, progress_jobs;
#define PROGRESS_GRACE_MS 30000U
static unsigned progress_now(void) { return (unsigned)(uint64_t)stamp(); }
static void progress_touch(unsigned *slot) {
  unsigned now = progress_now();
  __atomic_store_n(slot, now ? now : 1, __ATOMIC_RELAXED);
}
static void progress_idle(unsigned *slot) {
  __atomic_store_n(slot, 0, __ATOMIC_RELAXED);
}
static int progress_expired(unsigned *slot) {
  unsigned last = __atomic_load_n(slot, __ATOMIC_RELAXED);
  return last && (int32_t)(progress_now() - last) > (int32_t)PROGRESS_GRACE_MS;
}
#ifdef NATIVE_WORKER_FAULT_TEST
static int progress_test_jobs_stall;
static void progress_test_stall(unsigned *slot) {
  __atomic_store_n(slot, progress_now() - PROGRESS_GRACE_MS - 1000,
                   __ATOMIC_RELAXED);
  for (;;)
    usleep(100000);
}
#endif
