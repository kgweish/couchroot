/* Bounded guardian diagnostics, separate from command wait status.
 * Original Couchroot code. SPDX-License-Identifier: 0BSD */
#include <sys/mman.h>
#define FAULT_EVENTS 64
/* All fields use 32-bit atomics, also lock-free on the supported ARMv7 target.
 * Only the guardian writes. Sequence checks avoid mixed records on overwrite.
 */
typedef struct {
  unsigned sequence, pid, thread, signal, code, seconds, millis;
} FaultEvent;
typedef struct {
  unsigned total;
  FaultEvent events[FAULT_EVENTS];
} FaultEvents;
static FaultEvents *fault_events;
#define FAULT_LOAD(p) __atomic_load_n((p), __ATOMIC_SEQ_CST)
#define FAULT_STORE(p, v) __atomic_store_n((p), (v), __ATOMIC_SEQ_CST)
static void fault_events_init(void) {
  fault_events = mmap(NULL, sizeof *fault_events, PROT_READ | PROT_WRITE,
                      MAP_SHARED | MAP_ANONYMOUS, -1, 0);
  if (fault_events == MAP_FAILED)
    fatal("guardian diagnostic memory");
}
static void fault_events_readonly(void) {
  if (mprotect(fault_events, sizeof *fault_events, PROT_READ))
    fatal("guardian diagnostic protection");
}
static void fault_event_save(pid_t pid, pid_t thread, int sig, int code) {
  unsigned total = FAULT_LOAD(&fault_events->total);
  /* Saturation is explicit; never reuse a sequence after wrapping. */
  if (total == UINT_MAX)
    return;
  FaultEvent *e = &fault_events->events[total % FAULT_EVENTS];
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now))
    fatal("guardian diagnostic clock");
  FAULT_STORE(&e->sequence, 0);
  FAULT_STORE(&e->pid, (unsigned)pid);
  FAULT_STORE(&e->thread, (unsigned)thread);
  FAULT_STORE(&e->signal, (unsigned)sig);
  FAULT_STORE(&e->code, (unsigned)code);
  FAULT_STORE(&e->seconds, (unsigned)now.tv_sec);
  FAULT_STORE(&e->millis, (unsigned)(now.tv_nsec / 1000000));
  FAULT_STORE(&e->sequence, total + 1);
  FAULT_STORE(&fault_events->total, total + 1);
}
static J *fault_events_snapshot(void) {
  J *r = obj(), *events = json_object_new_array();
  unsigned total = FAULT_LOAD(&fault_events->total),
           first = total > FAULT_EVENTS ? total - FAULT_EVENTS : 0;
  int concurrent = 0;
  for (unsigned i = first; i < total; i++) {
    FaultEvent *e = &fault_events->events[i % FAULT_EVENTS];
    unsigned seq = FAULT_LOAD(&e->sequence), pid = FAULT_LOAD(&e->pid),
             thread = FAULT_LOAD(&e->thread), sig = FAULT_LOAD(&e->signal),
             code = FAULT_LOAD(&e->code), seconds = FAULT_LOAD(&e->seconds),
             millis = FAULT_LOAD(&e->millis);
    if (seq != i + 1 || FAULT_LOAD(&e->sequence) != seq) {
      concurrent = 1;
      continue;
    }
    J *v = obj();
    num(v, "sequence", seq);
    num(v, "pid", pid);
    num(v, "thread_id", thread);
    num(v, "original_signal", sig);
    num(v, "signal_code", (int32_t)code);
    num(v, "termination_signal", SIGKILL);
    num(v, "monotonic_ms", (int64_t)seconds * 1000 + millis);
    str(v, "action", "terminate-faulting-thread-group");
    json_object_array_add(events, v);
  }
  num(r, "total", total);
  num(r, "capacity", FAULT_EVENTS);
  num(r, "overwritten", first);
  boolean(r, "snapshot_incomplete", concurrent);
  boolean(r, "saturated", total == UINT_MAX);
  boolean(r, "durable", 0);
  json_object_object_add(r, "events", events);
  return r;
}
#undef FAULT_LOAD
#undef FAULT_STORE
