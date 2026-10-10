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
    {"INFO", MB_INFO}, {"GET", MB_GET}, {"SET", MB_SET}, {"REBOOT", MB_REBOOT},
    {"DEFAULTS", MB_DEFAULTS}};
  for (const auto &c : COMMANDS)
    if (strlen(c.name) == n && strncmp(cmd, c.name, n) == 0) return c.id;
  return MB_UNKNOWN;
}

void mbCommandWord(const char *line, char *out, size_t outLen) {
  if (outLen == 0) return;
  out[0] = '\0';
  if (strncmp(line, MB_PREFIX, PREFIX_LEN) != 0) return;
  const char *word = line + PREFIX_LEN;
  size_t n = 0;
  while (word[n] != '\0' && word[n] != ' ') n++;
  if (n > 16) n = 16;
  if (n > outLen - 1) n = outLen - 1;
  memcpy(out, word, n);
  out[n] = '\0';
}

MbArgResult mbParseArg(const char *arg, JsonDocument &body, bool &hasId, int32_t &id) {
  hasId = false;
  if (arg[0] == '\0') return MB_ARG_OK;
  if (deserializeJson(body, arg) || !body.is<JsonObject>()) return MB_ARG_BAD_JSON;
  JsonVariantConst v = body["id"];
  if (!v.is<JsonVariantConst>()) return MB_ARG_OK;       // no "id" key
  if (!v.is<int32_t>() || v.as<int32_t>() < 0) return MB_ARG_BAD_ID;
  id = v.as<int32_t>();
  hasId = true;
  return MB_ARG_OK;
}
