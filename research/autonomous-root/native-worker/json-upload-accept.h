/* Legacy JSON chunk and binary chunk interoperability within one transfer.
 * SPDX-License-Identifier: 0BSD */
static void json_upload_checks(void) {
  unsigned char *bytes = allocate(CHUNK + 3);
  for (size_t i = 0; i < CHUNK + 3; i++)
    bytes[i] = (unsigned char)(i % 251);
  char full[65], chunk[65];
  digest(bytes, CHUNK + 3, full);
  digest(bytes, CHUNK, chunk);
  char *path = format("%s/json-upload-fixture", filescope);
  J *j = req("file.begin");
  str(j, "path", path);
  num(j, "size", CHUNK + 3);
  str(j, "sha256", full);
  str(j, "expected_sha256", "absent");
  J *r = call(j);
  char *id = strdup(textval(get(r, "result"), "transfer_id"));
  discard(r);
  char *data = base64(bytes, CHUNK);
  j = req("file.write");
  str(j, "transfer_id", id);
  num(j, "offset", 1);
  str(j, "data", data);
  str(j, "sha256", chunk);
  rejected(j);
  j = req("file.status");
  str(j, "transfer_id", id);
  r = call(j);
  if (number(get(r, "result"), "offset"))
    fatal("rejected JSON upload changed offset");
  discard(r);
  j = req("file.write");
  str(j, "transfer_id", id);
  num(j, "offset", 0);
  str(j, "data", data);
  str(j, "sha256", chunk);
  r = call(j);
  if (number(get(r, "result"), "offset") != CHUNK)
    fatal("JSON upload offset");
  discard(r);
  free(data);
  upload(id, CHUNK, bytes + CHUNK, 3, 1);
  j = req("file.commit");
  str(j, "transfer_id", id);
  discard(call(j));
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  char actual[65];
  if (fd < 0 || !filedigest(fd, actual) || strcmp(actual, full))
    fatal("mixed JSON binary upload digest");
  close(fd);
  if (unlink(path))
    fatal("JSON upload fixture cleanup");
  free(id);
  free(path);
  free(bytes);
  mark("json_upload_chunk_limit_and_binary_interoperability");
}
