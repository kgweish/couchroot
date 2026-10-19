/* Shared private-loopback experiment client. SPDX-License-Identifier: 0BSD */
static pid_t child, worker_pid;
static Wire w;
static int sequence;
static const char *scope, *filescope;
static void stop_child(void) {
  if (child > 0) {
    kill(child, SIGTERM);
    double deadline = stamp() + 15000;
    pid_t got;
    do {
      got = waitpid(child, NULL, WNOHANG);
      if (!got)
        usleep(10000);
    } while (!got && stamp() < deadline);
    if (!got)
      fputs("prototype: guardian still recovering; retain journal for "
            "inspection\n",
            stderr);
    child = 0;
  }
  if (w.fd > 0) {
    close(w.fd);
    w.fd = -1;
  }
}
static J *request(J *j) {
  char *b = base64(json(j), strlen(json(j))),
       *p = format("OP\t%d\t%s", ++sequence, b);
  sendframe(&w, p);
  free(p);
  free(b);
  char *s = receive(&w), *f[4];
  if (fields(s, f, 4) != 3 || strcmp(f[0], "OPRESULT") ||
      atoi(f[1]) != sequence)
    fatal("operation response");
  size_t len;
  unsigned char *data = decode(f[2], &len);
  if (!data || strlen((char *)data) != len)
    fatal("response encoding");
  J *r = parse((char *)data);
  if (!r)
    fatal("response JSON");
  free(data);
  free(s);
  return r;
}
static J *req(const char *op) {
  J *j = obj();
  str(j, "op", op);
  return j;
}
static J *call(J *j) {
  J *r = request(j);
  json_object_put(j);
  if (!json_object_get_boolean(get(r, "ok"))) {
    fprintf(stderr, "operation failed: %s\n", json(r));
    fatal("operation failure");
  }
  return r;
}
static void rejected(J *j) {
  J *r = request(j);
  json_object_put(j);
  if (json_object_get_boolean(get(r, "ok")))
    fatal("unexpected success");
  if (!textval(r, "outcome") || strcmp(textval(r, "outcome"), "failed"))
    fatal("wrong failure outcome");
  json_object_put(r);
}
static void command(const char *cmd, int timeout, int expected, int timed) {
  char *b = base64(cmd, strlen(cmd)),
       *p = format("EXEC\t%d\t%d\t%s", ++sequence, timeout, b);
  sendframe(&w, p);
  free(p);
  free(b);
  char *s = receive(&w), *f[8];
  int n = fields(s, f, 8);
  if (n != 6 || strcmp(f[0], "RESULT") || atoi(f[1]) != sequence ||
      atoi(f[2]) != expected || atoi(f[3]) != timed)
    fatal("command result");
  free(s);
}
static void upload(const char *id, int64_t offset, const unsigned char *data,
                   int length, int good) {
  char sha[65];
  digest(data, length, sha);
  char *p = format("OPWRITE\t%d\t%s\t%" PRId64 "\t%d\t%s", ++sequence, id,
                   offset, length, sha);
  sendframe(&w, p);
  writeall(w.fd, data, length);
  free(p);
  char *s = receive(&w), *f[4];
  if (fields(s, f, 4) != 3 || strcmp(f[0], "OPRESULT") ||
      atoi(f[1]) != sequence)
    fatal("upload response");
  size_t n;
  unsigned char *raw = decode(f[2], &n);
  J *r = raw ? parse((char *)raw) : NULL;
  if (!r || json_object_get_boolean(get(r, "ok")) != good)
    fatal("upload outcome");
  if (good && number(get(r, "result"), "offset") != offset + length)
    fatal("upload offset");
  json_object_put(r);
  free(raw);
  free(s);
}
static char *begin(const char *path, int64_t size, const char *sha,
                   const char *expected) {
  J *j = req("file.begin");
  str(j, "path", path);
  num(j, "size", size);
  str(j, "sha256", sha);
  str(j, "expected_sha256", expected);
  J *r = call(j);
  const char *id = textval(get(r, "result"), "transfer_id");
  if (!id)
    fatal("transfer id");
  char *result = strdup(id);
  json_object_put(r);
  return result;
}
static void transfer_op(const char *op, const char *id, int good) {
  J *j = req(op);
  str(j, "transfer_id", id);
  if (good) {
    J *r = call(j);
    json_object_put(r);
  } else
    rejected(j);
}
static void download(const char *id, int64_t offset, int length,
                     const unsigned char *expected, int expected_length) {
  J *j = req("file.read");
  str(j, "transfer_id", id);
  num(j, "offset", offset);
  num(j, "length", length);
  char *b = base64(json(j), strlen(json(j))),
       *p = format("OP\t%d\t%s", ++sequence, b);
  sendframe(&w, p);
  free(p);
  free(b);
  json_object_put(j);
  char *s = receive(&w), *f[6];
  int64_t got_offset, got_length;
  if (fields(s, f, 6) != 5 || strcmp(f[0], "OPDATA") ||
      atoi(f[1]) != sequence || !decimal(f[2], &got_offset) ||
      got_offset != offset || !decimal(f[3], &got_length) ||
      got_length != expected_length || !hexvalid(f[4], 64))
    fatal("download header");
  unsigned char *raw = allocate(expected_length);
  exact(&w, raw, expected_length);
  char sha[65];
  digest(raw, expected_length, sha);
  if (strcmp(sha, f[4]) || memcmp(raw, expected, expected_length))
    fatal("download digest");
  free(raw);
  free(s);
}
