#pragma once
// The web flasher's serial protocol, framing and parsing only:
//   in:  "@MB <COMMAND>[ <json>]\n"     out: "@MB <json>\n"
// Lines without the "@MB " prefix are ignored, so the status line and the
// library logs never collide with it. Pure C++; unit-tested on the PC.
#include <stddef.h>

static const char MB_PREFIX[] = "@MB ";

enum MbCommand { MB_NONE, MB_INFO, MB_GET, MB_SET, MB_REBOOT, MB_UNKNOWN };

// Collects serial bytes into lines; '\r' is ignored. A line longer than
// CAPACITY is dropped whole: TOO_LONG if it started with the prefix (so the
// sender can be told), NOTHING otherwise.
class LineReader {
 public:
  static const size_t CAPACITY = 2048;
  enum Result { NOTHING, LINE, TOO_LONG };

  Result feed(char c);
  // Valid right after feed() returned LINE, until the next feed().
  const char *line() const { return buf_; }

 private:
  char   buf_[CAPACITY + 1] = {0};
  size_t len_ = 0;
  bool   overflow_ = false;
};

// MB_NONE for lines without the prefix. *arg points at the text after the
// command and one space, or at "" when there is none.
MbCommand mbParse(const char *line, const char **arg);
