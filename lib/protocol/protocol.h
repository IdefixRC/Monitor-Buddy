#pragma once
// The web flasher's serial protocol, framing and parsing only:
//   in:  "@MB <COMMAND>[ <json>]\n"     out: "@MB <json>\n"
// Lines without the "@MB " prefix are ignored, so the status line and the
// library logs never collide with it. Pure C++; unit-tested on the PC.
//
// Every reply carries "cmd" (the command word the request sent). A request
// may carry an integer "id" in its JSON argument, which the reply echoes.
#include <stddef.h>
#include <stdint.h>
#include <ArduinoJson.h>

static const char MB_PREFIX[] = "@MB ";

enum MbCommand { MB_NONE, MB_INFO, MB_GET, MB_SET, MB_REBOOT, MB_DEFAULTS, MB_UNKNOWN };

// Collects serial bytes into lines; '\r' is ignored. A line longer than
// CAPACITY is dropped whole: TOO_LONG if it started with the prefix (so the
// sender can be told), NOTHING otherwise.
class LineReader {
 public:
  static const size_t CAPACITY = 2048;
  enum Result { NOTHING, LINE, TOO_LONG };

  Result feed(char c);
  // Valid right after feed() returned LINE or TOO_LONG (then the first
  // CAPACITY characters), until the next feed().
  const char *line() const { return buf_; }

 private:
  char   buf_[CAPACITY + 1] = {0};
  size_t len_ = 0;
  bool   overflow_ = false;
};

// MB_NONE for lines without the prefix. *arg points at the text after the
// command and one space, or at "" when there is none.
MbCommand mbParse(const char *line, const char **arg);

// Copies the command word (the text after "@MB " up to a space or the end) into
// out, cut to 16 characters and to outLen - 1, and NUL-terminates it. Writes ""
// when the line has no prefix. Use it for the "cmd" echo of unknown commands
// and of lines that were too long; out needs 17 bytes to hold the full 16.
void mbCommandWord(const char *line, char *out, size_t outLen);

enum MbArgResult { MB_ARG_OK, MB_ARG_BAD_JSON, MB_ARG_BAD_ID };

// Parses the argument that mbParse() returned. "" is MB_ARG_OK with body left
// null and hasId false. Otherwise the argument must be a JSON object, which
// goes into body (else MB_ARG_BAD_JSON). Its optional "id" must be an integer
// from 0 to 2147483647 (else MB_ARG_BAD_ID). hasId and id are only set on
// MB_ARG_OK; hasId is false on every error.
MbArgResult mbParseArg(const char *arg, JsonDocument &body, bool &hasId, int32_t &id);
