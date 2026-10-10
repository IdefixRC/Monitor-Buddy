#include "protocol.h"
#include <string.h>

static const size_t PREFIX_LEN = sizeof(MB_PREFIX) - 1;

LineReader::Result LineReader::feed(char c) {
  if (c == '\r') return NOTHING;
  if (c == '\n') {
    buf_[len_] = '\0';
    size_t n = len_;
    bool wasOverflow = overflow_;
    len_ = 0;
    overflow_ = false;
    if (wasOverflow) return strncmp(buf_, MB_PREFIX, PREFIX_LEN) == 0 ? TOO_LONG : NOTHING;
    return n > 0 ? LINE : NOTHING;
  }
  if (overflow_) return NOTHING;
  if (len_ == CAPACITY) { overflow_ = true; return NOTHING; }
  buf_[len_++] = c;
  return NOTHING;
}

MbCommand mbParse(const char *line, const char **arg) {
  *arg = "";
  if (strncmp(line, MB_PREFIX, PREFIX_LEN) != 0) return MB_NONE;
  const char *cmd = line + PREFIX_LEN;
  const char *space = strchr(cmd, ' ');
  size_t n = space ? (size_t)(space - cmd) : strlen(cmd);
  if (space) *arg = space + 1;
  static const struct { const char *name; MbCommand id; } COMMANDS[] = {
    {"INFO", MB_INFO}, {"GET", MB_GET}, {"SET", MB_SET}, {"REBOOT", MB_REBOOT}};
  for (const auto &c : COMMANDS)
    if (strlen(c.name) == n && strncmp(cmd, c.name, n) == 0) return c.id;
  return MB_UNKNOWN;
}
